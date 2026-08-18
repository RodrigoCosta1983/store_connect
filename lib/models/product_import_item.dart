// ============================================================================
// ARQUIVO: product_import_item.dart
// ============================================================================
//
// OBJETIVO:
//
// Modelo temporário utilizado durante o processo de importação de produtos.
//
// Este objeto NÃO representa diretamente um documento Firestore.
//
// Ele transporta os dados entre:
//
// Excel / CSV
//      ↓
// Mapeamento
//      ↓
// Validação
//      ↓
// Confirmação
//      ↓
// Serviço de importação
//
// ============================================================================

class ProductImportItem {
  final int sourceRow;

  final String name;

  final double price;

  final double quantity;

  final String category;

  final String barcode;

  final double? costPrice;

  final String ncm;

  const ProductImportItem({
    required this.sourceRow,
    required this.name,
    required this.price,
    required this.quantity,
    required this.category,
    required this.barcode,
    required this.costPrice,
    required this.ncm,
  });

  // ==========================================================================
  // NOME NORMALIZADO
  //
  // Utilizado principalmente para detecção de duplicidade.
  // ==========================================================================

  String get normalizedName =>
      name.trim().toLowerCase();

  // ==========================================================================
  // QUANTIDADE PARA O SCHEMA ATUAL
  //
  // Hoje o Store Connect trabalha com quantidade inteira.
  // ==========================================================================

  int get integerQuantity =>
      quantity.round();
}