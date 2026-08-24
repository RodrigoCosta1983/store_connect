// ============================================================================
// STORE CONNECT - SINCRONIZAÇÃO DE VENDA OFFLINE
// ============================================================================
//
// Arquivo:
//   functions/sales/syncOfflineSale.js
//
// Objetivo:
//   Receber uma venda persistida localmente pelo Flutter e registrá-la de forma
//   idempotente no Firestore, baixando o estoque exatamente uma vez.
//
// Fluxo:
//   Flutter / SQLite
//        ↓
//   OfflineSalesSyncService
//        ↓
//   callable syncOfflineSale
//        ↓
//   transação Firestore
//        ↓
//   stores/{storeId}/sales/{localSaleId}
//        +
//   baixa do estoque dos produtos
//
// IDEMPOTÊNCIA:
//   O localSaleId é usado como ID definitivo do documento da venda.
//   Se uma tentativa anterior já tiver criado esse documento, a função retorna
//   sucesso sem baixar estoque novamente.
//
// SEGURANÇA - FASE ATUAL:
//   - exige usuário autenticado;
//   - exige que request.auth.uid seja ownerId da loja;
//   - exige assinatura active, trial ou overdue;
//   - valida a estrutura dos produtos;
//   - valida quantidade inteira positiva;
//   - valida total informado contra a soma dos itens.
//
// IMPORTANTE SOBRE FUNCIONÁRIOS:
//   Nesta primeira versão segura, a callable aceita somente o proprietário.
//   Não foi presumido um schema de funcionários/permissões que não está
//   confirmado. Quando o schema de colaboradores for ligado ao backend,
//   a autorização poderá ser ampliada sem alterar a idempotência da venda.
//
// ESTOQUE:
//   - sem lotes: decrementa quantidade;
//   - com lotes: baixa FIFO pela validade;
//   - quantidade permanece inteira;
//   - falta de estoque aborta a transação inteira.
//
// FISCAL:
//   Esta função NÃO emite NFC-e.
//   Ela apenas informa shouldRequestNfce no retorno.
//   A emissão fiscal é uma etapa posterior e não pode desfazer a venda.
//
// ============================================================================

