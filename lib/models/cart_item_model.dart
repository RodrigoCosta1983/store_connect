// lib/models/cart_item_model.dart

class CartItem {
  final String productId; // MODIFICADO: ID do produto no banco
  final String name;
  final int quantity;
  final double price;

  CartItem({
    required this.productId, // MODIFICADO
    required this.name,
    required this.quantity,
    required this.price,
  });

  factory CartItem.fromMap(Map<String, dynamic> map) {
    return CartItem(
      productId: map['productId'] ?? '', // MODIFICADO
      name: map['name'] ?? 'Produto sem nome',
      quantity: (map['quantity'] as num).toInt(),
      price: (map['price'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'productId': productId, // MODIFICADO
      'name': name,
      'quantity': quantity,
      'price': price,
    };
  }
}