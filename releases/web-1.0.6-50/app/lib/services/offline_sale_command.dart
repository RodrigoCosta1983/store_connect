import 'sale_mutation_command.dart';
import '../models/sale_payment_allocation.dart';

/// Constructed before network and stored verbatim alongside the queue row.
Map<String, dynamic> offlineSaleCommand({required String id,
  required Map<String, dynamic> scope, required List<Map<String, dynamic>> products,
  required double totalAmount, required String paymentMethod, required DateTime createdAt,
  String? notes, String? customerId, List<SalePaymentAllocation>? payments}) {
  if ((!instantPaymentMethods.contains(paymentMethod) && paymentMethod != splitPaymentMethod) ||
      products.isEmpty || products.length > 100) {
    throw const FormatException('Operação offline instantânea inválida.');
  }
  final seen = <String>{};
  var total = 0;
  final items = products.map((row) {
    final product = saleId(row['productId']);
    if (!seen.add(product) || row['variantId'] != null) {
      throw const FormatException('Produto offline incompatível.');
    }
    final quantity = saleInteger(row['quantity'], positive: true);
    final price = row['price'];
    if (price is! num || !price.isFinite || price < 0) throw const FormatException('Preço inválido.');
    final cents = (price * 100).round();
    if (cents / 100 != price) throw const FormatException('Preço deve ter centavos exatos.');
    total = saleInteger(total + quantity * cents);
    return {'productId': product, 'quantity': quantity, 'expectedUnitPriceCents': cents};
  }).toList()..sort((a,b) => (a['productId'] as String).compareTo(b['productId'] as String));
  if (!totalAmount.isFinite || (totalAmount * 100).round() != total ||
      (total / 100 - totalAmount).abs() > 0.0000001) {
    throw const FormatException('Total divergente.');
  }
  final split = paymentMethod == splitPaymentMethod
      ? validateSplitPayments(payments ?? const [], total)
      : null;
  if (split == null && payments != null) throw const FormatException('Detalhamento inesperado.');
  return {'schemaVersion': 1, 'requestId': saleId(id), 'saleId': id,
    'scope': {'projectId': saleId(scope['projectId']), 'uid': saleId(scope['uid']), 'storeId': saleId(scope['storeId'])},
    'items': items, 'expectedTotalCents': total, 'paymentMethod': paymentMethod,
    if (split != null) 'payments': split.map((payment) => payment.toJson()).toList(),
    'notes': notes?.trim() ?? '', 'customerId': customerId == null ? null : saleId(customerId),
    'createdAtMs': createdAt.millisecondsSinceEpoch};
}