"use strict";

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function asFiniteNumber(value, fieldName) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} deve ser numérico.`,
    );
  }

  return number;
}

function asPositiveInteger(value, fieldName) {
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

function normalizeMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

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

  return admin.firestore.Timestamp.fromDate(date);
}

function normalizeProducts(rawProducts) {
  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    throw new HttpsError(
        "invalid-argument",
        "A venda deve possuir ao menos um produto.",
    );
  }

  return rawProducts.map((rawItem, index) => {
    const item = asObject(rawItem);

    const productId = normalizeString(item.productId);
    const name = normalizeString(item.name);
    const quantity = asPositiveInteger(
        item.quantity,
        `products[${index}].quantity`,
    );

    const price = asFiniteNumber(
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
      price: normalizeMoney(price),
    };
  });
}

function validateTotal(products, rawTotal) {
  const informedTotal = normalizeMoney(
      asFiniteNumber(rawTotal, "totalAmount"),
  );

  if (informedTotal < 0) {
    throw new HttpsError(
        "invalid-argument",
        "totalAmount não pode ser negativo.",
    );
  }

  const calculatedTotal = normalizeMoney(
      products.reduce(
          (sum, item) =>
            sum + item.price * item.quantity,
          0,
      ),
  );

  if (
    Math.abs(
        calculatedTotal - informedTotal,
    ) > 0.01
  ) {
    throw new HttpsError(
        "failed-precondition",
        "O total da venda não confere com os itens armazenados offline.",
    );
  }

  return informedTotal;
}

function isAllowedSubscriptionStatus(status) {
  return [
    "active",
    "trial",
    "overdue",
  ].includes(status);
}

function shouldRequestNfce(store) {
  const subscriptionType = normalizeString(
      store.subscriptionType ||
      store.plan ||
      store.plano ||
      store.subscriptionPlan,
  ).toLowerCase();

  const perfilFiscal = asObject(store.perfilFiscal);

  return (
    subscriptionType === "business" &&
    perfilFiscal.configurado === true
  );
}

function timestampMillis(value) {
  if (
    value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  if (
    value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().getTime();
  }

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : Number.MAX_SAFE_INTEGER;
}

function buildUpdatedLots({
  rawLots,
  quantityToRemove,
  productName,
}) {
  const activeLots = rawLots
      .filter((rawLot) => {
        const lot = asObject(rawLot);
        return Number(lot.quantidade) > 0;
      })
      .map((rawLot) => ({
        ...asObject(rawLot),
      }));

  activeLots.sort(
      (a, b) =>
        timestampMillis(a.validade) -
        timestampMillis(b.validade),
  );

  let remaining = quantityToRemove;
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

    if (currentQuantity <= remaining) {
      remaining -= currentQuantity;
      continue;
    }

    updatedLots.push({
      ...lot,
      quantidade:
        currentQuantity - remaining,
    });

    remaining = 0;
  }

  if (remaining > 0) {
    throw new HttpsError(
        "failed-precondition",
        `Estoque insuficiente para ${productName} nos lotes.`,
    );
  }

  const newTotal = updatedLots.reduce(
      (sum, lot) =>
        sum + Number(lot.quantidade || 0),
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

const syncOfflineSale = onCall(
    {
      timeoutSeconds: 60,
      memory: "256MiB",
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "O usuário deve estar logado.",
        );
      }

      const uid = request.auth.uid;

      const storeId =
        normalizeString(request.data?.storeId);

      const localSaleId =
        normalizeString(request.data?.localSaleId);

      const paymentMethod =
        normalizeString(request.data?.paymentMethod);

      const notes =
        normalizeString(request.data?.notes);

      const customerId =
        normalizeString(request.data?.customerId);

      const customerName =
        normalizeString(request.data?.customerName);

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
        normalizeProducts(request.data?.products);

      const totalAmount =
        validateTotal(
            products,
            request.data?.totalAmount,
        );

      const createdAt =
        parseCreatedAt(request.data?.createdAt);

      const db = admin.firestore();

      const storeRef =
        db.collection("stores").doc(storeId);

      const saleRef =
        storeRef
            .collection("sales")
            .doc(localSaleId);

      try {
        const result =
          await db.runTransaction(
              async (transaction) => {
                // ============================================================
                // FASE 1 - TODAS AS LEITURAS
                // ============================================================

                const storeSnapshot =
                  await transaction.get(storeRef);

                if (!storeSnapshot.exists) {
                  throw new HttpsError(
                      "not-found",
                      "Loja não encontrada.",
                  );
                }

                const store =
                  storeSnapshot.data() || {};

                const ownerId =
                  normalizeString(store.ownerId);

                if (
                  !ownerId ||
                  ownerId !== uid
                ) {
                  throw new HttpsError(
                      "permission-denied",
                      "Somente o proprietário da loja pode sincronizar vendas offline nesta etapa.",
                  );
                }

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

                // ------------------------------------------------------------
                // A LEITURA DA VENDA VEM ANTES DE QUALQUER WRITE.
                //
                // Se já existe, encerramos sem tocar no estoque.
                // Essa é a barreira principal contra baixa duplicada.
                // ------------------------------------------------------------

                const existingSaleSnapshot =
                  await transaction.get(saleRef);

                if (existingSaleSnapshot.exists) {
                  const existing =
                    existingSaleSnapshot.data() || {};

                  const existingLocalId =
                    normalizeString(
                        existing.localSaleId,
                    );

                  if (
                    existingLocalId &&
                    existingLocalId !== localSaleId
                  ) {
                    throw new HttpsError(
                        "already-exists",
                        "O identificador local conflita com uma venda existente.",
                    );
                  }

                  return {
                    alreadyProcessed: true,
                    serverSaleId: saleRef.id,
                    shouldRequestNfce:
                      shouldRequestNfce(store),
                  };
                }

                const productSnapshots =
                  new Map();

                for (const item of products) {
                  const productRef =
                    storeRef
                        .collection("products")
                        .doc(item.productId);

                  const productSnapshot =
                    await transaction.get(
                        productRef,
                    );

                  if (!productSnapshot.exists) {
                    throw new HttpsError(
                        "not-found",
                        `Produto ${item.name} não encontrado.`,
                    );
                  }

                  productSnapshots.set(
                      item.productId,
                      productSnapshot,
                  );
                }

                // ============================================================
                // FASE 2 - ESCRITAS DE ESTOQUE
                // ============================================================

                for (const item of products) {
                  const productSnapshot =
                    productSnapshots.get(
                        item.productId,
                    );

                  const product =
                    productSnapshot.data() || {};

                  const productRef =
                    productSnapshot.ref;

                  const rawLots =
                    Array.isArray(product.lotes)
                      ? product.lotes
                      : [];

                  if (rawLots.length === 0) {
                    const currentQuantity =
                      Number(product.quantidade || 0);

                    if (
                      !Number.isInteger(
                          currentQuantity,
                      )
                    ) {
                      throw new HttpsError(
                          "failed-precondition",
                          `Estoque inválido para ${item.name}.`,
                      );
                    }

                    if (
                      currentQuantity <
                      item.quantity
                    ) {
                      throw new HttpsError(
                          "failed-precondition",
                          `Estoque insuficiente para ${item.name}.`,
                      );
                    }

                    transaction.update(
                        productRef,
                        {
                          quantidade:
                            admin.firestore
                                .FieldValue
                                .increment(
                                    -item.quantity,
                                ),
                        },
                    );

                    continue;
                  }

                  const lotResult =
                    buildUpdatedLots({
                      rawLots,
                      quantityToRemove:
                        item.quantity,
                      productName:
                        item.name,
                    });

                  transaction.update(
                      productRef,
                      {
                        quantidade:
                          lotResult.newTotal,
                        lotes:
                          lotResult.updatedLots,
                      },
                  );
                }

                // ============================================================
                // FASE 3 - REGISTRO DA VENDA
                // ============================================================

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
                      isPaid: true,
                      customerId:
                        customerId || null,
                      customerName:
                        customerName || null,

                      localSaleId,
                      syncOrigin:
                        "offline",
                      syncedBy: uid,
                      syncedAt:
                        admin.firestore
                            .FieldValue
                            .serverTimestamp(),
                    },
                );

                return {
                  alreadyProcessed: false,
                  serverSaleId: saleRef.id,
                  shouldRequestNfce:
                    shouldRequestNfce(store),
                };
              },
          );

        console.log(
            "[syncOfflineSale] Venda sincronizada:",
            {
              storeId,
              localSaleId,
              alreadyProcessed:
                result.alreadyProcessed,
            },
        );

        return {
          success: true,
          localSaleId,
          serverSaleId:
            result.serverSaleId,
          alreadyProcessed:
            result.alreadyProcessed,
          shouldRequestNfce:
            result.shouldRequestNfce,
        };
      } catch (error) {
        if (error instanceof HttpsError) {
          throw error;
        }

        console.error(
            "[syncOfflineSale] Erro inesperado:",
            {
              storeId,
              localSaleId,
              error:
                error?.message || error,
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
