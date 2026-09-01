/**
 * ============================================================================
 * ARQUIVO: scripts/migrateOwnerRoles.js
 * ============================================================================
 *
 * OBJETIVO
 * -------
 * Migração administrativa única para regularizar proprietários de lojas
 * antigas que foram criadas antes da adoção explícita do campo:
 *
 *   users/{uid}.role = "admin"
 *
 * CONTEXTO
 * --------
 * Nas lojas atuais, CreateStoreScreen já grava corretamente:
 *
 *   stores/{storeId}.ownerId = uid
 *
 * e:
 *
 *   users/{uid}.storeId = storeId
 *   users/{uid}.role = "admin"
 *
 * Porém, lojas antigas podem possuir ownerId corretamente na loja enquanto
 * o documento users/{ownerId} ainda não possui role.
 *
 * Isso faz o UserRoleProvider aplicar o fallback seguro "vendedor", impedindo
 * acesso às funções administrativas.
 *
 * O QUE ESTE SCRIPT FAZ
 * ---------------------
 * Para cada documento em stores:
 *
 * 1. lê ownerId;
 * 2. procura users/{ownerId};
 * 3. valida a relação entre usuário e loja;
 * 4. identifica proprietários antigos sem role válido;
 * 5. prepara a correção para:
 *
 *      role: "admin"
 *      storeId: "{storeId}"
 *
 * SEGURANÇA
 * ---------
 * O script NÃO:
 *
 * - altera clientes;
 * - altera funcionários normalmente cadastrados;
 * - transforma todo usuário sem role em admin;
 * - sobrescreve silenciosamente storeId conflitante;
 * - sobrescreve um role válido diferente de admin;
 * - cria automaticamente usuários inexistentes.
 *
 * A autoridade usada para decidir quem é proprietário é:
 *
 *   stores/{storeId}.ownerId
 *
 * MODO PADRÃO: DRY RUN
 * --------------------
 * Executar:
 *
 *   node scripts/migrateOwnerRoles.js
 *
 * apenas analisa e mostra o que seria alterado.
 *
 * Para realmente aplicar:
 *
 *   node scripts/migrateOwnerRoles.js --apply
 *
 * CUIDADO
 * -------
 * Este script usa Firebase Admin SDK e deve ser executado somente por quem
 * possui credenciais administrativas do projeto.
 *
 * Nunca versionar, compartilhar ou colocar a chave de service account
 * dentro do projeto/Git.
 *
 * Após a migração ser concluída e validada, este script pode permanecer
 * apenas como histórico administrativo ou ser removido.
 * ============================================================================
 */

const admin = require("firebase-admin");

// ============================================================================
// CONFIGURAÇÃO
// ============================================================================

const APPLY_CHANGES = process.argv.includes("--apply");

const VALID_ROLES = new Set([
  "admin",
  "gerente",
  "vendedor",
]);

// ============================================================================
// FIREBASE ADMIN
// ============================================================================

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

// ============================================================================
// CONTADORES
// ============================================================================

const stats = {
  storesFound: 0,
  alreadyCorrect: 0,
  wouldUpdate: 0,
  updated: 0,
  missingOwnerId: 0,
  missingUser: 0,
  storeIdConflict: 0,
  roleConflict: 0,
  errors: 0,
};

// ============================================================================
// UTILITÁRIOS
// ============================================================================

function normalizeString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeRole(value) {
  return normalizeString(value).toLowerCase();
}

function separator() {
  console.log(
    "--------------------------------------------------------------------",
  );
}

// ============================================================================
// MIGRAÇÃO
// ============================================================================

