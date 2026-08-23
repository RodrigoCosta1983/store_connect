// ============================================================================
// STORE CONNECT - EMISSÃO NFC-e / FOCUS NFE
// ============================================================================
//
// Arquivo:
//   functions/fiscal/emitirNfce.js
//
// Objetivo:
//   Receber uma venda já concluída no Store Connect e preparar/enviar a NFC-e
//   para a Focus NFe.
//
// Responsabilidades:
//   - validar autenticação do usuário;
//   - validar proprietário da loja;
//   - validar plano Business ativo;
//   - validar configuração fiscal;
//   - utilizar credencial Focus criptografada;
//   - carregar venda e produtos;
//   - validar dados fiscais dos itens;
//   - aplicar regra especial IBS/CBS para MEI/Simples em 2026;
//   - mapear a forma de pagamento;
//   - bloquear emissão enquanto o certificado digital não estiver vinculado;
//   - enviar a NFC-e para a Focus quando todos os requisitos forem atendidos;
//   - salvar o andamento da emissão dentro do documento da venda.
//
// REGRA IBS/CBS:
//   Em 2026, para regime tributário MEI/SIMEI ou Simples Nacional,
//   CST IBS/CBS e cClassTrib não são exigidos por esta implementação.
//
//   Para outros regimes, continuam obrigatórios.
//
//   A partir de 2027, esta função volta a exigir os campos até que a regra
//   fiscal seja revisada especificamente para o novo exercício.
//
// IMPORTANTE:
//   - nunca armazenar o token Focus em texto puro;
//   - não remover a validação de proprietário sem revisar permissões;
//   - não alterar códigos fiscais automaticamente;
//   - não inventar CST/CSOSN/CFOP/NCM;
//   - a venda comercial não é desfeita se a NFC-e falhar.
//
// ============================================================================

const crypto = require("crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const axios = require("axios");

const focusCredentialsEncryptionKey = defineSecret(
    "FOCUS_CREDENTIALS_ENCRYPTION_KEY",
);

const FOCUS_URLS = {
  homologacao: "https://homologacao.focusnfe.com.br/v2",
  producao: "https://api.focusnfe.com.br/v2",
};

// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function onlyDigits(value) {
  return normalizeString(value).replace(/\D/g, "");
}

function asMap(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  return {};
}

function asPositiveNumber(value, fieldName) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    throw new HttpsError(
        "failed-precondition",
        `${fieldName} inválido.`,
    );
  }

  return number;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildFocusReference(storeId, saleId) {
  const cleanStore = normalizeString(storeId).replace(
      /[^a-zA-Z0-9]/g,
      "",
  );

  const cleanSale = normalizeString(saleId).replace(
      /[^a-zA-Z0-9]/g,
      "",
  );

  return `sc${cleanStore}${cleanSale}`;
}

// ============================================================================
// REGIME TRIBUTÁRIO / IBS-CBS
// ============================================================================

function normalizeTaxRegime(value) {
  return normalizeString(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
}

function shouldRequireIbsCbs({
  regimeTributario,
  issuanceYear,
}) {
  const regime = normalizeTaxRegime(regimeTributario);

  const isMeiOrSimples = [
    "mei",
    "simei",
    "simples",
    "simplesnacional",
    "sn",
  ].includes(regime);

  // Regra deliberadamente limitada ao exercício de 2026.
  if (issuanceYear === 2026 && isMeiOrSimples) {
    return false;
  }

  return true;
}

// ============================================================================
// DESCRIPTOGRAFAR CREDENCIAL FOCUS
// ============================================================================

function decryptFocusCredential(encryptedCredential) {
  try {
    const secretValue = focusCredentialsEncryptionKey.value();

    if (!secretValue) {
      throw new Error(
          "FOCUS_CREDENTIALS_ENCRYPTION_KEY não configurada.",
      );
    }

    const key = Buffer.from(secretValue, "base64");

    if (key.length !== 32) {
      throw new Error(
          "A chave de criptografia Focus deve possuir 32 bytes.",
      );
    }

    const iv = Buffer.from(
        normalizeString(encryptedCredential.iv),
        "base64",
    );

    const authTag = Buffer.from(
        normalizeString(encryptedCredential.authTag),
        "base64",
    );

    const ciphertext = Buffer.from(
        normalizeString(encryptedCredential.ciphertext),
        "base64",
    );

    if (
      iv.length === 0 ||
      authTag.length === 0 ||
      ciphertext.length === 0
    ) {
      throw new Error(
          "Credencial Focus criptografada está incompleta.",
      );
    }

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        iv,
    );

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    const token = decrypted.toString("utf8").trim();

    if (!token) {
      throw new Error(
          "Credencial Focus descriptografada ficou vazia.",
      );
    }

    return token;
  } catch (error) {
    console.error(
        "[emitirNfce] Falha ao descriptografar credencial Focus:",
        error.message,
    );

    throw new HttpsError(
        "failed-precondition",
        "Não foi possível acessar a credencial fiscal da Focus NFe.",
    );
  }
}

