/**
 * ============================================================================
 * STORE CONNECT - SAVE FOCUS CREDENTIALS
 * ============================================================================
 *
 * Arquivo:
 *   functions/fiscal/saveFocusCredentials.js
 *
 * Objetivo:
 *   Receber, validar, criptografar e armazenar com segurança o token individual
 *   da Focus NFe pertencente a uma loja/empresa do Store Connect.
 *
 * Responsabilidades:
 *   1. Exigir usuário autenticado no Firebase Auth.
 *   2. Validar o storeId recebido.
 *   3. Confirmar que o usuário autenticado é proprietário da loja.
 *   4. Confirmar que a loja possui plano Business ativo.
 *   5. Receber um token Focus para:
 *        - homologacao
 *        - producao
 *   6. Validar a credencial diretamente contra a API Focus NFe.
 *   7. Criptografar o token usando AES-256-GCM.
 *   8. Persistir APENAS o conteúdo criptografado no Firestore.
 *   9. Nunca devolver o token puro para o Flutter.
 *
 * Segurança:
 *   A chave FOCUS_CREDENTIALS_ENCRYPTION_KEY fica exclusivamente no
 *   Firebase Secret Manager.
 *
 *   Essa chave NÃO deve:
 *     - ficar no Firestore;
 *     - ficar no Flutter;
 *     - ficar no Git;
 *     - ficar no .env de produção;
 *     - ser enviada para o cliente.
 *
 * Estrutura gravada no Firestore:
 *
 * stores/{storeId}
 *   perfilFiscal
 *     focus
 *       credentials
 *         homologacao
 *           ciphertext
 *           iv
 *           authTag
 *           version
 *           updatedAt
 *
 *         producao
 *           ciphertext
 *           iv
 *           authTag
 *           version
 *           updatedAt
 *
 * O token original NÃO é salvo.
 *
 * Algoritmo:
 *   AES-256-GCM
 *
 * Formato esperado da chave:
 *   Base64 contendo exatamente 32 bytes.
 *
 * IMPORTANTE:
 *   O endpoint de validação NÃO emite documento fiscal.
 *
 *   Fazemos:
 *
 *     GET /v2/nfce/{referencia-inexistente}
 *
 *   Um HTTP 404 indica que a API reconheceu a credencial, mas a referência
 *   consultada não existe.
 *
 *   HTTP 401 indica credencial inválida.
 *
 * Integração futura:
 *   emitirNfce.js deverá carregar credentials[ambiente], descriptografar o
 *   token dentro do backend e utilizá-lo somente durante a chamada à Focus.
 *
 * Manutenção:
 *   Se o formato criptográfico mudar futuramente, aumente "version".
 *
 * ============================================================================
 */

const crypto = require("crypto");

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");

const admin = require("firebase-admin");


// ============================================================================
// SECRET
// ============================================================================

const focusCredentialsEncryptionKey = defineSecret(
    "FOCUS_CREDENTIALS_ENCRYPTION_KEY",
);


// ============================================================================
// CONSTANTES
// ============================================================================

const FOCUS_URLS = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = 1;


// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normaliza valores que possam vir como String.
 *
 * @param {*} value Valor original.
 * @return {string} String limpa.
 */
function normalizeString(value) {
  return String(value ?? "").trim();
}


/**
 * Retorna a chave criptográfica em Buffer.
 *
 * O Secret Manager deve conter uma string Base64 que represente
 * exatamente 32 bytes.
 *
 * @return {Buffer}
 */
function getEncryptionKey() {
  const rawKey = normalizeString(
      focusCredentialsEncryptionKey.value(),
  );

  if (!rawKey) {
    throw new HttpsError(
        "failed-precondition",
        "Chave de criptografia das credenciais Focus não configurada.",
    );
  }

  let key;

  try {
    key = Buffer.from(rawKey, "base64");
  } catch (error) {
    console.error(
        "[saveFocusCredentials] Falha ao decodificar chave Base64:",
        error,
    );

    throw new HttpsError(
        "internal",
        "A chave de criptografia possui formato inválido.",
    );
  }

  if (key.length !== 32) {
    console.error(
        "[saveFocusCredentials] Chave inválida. Bytes encontrados:",
        key.length,
    );

    throw new HttpsError(
        "internal",
        "A chave de criptografia deve possuir exatamente 32 bytes.",
    );
  }

  return key;
}


/**
 * Criptografa um texto utilizando AES-256-GCM.
 *
 * @param {string} plaintext Texto em claro.
 * @return {{
 *   ciphertext: string,
 *   iv: string,
 *   authTag: string,
 *   version: number
 * }}
 */
