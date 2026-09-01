// ============================================================================
// STORE CONNECT - SINCRONIZAÇÃO DE VENDA OFFLINE
// ============================================================================
//
// Arquivo:
//   functions/sales/syncOfflineSale.js
//
// OBJETIVO:
//
// Receber uma venda persistida localmente pelo Flutter e registrá-la de forma
// idempotente no Firestore, baixando o estoque exatamente uma vez.
//
// FLUXO:
//
// Flutter / SQLite
//      ↓
// OfflineSalesSyncService
//      ↓
// callable syncOfflineSale
//      ↓
// transação Firestore
//      ↓
// stores/{storeId}/sales/{localSaleId}
//      +
// baixa do estoque dos produtos
//
// IDEMPOTÊNCIA:
//
// O localSaleId é usado como ID definitivo do documento da venda.
//
// Se uma tentativa anterior já criou a venda:
//
// - retorna sucesso;
// - não baixa estoque novamente;
// - não recria auditoria;
// - não repete efeitos colaterais.
//
// SEGURANÇA - FASE ATUAL:
//
// - exige Firebase Authentication;
// - exige que request.auth.uid seja ownerId da loja;
// - exige assinatura active, trial ou overdue;
// - valida a estrutura dos produtos;
// - valida quantidade inteira positiva;
// - valida total informado contra os itens persistidos offline;
// - verifica a existência real dos produtos no Firestore.
//
// PRODUTOS ARQUIVADOS:
//
// Produto arquivado NÃO pode participar de uma nova venda.
//
// Entretanto, existe um caso legítimo importante:
//
//   15:00 → terminal está offline e realiza venda
//   16:00 → outro terminal arquiva o produto
//   17:00 → venda antiga volta a ter internet e sincroniza
//
// Nesse caso, bloquear simplesmente porque o produto está arquivado causaria
// perda operacional de uma venda que realmente aconteceu.
//
// Portanto:
//
//   sale.createdAt <= product.archivedAt
//       → venda offline anterior ao arquivamento é aceita.
//
//   sale.createdAt > product.archivedAt
//       → venda posterior ao arquivamento é rejeitada.
//
// Se uma venda anterior ao arquivamento for aceita, o documento da venda
// registra:
//
//   containsArchivedProductsAtSync: true
//   archivedProductsAtSync: [...]
//
// e também é criado um auditLog específico.
//
// IMPORTANTE:
//
// `createdAt` da venda offline é originado no dispositivo. Portanto essa regra
// é uma proteção operacional compatível com o fluxo offline atual, e não uma
// prova criptográfica do momento exato da venda.
//
// Caso futuramente seja necessário um nível ainda maior de garantia para
// terminais offline, podemos introduzir uma autorização/lease assinada pelo
// backend antes da perda de conexão.
//
// FUNCIONÁRIOS:
//
// Nesta etapa mantemos a autorização atual somente para o proprietário.
//
// A migração para:
//
// - admin
// - gerente
// - operador
//
// deve ser feita juntamente com o endurecimento das Firestore Rules, evitando
// ampliar confiança em users/{uid} antes que o próprio usuário deixe de poder
// alterar campos críticos como role e storeId.
//
// ESTOQUE:
//
// - sem lotes: decrementa quantidade;
// - com lotes: baixa FIFO pela validade;
// - quantidade permanece inteira;
// - falta de estoque aborta toda a transação.
//
// FISCAL:
//
// Esta função NÃO emite NFC-e.
//
// Ela apenas informa shouldRequestNfce no retorno.
//
// A emissão fiscal ocorre posteriormente e não deve desfazer uma venda já
// confirmada.
//
// ============================================================================

"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");

// ============================================================================
// NORMALIZA STRING
// ============================================================================

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

// ============================================================================
// GARANTE OBJETO
// ============================================================================

function asObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

// ============================================================================
// NÚMERO FINITO
// ============================================================================

