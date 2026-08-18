// ============================================================================
// ARQUIVO: syncNcmTable.js
// ============================================================================
//
// OBJETIVO:
// Sincronizar a tabela oficial vigente da NCM com o Firestore.
//
// PRINCIPAIS RESPONSABILIDADES:
// - Baixar o JSON oficial disponibilizado pela Receita/Siscomex.
// - Identificar os códigos NCM vigentes.
// - Normalizar descrições para facilitar pesquisas.
// - Gerar palavras-chave para o searchNcm.js.
// - Gravar/atualizar os documentos na coleção "ncm".
// - Registrar informações da última sincronização.
//
// FONTE OFICIAL:
// Portal Único Siscomex / Sistema Classif.
//
// URL:
// https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
//
// FIRESTORE:
//
// ncm/{codigo}
//
// Exemplo:
// {
//   codigo: "61091000",
//   codigoFormatado: "6109.10.00",
//   descricao: "...",
//   descricaoNormalizada: "...",
//   palavras: [...],
//   dataInicio: "...",
//   dataFim: null,
//   ativo: true,
//   atualizadoEm: Timestamp
// }
//
// CONTROLE:
//
// system/ncmSync
// {
//   ultimaSincronizacao: Timestamp,
//   totalRegistros: 12345,
//   origem: "..."
// }
//
// SEGURANÇA:
// - Esta função NÃO deve ficar aberta para qualquer usuário do app.
// - Inicialmente será uma Callable restrita ao owner/admin de uma loja
//   Business, apenas para desenvolvimento.
// - Futuramente o ideal é transformá-la em rotina administrativa/scheduler.
//
// MANUTENÇÃO:
// - Não adicionar códigos NCM manualmente neste arquivo.
// - Não alterar a URL oficial sem verificar a documentação do governo.
// - Manter a sincronização separada do searchNcm.js.
// - Não executar download durante cada pesquisa do usuário.
//
// ============================================================================

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");
const axios = require("axios");

// ============================================================================
// CONFIGURAÇÕES
// ============================================================================

const NCM_URL =
  "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";

const COLLECTION_NCM = "ncm";

const SYNC_DOC_PATH = "system/ncmSync";

// Firestore suporta batches de até 500 operações.
// Usamos menos para manter margem de segurança.

const BATCH_SIZE = 400;

// ============================================================================
// NORMALIZA TEXTO
// ============================================================================

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================================
// SOMENTE DÍGITOS
// ============================================================================

function onlyDigits(value) {
  return String(value || "")
    .replace(/\D/g, "");
}

// ============================================================================
// FORMATA NCM
//
// 61091000 -> 6109.10.00
// ============================================================================

function formatNcm(code) {
  const clean =
    onlyDigits(code);

  if (clean.length !== 8) {
    return clean;
  }

  return (
    clean.substring(0, 4) +
    "." +
    clean.substring(4, 6) +
    "." +
    clean.substring(6, 8)
  );
}

// ============================================================================
// GERA PALAVRAS DE PESQUISA
// ============================================================================

function buildKeywords(description) {
  const normalized =
    normalizeText(description);

  if (!normalized) {
    return [];
  }

  const ignoredWords =
    new Set([
      "de",
      "da",
      "do",
      "das",
      "dos",
      "e",
      "em",
      "para",
      "com",
      "sem",
      "a",
      "o",
      "as",
      "os",
      "um",
      "uma",
      "uns",
      "umas",
      "por",
      "ou",
    ]);

  const words =
    normalized
      .split(" ")
      .filter(
        (word) =>
          word.length >= 2 &&
          !ignoredWords.has(word)
      );

  // Remove duplicados.

  return [...new Set(words)];
}

// ============================================================================
// EXTRAI A LISTA DO JSON
//
// Mantemos flexibilidade porque o envelope do JSON pode mudar.
// ============================================================================

function extractItems(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    data &&
    Array.isArray(data.Nomenclaturas)
  ) {
    return data.Nomenclaturas;
  }

  if (
    data &&
    Array.isArray(data.nomenclaturas)
  ) {
    return data.nomenclaturas;
  }

  if (
    data &&
    Array.isArray(data.listaNcm)
  ) {
    return data.listaNcm;
  }

  if (
    data &&
    Array.isArray(data.data)
  ) {
    return data.data;
  }

  return [];
}

// ============================================================================
// FUNÇÃO PRINCIPAL
// ============================================================================

