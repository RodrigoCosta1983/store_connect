"use strict";


// ============================================================================
// STORE&CONNECT â€” TESTES DAS TRAVAS DE SEGURANÃ‡A DA RETENÃ‡ÃƒO
// ============================================================================
//
// Arquivo:
//   functions/backups/backupRetentionSafety.test.js
//
// Etapa:
//   F5.6-D1.5
//
// Objetivo:
//
// Validar a funÃ§Ã£o:
//
//   validateRetentionDeleteCandidate()
//
// antes de existir qualquer operaÃ§Ã£o real de exclusÃ£o.
//
// Este teste verifica:
//
// âœ… candidato legÃ­timo;
// âœ… backup pertencente ao KEEP;
// âœ… backup manual;
// âœ… backup nÃ£o-ready;
// âœ… backup protegido;
// âœ… campo protected invÃ¡lido;
// âœ… storeId incorreto;
// âœ… backupId incorreto;
// âœ… storagePath incorreto;
// âœ… createdAt invÃ¡lido;
// âœ… backup ausente da lista atual.
//
// Nenhum Firebase Ã© utilizado.
//
// ============================================================================


const assert =
    require("assert");

const {
  calculateBackupRetention,
  validateRetentionDeleteCandidate,
} = require("../../backups/backupRetention");


const STORE_ID =
    "TEST_STORE";


// ============================================================================
// HELPERS
// ============================================================================

function createBackup(
    date,
    {
      type = "automatic",
      status = "ready",
      protectedValue,
    } = {},
) {
  const backupId =
      `backup-${date}`;

  const backup = {
    backupId,

    storeId:
      STORE_ID,

    type,

    status,

    createdAt:
      new Date(
          `${date}T15:00:00.000Z`,
      ),

    storagePath:
      (
        `store_backups/` +
        `${STORE_ID}/` +
        `${backupId}/` +
        `snapshot.json.gz`
      ),
  };


  if (
    protectedValue !==
    undefined
  ) {
    backup.protected =
        protectedValue;
  }


  return backup;
}


function cloneBackup(
    backup,
) {
  return {
    ...backup,
  };
}


function getReasonCodes(
    result,
) {
  return result.reasons.map(
      (reason) =>
        reason.code,
  );
}


function assertBlockedBy(
    result,
    expectedCode,
) {
  assert.strictEqual(
      result.allowed,
      false,
      (
        `O backup deveria ter sido bloqueado por ` +
        `${expectedCode}.`
      ),
  );

  const reasonCodes =
      getReasonCodes(
          result,
      );

  assert.ok(
      reasonCodes.includes(
          expectedCode,
      ),
      (
        `Motivo esperado nÃ£o encontrado: ` +
        `${expectedCode}. ` +
        `Recebidos: ${reasonCodes.join(", ")}`
      ),
  );
}


// ============================================================================
// BASE DE BACKUPS
// ============================================================================
//
// Mesma estrutura usada para validar:
//
// 7 DAILY
// 4 WEEKLY
// 6 MONTHLY
// DELETE CANDIDATES
//
// ============================================================================

const backups = [

  // 7 DAILY
  createBackup("2026-09-30"),
  createBackup("2026-09-29"),
  createBackup("2026-09-28"),
  createBackup("2026-09-27"),
  createBackup("2026-09-26"),
  createBackup("2026-09-25"),
  createBackup("2026-09-24"),


  // 4 WEEKLY
  createBackup("2026-09-23"),
  createBackup("2026-09-20"),
  createBackup("2026-09-13"),
  createBackup("2026-09-06"),


  // Mesmo weekKey de 06/09.
  // Deve virar DELETE CANDIDATE.
  createBackup("2026-09-05"),


  // MONTHLY + excedentes
  createBackup("2026-08-30"),
  createBackup("2026-08-29"),

  createBackup("2026-07-31"),
  createBackup("2026-07-30"),

  createBackup("2026-06-30"),
  createBackup("2026-06-29"),

  createBackup("2026-05-31"),
  createBackup("2026-05-30"),

  createBackup("2026-04-30"),
  createBackup("2026-04-29"),

  createBackup("2026-03-31"),
  createBackup("2026-03-30"),

  createBackup("2026-02-28"),
];


// ============================================================================
// CONFIRMA BASE
// ============================================================================

const retention =
    calculateBackupRetention(
        backups,
    );

assert.strictEqual(
    retention.counts.keepTotal,
    17,
);

assert.strictEqual(
    retention.counts.deleteCandidates,
    8,
);


const validCandidate =
    backups.find(
        (backup) =>
          backup.backupId ===
          "backup-2026-09-05",
    );

const dailyKeep =
    backups.find(
        (backup) =>
          backup.backupId ===
          "backup-2026-09-30",
    );


assert.ok(
    validCandidate,
    "Candidato de teste nÃ£o encontrado.",
);

assert.ok(
    dailyKeep,
    "Backup DAILY de teste nÃ£o encontrado.",
);


// ============================================================================
// CABEÃ‡ALHO
// ============================================================================

console.log(
    "\n============================================================",
);

console.log(
    "F5.6-D1.5 â€” TESTES DAS TRAVAS DE SEGURANÃ‡A",
);

console.log(
    "============================================================",
);


