"use strict";

const assert =
    require("assert");

const {
  calculateBackupRetention,
  getIsoWeekKey,
} = require("../../backups/backupRetention");


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
  const backup = {
    backupId:
      `backup-${date}-${type}-${status}`,

    storeId:
      "TEST_STORE",

    type,
    status,

    createdAt:
      new Date(
          `${date}T15:00:00.000Z`,
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


// ============================================================================
// DADOS SIMULADOS
// ============================================================================

const backups = [

  // --------------------------------------------------------------------------
  // 7 MAIS RECENTES â†’ DIÃRIOS
  // --------------------------------------------------------------------------

  createBackup("2026-09-30"),
  createBackup("2026-09-29"),
  createBackup("2026-09-28"),
  createBackup("2026-09-27"),
  createBackup("2026-09-26"),
  createBackup("2026-09-25"),
  createBackup("2026-09-24"),


  // --------------------------------------------------------------------------
  // FAIXA SEMANAL
  // --------------------------------------------------------------------------

  createBackup("2026-09-23"),
  createBackup("2026-09-20"),
  createBackup("2026-09-13"),
  createBackup("2026-09-06"),

  // IMPORTANTE:
  // 05/09 pertence Ã  mesma semana de 06/09.
  //
  // Ele NÃƒO pode virar mensal.
  createBackup("2026-09-05"),


  // --------------------------------------------------------------------------
  // FAIXA MENSAL
  // --------------------------------------------------------------------------

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

  // JÃ¡ estÃ¡ alÃ©m dos 6 mensais.
  createBackup("2026-02-28"),


  // --------------------------------------------------------------------------
  // PROTEGIDOS / NÃƒO ELEGÃVEIS
  // --------------------------------------------------------------------------

  createBackup(
      "2026-10-01",
      {
        type: "manual",
        status: "ready",
      },
  ),

  createBackup(
      "2026-10-02",
      {
        type: "automatic",
        status: "processing",
      },
  ),

  createBackup(
      "2026-01-31",
      {
        type: "automatic",
        status: "ready",
        protectedValue: true,
      },
  ),
];


// ============================================================================
// EXECUTA MOTOR
// ============================================================================

const result =
    calculateBackupRetention(
        backups,
    );


// ============================================================================
// MOSTRA RESULTADO
// ============================================================================

function printGroup(
    title,
    group,
) {
  console.log(
      `\n${title}`,
  );

  for (const backup of group) {
    console.log(
        `  ${backup.createdAtDate
            .toISOString()
            .slice(0, 10)}  â†’  ${backup.backupId}`,
    );
  }
}


console.log(
    "\n============================================================",
);

console.log(
    "F5.6 â€” TESTE DA POLÃTICA DE RETENÃ‡ÃƒO",
);

console.log(
    "============================================================",
);


printGroup(
    "ðŸ“… DAILY",
    result.keep.daily,
);

printGroup(
    "ðŸ“† WEEKLY",
    result.keep.weekly,
);

printGroup(
    "ðŸ—“ï¸ MONTHLY",
    result.keep.monthly,
);

printGroup(
    "ðŸ—‘ï¸ DELETE CANDIDATES",
    result.deleteCandidates,
);


console.log(
    "\nCONTADORES:",
    result.counts,
);


// ============================================================================
// ASSERT â€” DIÃRIOS
// ============================================================================

assert.strictEqual(
    result.keep.daily.length,
    7,
    "Deveriam existir exatamente 7 backups diÃ¡rios.",
);


// ============================================================================
// ASSERT â€” SEMANAIS
// ============================================================================

assert.strictEqual(
    result.keep.weekly.length,
    4,
    "Deveriam existir exatamente 4 backups semanais.",
);

const weeklyKeys =
    result.keep.weekly.map(
        (backup) =>
          getIsoWeekKey(
              backup.createdAtDate,
          ),
    );

assert.strictEqual(
    new Set(weeklyKeys).size,
    4,
    "Os 4 backups semanais precisam representar semanas diferentes.",
);


// ============================================================================
// ASSERT â€” MENSAIS
// ============================================================================

assert.strictEqual(
    result.keep.monthly.length,
    6,
    "Deveriam existir exatamente 6 backups mensais.",
);


// ============================================================================
// REGRA CRÃTICA:
// MENSAL NÃƒO PODE REUTILIZAR SEMANA DA FAIXA SEMANAL
// ============================================================================

const monthlyWeekKeys =
    result.keep.monthly.map(
        (backup) =>
          getIsoWeekKey(
              backup.createdAtDate,
          ),
    );

for (const weekKey of monthlyWeekKeys) {
  assert.ok(
      !weeklyKeys.includes(
          weekKey,
      ),
      `Backup mensal caiu dentro de semana jÃ¡ protegida: ${weekKey}`,
  );
}


// ============================================================================
// BACKUPS PROTEGIDOS NÃƒO ENTRAM NA LIMPEZA
// ============================================================================

const deleteIds =
    new Set(
        result.deleteCandidates.map(
            (backup) =>
              backup.backupId,
        ),
    );

const manualBackup =
    backups.find(
        (backup) =>
          backup.type === "manual",
    );

const processingBackup =
    backups.find(
        (backup) =>
          backup.status === "processing",
    );

assert.ok(
    !deleteIds.has(
        manualBackup.backupId,
    ),
    "Backup manual nunca pode virar candidato Ã  exclusÃ£o.",
);

assert.ok(
    !deleteIds.has(
        processingBackup.backupId,
    ),
    "Backup nÃ£o-ready nunca pode virar candidato Ã  exclusÃ£o.",
);


// ============================================================================
// BACKUP PROTEGIDO NÃƒO PARTICIPA DA RETENÃ‡ÃƒO
// ============================================================================

const protectedBackup =
    backups.find(
        (backup) =>
          backup.protected === true,
    );

assert.ok(
    protectedBackup,
    "Backup protegido de teste nÃ£o encontrado.",
);

const allRetentionIds =
    new Set([
      ...result.keep.daily.map(
          (backup) =>
            backup.backupId,
      ),

      ...result.keep.weekly.map(
          (backup) =>
            backup.backupId,
      ),

      ...result.keep.monthly.map(
          (backup) =>
            backup.backupId,
      ),

      ...result.deleteCandidates.map(
          (backup) =>
            backup.backupId,
      ),
    ]);

assert.ok(
    !allRetentionIds.has(
        protectedBackup.backupId,
    ),
    (
      "Backup protected=true nÃ£o pode participar " +
      "da retenÃ§Ã£o automÃ¡tica."
    ),
);

console.log(
    "âœ… protected=true ficou fora de KEEP e DELETE CANDIDATES",
);


// ============================================================================
// FINAL
// ============================================================================

console.log(
    "\n============================================================",
);

console.log(
    "âœ… TODOS OS TESTES DE RETENÃ‡ÃƒO PASSARAM",
);

console.log(
    "============================================================\n",
);