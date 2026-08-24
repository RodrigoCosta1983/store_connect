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

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

abstract final class OfflineSaleStatus {
  static const String pending = 'pending';
  static const String syncing = 'syncing';
  static const String synced = 'synced';
  static const String failed = 'failed';
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
  AppDatabase._internal() : super(driftDatabase(name: 'store_connect_local'));

  static final AppDatabase instance = AppDatabase._internal();

  @override
  int get schemaVersion => 1;

  Future<void> insertPendingSale(PendingSalesCompanion sale) async {
    await into(pendingSales).insert(sale, mode: InsertMode.insertOrIgnore);
  }

  Future<PendingSale?> getSaleByLocalId(String localId) {
    return (select(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).getSingleOrNull();
  }

  Future<List<PendingSale>> getSalesWaitingForSync() {
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
    return (select(pendingSales)
          ..where((table) => table.status.equals(OfflineSaleStatus.pending))
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .get();
  }

  Stream<List<PendingSale>> watchSalesWaitingForSync() {
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
    return (select(pendingSales)
          ..where(
            (table) =>
                table.status.equals(OfflineSaleStatus.pending) |
                table.status.equals(OfflineSaleStatus.syncing) |
                table.status.equals(OfflineSaleStatus.failed),
          )
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .watch();
  }

  /// Snapshot das vendas que ainda reservam estoque localmente.
  ///
  /// Usado dentro de uma transação SQLite no instante do fechamento offline.
  Future<List<PendingSale>> getUnsyncedSalesForLocalStock() {
    return (select(pendingSales)
          ..where(
            (table) =>
                table.status.equals(OfflineSaleStatus.pending) |
                table.status.equals(OfflineSaleStatus.syncing) |
                table.status.equals(OfflineSaleStatus.failed),
          )
          ..orderBy([(table) => OrderingTerm.asc(table.createdAt)]))
        .get();
  }

  Future<int> countSalesWaitingForSync() async {
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
    return (delete(
      pendingSales,
    )..where((table) => table.localId.equals(localId))).go();
  }

  String _sanitizeError(String error) {
    final normalized = error.trim();
    if (normalized.length <= 1000) return normalized;
    return normalized.substring(0, 1000);
  }
}
