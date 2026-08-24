// ============================================================================
// STORE CONNECT - BANCO DE DADOS LOCAL / INFRAESTRUTURA OFFLINE
// ============================================================================
//
// Arquivo:
//   lib/data/local/app_database.dart
//
// Objetivo:
//   Fornecer o banco de dados local do Store Connect utilizando Drift +
//   SQLite. Este banco será a base da arquitetura offline-first do aplicativo.
//
// Nesta primeira versão, o banco armazena vendas que ainda precisam ser
// sincronizadas com o backend.
//
// Fluxo planejado:
//
//   Venda concluída no dispositivo
//          ↓
//   pending_sales (SQLite local)
//          ↓
//   SyncService
//          ↓
//   Firebase / Cloud Functions
//          ↓
//   Firestore
//          ↓
//   NFC-e / Focus NFe quando aplicável
//
// Responsabilidades deste arquivo:
//   - definir a tabela local de vendas pendentes;
//   - persistir uma venda antes da sincronização;
//   - recuperar vendas aguardando envio;
//   - controlar tentativas de sincronização;
//   - registrar erros de sincronização;
//   - marcar vendas como sincronizadas;
//   - fornecer Streams para futuras interfaces de status offline.
//
// IMPORTANTE SOBRE SEGURANÇA E CONSISTÊNCIA:
//
//   1. O campo localId é a identidade permanente da venda offline.
//      Ele deverá acompanhar a venda até o servidor e será utilizado
//      futuramente como chave de idempotência.
//
//   2. Nunca criar um novo localId ao repetir uma sincronização.
//      A mesma venda deve reutilizar sempre o mesmo identificador.
//
//   3. O banco local NÃO substitui o Firestore.
//      Ele funciona como fila persistente para garantir que uma venda
//      não seja perdida durante períodos sem conexão.
//
//   4. Não remover vendas sincronizadas imediatamente.
//      Manteremos o registro local inicialmente para auditoria e diagnóstico.
//      Uma política de limpeza poderá ser adicionada futuramente.
//
//   5. productsJson guarda um snapshot dos itens vendidos.
//      Isto é intencional: uma venda histórica não deve depender dos dados
//      atuais do cadastro do produto.
//
//   6. Quantidades de produtos continuam sendo inteiras.
//      Não alterar esse comportamento sem revisão de toda a lógica de estoque.
//
//   7. Dados fiscais sensíveis, certificados e senhas NÃO devem ser gravados
//      neste banco.
//
// STATUS DE SINCRONIZAÇÃO:
//
//   pending  -> aguardando sincronização
//   syncing  -> tentativa em andamento
//   synced   -> confirmada pelo servidor
//   failed   -> última tentativa falhou
//
// FUTURAS EVOLUÇÕES:
//
//   - tabela de movimentações locais de estoque;
//   - sincronização automática ao recuperar conexão;
//   - reconciliação de conflitos;
//   - controle de dispositivo;
//   - fila para outros tipos de operação offline;
//   - limpeza periódica de registros antigos sincronizados.
//
// ============================================================================

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'app_database.g.dart';

// ============================================================================
// STATUS DA FILA OFFLINE
// ============================================================================

abstract final class OfflineSaleStatus {
  static const String pending = 'pending';
  static const String syncing = 'syncing';
  static const String synced = 'synced';
  static const String failed = 'failed';
}

// ============================================================================
// TABELA: PENDING SALES
// ============================================================================
//
// Apesar do nome "PendingSales", ela também manterá temporariamente registros
// já sincronizados.
//
// Isso facilita:
//
//   - auditoria;
//   - diagnóstico;
//   - prevenção de duplicidade;
//   - futuras políticas de limpeza.
//
// ============================================================================

class PendingSales extends Table {
  // --------------------------------------------------------------------------
  // IDENTIFICAÇÃO LOCAL
  // --------------------------------------------------------------------------

  TextColumn get localId => text()();

  // Loja responsável pela venda.
  TextColumn get storeId => text()();

  // --------------------------------------------------------------------------
  // DADOS FINANCEIROS
  // --------------------------------------------------------------------------

  RealColumn get totalAmount => real()();

  // --------------------------------------------------------------------------
  // ITENS
  // --------------------------------------------------------------------------
  //
  // JSON contendo snapshot dos produtos:
  //
  // [
  //   {
  //     "productId": "...",
  //     "name": "...",
  //     "price": 10.0,
  //     "quantity": 2
  //   }
  // ]
  //
  // --------------------------------------------------------------------------

