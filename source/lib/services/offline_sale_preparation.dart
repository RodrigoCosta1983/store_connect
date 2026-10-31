import 'dart:convert';

import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';

/// Local preparation only. Not connected to S01 or any commercial transport.
/// The caller must supply a scope observed from coherent SDKs before any network.
class OfflineSalePreparation {
  final OfflineSalesRepository repository;
  final LocalSaleScope? Function() activeScope;
  final LocalSaleIntent intent;

  OfflineSalePreparation.capture({
    required this.repository,
    required this.activeScope,
    required LocalSaleScope scope,
    required double totalAmount,
    required List<Map<String, dynamic>> products,
    required String paymentMethod,
    required DateTime createdAt,
    String? localId,
    String? notes,
    String? customerId,
    String? customerName,
  }) : intent = LocalSaleIntent.capturedBeforeNetwork(
         localId: localId ?? repository.createLocalSaleId(),
         scope: scope,
         totalAmount: totalAmount,
         productsJson: jsonEncode(products),
         paymentMethod: paymentMethod,
         createdAt: createdAt,
         notes: notes,
         customerId: customerId,
         customerName: customerName,
       );

  /// Repeated preparation retains the original candidate, including on conflict
  /// or disk failure. Completion never authorizes sending, clearing the cart,
  /// confirming a sale, or releasing stock.
  Future<LocalIntentInsertResult> persist() async {
    _requireOriginalContext();
    final result = await repository.persistLocalIntent(intent);
    _requireOriginalContext();
    return result;
  }

  void _requireOriginalContext() {
    final scope = activeScope();
    if (scope == null || !scope.matches(intent.values)) {
      throw StateError('Sale preparation suspended: context changed or absent.');
    }
  }
}