async function migrateOwnerRoles() {
  console.log("");
  console.log("============================================================");
  console.log(" STORE&CONNECT - MIGRAÇÃO DE PROPRIETÁRIOS");
  console.log("============================================================");
  console.log("");

  if (APPLY_CHANGES) {
    console.log("⚠️  MODO: APLICAÇÃO REAL");
    console.log("As alterações elegíveis serão gravadas no Firestore.");
  } else {
    console.log("🔎 MODO: DRY RUN");
    console.log("Nenhuma alteração será realizada.");
  }

  console.log("");

  const storesSnapshot = await db.collection("stores").get();

  stats.storesFound = storesSnapshot.size;

  console.log(
    `🏪 Lojas encontradas: ${stats.storesFound}`,
  );

  console.log("");

  for (const storeDoc of storesSnapshot.docs) {
    separator();

    const storeId = storeDoc.id;
    const storeData = storeDoc.data() || {};

    const storeName =
      normalizeString(storeData.name) || "(sem nome)";

    const ownerId =
      normalizeString(storeData.ownerId);

    console.log(`🏪 Loja: ${storeName}`);
    console.log(`   storeId: ${storeId}`);

    // ========================================================================
    // 1. LOJA SEM OWNER ID
    // ========================================================================

    if (!ownerId) {
      stats.missingOwnerId++;

      console.log(
        "⚠️  IGNORADA: loja não possui ownerId.",
      );

      continue;
    }

    console.log(`   ownerId: ${ownerId}`);

    try {
      // ======================================================================
      // 2. BUSCAR USUÁRIO PROPRIETÁRIO
      // ======================================================================

      const userRef =
        db.collection("users").doc(ownerId);

      const userDoc =
        await userRef.get();

      if (!userDoc.exists) {
        stats.missingUser++;

        console.log(
          "⚠️  IGNORADA: users/{ownerId} não existe.",
        );

        continue;
      }

      const userData =
        userDoc.data() || {};

      const currentRole =
        normalizeRole(userData.role);

      const currentStoreId =
        normalizeString(userData.storeId);

      console.log(
        `   role atual: ${currentRole || "(ausente)"}`,
      );

      console.log(
        `   storeId do usuário: ${
          currentStoreId || "(ausente)"
        }`,
      );

      // ======================================================================
      // 3. CONFLITO DE STORE ID
      //
      // Se o usuário aponta explicitamente para outra loja, não alteramos.
      // Isso merece revisão manual antes de qualquer correção automática.
      // ======================================================================

      if (
        currentStoreId &&
        currentStoreId !== storeId
      ) {
        stats.storeIdConflict++;

        console.log(
          "🚨 CONFLITO: usuário está vinculado a outro storeId.",
        );

        console.log(
          "   Nenhuma alteração será realizada automaticamente.",
        );

        continue;
      }

      // ======================================================================
      // 4. ROLE JÁ É ADMIN
      //
      // Só precisamos eventualmente preencher storeId legado ausente.
      // ======================================================================

      if (currentRole === "admin") {
        if (currentStoreId === storeId) {
          stats.alreadyCorrect++;

          console.log(
            "✅ OK: proprietário já está corretamente configurado.",
          );

          continue;
        }

        const updateData = {
          storeId,
        };

        stats.wouldUpdate++;

        console.log(
          "🛠️  CORREÇÃO NECESSÁRIA:",
        );

        console.log(
          `   storeId: "(ausente)" → "${storeId}"`,
        );

        if (APPLY_CHANGES) {
          await userRef.set(
            updateData,
            { merge: true },
          );

          stats.updated++;

          console.log(
            "✅ Atualização aplicada.",
          );
        } else {
          console.log(
            "🔎 DRY RUN: nenhuma gravação realizada.",
          );
        }

        continue;
      }

      // ======================================================================
      // 5. ROLE VÁLIDO, MAS DIFERENTE DE ADMIN
      //
      // Mesmo que ownerId indique propriedade, não sobrescrevemos
      // automaticamente gerente/vendedor.
      //
      // Isso evita apagar uma decisão administrativa existente sem revisão.
      // ======================================================================

      if (
        currentRole &&
        VALID_ROLES.has(currentRole)
      ) {
        stats.roleConflict++;

        console.log(
          `🚨 CONFLITO: proprietário possui role válido "${currentRole}".`,
        );

        console.log(
          "   Nenhuma promoção automática foi realizada.",
        );

        continue;
      }

      // ======================================================================
      // 6. PROPRIETÁRIO LEGADO SEM ROLE
      //
      // Este é o principal caso desta migração.
      //
      // Como:
      //
      //   stores/{storeId}.ownerId == ownerId
      //
      // e não existe conflito de storeId,
      // podemos regularizar o proprietário.
      // ======================================================================

      const updateData = {
        role: "admin",
        storeId,
      };

      stats.wouldUpdate++;

      console.log(
        "🛠️  PROPRIETÁRIO LEGADO IDENTIFICADO.",
      );

      console.log(
        `   role: "${currentRole || "(ausente)"}" → "admin"`,
      );

      if (!currentStoreId) {
        console.log(
          `   storeId: "(ausente)" → "${storeId}"`,
        );
      }

      if (APPLY_CHANGES) {
        await userRef.set(
          updateData,
          { merge: true },
        );

        stats.updated++;

        console.log(
          "✅ Proprietário atualizado para admin.",
        );
      } else {
        console.log(
          "🔎 DRY RUN: nenhuma gravação realizada.",
        );
      }
    } catch (error) {
      stats.errors++;

      console.error(
        `❌ Erro ao processar loja ${storeId}:`,
        error,
      );
    }
  }

  // ==========================================================================
  // RELATÓRIO FINAL
  // ==========================================================================

  console.log("");
  console.log("");
  console.log("============================================================");
  console.log(" RESULTADO DA MIGRAÇÃO");
  console.log("============================================================");
  console.log("");

  console.log(
    `🏪 Lojas analisadas:              ${stats.storesFound}`,
  );

  console.log(
    `✅ Já estavam corretas:           ${stats.alreadyCorrect}`,
  );

  console.log(
    `🛠️  Elegíveis para correção:      ${stats.wouldUpdate}`,
  );

  if (APPLY_CHANGES) {
    console.log(
      `✅ Alterações realizadas:         ${stats.updated}`,
    );
  }

  console.log(
    `⚠️  Sem ownerId:                  ${stats.missingOwnerId}`,
  );

  console.log(
    `⚠️  Usuário proprietário ausente: ${stats.missingUser}`,
  );

  console.log(
    `🚨 Conflito de storeId:           ${stats.storeIdConflict}`,
  );

  console.log(
    `🚨 Conflito de role:              ${stats.roleConflict}`,
  );

  console.log(
    `❌ Erros:                         ${stats.errors}`,
  );

  console.log("");

  if (!APPLY_CHANGES) {
    console.log(
      "🔎 Nenhuma alteração foi realizada.",
    );

    console.log(
      "Revise o relatório acima.",
    );

    console.log("");

    console.log(
      "Para aplicar somente as correções elegíveis:",
    );

    console.log(
      "node scripts/migrateOwnerRoles.js --apply",
    );
  } else {
    console.log(
      "✅ Migração concluída.",
    );
  }

  console.log("");
  console.log("============================================================");
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

migrateOwnerRoles()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("");
    console.error(
      "❌ Falha fatal durante a migração:",
      error,
    );

    process.exit(1);
  });