function asFiniteNumber(
    value,
    fieldName,
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} deve ser numérico.`,
    );
  }

  return number;
}

// ============================================================================
// INTEIRO POSITIVO
// ============================================================================

function asPositiveInteger(
    value,
    fieldName,
) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number <= 0
  ) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} deve ser um inteiro positivo.`,
    );
  }

  return number;
}

// ============================================================================
// DINHEIRO
// ============================================================================

function normalizeMoney(value) {
  return (
    Math.round(Number(value) * 100) /
    100
  );
}

// ============================================================================
// DATA DA VENDA
// ============================================================================

function parseCreatedAt(value) {
  const text = normalizeString(value);

  if (!text) {
    return admin.firestore.Timestamp.now();
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new HttpsError(
        "invalid-argument",
        "createdAt inválido.",
    );
  }

  return admin.firestore.Timestamp
      .fromDate(date);
}

// ============================================================================
// PRODUTOS DA VENDA
// ============================================================================

function normalizeProducts(rawProducts) {
  if (
    !Array.isArray(rawProducts) ||
    rawProducts.length === 0
  ) {
    throw new HttpsError(
        "invalid-argument",
        "A venda deve possuir ao menos um produto.",
    );
  }

  return rawProducts.map(
      (rawItem, index) => {
        const item =
          asObject(rawItem);

        const productId =
          normalizeString(
              item.productId,
          );

        const name =
          normalizeString(
              item.name,
          );

        const quantity =
          asPositiveInteger(
              item.quantity,
              `products[${index}].quantity`,
          );

        const price =
          asFiniteNumber(
              item.price,
              `products[${index}].price`,
          );

        if (!productId) {
          throw new HttpsError(
              "invalid-argument",
              `products[${index}].productId é obrigatório.`,
          );
        }

        if (!name) {
          throw new HttpsError(
              "invalid-argument",
              `products[${index}].name é obrigatório.`,
          );
        }

        if (price < 0) {
          throw new HttpsError(
              "invalid-argument",
              `products[${index}].price não pode ser negativo.`,
          );
        }

        return {
          productId,
          name,
          quantity,
          price:
            normalizeMoney(price),
        };
      },
  );
}

// ============================================================================
// TOTAL
// ============================================================================

function validateTotal(
    products,
    rawTotal,
) {
  const informedTotal =
    normalizeMoney(
        asFiniteNumber(
            rawTotal,
            "totalAmount",
        ),
    );

  if (informedTotal < 0) {
    throw new HttpsError(
        "invalid-argument",
        "totalAmount não pode ser negativo.",
    );
  }

  const calculatedTotal =
    normalizeMoney(
        products.reduce(
            (sum, item) =>
              sum +
              item.price *
              item.quantity,
            0,
        ),
    );

  if (
    Math.abs(
        calculatedTotal -
        informedTotal,
    ) > 0.01
  ) {
    throw new HttpsError(
        "failed-precondition",
        "O total da venda não confere com os itens armazenados offline.",
    );
  }

  return informedTotal;
}

// ============================================================================
// ASSINATURA
// ============================================================================

function isAllowedSubscriptionStatus(
    status,
) {
  return [
    "active",
    "trial",
    "overdue",
  ].includes(status);
}

// ============================================================================
// NFC-E
// ============================================================================

function shouldRequestNfce(store) {
  const subscriptionType =
    normalizeString(
        store.subscriptionType ||
        store.plan ||
        store.plano ||
        store.subscriptionPlan,
    ).toLowerCase();

  const perfilFiscal =
    asObject(store.perfilFiscal);

  return (
    subscriptionType === "business" &&
    perfilFiscal.configurado === true
  );
}

// ============================================================================
// TIMESTAMP PARA MILISSEGUNDOS
//
// Utilizado na ordenação dos lotes.
// ============================================================================