// ============================================================================
// TESTE 1 â€” CANDIDATO LEGÃTIMO
// ============================================================================

{
  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData:
          cloneBackup(
              validCandidate,
          ),

        allBackups:
          backups,
      });


  assert.strictEqual(
      result.allowed,
      true,
      (
        "Um candidato legÃ­timo deveria ser " +
        "autorizado pela validaÃ§Ã£o."
      ),
  );


  assert.deepStrictEqual(
      result.reasons,
      [],
  );


  console.log(
      "âœ… candidato legÃ­timo â†’ ALLOWED",
  );
}


// ============================================================================
// TESTE 2 â€” BACKUP DAILY / KEEP
// ============================================================================

{
  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          dailyKeep.backupId,

        backupData:
          cloneBackup(
              dailyKeep,
          ),

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "retained-by-policy",
  );


  console.log(
      "âœ… backup em KEEP â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 3 â€” BACKUP MANUAL
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.type =
      "manual";


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "not-automatic",
  );


  console.log(
      "âœ… backup manual â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 4 â€” STATUS DIFERENTE DE READY
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.status =
      "processing";


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "not-ready",
  );


  console.log(
      "âœ… backup nÃ£o-ready â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 5 â€” BACKUP PROTEGIDO
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.protected =
      true;


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "backup-protected",
  );


  console.log(
      "âœ… protected=true â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 6 â€” CAMPO PROTECTED INVÃLIDO
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.protected =
      "true";


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "invalid-protected-field",
  );


  console.log(
      "âœ… protected invÃ¡lido â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 7 â€” STORE ID INCORRETO
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.storeId =
      "OUTRA_LOJA";


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "store-id-mismatch",
  );


  console.log(
      "âœ… storeId divergente â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 8 â€” BACKUP ID INCORRETO NA METADATA
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.backupId =
      "BACKUP_ERRADO";


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "backup-id-mismatch",
  );


  console.log(
      "âœ… backupId divergente â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 9 â€” STORAGE PATH INCORRETO
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.storagePath =
      (
        "store_backups/" +
        "OUTRA_LOJA/" +
        "arquivo.json.gz"
      );


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "invalid-storage-path",
  );


  console.log(
      "âœ… storagePath incorreto â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 10 â€” CREATED AT INVÃLIDO
// ============================================================================

{
  const backupData =
      cloneBackup(
          validCandidate,
      );

  backupData.createdAt =
      "DATA_INVALIDA";


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData,

        allBackups:
          backups,
      });


  assertBlockedBy(
      result,
      "invalid-created-at",
  );


  console.log(
      "âœ… createdAt invÃ¡lido â†’ BLOQUEADO",
  );
}


// ============================================================================
// TESTE 11 â€” BACKUP NÃƒO EXISTE NA LISTA ATUAL
// ============================================================================

{
  const listWithoutCandidate =
      backups.filter(
          (backup) =>
            backup.backupId !==
            validCandidate.backupId,
      );


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData:
          cloneBackup(
              validCandidate,
          ),

        allBackups:
          listWithoutCandidate,
      });


  assertBlockedBy(
      result,
      "backup-list-mismatch",
  );


  console.log(
      "âœ… backup ausente da lista atual â†’ BLOQUEADO",
  );
}



// ============================================================================
// TESTE 12 â€” CANDIDATO ANTIGO VIROU KEEP APÃ“S RECÃLCULO
// ============================================================================
//
// O backup de 05/09 Ã© candidato porque 06/09 representa sua semana.
//
// Agora simulamos uma mudanÃ§a no estado:
// removemos o backup de 06/09.
//
// Com isso, 05/09 passa a ser o representante semanal daquela faixa.
//
// Mesmo que ele tenha sido considerado candidato anteriormente,
// a validaÃ§Ã£o precisa RECALCULAR a polÃ­tica e bloqueÃ¡-lo.
//
// ============================================================================

{
  const updatedBackups =
      backups.filter(
          (backup) =>
            backup.backupId !==
            "backup-2026-09-06",
      );


  const updatedRetention =
      calculateBackupRetention(
          updatedBackups,
      );


  const becameKeep =
      [
        ...updatedRetention.keep.daily,
        ...updatedRetention.keep.weekly,
        ...updatedRetention.keep.monthly,
      ].some(
          (backup) =>
            backup.backupId ===
            validCandidate.backupId,
      );


  assert.strictEqual(
      becameKeep,
      true,
      (
        "O backup de 05/09 deveria ter se tornado " +
        "KEEP apÃ³s a mudanÃ§a do estado."
      ),
  );


  const result =
      validateRetentionDeleteCandidate({
        storeId:
          STORE_ID,

        backupId:
          validCandidate.backupId,

        backupData:
          cloneBackup(
              validCandidate,
          ),

        allBackups:
          updatedBackups,
      });


  assertBlockedBy(
      result,
      "retained-by-policy",
  );


  console.log(
      "âœ… candidato antigo que virou KEEP â†’ BLOQUEADO",
  );
}


// ============================================================================
// RESULTADO
// ============================================================================

console.log(
    "\n============================================================",
);

console.log(
    "âœ… TODAS AS TRAVAS DE SEGURANÃ‡A PASSARAM",
);

console.log(
    "============================================================\n",
);