// ============================================================================
// ARQUIVO: searchNcm.js
// ============================================================================
//
// OBJETIVO:
// Pesquisar códigos NCM utilizados no cadastro fiscal dos produtos.
//
// PRINCIPAIS RESPONSABILIDADES:
// - Receber um código ou descrição digitada pelo usuário.
// - Pesquisar na coleção "ncm" do Firestore.
// - Permitir busca direta pelo código NCM.
// - Permitir busca por palavras da descrição.
// - Retornar uma lista reduzida de resultados para o Flutter.
//
// REGRA DE PLANO:
// - Recurso disponível somente para lojas Business ativas.
// - O usuário precisa estar autenticado.
// - O usuário precisa pertencer à loja informada.
//
// FIRESTORE:
//
// ncm/{codigo}
//
// Exemplo:
//
// ncm/61091000
// {
//   codigo: "61091000",
//   codigoFormatado: "6109.10.00",
//   descricao: "...",
//   descricaoNormalizada: "...",
//   palavras: ["camiseta", "algodao", ...],
//   ativo: true
// }
//
// SEGURANÇA:
// - Nunca confiar apenas no Flutter.
// - Validação Business também ocorre no backend.
// - Esta função NÃO altera dados fiscais.
// - Esta função NÃO emite NFC-e.
//
// FONTE DA BASE:
// - A coleção será alimentada pelo syncNcmTable.js.
// - A sincronização utilizará a tabela NCM oficial vigente.
//
// MANUTENÇÃO:
// - Não colocar códigos NCM manualmente neste arquivo.
// - Não transformar esta função em sincronizador da tabela.
// - searchNcm = consulta.
// - syncNcmTable = atualização da base.
//
// ============================================================================

const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const admin = require("firebase-admin");

// ============================================================================
// NORMALIZA TEXTO
//
// Remove:
// - acentos
// - caracteres especiais
// - excesso de espaços
// - diferença entre maiúsculas e minúsculas
//
// Exemplo:
//
// "Camiseta de Algodão"
// vira:
// "camiseta de algodao"
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
// FUNÇÃO PRINCIPAL
// ============================================================================

