// ============================================================================
// STORE CONNECT - BANCO LOCAL / FILA DE VENDAS OFFLINE
// ============================================================================
//
// Arquivo:
//   lib/data/local/app_database.dart
//
// Objetivo:
//   Manter a base SQLite local usada pelo modo offline do Store Connect.
//
// Arquitetura:
//   UI / PDV
//      ↓
//   OfflineSalesRepository
//      ↓
//   AppDatabase.instance
//      ↓
//   Drift / SQLite
//
// IMPORTANTE:
//   - AppDatabase deve existir UMA ÚNICA VEZ durante a execução do aplicativo.
//   - Use sempre AppDatabase.instance.
//   - Não crie AppDatabase() diretamente em telas, widgets ou serviços.
//   - Isso evita múltiplos executores Drift apontando para o mesmo arquivo,
//     condição que pode impedir streams reativos de perceberem alterações e,
//     em cenários concorrentes, causar race conditions.
//
// Persistência:
//   A tabela PendingSales guarda vendas que ainda precisam chegar ao backend.
//
// Estados:
//   pending  -> aguardando sincronização
//   syncing  -> sincronização em andamento
//   synced   -> sincronizada com sucesso
//   failed   -> tentativa falhou e poderá ser repetida
//
// Segurança:
//   Este banco NÃO deve armazenar:
//   - senhas;
//   - tokens;
//   - certificado A1;
//   - credenciais Focus NFe;
//   - outros segredos fiscais.
//
// Estoque:
//   O SQLite não é a fonte definitiva de estoque multi-dispositivo.
//   Enquanto uma venda ainda não foi confirmada pelo backend, seus itens funcionam
//   como uma RESERVA LOCAL de estoque. A UI subtrai essas reservas do último saldo
//   conhecido do Firestore para impedir sobrevenda no mesmo aparelho offline.
//   Além da proteção visual, o fechamento offline executa uma segunda validação
//   imediatamente antes de inserir a venda, dentro de uma transação SQLite.
//   A reconciliação definitiva continua sendo feita pelo backend no SyncService.
//
// ============================================================================

import 'dart:convert';
import 'dart:math';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

abstract final class OfflineSaleStatus {
  static const String pending = 'pending';
  static const String syncing = 'syncing';
  static const String synced = 'synced';
  static const String failed = 'failed';
  static const String unknown = 'unknown';
  static const String rejected = 'rejected';
  static const String confirmedRefreshPending = 'confirmedRefreshPending';
}

class PendingSales extends Table {
  TextColumn get localId => text()();
  TextColumn get storeId => text()();
  RealColumn get totalAmount => real()();
  TextColumn get productsJson => text()();
  TextColumn get paymentMethod => text()();
  TextColumn get notes => text().nullable()();
  TextColumn get customerId => text().nullable()();
  TextColumn get customerName => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get syncedAt => dateTime().nullable()();

  TextColumn get status =>
      text().withDefault(const Constant(OfflineSaleStatus.pending))();

  IntColumn get syncAttempts => integer().withDefault(const Constant(0))();

  TextColumn get lastSyncError => text().nullable()();
  TextColumn get serverSaleId => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {localId};
}

@DriftDatabase(tables: [PendingSales])
class AppDatabase extends _$AppDatabase {
  AppDatabase.offlineQueue(super.executor) : localPersistenceEnabled = false;
  /// Additive queue journal. Historical pending_sales rows are never adopted.
  Future<void>? _s03Ready;
  Future<void> prepareS03() => _s03Ready ??= customStatement('''
    CREATE TABLE IF NOT EXISTS offline_sale_commands_v1 (
      local_id TEXT PRIMARY KEY NOT NULL, command_json TEXT NOT NULL,
      claim_token TEXT, claim_until INTEGER, result_json TEXT
    )''').then((_) => customStatement('''
    CREATE TABLE IF NOT EXISTS offline_sale_transports_v1 (
      local_id TEXT PRIMARY KEY NOT NULL, transport_json TEXT NOT NULL
    )''')).catchError((Object error) { _s03Ready = null; throw error; });

  Future<String?> readS03Transport(String id) async {
    await prepareS03();
    final rows = await customSelect('SELECT transport_json FROM offline_sale_transports_v1 WHERE local_id = ?',
      variables: [Variable<String>(id)]).get();
    return rows.isEmpty ? null : rows.single.read<String>('transport_json');
  }