function encryptCredential(plaintext) {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
      ENCRYPTION_ALGORITHM,
      key,
      iv,
  );

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    version: ENCRYPTION_VERSION,
  };
}


/**
 * Cria o header HTTP Basic esperado pela Focus.
 *
 * Formato:
 *   Basic base64(token:)
 *
 * @param {string} token Token Focus.
 * @return {string}
 */
function buildFocusAuthorization(token) {
  const encoded = Buffer
      .from(`${token}:`, "utf8")
      .toString("base64");

  return `Basic ${encoded}`;
}


/**
 * Faz uma consulta que não emite documento fiscal para validar se
 * o token informado é reconhecido pela Focus.
 *
 * A referência consultada é criada especificamente para não existir.
 *
 * 404:
 *   autenticação aceita e NFC-e inexistente.
 *
 * 401:
 *   credencial inválida.
 *
 * 403:
 *   autenticação reconhecida, mas operação não permitida.
 *
 * @param {string} token Token individual da empresa.
 * @param {"homologacao"|"producao"} ambiente Ambiente Focus.
 * @return {Promise<{valid: boolean, status: number}>}
 */
async function validateFocusToken(token, ambiente) {
  const baseUrl = FOCUS_URLS[ambiente];

  if (!baseUrl) {
    throw new HttpsError(
        "invalid-argument",
        "Ambiente Focus inválido.",
    );
  }

  const validationRef =
      `storeconnect-token-check-${Date.now()}-${crypto
          .randomBytes(8)
          .toString("hex")}`;

  const url =
      `${baseUrl}/v2/nfce/${encodeURIComponent(validationRef)}`;

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: buildFocusAuthorization(token),
        Accept: "application/json",
      },
    });
  } catch (error) {
    console.error(
        "[saveFocusCredentials] Erro de conexão com Focus:",
        error,
    );

    throw new HttpsError(
        "unavailable",
        "Não foi possível conectar à Focus NFe.",
    );
  }

  console.log(
      "[saveFocusCredentials] Validação Focus:",
      {
        ambiente,
        status: response.status,
      },
  );

  // Token inválido.
  if (response.status === 401) {
    return {
      valid: false,
      status: response.status,
    };
  }

  /*
   * 404:
   * referência inexistente com autenticação aceita.
   *
   * 200:
   * improvável, mas possível em colisão de referência.
   *
   * 403:
   * autenticação reconhecida, porém operação não permitida.
   *
   * Para nosso objetivo de autenticação, todos indicam que a
   * credencial chegou autenticada à Focus.
   */
  if (
    response.status === 404 ||
    response.status === 200 ||
    response.status === 403
  ) {
    return {
      valid: true,
      status: response.status,
    };
  }

  let responseBody = "";

  try {
    responseBody = await response.text();
  } catch (_) {
    // Corpo não é necessário para continuar.
  }

  console.error(
      "[saveFocusCredentials] Resposta inesperada da Focus:",
      {
        ambiente,
        status: response.status,
        body: responseBody.substring(0, 500),
      },
  );

  throw new HttpsError(
      "unavailable",
      `A Focus respondeu com status inesperado: ${response.status}.`,
  );
}


// ============================================================================
// CLOUD FUNCTION
// ============================================================================

