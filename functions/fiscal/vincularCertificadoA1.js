// ============================================================================
// STORE CONNECT - VINCULAR CERTIFICADO DIGITAL A1 / FOCUS NFE
// ============================================================================
//
// Arquivo:
//   functions/fiscal/vincularCertificadoA1.js
//
// Objetivo:
//   Receber temporariamente um certificado digital A1 (.pfx/.p12) enviado
//   pelo aplicativo e vinculá-lo à empresa já cadastrada na Focus NFe.
//
// Fluxo:
//   Flutter
//      ↓
//   arquivo .pfx/.p12 + senha
//      ↓
//   Cloud Function vincularCertificadoA1
//      ↓
//   valida usuário / proprietário / Business / perfil fiscal
//      ↓
//   recupera perfilFiscal.focus.empresaId
//      ↓
//   PUT https://api.focusnfe.com.br/v2/empresas/{empresaId}
//      ↓
//   Focus valida certificado + senha
//      ↓
//   Firestore recebe SOMENTE metadados seguros
//
// Segurança:
//   - o certificado NÃO é salvo no Firestore;
//   - a senha NÃO é salva no Firestore;
//   - certificado e senha NÃO são registrados em logs;
//   - FOCUS_NFE_MASTER_TOKEN permanece somente no Secret Manager/backend;
//   - o conteúdo Base64 existe somente durante a execução da Function;
//   - somente o proprietário da loja pode executar esta operação;
//   - somente lojas Business ativas podem utilizar o módulo.
//
// Firestore após sucesso:
//
//   perfilFiscal.certificado: {
//     vinculado: true,
//     nomeArquivo: "...",
//     origem: "focus",
//     vinculadoEm: Timestamp,
//     focusEmpresaId: "..."
//   }
//
// IMPORTANTE:
//   A API de Empresas da Focus opera no endpoint de produção:
//   https://api.focusnfe.com.br/v2/empresas/{id}
//
//   Isso é diferente do endpoint utilizado posteriormente para emitir NFC-e
//   em homologação.
//
// Manutenção:
//   Se futuramente o Store Connect permitir substituição, expiração ou
//   revogação de certificado, centralizar essas regras neste módulo.
//   Nunca persistir senha ou Base64 do certificado.
//
// ============================================================================

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");
const axios = require("axios");

// ============================================================================
// CONSTANTES
// ============================================================================

const FOCUS_EMPRESAS_URL =
  "https://api.focusnfe.com.br/v2/empresas";

// Limite do arquivo REAL antes da conversão Base64.
//
// 5 MiB é mais do que suficiente para um certificado A1 comum e evita que
// alguém envie conteúdo exageradamente grande para a Function.
const MAX_CERTIFICATE_BYTES =
  5 * 1024 * 1024;

// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
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

function normalizeFileName(value) {
  return normalizeString(value)
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 180);
}

// ============================================================================
// EXTENSÃO
// ============================================================================

function validateCertificateExtension(fileName) {
  const lower =
    normalizeString(fileName)
        .toLowerCase();

  if (
    !lower.endsWith(".pfx") &&
    !lower.endsWith(".p12")
  ) {
    throw new HttpsError(
        "invalid-argument",
        "O certificado deve possuir extensão .pfx ou .p12.",
    );
  }
}

// ============================================================================
// BASE64
// ============================================================================

function normalizeBase64(value) {
  let base64 =
    normalizeString(value);

  // Aceita também eventual formato:
  //
  // data:application/x-pkcs12;base64,AAAA...
  //
  // embora o Flutter que criaremos envie somente o Base64 puro.
  const commaIndex =
    base64.indexOf(",");

  if (
    base64.startsWith("data:") &&
    commaIndex >= 0
  ) {
    base64 =
      base64.substring(
          commaIndex + 1,
      );
  }

  // Remove espaços e quebras de linha.
  return base64.replace(/\s/g, "");
}

function validateAndDecodeBase64(
    certificateBase64,
) {
  const normalized =
    normalizeBase64(
        certificateBase64,
    );

  if (!normalized) {
    throw new HttpsError(
        "invalid-argument",
        "O arquivo do certificado não foi informado.",
    );
  }

  // Apenas caracteres permitidos em Base64.
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(
        normalized,
    )
  ) {
    throw new HttpsError(
        "invalid-argument",
        "O conteúdo do certificado está inválido.",
    );
  }

  let buffer;

  try {
    buffer =
      Buffer.from(
          normalized,
          "base64",
      );
  } catch (error) {
    throw new HttpsError(
        "invalid-argument",
        "Não foi possível interpretar o certificado enviado.",
    );
  }

  if (
    !buffer ||
    buffer.length === 0
  ) {
    throw new HttpsError(
        "invalid-argument",
        "O certificado enviado está vazio.",
    );
  }

  if (
    buffer.length >
    MAX_CERTIFICATE_BYTES
  ) {
    throw new HttpsError(
        "invalid-argument",
        "O certificado excede o tamanho máximo permitido de 5 MB.",
    );
  }

  return {
    normalizedBase64: normalized,
    sizeBytes: buffer.length,
  };
}

