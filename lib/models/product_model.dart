// lib/models/product_model.dart

class Product {
  final String id;
  final String name;
  final double price;
  final String? imageUrl;
  final int quantidade;

  Product({
    required this.id,
    required this.name,
    required this.price,
    this.imageUrl,
    required this.quantidade,
  });

  factory Product.fromMap(String id, Map<String, dynamic> data) {
    return Product(
      id: id,
      name: data['name'] ?? 'Produto sem nome',
      price: (data['price'] as num).toDouble(),
      imageUrl: data['imageUrl'],
      // MODIFICADO: Agora lê o campo 'quantidade' do Firebase
      quantidade: (data['quantidade'] as num? ?? 0).toInt(),
    );
  }
}