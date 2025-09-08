// lib/models/product_model.dart

class Product {
  final String id;
  final String name;
  final double price;
  final String? imageUrl;
  final int quantidade;
  final int minimumStock; // NOVO: Campo para o estoque mínimo

  Product({
    required this.id,
    required this.name,
    required this.price,
    this.imageUrl,
    required this.quantidade,
    required this.minimumStock, // NOVO
  });

  factory Product.fromMap(String id, Map<String, dynamic> data) {
    return Product(
      id: id,
      name: data['name'] ?? 'Produto sem nome',
      price: (data['price'] as num).toDouble(),
      imageUrl: data['imageUrl'],
      quantidade: (data['quantidade'] as num? ?? 0).toInt(),
      // NOVO: Lê o estoque mínimo do Firebase, com 0 como valor padrão
      minimumStock: (data['minimumStock'] as num? ?? 0).toInt(),
    );
  }
}