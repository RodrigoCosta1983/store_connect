// lib/providers/cart_provider.dart

import 'package:flutter/foundation.dart';
import '../models/product_model.dart';
import '../models/cart_item_model.dart';
import '../models/customer_model.dart'; // 1. IMPORTE O MODELO DO CLIENTE

class CartProvider with ChangeNotifier {
  Map<String, CartItem> _items = {};

  // 2. ADICIONE A VARIÁVEL PARA GUARDAR O CLIENTE
  Customer? _selectedCustomer;

  Map<String, CartItem> get items => {..._items};
  int get itemCount => _items.length;

  double get totalAmount {
    var total = 0.0;
    _items.forEach((key, cartItem) {
      total += cartItem.price * cartItem.quantity;
    });
    return total;
  }

  // 3. ADICIONE O GETTER PARA ACESSAR O CLIENTE
  Customer? get selectedCustomer => _selectedCustomer;




  void addItem(Product product) {
    // Pega a quantidade que já está no carrinho, se houver
    final existingQuantity = _items[product.id]?.quantity ?? 0;

    // VERIFICAÇÃO: Impede adicionar mais do que o estoque permite
    if (existingQuantity >= product.quantidade) {
      // Opcional: você pode mostrar uma SnackBar ou apenas ignorar a ação
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

  void removeItem(String productId) {
    _items.remove(productId);
    notifyListeners();
  }

  // 4. ADICIONE O MÉTODO PARA SELECIONAR UM CLIENTE
  void selectCustomer(Customer? customer) {
    _selectedCustomer = customer;
    notifyListeners();
  }

  void clear() {
    _items = {};
    _selectedCustomer = null; // 5. LIMPA O CLIENTE JUNTO COM OS ITENS
    notifyListeners();
  }
}