// lib/models/abc_product_model.dart

class AbcProduct {
  final String productId;
  final String productName;
  int totalQuantity = 0;
  double totalRevenue = 0;
  double percentageOfTotal = 0;
  String classification = ''; // Será 'A', 'B' ou 'C'

  AbcProduct({
    required this.productId,
    required this.productName,
  });
}