function timestampMillis(value) {
  if (
    value &&
    typeof value.toMillis ===
      "function"
  ) {
    return value.toMillis();
  }

  if (
    value &&
    typeof value.toDate ===
      "function"
  ) {
    return value.toDate().getTime();
  }

  const parsed =
    new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : Number.MAX_SAFE_INTEGER;
}

// ============================================================================
// TIMESTAMP ESTRITO PARA COMPARAÇÃO
//
// Diferentemente de timestampMillis(), aqui um valor inválido retorna null.
//
// Isso é importante para produtos arquivados: se isArchived == true mas o
// archivedAt estiver ausente/corrompido, adotamos comportamento seguro e
// rejeitamos a venda.
// ============================================================================

function timestampMillisOrNull(value) {
  if (
    value &&
    typeof value.toMillis ===
      "function"
  ) {
    const millis =
      value.toMillis();

    return Number.isFinite(millis)
      ? millis
      : null;
  }

  if (
    value &&
    typeof value.toDate ===
      "function"
  ) {
    const millis =
      value.toDate().getTime();

    return Number.isFinite(millis)
      ? millis
      : null;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

// ============================================================================
// BAIXA FIFO DOS LOTES
// ============================================================================

function buildUpdatedLots({
  rawLots,
  quantityToRemove,
  productName,
}) {
  const activeLots =
    rawLots
        .filter(
            (rawLot) => {
              const lot =
                asObject(rawLot);

              return (
                Number(
                    lot.quantidade,
                ) > 0
              );
            },
        )
        .map(
            (rawLot) => ({
              ...asObject(rawLot),
            }),
        );

  activeLots.sort(
      (a, b) =>
        timestampMillis(
            a.validade,
        ) -
        timestampMillis(
            b.validade,
        ),
  );

  let remaining =
    quantityToRemove;

  const updatedLots = [];

  for (const lot of activeLots) {
    const currentQuantity =
      asPositiveInteger(
          lot.quantidade,
          `quantidade do lote de ${productName}`,
      );

    if (remaining <= 0) {
      updatedLots.push(lot);

      continue;
    }

    if (
      currentQuantity <=
      remaining
    ) {
      remaining -=
        currentQuantity;

      continue;
    }

    updatedLots.push({
      ...lot,

      quantidade:
        currentQuantity -
        remaining,
    });

    remaining = 0;
  }

  if (remaining > 0) {
    throw new HttpsError(
        "failed-precondition",
        `Estoque insuficiente para ${productName} nos lotes.`,
    );
  }

  const newTotal =
    updatedLots.reduce(
        (sum, lot) =>
          sum +
          Number(
              lot.quantidade || 0,
          ),
        0,
    );

  if (!Number.isInteger(newTotal)) {
    throw new HttpsError(
        "failed-precondition",
        `Estoque inválido após baixa de ${productName}.`,
    );
  }

  return {
    updatedLots,
    newTotal,
  };
}

// ============================================================================
// CALLABLE
// ============================================================================

const syncOfflineSale = onCall(
    {
      timeoutSeconds: 60,
      memory: "256MiB",
    },

    async (request) => {
      // ======================================================================
      // 1. AUTENTICAÇÃO
      // ======================================================================

      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "O usuário deve estar logado.",
        );
      }

      const uid =
        request.auth.uid;

      // ======================================================================
      // 2. DADOS DA VENDA
      // ======================================================================

      const storeId =
        normalizeString(
            request.data?.storeId,
        );

      const localSaleId =
        normalizeString(
            request.data?.localSaleId,
        );

      const paymentMethod =
        normalizeString(
            request.data?.paymentMethod,
        );

      const notes =
        normalizeString(
            request.data?.notes,
        );

      const customerId =
        normalizeString(
            request.data?.customerId,
        );

      const customerName =
        normalizeString(
            request.data?.customerName,
        );

      // ======================================================================
      // 3. VALIDAÇÃO BÁSICA
      // ======================================================================

      if (!storeId) {
        throw new HttpsError(
            "invalid-argument",
            "storeId é obrigatório.",
        );
      }

      if (!localSaleId) {
        throw new HttpsError(
            "invalid-argument",
            "localSaleId é obrigatório.",
        );
      }

      if (!paymentMethod) {
        throw new HttpsError(
            "invalid-argument",
            "paymentMethod é obrigatório.",
        );
      }

      const products =
        normalizeProducts(
            request.data?.products,
        );

      const totalAmount =
        validateTotal(
            products,
            request.data?.totalAmount,
        );

      const createdAt =
        parseCreatedAt(
            request.data?.createdAt,
        );

      const saleCreatedAtMillis =
        createdAt.toMillis();

      // ======================================================================
      // 4. REFERÊNCIAS FIRESTORE
      // ======================================================================

      const db =
        admin.firestore();

      const storeRef =
        db.collection("stores")
            .doc(storeId);

      const saleRef =
        storeRef
            .collection("sales")
            .doc(localSaleId);

      // Audit usado somente quando uma venda legitimamente criada antes do
      // arquivamento contém produto que já está arquivado no momento do sync.
      const archivedProductAuditRef =
        storeRef
            .collection("auditLogs")
            .doc();

      try {
        // ====================================================================
        // 5. TRANSAÇÃO
        // ====================================================================

        const result =
          await db.runTransaction(
              async (transaction) => {
                // ============================================================
                // FASE 1 - TODAS AS LEITURAS
                // ============================================================

                const storeSnapshot =
                  await transaction.get(
                      storeRef,
                  );

                if (!storeSnapshot.exists) {
                  throw new HttpsError(
                      "not-found",
                      "Loja não encontrada.",
                  );
                }

                const store =
                  storeSnapshot.data() ||
                  {};

                // ============================================================
                // AUTORIZAÇÃO ATUAL: PROPRIETÁRIO
                // ============================================================

                const ownerId =
                  normalizeString(
                      store.ownerId,
                  );

                if (
                  !ownerId ||
                  ownerId !== uid
                ) {
                  throw new HttpsError(
                      "permission-denied",
                      "Somente o proprietário da loja pode sincronizar vendas offline nesta etapa.",
                  );
                }

                // ============================================================
                // ASSINATURA
                // ============================================================

                const subscriptionStatus =
                  normalizeString(
                      store.subscriptionStatus,
                  ).toLowerCase();

                if (
                  !isAllowedSubscriptionStatus(
                      subscriptionStatus,
                  )
                ) {
                  throw new HttpsError(
                      "failed-precondition",
                      "A assinatura da loja está inativa ou expirada.",
                  );
                }

                // ============================================================
                // IDEMPOTÊNCIA
                //
                // A leitura da venda ocorre antes de qualquer write.
                //
                // Se a venda já existe, encerramos sem:
                // - baixar estoque;
                // - repetir auditoria;
                // - criar venda novamente.
                // ============================================================

                const existingSaleSnapshot =
                  await transaction.get(
                      saleRef,
                  );

                if (
                  existingSaleSnapshot
                      .exists
                ) {
                  const existing =
                    existingSaleSnapshot
                        .data() ||
                    {};

                  const existingLocalId =
                    normalizeString(
                        existing.localSaleId,
                    );

                  if (
                    existingLocalId &&
                    existingLocalId !==
                      localSaleId
                  ) {
                    throw new HttpsError(
                        "already-exists",
                        "O identificador local conflita com uma venda existente.",
                    );
                  }

                  return {
                    alreadyProcessed:
                      true,

                    serverSaleId:
                      saleRef.id,

                    shouldRequestNfce:
                      shouldRequestNfce(
                          store,
                      ),

                    archivedProductsAtSync:
                      [],
                  };
                }

                // ============================================================
                // PRODUTOS
                // ============================================================

                const productSnapshots =
                  new Map();

                const archivedProductsAtSync =
                  [];

                for (
                  const item of products
                ) {
                  const productRef =
                    storeRef
                        .collection(
                            "products",
                        )
                        .doc(
                            item.productId,
                        );

                  const productSnapshot =
                    await transaction.get(
                        productRef,
                    );

                  if (
                    !productSnapshot.exists
                  ) {
                    throw new HttpsError(
                        "not-found",
                        `Produto ${item.name} não encontrado.`,
                    );
                  }

                  const product =
                    productSnapshot
                        .data() ||
                    {};

                  const canonicalName =
                    normalizeString(
                        product.name,
                    ) ||
                    item.name;

                  // ==========================================================
                  // PRODUTO ARQUIVADO
                  // ==========================================================

                  if (
                    product.isArchived ===
                    true
                  ) {
                    const archivedAtMillis =
                      timestampMillisOrNull(
                          product.archivedAt,
                      );

                    // --------------------------------------------------------
                    // Falha segura.
                    //
                    // Um produto marcado como arquivado precisa ter archivedAt
                    // confiável para que possamos saber se a venda ocorreu
                    // antes ou depois.
                    // --------------------------------------------------------

                    if (
                      archivedAtMillis ===
                      null
                    ) {
                      throw new HttpsError(
                          "failed-precondition",
                          `O produto ${canonicalName} está arquivado e não possui data de arquivamento válida.`,
                      );
                    }

                    // --------------------------------------------------------
                    // Venda criada DEPOIS do arquivamento.
                    //
                    // Não pode sincronizar.
                    // --------------------------------------------------------

                    if (
                      saleCreatedAtMillis >
                      archivedAtMillis
                    ) {
                      throw new HttpsError(
                          "failed-precondition",
                          `O produto ${canonicalName} foi arquivado antes desta venda e não pode mais ser vendido.`,
                      );
                    }

                    // --------------------------------------------------------
                    // Venda criada ANTES do arquivamento.
                    //
                    // Foi uma operação offline legítima já realizada.
                    //
                    // Permitimos a sincronização e deixamos trilha explícita.
                    // --------------------------------------------------------

                    archivedProductsAtSync
                        .push({
                          productId:
                            item.productId,

                          name:
                            canonicalName,

                          archivedAt:
                            product.archivedAt,
                        });
                  }

                  productSnapshots.set(
                      item.productId,
                      productSnapshot,
                  );
                }

                // ============================================================
                // FASE 2 - ESCRITAS DE ESTOQUE
                // ============================================================

                for (
                  const item of products
                ) {
                  const productSnapshot =
                    productSnapshots.get(
                        item.productId,
                    );

                  const product =
                    productSnapshot
                        .data() ||
                    {};

                  const productRef =
                    productSnapshot.ref;

                  const canonicalName =
                    normalizeString(
                        product.name,
                    ) ||
                    item.name;

                  const rawLots =
                    Array.isArray(
                        product.lotes,
                    )
                      ? product.lotes
                      : [];

                  // ==========================================================
                  // SEM LOTES
                  // ==========================================================

                  if (
                    rawLots.length === 0
                  ) {
                    const currentQuantity =
                      Number(
                          product
                              .quantidade ||
                          0,
                      );

                    if (
                      !Number.isInteger(
                          currentQuantity,
                      )
                    ) {
                      throw new HttpsError(
                          "failed-precondition",
                          `Estoque inválido para ${canonicalName}.`,
                      );
                    }

                    if (
                      currentQuantity <
                      item.quantity
                    ) {
                      throw new HttpsError(
                          "failed-precondition",
                          `Estoque insuficiente para ${canonicalName}.`,
                      );
                    }

                    transaction.update(
                        productRef,
                        {
                          quantidade:
                            admin.firestore
                                .FieldValue
                                .increment(
                                    -item
                                        .quantity,
                                ),
                        },
                    );

                    continue;
                  }

                  // ==========================================================
                  // COM LOTES
                  // ==========================================================

                  const lotResult =
                    buildUpdatedLots({
                      rawLots,

                      quantityToRemove:
                        item.quantity,

                      productName:
                        canonicalName,
                    });

                  transaction.update(
                      productRef,
                      {
                        quantidade:
                          lotResult
                              .newTotal,

                        lotes:
                          lotResult
                              .updatedLots,
                      },
                  );
                }

                // ============================================================
                // FASE 3 - REGISTRO DA VENDA
                // ============================================================

                const containsArchivedProductsAtSync =
                  archivedProductsAtSync
                      .length >
                  0;

                transaction.create(
                    saleRef,
                    {
                      totalAmount,
                      products,
                      createdAt,
                      storeId,

                      notes:
                        notes || null,

                      paymentMethod,

                      isPaid:
                        true,

                      customerId:
                        customerId ||
                        null,

                      customerName:
                        customerName ||
                        null,

                      localSaleId,

                      syncOrigin:
                        "offline",

                      syncedBy:
                        uid,

                      syncedAt:
                        admin.firestore
                            .FieldValue
                            .serverTimestamp(),

                      // ======================================================
                      // RASTREABILIDADE DE PRODUTOS ARQUIVADOS
                      // ======================================================

                      containsArchivedProductsAtSync,

                      archivedProductsAtSync:
                        archivedProductsAtSync,
                    },
                );

                // ============================================================
                // AUDITORIA ESPECIAL
                //
                // Só existe quando uma venda legítima feita antes do
                // arquivamento sincroniza depois.
                // ============================================================

                if (
                  containsArchivedProductsAtSync
                ) {
                  transaction.set(
                      archivedProductAuditRef,
                      {
                        action:
                          "offline_sale_with_archived_product_accepted",

                        entityType:
                          "sale",

                        entityId:
                          localSaleId,

                        storeId,

                        performedBy: {
                          uid,
                          role:
                            "owner",
                        },

                        reason:
                          "Venda criada offline antes do arquivamento do produto.",

                        saleCreatedAt:
                          createdAt,

                        archivedProducts:
                          archivedProductsAtSync,

                        createdAt:
                          admin.firestore
                              .FieldValue
                              .serverTimestamp(),
                      },
                  );
                }

                return {
                  alreadyProcessed:
                    false,

                  serverSaleId:
                    saleRef.id,

                  shouldRequestNfce:
                    shouldRequestNfce(
                        store,
                    ),

                  archivedProductsAtSync,
                };
              },
          );

        // ====================================================================
        // LOG
        // ====================================================================

        console.log(
            "[syncOfflineSale] Venda sincronizada:",
            {
              storeId,

              localSaleId,

              alreadyProcessed:
                result
                    .alreadyProcessed,

              archivedProductsAccepted:
                result
                    .archivedProductsAtSync
                    .length,
            },
        );

        // ====================================================================
        // RETORNO
        // ====================================================================

        return {
          success:
            true,

          localSaleId,

          serverSaleId:
            result.serverSaleId,

          alreadyProcessed:
            result
                .alreadyProcessed,

          shouldRequestNfce:
            result
                .shouldRequestNfce,

          archivedProductsAccepted:
            result
                .archivedProductsAtSync
                .length,
        };
      } catch (error) {
        // ====================================================================
        // HTTpsError CONHECIDO
        // ====================================================================

        if (
          error instanceof
          HttpsError
        ) {
          throw error;
        }

        // ====================================================================
        // ERRO INESPERADO
        // ====================================================================

        console.error(
            "[syncOfflineSale] Erro inesperado:",
            {
              storeId,

              localSaleId,

              error:
                error?.message ||
                error,
            },
        );

        throw new HttpsError(
            "internal",
            "Não foi possível sincronizar a venda offline.",
        );
      }
    },
);

module.exports = {
  syncOfflineSale,
};