// ============================================================================
// MENSAGEM SEGURA DA FOCUS
// ============================================================================

function extractSafeFocusMessage(
    responseData,
) {
  if (!responseData) {
    return "";
  }

  if (
    typeof responseData === "string"
  ) {
    return responseData
        .trim()
        .slice(0, 1000);
  }

  if (
    typeof responseData !== "object"
  ) {
    return "";
  }

  const possibleMessage =
    responseData.mensagem ||
    responseData.message ||
    responseData.erro ||
    responseData.error ||
    responseData.errors;

  if (
    typeof possibleMessage === "string"
  ) {
    return possibleMessage
        .trim()
        .slice(0, 1000);
  }

  if (
    Array.isArray(possibleMessage)
  ) {
    return possibleMessage
        .map((item) =>
          typeof item === "string"
            ? item
            : JSON.stringify(item),
        )
        .join(" | ")
        .slice(0, 1000);
  }

  if (
    possibleMessage &&
    typeof possibleMessage === "object"
  ) {
    try {
      return JSON.stringify(
          possibleMessage,
      ).slice(0, 1000);
    } catch (_) {
      return "";
    }
  }

  return "";
}

// ============================================================================
// CLOUD FUNCTION
// ============================================================================

const vincularCertificadoA1 =
  onCall(
      {
        secrets: [
          "FOCUS_NFE_MASTER_TOKEN",
        ],

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
              "O usuário precisa estar autenticado.",
          );
        }

        const uid =
          request.auth.uid;

        const data =
          asMap(request.data);

        const storeId =
          normalizeString(
              data.storeId,
          );

        const fileName =
          normalizeFileName(
              data.fileName,
          );

        const password =
          normalizeString(
              data.password,
          );

        const certificateBase64 =
          data.certificateBase64;

        // ======================================================================
        // 2. PARÂMETROS
        // ======================================================================

        if (!storeId) {
          throw new HttpsError(
              "invalid-argument",
              "storeId é obrigatório.",
          );
        }

        if (!fileName) {
          throw new HttpsError(
              "invalid-argument",
              "O nome do arquivo do certificado é obrigatório.",
          );
        }

        validateCertificateExtension(
            fileName,
        );

        if (!password) {
          throw new HttpsError(
              "invalid-argument",
              "Informe a senha do certificado digital.",
          );
        }

        const {
          normalizedBase64,
          sizeBytes,
        } =
          validateAndDecodeBase64(
              certificateBase64,
          );

        // ======================================================================
        // 3. FIRESTORE / LOJA
        // ======================================================================

        const db =
          admin.firestore();

        const storeRef =
          db.collection("stores")
              .doc(storeId);

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

        // ======================================================================
        // 4. PROPRIETÁRIO
        // ======================================================================

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
              "Somente o proprietário da loja pode vincular o certificado digital.",
          );
        }

        // ======================================================================
        // 5. PLANO BUSINESS
        // ======================================================================

        const subscriptionType =
          normalizeString(
              store.subscriptionType ||
              store.plan ||
              store.plano ||
              store.subscriptionPlan,
          ).toLowerCase();

        const subscriptionStatus =
          normalizeString(
              store.subscriptionStatus,
          ).toLowerCase();

        if (
          subscriptionType !==
            "business" ||
          subscriptionStatus !==
            "active"
        ) {
          throw new HttpsError(
              "failed-precondition",
              "O certificado fiscal exige plano Business ativo.",
          );
        }

        // ======================================================================
        // 6. PERFIL FISCAL
        // ======================================================================

        const perfilFiscal =
          asMap(
              store.perfilFiscal,
          );

        if (
          perfilFiscal.configurado !==
          true
        ) {
          throw new HttpsError(
              "failed-precondition",
              "Finalize a configuração fiscal antes de vincular o certificado.",
          );
        }

        // ======================================================================
        // 7. EMPRESA FOCUS
        // ======================================================================

        const focus =
          asMap(
              perfilFiscal.focus,
          );

        if (
          focus.empresaCadastrada !==
          true
        ) {
          throw new HttpsError(
              "failed-precondition",
              "A empresa ainda não foi cadastrada na Focus NFe.",
          );
        }

        const empresaId =
          normalizeString(
              focus.empresaId,
          );

        if (!empresaId) {
          throw new HttpsError(
              "failed-precondition",
              "O identificador da empresa na Focus NFe não foi encontrado.",
          );
        }

        // ======================================================================
        // 8. TOKEN PRINCIPAL FOCUS
        // ======================================================================

        const focusMasterToken =
          normalizeString(
              process.env
                  .FOCUS_NFE_MASTER_TOKEN,
          );

        if (!focusMasterToken) {
          console.error(
              "[vincularCertificadoA1] " +
              "FOCUS_NFE_MASTER_TOKEN não configurado.",
          );

          throw new HttpsError(
              "failed-precondition",
              "A integração administrativa com a Focus NFe não está configurada.",
          );
        }

        const auth = {
          username:
            focusMasterToken,

          password: "",
        };

        // ======================================================================
        // 9. PAYLOAD FOCUS
        //
        // IMPORTANTE:
        // A senha e o Base64 existem somente nesta variável durante a execução.
        //
        // NÃO usar console.log(payload).
        // ======================================================================

        const payload = {
          arquivo_certificado_base64:
            normalizedBase64,

          senha_certificado:
            password,
        };

        const url =
          `${FOCUS_EMPRESAS_URL}/${encodeURIComponent(empresaId)}`;

        console.log(
            "[vincularCertificadoA1] Iniciando vínculo:",
            {
              storeId,
              empresaId,
              fileName,
              sizeBytes,
            },
        );

        // ======================================================================
        // 10. ENVIO PARA FOCUS
        // ======================================================================

        try {
          const response =
            await axios.put(
                url,
                payload,
                {
                  auth,

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

          // ====================================================================
          // 11. SUCESSO
          // ====================================================================

          await storeRef.update({
            "perfilFiscal.certificado.vinculado":
              true,

            "perfilFiscal.certificado.nomeArquivo":
              fileName,

            "perfilFiscal.certificado.origem":
              "focus",

            "perfilFiscal.certificado.focusEmpresaId":
              empresaId,

            "perfilFiscal.certificado.tamanhoBytes":
              sizeBytes,

            "perfilFiscal.certificado.vinculadoEm":
              admin.firestore.FieldValue
                  .serverTimestamp(),

            "perfilFiscal.certificado.ultimoErro":
              admin.firestore.FieldValue
                  .delete(),

            "perfilFiscal.certificado.ultimoErroEm":
              admin.firestore.FieldValue
                  .delete(),
          });

          console.log(
              "[vincularCertificadoA1] Certificado vinculado:",
              {
                storeId,
                empresaId,
                fileName,
                focusHttpStatus:
                  response.status,
              },
          );

          return {
            success: true,

            vinculado: true,

            fileName,

            sizeBytes,

            focusHttpStatus:
              response.status,

            message:
              "Certificado digital A1 vinculado com sucesso.",
          };
        } catch (error) {
          // ====================================================================
          // 12. ERRO HTTP / FOCUS
          // ====================================================================

          if (
            axios.isAxiosError(error)
          ) {
            const httpStatus =
              error.response?.status ||
              null;

            const safeMessage =
              extractSafeFocusMessage(
                  error.response?.data,
              );

            // Não logamos response.data completo para evitar qualquer
            // possibilidade de eco de dados sensíveis.
            console.error(
                "[vincularCertificadoA1] Focus recusou o certificado:",
                {
                  storeId,
                  empresaId,
                  httpStatus,
                  message:
                    safeMessage ||
                    "Erro não detalhado pela Focus.",
                },
            );

            // Registra apenas o estado seguro do erro.
            try {
              await storeRef.update({
                // Não alteramos "vinculado" em caso de falha.
                // Se já existir um certificado válido, ele continua ativo.
                "perfilFiscal.certificado.ultimoErro":
                  safeMessage ||
                  "A Focus recusou o certificado digital.",

                "perfilFiscal.certificado.ultimoErroEm":
                  admin.firestore.FieldValue
                      .serverTimestamp(),
              });
            } catch (
              firestoreError
            ) {
              console.error(
                  "[vincularCertificadoA1] " +
                  "Falha ao registrar estado do erro:",
                  firestoreError.message,
              );
            }

            // 401 / 403 geralmente representam problema com a credencial
            // administrativa da integração, não com a senha do PFX.
            if (
              httpStatus === 401 ||
              httpStatus === 403
            ) {
              let userMessage =
                safeMessage;

              if (
                !userMessage ||
                userMessage
                    .toLowerCase()
                    .includes("erro de validação")
              ) {
                userMessage =
                  "Não foi possível validar o certificado digital. " +
                  "Verifique se o arquivo é um certificado A1 válido " +
                  "e se a senha informada está correta.";
              }

              throw new HttpsError(
                  "failed-precondition",
                  userMessage,
              );
            }

            throw new HttpsError(
                "failed-precondition",
                safeMessage ||
                "A Focus NFe não conseguiu validar o certificado digital. " +
                "Confira o arquivo e a senha.",
            );
          }

          throw error;
        }
      },
  );

// ============================================================================
// EXPORTAÇÃO
// ============================================================================

module.exports = {
  vincularCertificadoA1,
};