  TextColumn get productsJson => text()();

  // --------------------------------------------------------------------------
  // PAGAMENTO E OBSERVAÇÕES
  // --------------------------------------------------------------------------

  TextColumn get paymentMethod => text()();

  TextColumn get notes => text().nullable()();

  // --------------------------------------------------------------------------
  // CLIENTE
  // --------------------------------------------------------------------------

  TextColumn get customerId => text().nullable()();

  TextColumn get customerName => text().nullable()();

  // --------------------------------------------------------------------------
  // DATAS
  // --------------------------------------------------------------------------

  DateTimeColumn get createdAt => dateTime()();

  DateTimeColumn get syncedAt => dateTime().nullable()();

  // --------------------------------------------------------------------------
  // CONTROLE DE SINCRONIZAÇÃO
  // --------------------------------------------------------------------------

  TextColumn get status =>
      text().withDefault(const Constant(OfflineSaleStatus.pending))();

  IntColumn get syncAttempts => integer().withDefault(const Constant(0))();

  TextColumn get lastSyncError => text().nullable()();

  // ID definitivo da venda no Firestore.
  //
  // Futuramente poderemos utilizar o próprio localId como ID do documento,
  // mas mantemos este campo separado para permitir evolução do backend.
  TextColumn get serverSaleId => text().nullable()();

  // --------------------------------------------------------------------------
  // PRIMARY KEY
  // --------------------------------------------------------------------------

  @override
  Set<Column<Object>> get primaryKey => {localId};
}

// ============================================================================
// BANCO
// ============================================================================