const searchNcm = onCall(async (request) => {
  // ==========================================================================
  // 1. AUTENTICAÇÃO
  // ==========================================================================

  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "O usuário precisa estar autenticado."
    );
  }

  // ==========================================================================
  // 2. DADOS RECEBIDOS
  // ==========================================================================

  const {
    storeId,
    query,
    limit = 20,
  } = request.data || {};

  if (!storeId) {
    throw new HttpsError(
      "invalid-argument",
      "storeId é obrigatório."
    );
  }

  if (!query || String(query).trim().length < 2) {
    throw new HttpsError(
      "invalid-argument",
      "Informe pelo menos 2 caracteres para pesquisar."
    );
  }

  // Limita a quantidade devolvida ao aplicativo.

  const safeLimit = Math.min(
    Math.max(Number(limit) || 20, 1),
    30
  );

  const db =
    admin.firestore();

  // ==========================================================================
  // 3. CONSULTA A LOJA
  // ==========================================================================

  const storeRef =
    db.collection("stores")
      .doc(storeId);

  const storeDoc =
    await storeRef.get();

  if (!storeDoc.exists) {
    throw new HttpsError(
      "not-found",
      "Loja não encontrada."
    );
  }

  const store =
    storeDoc.data();

  // ==========================================================================
  // 4. PLANO BUSINESS
  // ==========================================================================

  if (
    store.subscriptionType !== "business" ||
    store.subscriptionStatus !== "active"
  ) {
    throw new HttpsError(
      "permission-denied",
      "A pesquisa fiscal está disponível somente para o Plano Business ativo."
    );
  }

  // ==========================================================================
  // 5. VALIDA SE O USUÁRIO PERTENCE À LOJA
  //
  // Primeiro verificamos o owner.
  //
  // Se futuramente quisermos liberar pesquisa NCM para funcionários,
  // poderemos consultar aqui as permissões específicas.
  //
  // Por enquanto:
  // proprietário/admin da loja.
  // ==========================================================================

  const uid =
    request.auth.uid;

  if (store.ownerId !== uid) {
    throw new HttpsError(
      "permission-denied",
      "Você não possui permissão para utilizar a pesquisa fiscal."
    );
  }

  // ==========================================================================
  // 6. PREPARA A PESQUISA
  // ==========================================================================

  const originalQuery =
    String(query).trim();

  const digits =
    onlyDigits(originalQuery);

  const normalized =
    normalizeText(originalQuery);

  const results = [];

  // ==========================================================================
  // 7. PESQUISA EXATA POR CÓDIGO
  //
  // Se o usuário digitar:
  //
  // 61091000
  //
  // ou:
  //
  // 6109.10.00
  //
  // procuramos diretamente pelo documento.
  // ==========================================================================

  if (digits.length === 8) {
    const directDoc =
      await db
        .collection("ncm")
        .doc(digits)
        .get();

    if (
      directDoc.exists &&
      directDoc.data()?.ativo !== false
    ) {
      const data =
        directDoc.data();

      return {
        success: true,

        query:
          originalQuery,

        results: [
          {
            codigo:
              data.codigo ||
              directDoc.id,

            descricao:
              data.descricao ||
              "",
          },
        ],
      };
    }
  }

  // ==========================================================================
  // 8. PESQUISA POR PREFIXO DO CÓDIGO
  //
  // Exemplo:
  //
  // usuário digita:
  // 6109
  //
  // retornamos NCMs iniciados em 6109.
  // ==========================================================================

  if (
    digits.length >= 2 &&
    digits.length < 8 &&
    digits === normalized
  ) {
    const end =
      `${digits}\uf8ff`;

    const snapshot =
      await db
        .collection("ncm")
        .where(
          "codigo",
          ">=",
          digits
        )
        .where(
          "codigo",
          "<=",
          end
        )
        .limit(safeLimit)
        .get();

    for (
      const doc
      of snapshot.docs
    ) {
      const data =
        doc.data();

      if (data.ativo === false) {
        continue;
      }

      results.push({
        codigo:
          data.codigo ||
          doc.id,

        descricao:
          data.descricao ||
          "",
      });
    }

    return {
      success: true,
      query:
        originalQuery,
      results,
    };
  }

  // ==========================================================================
  // 9. PESQUISA POR PALAVRAS
  //
  // Firestore não possui busca textual completa nativa.
  //
  // Por isso o syncNcmTable cria o campo:
  //
  // palavras: [...]
  //
  // Exemplo:
  //
  // descrição:
  // "Camisetas de malha de algodão"
  //
  // palavras:
  // [
  //   "camisetas",
  //   "malha",
  //   "algodao"
  // ]
  //
  // Nesta primeira versão usamos a palavra mais relevante digitada.
  // ==========================================================================

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
    ]);

  const searchWords =
    normalized
      .split(" ")
      .filter(
        (word) =>
          word.length >= 2 &&
          !ignoredWords.has(word)
      );

  if (
    searchWords.length === 0
  ) {
    return {
      success: true,
      query:
        originalQuery,
      results: [],
    };
  }

  // ==========================================================================
  // PRIMEIRA PALAVRA
  //
  // Usamos inicialmente a palavra mais longa.
  //
  // Exemplo:
  //
  // "camiseta algodão"
  //
  // normalmente:
  // "camiseta"
  //
  // ou "algodao", dependendo do tamanho.
  // ==========================================================================

  searchWords.sort(
    (a, b) =>
      b.length - a.length
  );

  const principalWord =
    searchWords[0];

  // ==========================================================================
  // CONSULTA FIRESTORE
  // ==========================================================================

  const wordSnapshot =
    await db
      .collection("ncm")
      .where(
        "palavras",
        "array-contains",
        principalWord
      )
      .limit(100)
      .get();

  // ==========================================================================
  // 10. FILTRA E ORDENA EM MEMÓRIA
  //
  // Depois da primeira palavra, verificamos as demais palavras digitadas
  // dentro da descrição normalizada.
  // ==========================================================================

  const scoredResults = [];

  for (
    const doc
    of wordSnapshot.docs
  ) {
    const data =
      doc.data();

    if (data.ativo === false) {
      continue;
    }

    const descricao =
      String(
        data.descricao || ""
      );

    const descricaoNormalizada =
      data.descricaoNormalizada ||
      normalizeText(descricao);

    let score = 0;

    // ------------------------------------------------------------------------
    // Cada palavra encontrada aumenta a relevância.
    // ------------------------------------------------------------------------

    for (
      const word
      of searchWords
    ) {
      if (
        descricaoNormalizada.includes(
          word
        )
      ) {
        score += 10;
      }
    }

    // ------------------------------------------------------------------------
    // Se a descrição contém toda a frase, ganha peso adicional.
    // ------------------------------------------------------------------------

    if (
      descricaoNormalizada.includes(
        normalized
      )
    ) {
      score += 30;
    }

    scoredResults.push({
      codigo:
        data.codigo ||
        doc.id,

      descricao,

      score,
    });
  }

  // ==========================================================================
  // ORDENA POR RELEVÂNCIA
  // ==========================================================================

  scoredResults.sort(
    (a, b) => {
      if (
        b.score !== a.score
      ) {
        return b.score - a.score;
      }

      return a.codigo
        .localeCompare(
          b.codigo
        );
    }
  );

  // ==========================================================================
  // 11. LIMITA O RETORNO
  // ==========================================================================

  for (
    const item
    of scoredResults.slice(
      0,
      safeLimit
    )
  ) {
    results.push({
      codigo:
        item.codigo,

      descricao:
        item.descricao,
    });
  }

  // ==========================================================================
  // 12. RESPOSTA
  // ==========================================================================

  console.log(
    "Pesquisa NCM:",
    {
      storeId,
      query:
        originalQuery,
      resultados:
        results.length,
    }
  );

  return {
    success: true,

    query:
      originalQuery,

    results,
  };
});

// ============================================================================
// EXPORTAÇÃO
// ============================================================================

module.exports = {
  searchNcm,
};