// ============================================================================
// FORMA DE PAGAMENTO
// ============================================================================

function buildPayment(paymentMethod, totalAmount) {
  const method = normalizeString(paymentMethod);

  switch (method) {
    case "Dinheiro":
      return {
        indicador_pagamento: "0",
        forma_pagamento: "01",
        valor_pagamento: roundMoney(totalAmount),
      };

    case "Cartão de crédito":
      return {
        indicador_pagamento: "0",
        forma_pagamento: "03",
        valor_pagamento: roundMoney(totalAmount),

        // POS não integrado ao sistema.
        tipo_integracao: "2",
      };

    case "Cartão de débito":
      return {
        indicador_pagamento: "0",
        forma_pagamento: "04",
        valor_pagamento: roundMoney(totalAmount),

        // POS não integrado ao sistema.
        tipo_integracao: "2",
      };

    case "PIX":
      return {
        indicador_pagamento: "0",
        forma_pagamento: "20",
        valor_pagamento: roundMoney(totalAmount),
      };

    case "A prazo":
    case "Crédito / A Prazo":
      return {
        indicador_pagamento: "1",
        forma_pagamento: "91",
        valor_pagamento: roundMoney(totalAmount),
      };

    case "Cartão":
      throw new HttpsError(
          "failed-precondition",
          "Venda antiga possui forma de pagamento \"Cartão\" ambígua. " +
          "Informe crédito ou débito.",
      );

    default:
      throw new HttpsError(
          "failed-precondition",
          `Forma de pagamento não suportada para NFC-e: "${method}".`,
      );
  }
}

// ============================================================================
// ITENS
// ============================================================================