const syncNcmTable =
  onCall(
    {
      timeoutSeconds: 540,
      memory: "1GiB",
    },
    async (request) => {
      // ======================================================================
      // 1. AUTENTICAÇÃO
      // ======================================================================

      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "O usuário precisa estar autenticado."
        );
      }

      const {
        storeId,
      } = request.data || {};

      if (!storeId) {
        throw new HttpsError(
          "invalid-argument",
          "storeId é obrigatório."
        );
      }

      const db =
        admin.firestore();

      // ======================================================================
      // 2. VALIDA LOJA / BUSINESS / OWNER
      //
      // Por enquanto usamos isso como trava administrativa.
      // Depois podemos remover totalmente a chamada pelo aplicativo.
      // ======================================================================

      const storeDoc =
        await db
          .collection("stores")
          .doc(storeId)
          .get();

      if (!storeDoc.exists) {
        throw new HttpsError(
          "not-found",
          "Loja não encontrada."
        );
      }

      const store =
        storeDoc.data();

      if (
        store.subscriptionType !==
          "business" ||
        store.subscriptionStatus !==
          "active"
      ) {
        throw new HttpsError(
          "permission-denied",
          "A sincronização fiscal está disponível somente para o Plano Business ativo."
        );
      }

      if (
        store.ownerId !==
        request.auth.uid
      ) {
        throw new HttpsError(
          "permission-denied",
          "Somente o proprietário da loja pode executar esta sincronização."
        );
      }

      // ======================================================================
      // 3. BAIXA A TABELA OFICIAL
      // ======================================================================

      console.log(
        "Iniciando download da tabela NCM oficial..."
      );

      let response;

      try {
        response =
          await axios.get(
            NCM_URL,
            {
              timeout: 120000,

              headers: {
                Accept:
                  "application/json",
              },
            }
          );
      } catch (error) {
        console.error(
          "Erro ao baixar tabela NCM:",
          error.response?.data ||
            error.message
        );

        throw new HttpsError(
          "unavailable",
          "Não foi possível baixar a tabela oficial da NCM."
        );
      }

      // ======================================================================
      // 4. EXTRAI REGISTROS
      // ======================================================================

      const items =
        extractItems(
          response.data
        );

      if (
        !items ||
        items.length === 0
      ) {
        console.error(
          "JSON NCM recebido, mas nenhuma lista foi reconhecida."
        );

        throw new HttpsError(
          "internal",
          "A tabela oficial foi recebida, mas o formato não foi reconhecido."
        );
      }

      console.log(
        `Tabela NCM recebida: ${items.length} registros brutos.`
      );

      // ======================================================================
      // DEBUG TEMPORÁRIO - FORMATO REAL DO JSON DA RECEITA
      //
      // Mostra apenas os primeiros registros e as chaves existentes.
      // Depois que identificarmos a estrutura, removeremos este bloco.
      // ======================================================================



      console.log(
        JSON.stringify(
          items[0],
          null,
          2
        )
      );



      console.log(
        Object.keys(
          items[0] || {}
        )
      );

      console.log(
        "===================================="
      );

      // ======================================================================
      // 5. PREPARA DOCUMENTOS VÁLIDOS
      // ======================================================================

      const records = [];

      for (
        const raw
        of items
      ) {
        const codigo =
          onlyDigits(
            raw.Codigo
          );

        const descricao =
          String(
            raw.Descricao ||
            ""
          ).trim();

        // --------------------------------------------------------------------
        // Nosso módulo precisa apenas dos códigos NCM completos.
        //
        // A tabela pode conter níveis hierárquicos que não tenham 8 dígitos.
        // --------------------------------------------------------------------

        if (
          codigo.length !== 8
        ) {
          continue;
        }

        if (!descricao) {
          continue;
        }

        // --------------------------------------------------------------------
        // Vigência
        // --------------------------------------------------------------------

        const dataFim =
          raw.Data_Fim ??
          null;

        // Se houver dataFim antiga, o item não é considerado ativo.
        //
        // Como a URL oficial fornece a tabela vigente, normalmente os
        // registros já estarão ativos, mas deixamos a estrutura preparada.

        // ====================================================================
        // STATUS DO NCM
        //
        // Estamos importando a tabela vigente disponibilizada pelo Siscomex.
        // Portanto, os códigos completos presentes nesta carga são tratados
        // como ativos.
        //
        // As datas de vigência continuam sendo armazenadas para referência.
        // ====================================================================

        const ativo = true;

        records.push({
          codigo,

          codigoFormatado:
            formatNcm(
              codigo
            ),

          descricao,

          descricaoNormalizada:
            normalizeText(
              descricao
            ),

          palavras:
            buildKeywords(
              descricao
            ),

          dataInicio:
            raw.Data_Inicio ??
            null,

          dataFim:
            dataFim,

          tipoAtoIni:
            raw.Tipo_Ato_Ini ??
            null,

          numeroAtoIni:
            raw.Numero_Ato_Ini ??
            null,

          anoAtoIni:
            raw.Ano_Ato_Ini ??
            null,

          ativo,

          atualizadoEm:
            admin.firestore
              .FieldValue
              .serverTimestamp(),
        });
      }

      if (
        records.length === 0
      ) {
        throw new HttpsError(
          "internal",
          "Nenhum código NCM de 8 dígitos foi encontrado."
        );
      }

      console.log(
        `Registros NCM válidos: ${records.length}.`
      );

      // ======================================================================
      // 6. SALVA EM BATCHES
      // ======================================================================

      let processed = 0;

      for (
        let i = 0;
        i < records.length;
        i += BATCH_SIZE
      ) {
        const chunk =
          records.slice(
            i,
            i + BATCH_SIZE
          );

        const batch =
          db.batch();

        for (
          const record
          of chunk
        ) {
          const ref =
            db.collection(
              COLLECTION_NCM
            )
              .doc(
                record.codigo
              );

          batch.set(
            ref,
            record,
            {
              merge: true,
            }
          );
        }

        await batch.commit();

        processed +=
          chunk.length;

        console.log(
          `NCM sincronizadas: ${processed}/${records.length}`
        );
      }

      // ======================================================================
      // 7. REGISTRA CONTROLE DA SINCRONIZAÇÃO
      // ======================================================================

      const syncRef =
        db.doc(
          SYNC_DOC_PATH
        );

      await syncRef.set(
        {
          ultimaSincronizacao:
            admin.firestore
              .FieldValue
              .serverTimestamp(),

          totalRegistros:
            records.length,

          origem:
            NCM_URL,

          executadoPor:
            request.auth.uid,

          storeId,

          status:
            "success",
        },
        {
          merge: true,
        }
      );

      // ======================================================================
      // 8. RESPOSTA
      // ======================================================================

      console.log(
        `Sincronização NCM concluída: ${records.length} registros.`
      );

      return {
        success: true,

        totalRegistros:
          records.length,

        message:
          `Tabela NCM sincronizada com sucesso. ${records.length} códigos disponíveis.`,
      };
    }
  );

// ============================================================================
// EXPORTAÇÃO
// ============================================================================

module.exports = {
  syncNcmTable,
};