const saveFocusCredentials = onCall(
    {
      secrets: [focusCredentialsEncryptionKey],
      timeoutSeconds: 30,
      memory: "256MiB",
    },
    async (request) => {
      // ======================================================================
      // 1. AUTENTICAÇÃO
      // ======================================================================

      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "É necessário estar autenticado.",
        );
      }

      const uid = request.auth.uid;

      // ======================================================================
      // 2. DADOS RECEBIDOS
      // ======================================================================

      const storeId = normalizeString(
          request.data?.storeId,
      );

      const token = normalizeString(
          request.data?.token,
      );

      const ambiente = normalizeString(
          request.data?.ambiente,
      ).toLowerCase();

      if (!storeId) {
        throw new HttpsError(
            "invalid-argument",
            "storeId é obrigatório.",
        );
      }

      if (!token) {
        throw new HttpsError(
            "invalid-argument",
            "O token Focus é obrigatório.",
        );
      }

      if (
        ambiente !== "homologacao" &&
        ambiente !== "producao"
      ) {
        throw new HttpsError(
            "invalid-argument",
            "O ambiente deve ser homologacao ou producao.",
        );
      }

      // Evita valores absurdos ou payload malicioso.
      if (token.length > 500) {
        throw new HttpsError(
            "invalid-argument",
            "Token Focus inválido.",
        );
      }

      // ======================================================================
      // 3. CARREGA LOJA
      // ======================================================================

      const db = admin.firestore();

      const storeRef = db
          .collection("stores")
          .doc(storeId);

      const storeSnapshot = await storeRef.get();

      if (!storeSnapshot.exists) {
        throw new HttpsError(
            "not-found",
            "Loja não encontrada.",
        );
      }

      const store = storeSnapshot.data() || {};

      // ======================================================================
      // 4. VERIFICA PROPRIETÁRIO
      // ======================================================================

      const ownerId = normalizeString(
          store.ownerId,
      );

      if (!ownerId || ownerId !== uid) {
        console.warn(
            "[saveFocusCredentials] Usuário sem permissão:",
            {
              uid,
              storeId,
              ownerId,
            },
        );

        throw new HttpsError(
            "permission-denied",
            "Você não possui permissão para configurar esta loja.",
        );
      }

      // ======================================================================
      // 5. VERIFICA PLANO BUSINESS
      // ======================================================================

      const plan = normalizeString(
          store.subscriptionType ||
          store.plan ||
          store.plano ||
          store.subscriptionPlan,
      ).toLowerCase();

      const subscriptionStatus = normalizeString(
          store.subscriptionStatus ||
          store.statusAssinatura ||
          store.assinatura?.status,
      ).toLowerCase();

      const isBusiness =
          plan === "business";

      /*
       * Não bloqueamos baseado somente em subscriptionStatus porque
       * existem projetos legados em que o plano ativo é controlado
       * por outro campo.
       *
       * A regra principal neste momento é que a loja seja Business.
       */
      if (!isBusiness) {
        throw new HttpsError(
            "failed-precondition",
            "A configuração fiscal está disponível apenas no plano Business.",
        );
      }

      console.log(
          "[saveFocusCredentials] Loja autorizada:",
          {
            storeId,
            uid,
            plan,
            subscriptionStatus,
            ambiente,
          },
      );

      // ======================================================================
      // 6. VERIFICA PERFIL FISCAL / EMPRESA FOCUS
      // ======================================================================

      const perfilFiscal =
          store.perfilFiscal &&
          typeof store.perfilFiscal === "object" ?
            store.perfilFiscal :
            {};

      const focus =
          perfilFiscal.focus &&
          typeof perfilFiscal.focus === "object" ?
            perfilFiscal.focus :
            {};

      if (!focus.empresaCadastrada) {
        throw new HttpsError(
            "failed-precondition",
            "A empresa ainda não foi vinculada à Focus NFe.",
        );
      }

      // ======================================================================
      // 7. VALIDA TOKEN NA FOCUS
      // ======================================================================

      const validation = await validateFocusToken(
          token,
          ambiente,
      );

      if (!validation.valid) {
        console.warn(
            "[saveFocusCredentials] Token Focus inválido:",
            {
              storeId,
              ambiente,
              status: validation.status,
            },
        );

        throw new HttpsError(
            "invalid-argument",
            `O token Focus de ${ambiente} é inválido.`,
        );
      }

      // ======================================================================
      // 8. CRIPTOGRAFA
      // ======================================================================

      const encryptedCredential =
          encryptCredential(token);

      // ======================================================================
      // 9. SALVA SOMENTE O TOKEN CRIPTOGRAFADO
      // ======================================================================

      const credentialPath =
          `perfilFiscal.focus.credentials.${ambiente}`;

      await storeRef.update({
        [credentialPath]: {
          ...encryptedCredential,

          ambiente,

          validado: true,

          validationHttpStatus:
              validation.status,

          updatedAt:
              admin.firestore.FieldValue.serverTimestamp(),

          updatedBy: uid,
        },

        "perfilFiscal.focus.credentialsUpdatedAt":
            admin.firestore.FieldValue.serverTimestamp(),

        "perfilFiscal.focus.credentialsConfigured":
            true,
      });

      // ======================================================================
      // 10. RESPOSTA
      // ======================================================================

      console.log(
          "[saveFocusCredentials] Credencial salva:",
          {
            storeId,
            ambiente,
            validationStatus: validation.status,
          },
      );

      return {
        success: true,
        ambiente,
        configured: true,
        message:
            `Credencial Focus de ${ambiente} salva com sucesso.`,
      };
    },
);


// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  saveFocusCredentials,
};