async function buildFocusItems({
  db,
  storeId,
  saleProducts,
  requireIbsCbs,
}) {
  if (!Array.isArray(saleProducts) || saleProducts.length === 0) {
    throw new HttpsError(
        "failed-precondition",
        "A venda não possui produtos.",
    );
  }

  const items = [];

  for (
    let index = 0;
    index < saleProducts.length;
    index += 1
  ) {
    const saleProduct = asMap(saleProducts[index]);

    const productId = normalizeString(
        saleProduct.productId,
    );

    const saleName = normalizeString(
        saleProduct.name,
    );

    const quantity = asPositiveNumber(
        saleProduct.quantity,
        `quantidade do item ${index + 1}`,
    );

    const unitPrice = asPositiveNumber(
        saleProduct.price,
        `preço do item ${index + 1}`,
    );

    if (!productId) {
      throw new HttpsError(
          "failed-precondition",
          `Item ${index + 1} da venda não possui productId.`,
      );
    }

    const productRef = db
        .collection("stores")
        .doc(storeId)
        .collection("products")
        .doc(productId);

    const productSnapshot = await productRef.get();

    if (!productSnapshot.exists) {
      throw new HttpsError(
          "failed-precondition",
          `O produto "${saleName || productId}" não existe mais no cadastro.`,
      );
    }

    const product = productSnapshot.data() || {};
    const fiscal = asMap(product.fiscal);

    const ncm = onlyDigits(fiscal.ncm);
    const cfop = onlyDigits(fiscal.cfop);

    const unidade = normalizeString(
        fiscal.unidade,
    ).toUpperCase();

    const cest = onlyDigits(fiscal.cest);

    const origem = normalizeString(
        fiscal.origem,
    );

    const icmsSituacao = normalizeString(
        fiscal.icmsSituacaoTributaria,
    );

    const pisSituacao = normalizeString(
        fiscal.pisSituacaoTributaria,
    );

    const cofinsSituacao = normalizeString(
        fiscal.cofinsSituacaoTributaria,
    );

    const ibsCbsSituacao = onlyDigits(
        fiscal.ibsCbsSituacaoTributaria,
    );

    const ibsCbsClassificacao = onlyDigits(
        fiscal.ibsCbsClassificacaoTributaria,
    );

    const displayName =
        saleName ||
        normalizeString(product.name) ||
        productId;

    const missing = [];

    // NCM padrão de mercadoria.
    if (ncm.length !== 8 && ncm.length !== 2) {
      missing.push("NCM");
    }

    if (cfop.length !== 4) {
      missing.push("CFOP");
    }

    if (!unidade) {
      missing.push("unidade");
    }

    if (!icmsSituacao) {
      missing.push("CSOSN/ICMS");
    }

    if (!pisSituacao) {
      missing.push("CST PIS");
    }

    if (!cofinsSituacao) {
      missing.push("CST COFINS");
    }

    // ------------------------------------------------------------
    // IBS / CBS
    //
    // Em 2026, MEI e Simples não são bloqueados por ausência
    // destes campos nesta implementação.
    // ------------------------------------------------------------

    if (requireIbsCbs) {
      if (ibsCbsSituacao.length !== 3) {
        missing.push("CST IBS/CBS");
      }

      if (ibsCbsClassificacao.length !== 6) {
        missing.push("cClassTrib IBS/CBS");
      }
    }

    if (missing.length > 0) {
      throw new HttpsError(
          "failed-precondition",
          `Produto "${displayName}" com cadastro fiscal incompleto: ` +
          `${missing.join(", ")}.`,
      );
    }

    if (cest && cest.length !== 7) {
      throw new HttpsError(
          "failed-precondition",
          `Produto "${displayName}" possui CEST inválido.`,
      );
    }

    const grossValue = roundMoney(
        quantity * unitPrice,
    );

    const item = {
      numero_item: index + 1,
      codigo_produto: productId,
      descricao: displayName,

      codigo_ncm: ncm,
      cfop,
      unidade_comercial: unidade,

      quantidade_comercial: quantity,
      valor_unitario_comercial: roundMoney(unitPrice),
      valor_bruto: grossValue,

      inclui_no_total: "1",

      icms_situacao_tributaria: icmsSituacao,
      pis_situacao_tributaria: pisSituacao,
      cofins_situacao_tributaria: cofinsSituacao,
    };

    if (requireIbsCbs) {
      item.ibs_cbs_situacao_tributaria =
          ibsCbsSituacao;

      item.ibs_cbs_classificacao_tributaria =
          ibsCbsClassificacao;
    }

    if (origem) {
      item.icms_origem = origem;
    }

    if (cest) {
      item.cest = cest;
    }

    items.push(item);
  }

  return items;
}

// ============================================================================
// SALVAR ESTADO FISCAL DA VENDA
// ============================================================================

