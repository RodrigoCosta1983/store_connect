// ============================================================================
// STORE CONNECT - REPOSITÓRIO LOCAL DE VENDAS OFFLINE
// ============================================================================
//
// Arquivo:
//   lib/data/local/offline_sales_repository.dart
//
// Objetivo:
//   Centralizar o acesso às vendas armazenadas localmente no SQLite/Drift.
//
// Fluxo:
//   UI / fluxo de venda
//        ↓
//   OfflineSalesRepository
//        ↓
//   AppDatabase (Drift / SQLite)
//
// Responsabilidades desta camada:
//   - gerar um identificador local estável para cada venda;
//   - serializar os produtos da venda em JSON;
//   - inserir vendas na fila local;
//   - consultar vendas pendentes/fracassadas;
//   - expor um contador em tempo real para o indicador do PDV;
//   - atualizar estados de sincronização;
//   - preparar a integração futura com o SyncService.
//
// IMPORTANTE:
//   - este arquivo NÃO envia vendas ao Firebase;
//   - o localId nunca deve mudar durante retries;
//   - não armazenar tokens, senhas, certificado A1 ou credenciais fiscais aqui;
//   - o banco SQLite local não deve ser tratado como fonte definitiva do estoque
//     multi-dispositivo; a reconciliação será feita no backend durante o sync.
//
// Estados esperados:
//   pending  -> aguardando sincronização
//   syncing  -> tentativa em andamento
//   synced   -> sincronizada com sucesso
//   failed   -> falhou e poderá ser tentada novamente
//
// ============================================================================

import 'dart:convert';
import 'dart:math';

import 'package:drift/drift.dart';

import 'app_database.dart';

class OfflineSalesRepository {
  // Única instância compartilhada do banco para todos os repositórios.
  // Evita que NewSaleScreen e PaymentOptionsSheet abram executores Drift
  // separados apontando para o mesmo arquivo SQLite.
  static final AppDatabase _sharedDatabase = AppDatabase();

  final AppDatabase _database;

  OfflineSalesRepository({
    AppDatabase? database,
  }) : _database = database ?? _sharedDatabase;

  /// Gera um ID estável para uma nova venda antes de qualquer tentativa de sync.
  ///
  /// O mesmo ID pode ser usado como documentId no Firestore. Isso é essencial
  /// para idempotência: se a resposta da rede se perder após o commit, uma
  /// tentativa posterior pode reutilizar a mesma chave sem duplicar a venda.
  String createLocalSaleId() => _generateLocalSaleId();

  Future<String> saveSale({
    String? localId,
    required String storeId,
    required double totalAmount,
    required List<Map<String, dynamic>> products,
    required String paymentMethod,
    String? notes,
    String? customerId,
    String? customerName,
  }) async {
    final resolvedLocalId = localId ?? _generateLocalSaleId();
    final productsJson = jsonEncode(products);

    final sale = PendingSalesCompanion.insert(
      localId: resolvedLocalId,
      storeId: storeId,
      totalAmount: totalAmount,
      productsJson: productsJson,
      paymentMethod: paymentMethod,
      notes: Value(_normalizeNullableText(notes)),
      customerId: Value(_normalizeNullableText(customerId)),
      customerName: Value(_normalizeNullableText(customerName)),
      createdAt: DateTime.now(),
    );

    await _database.insertPendingSale(sale);

    return resolvedLocalId;
  }

  Future<PendingSale?> getSale(String localId) {
    return _database.getSaleByLocalId(localId);
  }

  Future<List<PendingSale>> getWaitingSales() {
    return _database.getSalesWaitingForSync();
  }

  Future<int> countWaitingSales() {
    return _database.countSalesWaitingForSync();
  }

  Stream<List<PendingSale>> watchWaitingSales() {
    return _database.watchSalesWaitingForSync();
  }

  // --------------------------------------------------------------------------
  // CONTADOR REATIVO PARA A INTERFACE
  // --------------------------------------------------------------------------
  // Evita que telas precisem conhecer o tipo PendingSale gerado pelo Drift.
  // Sempre que a fila pending/failed mudar, o indicador do PDV é atualizado.
  // --------------------------------------------------------------------------

  Stream<int> watchWaitingSalesCount() {
    return watchWaitingSales().map((sales) => sales.length);
  }

  Future<void> markAsSyncing(String localId) {
    return _database.markSaleAsSyncing(localId);
  }

  Future<void> markAsSynced({
    required String localId,
    required String serverSaleId,
  }) {
    return _database.markSaleAsSynced(
      localId: localId,
      serverSaleId: serverSaleId,
    );
  }

  Future<void> markAsFailed({
    required String localId,
    required Object error,
  }) {
    return _database.markSaleAsFailed(
      localId: localId,
      error: error.toString(),
    );
  }

  Future<void> retry(String localId) {
    return _database.resetSaleForRetry(localId);
  }

  Future<int> recoverInterruptedSyncs() {
    return _database.recoverInterruptedSyncs();
  }

  Future<List<PendingSale>> getLocalHistory() {
    return _database.getAllLocalSales();
  }

  List<Map<String, dynamic>> decodeProducts(PendingSale sale) {
    final decoded = jsonDecode(sale.productsJson);

    if (decoded is! List) {
      throw const FormatException(
        'Formato inválido dos produtos armazenados localmente.',
      );
    }

    return decoded
        .map(
          (item) => Map<String, dynamic>.from(item as Map),
        )
        .toList();
  }

  String _generateLocalSaleId() {
    final timestamp = DateTime.now().microsecondsSinceEpoch;
    final random = Random.secure();

    final randomPart = List.generate(
      8,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();

    return 'offline_${timestamp}_$randomPart';
  }

  String? _normalizeNullableText(String? value) {
    if (value == null) {
      return null;
    }

    final normalized = value.trim();

    if (normalized.isEmpty) {
      return null;
    }

    return normalized;
  }

  Future<void> close() {
    return _database.close();
  }
}
