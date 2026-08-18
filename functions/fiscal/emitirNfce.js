const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

/**
 * --- EMITIR NFC-e (FASE 1 - MVP) ---
 * Recebe os dados de uma venda finalizada no app e envia para a Focus NFe.
 */
exports.emitirNfce = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "O usuário deve estar logado.");
  }

  const { storeId, vendaId } = request.data;
  const db = admin.firestore();

  try {
    // 1. Busca os dados da loja (onde está o perfilFiscal que desenhamos)
    const storeDoc = await db.collection("stores").doc(storeId).get();
    const loja = storeDoc.data();
    const perfilFiscal = loja.perfilFiscal;

    if (!perfilFiscal || !perfilFiscal.certificado.vinculado) {
        throw new HttpsError("failed-precondition", "Loja sem configuração fiscal ou certificado pendente.");
    }

    // 2. Busca a venda recém-criada
    const vendaDoc = await db.collection("stores").doc(storeId).collection("sales").doc(vendaId).get();
    const venda = vendaDoc.data();

    // 3. Monta o JSON no padrão exato que a Focus NFe exige
    const jsonNfce = {
      natureza_operacao: "Venda de mercadoria",
      cnpj_emitente: loja.document.replace(/\D/g, ''), // Limpa a formatação
      local_destino: "1", // 1 = Operação interna (dentro do estado)
      presenca_comprador: "1", // 1 = Operação presencial
      // Aqui entrarão os itens da venda mapeados (NCM, CFOP, Impostos)...
      itens: [
         // ... mapeamento dos produtos ...
      ],
      // ... formas de pagamento ...
    };

    // 4. Define a URL baseada no ambiente configurado na loja
    const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN; // O token que você acabou de copiar
    const baseUrl = perfilFiscal.ambiente === "producao"
        ? "https://api.focusnfe.com.br/v2"
        : "https://homologacao.focusnfe.com.br/v2";

    // 5. Dispara para a API
    const response = await axios.post(`${baseUrl}/nfce`, jsonNfce, {
      auth: {
        username: FOCUS_TOKEN,
        password: "" // A Focus NFe usa o token no lugar do usuário e senha em branco
      }
    });

    // 6. Retorna o status para o Flutter atualizar a venda (Autorizado, Rejeitado, etc.)
    return {
      sucesso: true,
      status: response.data.status,
      referencia: response.data.ref, // ID único da nota na Focus
      caminhoDanfe: response.data.caminho_danfe
    };

  } catch (error) {
    console.error("Erro ao emitir NFC-e:", error.response ? error.response.data : error.message);
    throw new HttpsError("internal", "Falha na comunicação com a SEFAZ.");
  }
});