async function saveFiscalAttempt(
    saleRef,
    nfceData,
) {
  await saleRef.set(
      {
        fiscal: {
          nfce: {
            ...nfceData,
            updatedAt:
                admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      },
      {
        merge: true,
      },
  );
}

// ============================================================================
// CLOUD FUNCTION
// ============================================================================

const emitirNfce = onCall(
    {
      secrets: [
        focusCredentialsEncryptionKey,
      ],
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

      const data = asMap(request.data);

      const storeId = normalizeString(
          data.storeId,
      );

      const saleId = normalizeString(
          data.vendaId || data.saleId,
      );

      if (!storeId) {
        throw new HttpsError(
            "invalid-argument",
            "storeId é obrigatório.",
        );
      }

      if (!saleId) {
        throw new HttpsError(
            "invalid-argument",
            "vendaId/saleId é obrigatório.",
        );
      }

      const db = admin.firestore();

      const storeRef = db
          .collection("stores")
          .doc(storeId);

      const saleRef = storeRef
          .collection("sales")
          .doc(saleId);

      try {
        // ================================================================
        // LOJA
        // ================================================================

        const storeSnapshot =
            await storeRef.get();

        if (!storeSnapshot.exists) {
          throw new HttpsError(
              "not-found",
              "Loja não encontrada.",
          );
        }

        const store =
            storeSnapshot.data() || {};

        // ================================================================
        // PROPRIETÁRIO
        // ================================================================

        const ownerId = normalizeString(
            store.ownerId,
        );

        if (!ownerId || ownerId !== uid) {
          throw new HttpsError(
              "permission-denied",
              "Somente o proprietário da loja pode emitir NFC-e nesta etapa.",
          );
        }

        // ================================================================
        // PLANO
        // ================================================================

        const subscriptionType = normalizeString(
            store.subscriptionType ||
            store.plan ||
            store.plano ||
            store.subscriptionPlan,
        ).toLowerCase();

        const subscriptionStatus = normalizeString(
            store.subscriptionStatus,
        ).toLowerCase();

        if (
          subscriptionType !== "business" ||
          subscriptionStatus !== "active"
        ) {
          throw new HttpsError(
              "failed-precondition",
              "A emissão de NFC-e exige plano Business ativo.",
          );
        }

        // ================================================================
        // PERFIL FISCAL
        // ================================================================

        const perfilFiscal =
            asMap(store.perfilFiscal);

        if (perfilFiscal.configurado !== true) {
          throw new HttpsError(
              "failed-precondition",
              "A configuração fiscal da loja ainda não foi concluída.",
          );
        }

        const ambiente = normalizeString(
            perfilFiscal.ambiente,
        ).toLowerCase();

        if (
          ambiente !== "homologacao" &&
          ambiente !== "producao"
        ) {
          throw new HttpsError(
              "failed-precondition",
              "Ambiente fiscal inválido.",
          );
        }

        const baseUrl =
            FOCUS_URLS[ambiente];

        const cnpjEmitente = onlyDigits(
            perfilFiscal.cnpj ||
            store.document,
        );

        if (cnpjEmitente.length !== 14) {
          throw new HttpsError(
              "failed-precondition",
              "CNPJ emitente inválido no perfil fiscal.",
          );
        }

        // ================================================================
        // FOCUS
        // ================================================================

        const focus =
            asMap(perfilFiscal.focus);

        if (focus.empresaCadastrada !== true) {
          throw new HttpsError(
              "failed-precondition",
              "A empresa ainda não foi vinculada à Focus NFe.",
          );
        }

        const credentials =
            asMap(focus.credentials);

        const encryptedCredential =
            asMap(credentials[ambiente]);

        if (
          encryptedCredential.validado !== true
        ) {
          throw new HttpsError(
              "failed-precondition",
              `Credencial Focus de ${ambiente} ainda não foi validada.`,
          );
        }

        const focusToken =
            decryptFocusCredential(
                encryptedCredential,
            );

        // ================================================================
        // VENDA
        // ================================================================

        const saleSnapshot =
            await saleRef.get();

        if (!saleSnapshot.exists) {
          throw new HttpsError(
              "not-found",
              "Venda não encontrada.",
          );
        }

        const sale =
            saleSnapshot.data() || {};

        if (
          normalizeString(sale.storeId) &&
          normalizeString(sale.storeId) !==
          storeId
        ) {
          throw new HttpsError(
              "failed-precondition",
              "A venda não pertence à loja informada.",
          );
        }

        const totalAmount =
            asPositiveNumber(
                sale.totalAmount,
                "Valor total da venda",
            );

        // ================================================================
        // IDEMPOTÊNCIA
        // ================================================================

        const currentNfce =
            asMap(
                asMap(sale.fiscal).nfce,
            );

        if (
          normalizeString(
              currentNfce.status,
          ).toLowerCase() ===
          "autorizado"
        ) {
          return {
            sucesso: true,
            status: "autorizado",
            referencia:
                currentNfce.referencia || null,
            chaveNfe:
                currentNfce.chaveNfe || null,
            caminhoDanfe:
                currentNfce.caminhoDanfe || null,
            caminhoXml:
                currentNfce.caminhoXml || null,
            alreadyAuthorized: true,
          };
        }

        // ================================================================
        // REGRA IBS/CBS
        // ================================================================

        const issuanceDate =
            new Date();

        const issuanceYear =
            issuanceDate.getFullYear();

        const requireIbsCbs =
            shouldRequireIbsCbs({
              regimeTributario:
                  perfilFiscal.regimeTributario,
              issuanceYear,
            });

        console.log(
            "[emitirNfce] Regra IBS/CBS:",
            {
              storeId,
              saleId,
              issuanceYear,
              regimeTributario:
                  normalizeString(
                      perfilFiscal.regimeTributario,
                  ) || "(vazio)",
              requireIbsCbs,
            },
        );

        // ================================================================
        // ITENS
        // ================================================================

        const items =
            await buildFocusItems({
              db,
              storeId,
              saleProducts: sale.products,
              requireIbsCbs,
            });

        // ================================================================
        // PAGAMENTO
        // ================================================================

        const payment =
            buildPayment(
                sale.paymentMethod,
                totalAmount,
            );

        // ================================================================
        // PAYLOAD
        // ================================================================

        const payload = {
          natureza_operacao:
              "VENDA AO CONSUMIDOR",

          cnpj_emitente:
              cnpjEmitente,

          data_emissao:
              issuanceDate.toISOString(),

          modalidade_frete:
              "9",

          local_destino:
              "1",

          presenca_comprador:
              "1",

          items,

          formas_pagamento: [
            payment,
          ],
        };

        const reference =
            buildFocusReference(
                storeId,
                saleId,
            );

        // ================================================================
        // CERTIFICADO
        // ================================================================

        const certificado =
            asMap(
                perfilFiscal.certificado,
            );

        if (
          certificado.vinculado !== true
        ) {
          await saveFiscalAttempt(
              saleRef,
              {
                referencia: reference,
                ambiente,
                status:
                    "bloqueado_certificado",

                erro:
                    "Certificado digital ainda não vinculado.",
              },
          );

          throw new HttpsError(
              "failed-precondition",
              "O payload fiscal foi validado, mas o certificado digital da empresa ainda está pendente.",
          );
        }

        // ================================================================
        // ENVIO
        // ================================================================

        await saveFiscalAttempt(
            saleRef,
            {
              referencia: reference,
              ambiente,
              status: "enviando",
              erro: null,
            },
        );

        const url =
            `${baseUrl}/nfce?ref=${encodeURIComponent(reference)}`;

        const response =
            await axios.post(
                url,
                payload,
                {
                  auth: {
                    username:
                        focusToken,
                    password: "",
                  },

                  headers: {
                    Accept:
                        "application/json",

                    "Content-Type":
                        "application/json",
                  },

                  timeout:
                      45000,
                },
            );

        const responseData =
            asMap(response.data);

        const status =
            normalizeString(
                responseData.status,
            ) || "processado";

        const caminhoDanfe =
            responseData.caminho_danfe ||
            responseData.caminhoDanfe ||
            null;

        const caminhoXml =
            responseData.caminho_xml_nota_fiscal ||
            responseData.caminho_xml ||
            responseData.caminhoXml ||
            null;

        const chaveNfe =
            responseData.chave_nfe ||
            responseData.chave ||
            null;

        await saveFiscalAttempt(
            saleRef,
            {
              referencia: reference,
              ambiente,
              status,
              chaveNfe,
              caminhoDanfe,
              caminhoXml,

              focusHttpStatus:
                  response.status,

              response:
                  responseData,

              erro:
                  null,

              emitidaEm:
                  admin.firestore.FieldValue
                      .serverTimestamp(),
            },
        );

        return {
          sucesso: true,
          status,
          referencia: reference,
          chaveNfe,
          caminhoDanfe,
          caminhoXml,
        };
      } catch (error) {
        // Mantém erros de validação da própria Function.
        if (error instanceof HttpsError) {
          throw error;
        }

        // ================================================================
        // ERRO FOCUS / HTTP
        // ================================================================

        if (axios.isAxiosError(error)) {
          const httpStatus =
              error.response?.status ||
              null;

          const focusResponse =
              error.response?.data ||
              null;

          console.error(
              "[emitirNfce] Erro Focus/HTTP:",
              {
                storeId,
                saleId,
                httpStatus,
                response:
                    focusResponse,
              },
          );

          try {
            const reference =
                buildFocusReference(
                    storeId,
                    saleId,
                );

            await saveFiscalAttempt(
                saleRef,
                {
                  referencia:
                      reference,

                  status:
                      "erro_focus",

                  focusHttpStatus:
                      httpStatus,

                  response:
                      focusResponse,

                  erro:
                      "A Focus rejeitou ou não conseguiu processar a NFC-e.",
                },
            );
          } catch (saveError) {
            console.error(
                "[emitirNfce] Falha ao registrar erro fiscal:",
                saveError.message,
            );
          }

          const focusMessage =
              normalizeString(
                  focusResponse?.mensagem ||
                  focusResponse?.message ||
                  focusResponse?.erro,
              );

          throw new HttpsError(
              "failed-precondition",
              focusMessage ||
              `A Focus NFe respondeu com erro${
                httpStatus
                  ? ` HTTP ${httpStatus}`
                  : ""
              }.`,
          );
        }

        // ================================================================
        // ERRO INESPERADO
        // ================================================================

        console.error(
            "[emitirNfce] Erro inesperado:",
            error?.message || error,
        );

        throw new HttpsError(
            "internal",
            "Falha inesperada durante a preparação/emissão da NFC-e.",
        );
      }
    },
);

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  emitirNfce,
};