@DriftDatabase(
  tables: [
    PendingSales,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(driftDatabase(name: 'store_connect_local'));

  // --------------------------------------------------------------------------
  // SCHEMA VERSION
  // --------------------------------------------------------------------------
  //
  // Sempre aumentar quando houver mudança estrutural nas tabelas.
  //
  // Futuramente adicionaremos MigrationStrategy quando chegarmos à versão 2.
  //
  // --------------------------------------------------------------------------

  @override
  int get schemaVersion => 1;

  // ==========================================================================
  // CRIAR VENDA PENDENTE
  // ==========================================================================

  Future<void> insertPendingSale(PendingSalesCompanion sale) async {
    await into(pendingSales).insert(
      sale,
      mode: InsertMode.insertOrAbort,
    );
  }

  // ==========================================================================
  // BUSCAR UMA VENDA PELO LOCAL ID
  // ==========================================================================

  Future<PendingSale?> getSaleByLocalId(String localId) {
    return (select(pendingSales)
      ..where((table) => table.localId.equals(localId)))
        .getSingleOrNull();
  }

  // ==========================================================================
  // LISTAR VENDAS QUE PRECISAM SER SINCRONIZADAS
  // ==========================================================================
  //
  // Incluímos:
  //   pending
  //   failed
  //
  // Uma venda "syncing" não entra imediatamente na próxima tentativa.
  //
  // Futuramente teremos recuperação automática de registros que ficaram
  // presos em "syncing" após fechamento inesperado do aplicativo.
  //
  // ==========================================================================

  Future<List<PendingSale>> getSalesWaitingForSync() {
    return (select(pendingSales)
      ..where(
            (table) =>
        table.status.equals(OfflineSaleStatus.pending) |
        table.status.equals(OfflineSaleStatus.failed),
      )
      ..orderBy([
            (table) => OrderingTerm.asc(table.createdAt),
      ]))
        .get();
  }

  // ==========================================================================
  // LISTAR SOMENTE PENDENTES
  // ==========================================================================

  Future<List<PendingSale>> getPendingSales() {
    return (select(pendingSales)
      ..where(
            (table) => table.status.equals(OfflineSaleStatus.pending),
      )
      ..orderBy([
            (table) => OrderingTerm.asc(table.createdAt),
      ]))
        .get();
  }

  // ==========================================================================
  // STREAM DE VENDAS AGUARDANDO SINCRONIZAÇÃO
  // ==========================================================================
  //
  // Futuramente poderá alimentar um indicador como:
  //
  //   "2 vendas aguardando sincronização"
  //
  // ==========================================================================

  Stream<List<PendingSale>> watchSalesWaitingForSync() {
    return (select(pendingSales)
      ..where(
            (table) =>
        table.status.equals(OfflineSaleStatus.pending) |
        table.status.equals(OfflineSaleStatus.failed),
      )
      ..orderBy([
            (table) => OrderingTerm.asc(table.createdAt),
      ]))
        .watch();
  }

  // ==========================================================================
  // CONTAR VENDAS AGUARDANDO SINCRONIZAÇÃO
  // ==========================================================================

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

  // ==========================================================================
  // MARCAR COMO "SINCRONIZANDO"
  // ==========================================================================

  Future<void> markSaleAsSyncing(String localId) async {
    await (update(pendingSales)
      ..where((table) => table.localId.equals(localId)))
        .write(
      PendingSalesCompanion(
        status: const Value(OfflineSaleStatus.syncing),
        syncAttempts: Value.absent(),
        lastSyncError: const Value(null),
      ),
    );

    // Incrementamos separadamente para manter atomicidade no SQLite.
    await customUpdate(
      '''
      UPDATE pending_sales
      SET sync_attempts = sync_attempts + 1
      WHERE local_id = ?
      ''',
      variables: [
        Variable<String>(localId),
      ],
      updates: {
        pendingSales,
      },
    );
  }

  // ==========================================================================
  // MARCAR COMO SINCRONIZADA
  // ==========================================================================

  Future<void> markSaleAsSynced({
    required String localId,
    required String serverSaleId,
  }) async {
    await (update(pendingSales)
      ..where((table) => table.localId.equals(localId)))
        .write(
      PendingSalesCompanion(
        status: const Value(OfflineSaleStatus.synced),
        serverSaleId: Value(serverSaleId),
        syncedAt: Value(DateTime.now()),
        lastSyncError: const Value(null),
      ),
    );
  }

  // ==========================================================================
  // REGISTRAR FALHA DE SINCRONIZAÇÃO
  // ==========================================================================

  Future<void> markSaleAsFailed({
    required String localId,
    required String error,
  }) async {
    final safeError = _sanitizeError(error);

    await (update(pendingSales)
      ..where((table) => table.localId.equals(localId)))
        .write(
      PendingSalesCompanion(
        status: const Value(OfflineSaleStatus.failed),
        lastSyncError: Value(safeError),
      ),
    );
  }

  // ==========================================================================
  // DEVOLVER PARA FILA
  // ==========================================================================
  //
  // Utilizado quando quisermos permitir nova tentativa manual.
  //
  // ==========================================================================

  Future<void> resetSaleForRetry(String localId) async {
    await (update(pendingSales)
      ..where((table) => table.localId.equals(localId)))
        .write(
      const PendingSalesCompanion(
        status: Value(OfflineSaleStatus.pending),
        lastSyncError: Value(null),
      ),
    );
  }

  // ==========================================================================
  // RECUPERAR VENDAS PRESAS EM "SYNCING"
  // ==========================================================================
  //
  // Se o aplicativo fechar durante uma sincronização, uma venda pode ficar
  // marcada como "syncing".
  //
  // Ao iniciar o SyncService futuramente, este método poderá devolver essas
  // vendas para a fila.
  //
  // ==========================================================================

  Future<int> recoverInterruptedSyncs() {
    return (update(pendingSales)
      ..where(
            (table) => table.status.equals(OfflineSaleStatus.syncing),
      ))
        .write(
      const PendingSalesCompanion(
        status: Value(OfflineSaleStatus.pending),
        lastSyncError: Value(
          'Sincronização interrompida antes da confirmação do servidor.',
        ),
      ),
    );
  }

  // ==========================================================================
  // CONSULTAR HISTÓRICO LOCAL
  // ==========================================================================

  Future<List<PendingSale>> getAllLocalSales() {
    return (select(pendingSales)
      ..orderBy([
            (table) => OrderingTerm.desc(table.createdAt),
      ]))
        .get();
  }

  // ==========================================================================
  // REMOVER VENDA LOCAL
  // ==========================================================================
  //
  // NÃO utilizaremos isto automaticamente agora.
  //
  // Existe principalmente para futuras ferramentas administrativas e testes.
  //
  // ==========================================================================

  Future<int> deleteLocalSale(String localId) {
    return (delete(pendingSales)
      ..where((table) => table.localId.equals(localId)))
        .go();
  }

  // ==========================================================================
  // PROTEÇÃO DE LOG LOCAL
  // ==========================================================================

  String _sanitizeError(String error) {
    final normalized = error.trim();

    if (normalized.isEmpty) {
      return 'Erro de sincronização não identificado.';
    }

    // Evita que mensagens gigantes sejam armazenadas no SQLite.
    if (normalized.length > 1000) {
      return normalized.substring(0, 1000);
    }

    return normalized;
  }
}