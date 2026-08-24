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
//   AppDatabase.instance
//        ↓
//   Drift / SQLite
//
// Responsabilidades:
//   - gerar um identificador local estável;
//   - serializar o snapshot dos produtos em JSON;
//   - inserir vendas na fila local;
//   - consultar vendas pendentes/fracassadas;
//   - expor contador reativo para o indicador do PDV;
//   - atualizar estados de sincronização;
//   - calcular reservas locais de estoque;
//   - revalidar estoque no instante do fechamento offline;
//   - gravar a venda somente quando houver saldo local suficiente.
//
// SINGLETON DO BANCO:
//   Este repositório NÃO cria AppDatabase().
//
//   Por padrão usa:
//       AppDatabase.instance
//
//   Ainda aceita injeção de AppDatabase no construtor para testes.
//
// Idempotência:
//   O localId deve nascer uma única vez e permanecer igual em todas as
//   tentativas de envio da mesma venda.
//
// Segurança:
//   Não armazenar tokens, senhas, certificado A1 ou credenciais fiscais.
//
// Estoque local:
//   As vendas pending/syncing/failed funcionam como reservas locais.
//   O repositório soma as quantidades por productId e expõe um stream reativo
//   usado pelo PDV para calcular:
//       estoque efetivo = último estoque Firestore - reservas locais
//
//   Isso evita vender novamente, no mesmo aparelho, unidades já comprometidas
//   por vendas offline ainda não confirmadas.
//
//   A proteção visual do PDV não é a regra final de integridade:
//   validateStockAndSaveSale() revalida o saldo dentro de uma transação SQLite
//   imediatamente antes da inserção. Se faltar saldo, a venda NÃO é criada.
//
//   O backend continua sendo a autoridade definitiva multi-dispositivo.
//
// ============================================================================

import 'dart:convert';
import 'dart:math';

import 'package:drift/drift.dart';

import 'app_database.dart';

class OfflineStockConflict {
  final String productId;
  final String productName;
  final int requestedQuantity;
  final int availableQuantity;

  const OfflineStockConflict({
    required this.productId,
    required this.productName,
    required this.requestedQuantity,
    required this.availableQuantity,
  });
}

class OfflineStockValidationException implements Exception {
  final List<OfflineStockConflict> conflicts;

  const OfflineStockValidationException(this.conflicts);

  String get friendlyMessage {
    if (conflicts.isEmpty) {
      return 'Não foi possível validar o estoque offline.';
    }

    final first = conflicts.first;
    final unitText = first.availableQuantity == 1 ? 'unidade' : 'unidades';

    if (conflicts.length == 1) {
      return 'Estoque insuficiente para ${first.productName}. '
          'Disponível offline: ${first.availableQuantity} $unitText.';
    }

    return 'Estoque insuficiente para ${first.productName} '
        'e mais ${conflicts.length - 1} produto(s). '
        'Disponível offline para ${first.productName}: '
        '${first.availableQuantity} $unitText.';
  }

  @override
  String toString() => friendlyMessage;
}

class OfflineSalesRepository {
  final AppDatabase _database;

  OfflineSalesRepository({AppDatabase? database})
    : _database = database ?? AppDatabase.instance;

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

  /// Segunda camada de segurança do estoque offline.
  ///
  /// [knownStockByProduct] contém o último estoque conhecido do cache Firestore.
  /// A validação e a inserção acontecem na mesma transação SQLite.
  Future<String> validateStockAndSaveSale({
    String? localId,
    required String storeId,
    required double totalAmount,
    required List<Map<String, dynamic>> products,
    required String paymentMethod,
    required Map<String, int> knownStockByProduct,
    String? notes,
    String? customerId,
    String? customerName,
  }) async {
    final resolvedLocalId = localId ?? _generateLocalSaleId();

    return _database.transaction(() async {
      final reservingSales = await _database.getUnsyncedSalesForLocalStock();

      final reservedByProduct = _calculateReservedQuantities(reservingSales);

      final conflicts = <OfflineStockConflict>[];

      for (final product in products) {
        final productId = product['productId']?.toString().trim() ?? '';

        final productNameValue = product['name']?.toString().trim() ?? '';

        final productName = productNameValue.isEmpty
            ? 'Produto'
            : productNameValue;

        final rawRequested = product['quantity'];

        final requested = rawRequested is num
            ? rawRequested.toInt()
            : int.tryParse(rawRequested?.toString() ?? '') ?? 0;

        if (productId.isEmpty || requested <= 0) {
          throw const FormatException('Produto inválido no carrinho offline.');
        }

        if (!knownStockByProduct.containsKey(productId)) {
          conflicts.add(
            OfflineStockConflict(
              productId: productId,
              productName: productName,
              requestedQuantity: requested,
              availableQuantity: 0,
            ),
          );
          continue;
        }

        final knownStock = knownStockByProduct[productId] ?? 0;

        final alreadyReserved = reservedByProduct[productId] ?? 0;

        final available = knownStock - alreadyReserved;

        final safeAvailable = available < 0 ? 0 : available;

        if (requested > safeAvailable) {
          conflicts.add(
            OfflineStockConflict(
              productId: productId,
              productName: productName,
              requestedQuantity: requested,
              availableQuantity: safeAvailable,
            ),
          );
        }
      }

      if (conflicts.isNotEmpty) {
        throw OfflineStockValidationException(
          List<OfflineStockConflict>.unmodifiable(conflicts),
        );
      }

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
    });
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

  Stream<int> watchWaitingSalesCount() {
    return watchWaitingSales().map((sales) => sales.length);
  }

  /// Retorna, em tempo real, quantas unidades de cada produto estão
  /// comprometidas por vendas locais ainda não confirmadas no servidor.
  ///
  /// Exemplo:
  ///   Venda A pending: Produto X = 2
  ///   Venda B failed : Produto X = 1
  ///   Resultado      : {'produto_x': 3}
  Stream<Map<String, int>> watchReservedQuantitiesByProduct() {
    return _database.watchUnsyncedSalesForLocalStock().map(
      (sales) =>
          Map<String, int>.unmodifiable(_calculateReservedQuantities(sales)),
    );
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

  Future<void> markAsFailed({required String localId, required Object error}) {
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
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  Map<String, int> _calculateReservedQuantities(List<PendingSale> sales) {
    final reserved = <String, int>{};

    for (final sale in sales) {
      final products = decodeProducts(sale);

      for (final product in products) {
        final productId = product['productId']?.toString().trim() ?? '';

        final rawQuantity = product['quantity'];

        final quantity = rawQuantity is num
            ? rawQuantity.toInt()
            : int.tryParse(rawQuantity?.toString() ?? '') ?? 0;

        if (productId.isEmpty || quantity <= 0) {
          continue;
        }

        reserved.update(
          productId,
          (current) => current + quantity,
          ifAbsent: () => quantity,
        );
      }
    }

    return reserved;
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
    if (value == null) return null;

    final normalized = value.trim();

    if (normalized.isEmpty) return null;

    return normalized;
  }

  Future<void> closeForTestsOnly() async {
    if (!identical(_database, AppDatabase.instance)) {
      await _database.close();
    }
  }
}