  Future<String?> readS03Command(String id) async {
    await prepareS03();
    final rows = await customSelect('SELECT command_json FROM offline_sale_commands_v1 WHERE local_id = ?',
      variables: [Variable<String>(id)]).get();
    return rows.isEmpty ? null : rows.single.read<String>('command_json');
  }

  Future<void> insertS03(PendingSalesCompanion sale, String command, {String? transport}) async {
    await prepareS03();
    await transaction(() async {
      final existing = await getSaleByLocalId(sale.localId.value);
      if (existing != null) {
        if (await readS03Command(existing.localId) != command) {
          throw StateError('Identidade offline já existe com outra intenção.');
        }
        return;
      }
      await into(pendingSales).insert(sale);
      await customStatement('INSERT INTO offline_sale_commands_v1(local_id, command_json) VALUES (?, ?)',
        [sale.localId.value, command]);
      if (transport != null) {
        await customStatement('INSERT INTO offline_sale_transports_v1(local_id, transport_json) VALUES (?, ?)',
          [sale.localId.value, transport]);
      }
    });
  }

  Future<String?> claimS03(String id, DateTime now) async {
    await prepareS03();
    final token = List.generate(24, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    return transaction(() async {
      final changed = await customUpdate('''UPDATE offline_sale_commands_v1 SET claim_token = ?, claim_until = ?
        WHERE local_id = ? AND result_json IS NULL AND (claim_token IS NULL OR claim_until <= ?)''',
        variables: [Variable<String>(token), Variable<int>(now.add(const Duration(minutes: 2)).millisecondsSinceEpoch),
          Variable<String>(id), Variable<int>(now.millisecondsSinceEpoch)]);
      if (changed != 1) return null;
      await markSaleAsSyncing(id);
      return token;
    });
  }

  Future<bool> finishS03(String id, String token, String status, {String? result, String? reason}) => transaction(() async {
    final changed = await customUpdate('''UPDATE offline_sale_commands_v1 SET claim_token = NULL,
      claim_until = NULL, result_json = ? WHERE local_id = ? AND claim_token = ?''',
      variables: [Variable<String>(result), Variable<String>(id), Variable<String>(token)]);
    if (changed != 1) return false;
    await (update(pendingSales)..where((t) => t.localId.equals(id))).write(PendingSalesCompanion(
      status: Value(status), lastSyncError: Value(reason),
      serverSaleId: status == OfflineSaleStatus.synced ? Value(id) : const Value.absent(),
      syncedAt: status == OfflineSaleStatus.synced ? Value(DateTime.now()) : const Value.absent()));
    return true;
  });

  Stream<List<PendingSale>> watchS03Queue() {
    requireLegacyAccess();
    return (select(pendingSales)
    ..where((t) => t.status.equals(OfflineSaleStatus.synced).not())
    ..orderBy([(t) => OrderingTerm.asc(t.createdAt)])).watch();
  }

  Future<List<PendingSale>> readS03Queue() {
    requireLegacyAccess();
    return (select(pendingSales)
    ..where((t) => t.status.equals(OfflineSaleStatus.synced).not())
    ..orderBy([(t) => OrderingTerm.asc(t.createdAt)])).get();
  }

  AppDatabase._internal()
    : localPersistenceEnabled = false,
      super(driftDatabase(name: 'store_connect_local'));

  /// Isolated local infrastructure. Never wired to the operational singleton
  /// before C-C; callers must supply an executor (tests use synthetic files).
  AppDatabase.localPersistence(super.executor)
    : localPersistenceEnabled = true;

  final bool localPersistenceEnabled;

  static final AppDatabase instance = AppDatabase._internal();

  @override
  int get schemaVersion => localPersistenceEnabled ? 2 : 1;

  void requireLegacyAccess() {
    if (localPersistenceEnabled) {
      throw StateError('Legacy offline API disabled for local schema v2.');
    }
  }

  void _requireLocalPersistence() {
    if (!localPersistenceEnabled) {
      throw StateError('Local persistence infrastructure is not activated.');
    }
  }

  // SQL-managed additive extension: generated Drift models intentionally remain
  // the v1 historical projection. No code generation or second table/ledger.
  static const _extensionColumns = <String, String>{
    'origin_project_id': 'TEXT', 'origin_uid': 'TEXT',
    'origin_target_json': 'TEXT', 'origin_evidence_kind': 'TEXT',
    'origin_evidence_version': 'INTEGER', 'remote_phase': 'TEXT',
    'context_gate': 'TEXT', 'local_phase': 'TEXT',
    'state_version': 'INTEGER NOT NULL DEFAULT 0',
    'claim_token': 'TEXT', 'claim_owner': 'TEXT',
    'claim_expires_at': 'INTEGER', 'attempt_started_at': 'INTEGER',
    'prior_online_attempt': 'TEXT',
    'previous_uncertainty': 'INTEGER NOT NULL DEFAULT 0',
    'remote_evidence_json': 'TEXT', 'remote_confirmed_at': 'INTEGER',
    'reconciliation_reason_code': 'TEXT', 'refresh_completed_at': 'INTEGER',
    'local_finalized_at': 'INTEGER', 'snapshot_version': 'INTEGER',
  };

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) => transaction(() async {
      await m.createAll();
      if (localPersistenceEnabled) await _extendLocalSchema();
    }),
    onUpgrade: (m, from, to) async {
      if (!localPersistenceEnabled || from != 1 || to != 2) {
        throw StateError('Unsupported offline database upgrade.');
      }
      await _extendLocalSchema();
    },
    beforeOpen: (details) async {
      if (!localPersistenceEnabled && details.versionNow != 1) {
        throw StateError('Legacy writer cannot open extended offline schema.');
      }
    },
  );

  Future<void> _extendLocalSchema() => transaction(() async {
    final before = await customSelect('SELECT * FROM pending_sales ORDER BY local_id').get();
    for (final entry in _extensionColumns.entries) {
      await customStatement('ALTER TABLE pending_sales ADD COLUMN ${entry.key} ${entry.value}');
    }
    await customStatement('''UPDATE pending_sales SET
      context_gate = 'ambiguous', prior_online_attempt = 'possible',
      origin_evidence_kind = 'legacyUnproven',
      remote_phase = CASE WHEN status = 'pending' THEN 'pending'
        WHEN status = 'synced' THEN NULL ELSE 'unknown' END,
      previous_uncertainty = CASE WHEN status IN ('pending','synced') THEN 0 ELSE 1 END,
      local_phase = CASE WHEN status = 'synced' THEN 'finalized' ELSE 'held' END,
      reconciliation_reason_code = CASE WHEN status = 'synced'
        THEN 'legacyHistoricalCompletion' ELSE 'legacyOriginMissing' END''');
    final after = await customSelect('SELECT * FROM pending_sales ORDER BY local_id').get();
    if (before.length != after.length) throw StateError('Migration lost rows.');
    for (var i = 0; i < before.length; i++) {
      for (final entry in before[i].data.entries) {
        if (entry.value != after[i].data[entry.key]) {
          throw StateError('Migration changed historical bytes.');
        }
      }
      final row = after[i].data;
      if (!['pending','failed','syncing','synced'].contains(row['status']) ||
          _productQuantities(row['products_json']) == null ||
          row['store_id'] is! String || (row['store_id'] as String).trim().isEmpty) {
        await customStatement("UPDATE pending_sales SET context_gate = 'integrityBlocked', reconciliation_reason_code = 'malformedHistoricalRecord' WHERE local_id = ?", [row['local_id']]);
      }
    }
    await customStatement('CREATE INDEX pending_sales_context_v2 ON pending_sales(origin_project_id, store_id, local_phase, created_at, local_id)');
    await customStatement('CREATE INDEX pending_sales_claim_v2 ON pending_sales(remote_phase, claim_expires_at)');
    // Drift normally writes user_version after onUpgrade returns. Persist it in
    // the same transaction as the ALTERs so a crash cannot leave v2 columns/v1
    // metadata. Drift's later write of the same version is harmless.
    await customStatement('PRAGMA user_version = 2');
  });

  Future<void> insertPendingSale(PendingSalesCompanion sale) async {
    requireLegacyAccess();
    await into(pendingSales).insert(sale, mode: InsertMode.insertOrIgnore);
  }

  Future<PendingSale?> getSaleByLocalId(String localId) {
    return (select(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).getSingleOrNull();
  }

  Future<List<PendingSale>> getSalesWaitingForSync() {
    requireLegacyAccess();
    return (select(pendingSales)
          ..where(
            (table) =>
                table.status.equals(OfflineSaleStatus.pending) |
                table.status.equals(OfflineSaleStatus.failed),
          )
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .get();
  }

  Future<List<PendingSale>> getPendingSales() {
    requireLegacyAccess();
    return (select(pendingSales)
          ..where((table) => table.status.equals(OfflineSaleStatus.pending))
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .get();
  }

  Stream<List<PendingSale>> watchSalesWaitingForSync() {
    requireLegacyAccess();
    return (select(pendingSales)
          ..where(
            (table) =>
                table.status.equals(OfflineSaleStatus.pending) |
                table.status.equals(OfflineSaleStatus.failed),
          )
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .watch();
  }

  /// Observa todas as vendas que ainda reservam estoque localmente.
  ///
  /// Inclui:
  ///   pending  -> ainda não enviada;
  ///   syncing  -> envio em andamento;
  ///   failed   -> tentativa falhou e precisa permanecer reservada.
  ///
  /// Exclui somente `synced`, pois nesse ponto o saldo definitivo já foi
  /// confirmado no servidor.
  Stream<List<PendingSale>> watchUnsyncedSalesForLocalStock() {
    requireLegacyAccess();
    return (select(pendingSales)
          ..where(
            (table) =>
                table.status.equals(OfflineSaleStatus.pending) |
                table.status.equals(OfflineSaleStatus.syncing) |
                table.status.equals(OfflineSaleStatus.unknown) |
                table.status.equals(OfflineSaleStatus.confirmedRefreshPending) |
                table.status.equals(OfflineSaleStatus.failed),
          )
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .watch();
  }

  /// Snapshot das vendas que ainda reservam estoque localmente.
  ///
  /// Usado dentro de uma transação SQLite no instante do fechamento offline.
  Future<List<PendingSale>> getUnsyncedSalesForLocalStock() {
    requireLegacyAccess();
    return (select(pendingSales)
          ..where(
            (table) =>
                table.status.equals(OfflineSaleStatus.pending) |
                table.status.equals(OfflineSaleStatus.syncing) |
                table.status.equals(OfflineSaleStatus.unknown) |
                table.status.equals(OfflineSaleStatus.confirmedRefreshPending) |
                table.status.equals(OfflineSaleStatus.failed),
          )
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .get();
  }

  Future<int> countSalesWaitingForSync() async {
    requireLegacyAccess();
    final countExpression = pendingSales.localId.count();

    final query = selectOnly(pendingSales)
      ..addColumns([countExpression])
      ..where(
        pendingSales.status.equals(OfflineSaleStatus.pending) |
            pendingSales.status.equals(OfflineSaleStatus.failed),
      );

    final row = await query.getSingle();
    return row.read(countExpression) ?? 0;
  }

  Future<void> markSaleAsSyncing(String localId) async {
    requireLegacyAccess();
    await customUpdate(
      '''
      UPDATE pending_sales
      SET
        status = ?,
        sync_attempts = sync_attempts + 1,
        last_sync_error = NULL
      WHERE local_id = ?
      ''',
      variables: [
        Variable<String>(OfflineSaleStatus.syncing),
        Variable<String>(localId),
      ],
      updates: {pendingSales},
    );
  }

  Future<void> markSaleAsSynced({
    required String localId,
    required String serverSaleId,
  }) async {
    requireLegacyAccess();
    await (update(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).write(
      PendingSalesCompanion(
        status: const Value(OfflineSaleStatus.synced),
        syncedAt: Value(DateTime.now()),
        serverSaleId: Value(serverSaleId),
        lastSyncError: const Value(null),
      ),
    );
  }

  Future<void> markSaleAsFailed({
    required String localId,
    required String error,
  }) async {
    requireLegacyAccess();
    await (update(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).write(
      PendingSalesCompanion(
        status: const Value(OfflineSaleStatus.failed),
        lastSyncError: Value(_sanitizeError(error)),
      ),
    );
  }

  Future<void> resetSaleForRetry(String localId) async {
    requireLegacyAccess();
    await (update(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).write(
      const PendingSalesCompanion(
        status: Value(OfflineSaleStatus.pending),
        lastSyncError: Value(null),
      ),
    );
  }

  Future<int> recoverInterruptedSyncs() {
    requireLegacyAccess();
    return (update(
      pendingSales,
    )..where((table) => table.status.equals(OfflineSaleStatus.syncing))).write(
      const PendingSalesCompanion(status: Value(OfflineSaleStatus.pending)),
    );
  }

  Future<List<PendingSale>> getAllLocalSales() {
    return (select(
      pendingSales,
    )..orderBy([(table) => OrderingTerm.desc(table.createdAt)])).get();
  }

  Future<int> deleteLocalSale(String localId) {
    requireLegacyAccess();
    return (delete(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).go();
  }

  String _sanitizeError(String error) {
    final normalized = error.trim();
    if (normalized.length <= 1000) return normalized;
    return normalized.substring(0, 1000);
  }

  Future<Map<String, Object?>?> readLocalIntent(String id) async {
    _requireLocalPersistence();
    final rows = await customSelect('SELECT * FROM pending_sales WHERE local_id = ?',
      variables: [Variable<String>(id)]).get();
    return rows.isEmpty ? null : Map.unmodifiable(rows.single.data);
  }

  /// Trusted local diagnostic API, not an authorization boundary for UI.
  Future<List<Map<String, Object?>>> readLocalIntents() async {
    _requireLocalPersistence();
    final rows = await customSelect('SELECT * FROM pending_sales ORDER BY created_at, local_id').get();
    return List.unmodifiable(rows.map((row) => Map<String, Object?>.unmodifiable(row.data)));
  }

  Future<LocalIntentInsertResult> persistLocalIntent(LocalSaleIntent intent) async {
    _requireLocalPersistence();
    final values = intent.values;
    if (_productQuantities(values['products_json']) == null) {
      throw const FormatException('Invalid immutable sale products.');
    }
    // Single INSERT with conflict reporting, then compare every immutable field.
    // No candidate is overwritten and no replacement identity is generated.
    return transaction(() async {
      final names = values.keys.join(',');
      final placeholders = List.filled(values.length, '?').join(',');
      await customStatement('INSERT INTO pending_sales ($names) VALUES ($placeholders) ON CONFLICT(local_id) DO NOTHING', values.values.toList());
      final inserted = (await customSelect('SELECT changes() AS n').getSingle()).read<int>('n') == 1;
      final stored = (await readLocalIntent(intent.localId))!;
      if (inserted) return LocalIntentInsertResult.inserted;
      for (final key in LocalSaleIntent.immutableKeys) {
        if (stored[key] != values[key]) {
          await customStatement('''UPDATE pending_sales SET
            context_gate = 'integrityBlocked',
            reconciliation_reason_code = 'localIdentityConflict',
            state_version = state_version + 1 WHERE local_id = ?''', [intent.localId]);
          return LocalIntentInsertResult.conflict;
        }
      }
      return LocalIntentInsertResult.existing;
    });
  }

  Future<int> _localCas(String sql, List<Object?> args) async {
    _requireLocalPersistence();
    return customUpdate(sql, variables: args.map((v) {
      if (v is int) return Variable<int>(v);
      return Variable<String>(v as String);
    }).toList(), updates: {pendingSales});
  }

  Future<String?> claimLocalIntent({required String id, required int version,
    required LocalSaleScope scope, required String owner, required DateTime now,
    required Duration lease}) async {
    if (owner.trim().isEmpty || lease.inMilliseconds <= 0) throw ArgumentError('Invalid claim.');
    final token = List.generate(24, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    final n = await _localCas('''UPDATE pending_sales SET remote_phase = 'claimed',
      claim_token = ?, claim_owner = ?, claim_expires_at = ?, attempt_started_at = ?,
      state_version = state_version + 1
      WHERE local_id = ? AND state_version = ? AND remote_phase = 'pending'
      AND context_gate = 'compatible' AND local_phase = 'held'
      AND prior_online_attempt = 'provenAbsent' AND previous_uncertainty = 0
      AND origin_project_id = ? AND store_id = ? AND origin_uid = ? AND origin_target_json = ?''',
      [token, owner, now.add(lease).millisecondsSinceEpoch, now.millisecondsSinceEpoch,
       id, version, scope.projectId, scope.storeId, scope.uid, scope.targetJson]);
    return n == 1 ? token : null;
  }

  Future<bool> setLocalContext({required String id, required int version,
    required LocalSaleScope activeScope}) async {
    final row = await readLocalIntent(id);
    if (row == null || row['context_gate'] == 'integrityBlocked') return false;
    final complete = row['origin_evidence_kind'] == 'capturedBeforeNetwork' &&
      row['origin_project_id'] != null && row['origin_uid'] != null && row['origin_target_json'] != null;
    final matches = complete && activeScope.matches(row);
    final gate = !complete ? 'ambiguous' : matches ? 'compatible' : 'incompatible';
    return await _localCas('UPDATE pending_sales SET context_gate = ?, state_version = state_version + 1 WHERE local_id = ? AND state_version = ?',
      [gate, id, version]) == 1;
  }

  Future<bool> finishLocalAttempt({required String id, required int version,
    required String token, required bool validationBlocked}) async =>
    await _localCas('''UPDATE pending_sales SET remote_phase = ?,
      previous_uncertainty = CASE WHEN ? = 'unknown' THEN 1 ELSE previous_uncertainty END,
      state_version = state_version + 1, claim_token = NULL, claim_owner = NULL,
      claim_expires_at = NULL WHERE local_id = ? AND state_version = ?
      AND claim_token = ? AND remote_phase = 'claimed' ''',
      [validationBlocked ? 'validationBlocked' : 'unknown',
       validationBlocked ? 'validationBlocked' : 'unknown', id, version, token]) == 1;

  Future<int> recoverExpiredLocalClaims(DateTime now) => _localCas('''
    UPDATE pending_sales SET remote_phase = 'unknown', previous_uncertainty = 1,
    reconciliation_reason_code = 'expiredClaimRequiresReconciliation',
    claim_token = NULL, claim_owner = NULL, claim_expires_at = NULL,
    state_version = state_version + 1 WHERE remote_phase = 'claimed'
    AND (claim_expires_at IS NULL OR claim_expires_at <= ?)''', [now.millisecondsSinceEpoch]);

  /// Persists a supplied, bound response; this method performs no remote call.
  /// Legacy acknowledgement is evidence only. P04 finalization remains disabled.
  Future<bool> recordLocalConfirmation({required String id, required int version,
    required String token, required LocalSaleScope scope,
    required Map<String, Object?> response, required DateTime observedAt}) async {
    if (response['success'] != true || response['localSaleId'] != id ||
        response['serverSaleId'] != id || response['alreadyProcessed'] is! bool) {
      await finishLocalAttempt(id: id, version: version, token: token, validationBlocked: false);
      return false;
    }
    final evidence = jsonEncode({'projectId': scope.projectId, 'storeId': scope.storeId,
      'uid': scope.uid, 'target': jsonDecode(scope.targetJson), 'localSaleId': id,
      'serverSaleId': id, 'alreadyProcessed': response['alreadyProcessed'],
      'level': response['alreadyProcessed'] == true ? 'legacyIdentityAcknowledged' : 'legacyAttemptCommitted',
      'attemptToken': token, 'observedAt': observedAt.toUtc().toIso8601String()});
    return await _localCas('''UPDATE pending_sales SET remote_phase = 'remoteConfirmed',
      local_phase = 'refreshPending', remote_evidence_json = ?, remote_confirmed_at = ?,
      state_version = state_version + 1 WHERE local_id = ? AND state_version = ?
      AND claim_token = ? AND remote_phase = 'claimed' AND origin_project_id = ?
      AND store_id = ? AND origin_uid = ? AND origin_target_json = ?''',
      [evidence, observedAt.millisecondsSinceEpoch, id, version, token,
       scope.projectId, scope.storeId, scope.uid, scope.targetJson]) == 1;
  }

  /// P04 is not approved: no public finalization/release primitive yet.
  Future<bool> recordLocalRefresh({required String id, required int version,
    required LocalSaleScope scope, required Set<String> refreshedProductIds,
    required DateTime completedAt}) async {
    final row = await readLocalIntent(id);
    if (row == null || !scope.matches(row) || row['context_gate'] != 'compatible') return false;
    final quantities = _productQuantities(row['products_json']);
    if (quantities == null || !refreshedProductIds.containsAll(quantities.keys)) return false;
    return await _localCas('''UPDATE pending_sales SET refresh_completed_at = ?,
      state_version = state_version + 1 WHERE local_id = ? AND state_version = ?
      AND remote_phase = 'remoteConfirmed' AND local_phase = 'refreshPending'
      AND context_gate = 'compatible' ''', [completedAt.millisecondsSinceEpoch, id, version]) == 1;
  }

  Future<LocalStockReservations> localReservations(LocalSaleScope scope) async {
    final reserved = <String, int>{};
    var uncertain = false;
    for (final row in await readLocalIntents()) {
      // Historical completion never becomes a new sale/reservation.
      if (row['local_phase'] == 'finalized') continue;
      final store = row['store_id'];
      final project = row['origin_project_id'];
      final target = row['origin_target_json'];
      if (store is String && store.trim().isNotEmpty && store != scope.storeId) continue;
      if (project != null && project != scope.projectId) continue;
      if (target != null && target != scope.targetJson) continue;
      final quantities = _productQuantities(row['products_json']);
      if (row['context_gate'] == 'integrityBlocked' || project == null ||
          target == null || store is! String || store.trim().isEmpty || quantities == null) {
        uncertain = true;
        continue;
      }
      for (final entry in quantities.entries) {
        reserved.update(entry.key, (n) => n + entry.value, ifAbsent: () => entry.value);
      }
    }
    return LocalStockReservations(reserved, uncertain: uncertain);
  }
}

enum LocalIntentInsertResult { inserted, existing, conflict }

class LocalSaleScope {
  final String projectId, storeId, uid, targetJson;
  LocalSaleScope({required this.projectId, required this.storeId, required this.uid,
    required String environment, required String firestoreEndpoint,
    required String functionsEndpoint}) : targetJson = jsonEncode({
      'environment': environment, 'firestoreEndpoint': firestoreEndpoint,
      'functionsEndpoint': functionsEndpoint}) {
    if ([projectId, storeId, uid, environment, firestoreEndpoint, functionsEndpoint]
        .any((v) => v.trim().isEmpty)) {
      throw ArgumentError('Incomplete scope.');
    }
  }
  bool matches(Map<String, Object?> row) => row['origin_project_id'] == projectId &&
    row['store_id'] == storeId && row['origin_uid'] == uid && row['origin_target_json'] == targetJson;
}

class LocalSaleIntent {
  final String localId;
  final Map<String, Object?> values;
  static const immutableKeys = ['local_id', 'store_id', 'total_amount', 'products_json',
    'payment_method', 'notes', 'customer_id', 'customer_name', 'created_at',
    'origin_project_id', 'origin_uid', 'origin_target_json', 'origin_evidence_kind',
    'origin_evidence_version', 'prior_online_attempt', 'snapshot_version'];
  /// Only for a future producer that actually captured origin before any network.
  /// This is a local assertion, not server attestation or retrospective evidence.
  LocalSaleIntent.capturedBeforeNetwork({required this.localId, required LocalSaleScope scope,
    required double totalAmount, required String productsJson, required String paymentMethod,
    required DateTime createdAt, String? notes, String? customerId, String? customerName})
    : values = Map.unmodifiable({
      'local_id': localId, 'store_id': scope.storeId, 'total_amount': totalAmount,
      'products_json': productsJson, 'payment_method': paymentMethod, 'notes': notes,
      'customer_id': customerId, 'customer_name': customerName,
      // Matches the existing Drift integer timestamp representation (seconds).
      'created_at': createdAt.millisecondsSinceEpoch ~/ 1000,
      'origin_project_id': scope.projectId, 'origin_uid': scope.uid,
      'origin_target_json': scope.targetJson, 'origin_evidence_kind': 'capturedBeforeNetwork',
      'origin_evidence_version': 1, 'prior_online_attempt': 'provenAbsent',
      'snapshot_version': 1, 'remote_phase': 'pending', 'context_gate': 'compatible',
      'local_phase': 'held', 'state_version': 0, 'previous_uncertainty': 0,
    }) {
      if (localId.trim().isEmpty || !totalAmount.isFinite || totalAmount < 0 ||
          paymentMethod.trim().isEmpty) {
        throw ArgumentError('Invalid immutable sale.');
      }
    }
}

class LocalStockReservations {
  final Map<String, int> quantities;
  final bool uncertain;
  LocalStockReservations(Map<String, int> quantities, {required this.uncertain})
    : quantities = Map.unmodifiable(quantities);
  // A null/loading result is not available; callers must await this result.
  bool get allowsOfflineAvailability => !uncertain;
}

Map<String, int>? _productQuantities(Object? raw) {
  try {
    if (raw is! String) return null;
    final products = jsonDecode(raw);
    if (products is! List || products.isEmpty) return null;
    final quantities = <String, int>{};
    for (final product in products) {
      if (product is! Map) return null;
      final id = product['productId'];
      final quantity = product['quantity'];
      if (id is! String || id.trim().isEmpty || quantity is! int || quantity <= 0 || quantities.containsKey(id)) return null;
      quantities[id] = quantity;
    }
    return quantities;
  } catch (_) { return null; }
}
