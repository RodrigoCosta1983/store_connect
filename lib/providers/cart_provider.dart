// lib/providers/cart_provider.dart

import 'package:flutter/foundation.dart';
import 'package:store_connect/models/product_model.dart'; // Certifique-se que o caminho está correto
import '../models/cart_item_model.dart';
import '../models/customer_model.dart';

class CartProvider with ChangeNotifier {
  Map<String, CartItem> _items = {};
  Customer? _selectedCustomer;

  Map<String, CartItem> get items => {..._items};
  int get itemCount => _items.length;
  Customer? get selectedCustomer => _selectedCustomer;

  double get totalAmount {
    var total = 0.0;
    _items.forEach((key, cartItem) {
      total += cartItem.price * cartItem.quantity;
    });
    return total;
  }

  void addItem(Product product) {
    final existingQuantity = _items[product.id]?.quantity ?? 0;
    if (existingQuantity >= product.quantidade) {
      print('Não é possível adicionar mais. Estoque máximo atingido no carrinho.');
      return;
    }

    if (_items.containsKey(product.id)) {
      _items.update(
        product.id,
            (existing) => CartItem(
          productId: existing.productId,
          name: existing.name,
          price: existing.price,
          quantity: existing.quantity + 1,
        ),
      );
    } else {
      _items.putIfAbsent(
        product.id,
            () => CartItem(
          productId: product.id,
          name: product.name,
          price: product.price,
          quantity: 1,
        ),
      );
    }
    notifyListeners();
  }

  // --- NOVO MÉTODO PARA O BOTÃO '-' ---
  void removeSingleItem(String productId) {
    if (!_items.containsKey(productId)) {
      return;
    }
    if (_items[productId]!.quantity > 1) {
      _items.update(
        productId,
            (existing) => CartItem(
          productId: existing.productId,
          name: existing.name,
          price: existing.price,
          quantity: existing.quantity - 1,
        ),
      );
    } else {
      _items.remove(productId);
    }
    notifyListeners();
  }


  void removeItem(String productId) {
    _items.remove(productId);
    notifyListeners();
  }

  void selectCustomer(Customer? customer) {
    _selectedCustomer = customer;
    notifyListeners();
  }

  void clear() {
    _items = {};
    _selectedCustomer = null;
    notifyListeners();
  }
}