// lib/providers/cart_provider.dart

import 'package:flutter/foundation.dart';
import 'package:store_connect/models/product_model.dart'; // Certifique-se que o caminho está correto
import '../models/cart_item_model.dart';
import '../models/customer_model.dart';
import '../services/variant_sale.dart';

class CartProvider with ChangeNotifier {
  Map<String, CartItem> _items = {};
  final Map<String, VariantSaleLine> _variantItems = {};
  List<VariantSaleLine> get variantItems => List.unmodifiable(_variantItems.values);
  bool get hasVariants => _variantItems.isNotEmpty;
  int get simpleItemCount => _items.length;
  Map<String, CartItem> get simpleItems => Map.unmodifiable(_items);
  Customer? _selectedCustomer;
  Object _revision = Object();

  // UI generation only; not a durable sale identity or session authorization.
  Object get revision => _revision;

  @override
  void notifyListeners() {
    _revision = Object();
    super.notifyListeners();
  }

  bool clearIfCurrent(Object revision) {
    if (!identical(_revision, revision)) return false;
    _items = {};
    _variantItems.clear();
    _selectedCustomer = null;
    final clearedRevision = _revision = Object();
    super.notifyListeners();
    // A listener may already have started the next cart synchronously.
    return identical(_revision, clearedRevision);
  }

  Map<String, CartItem> get items {
    if (hasVariants) throw StateError('Itens com variantes exigem o carrinho tipado e o protocolo comercial F10.');
    return {..._items};
  }
  int get itemCount => _items.length + _variantItems.length;
  Customer? get selectedCustomer => _selectedCustomer;

  double get totalAmount {
    var total = _variantItems.values.fold<int>(0, (sum, l) => sum + l.subtotalCents) / 100;
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
  void addVariant(VariantSaleChoice choice) {
    if (_variantItems.isNotEmpty) {
      final first = _variantItems.values.first.choice;
      if (!mapEquals(first.scope, choice.scope) || first.epoch != choice.epoch) {
        throw StateError('Contexto ou admissão alterado. Revise o carrinho.');
      }
    }
    final existing = _variantItems[choice.key];
    if (existing != null && existing.choice.unitPriceCents != choice.unitPriceCents) {
      throw StateError('Preço alterado. Remova a linha e selecione a variante novamente.');
    }
    final quantity = (existing?.quantity ?? 0) + 1;
    if (quantity > choice.availableQuantity) throw StateError('Estoque insuficiente para esta variante.');
    _variantItems[choice.key] = VariantSaleLine(choice, quantity);
    notifyListeners();
  }

  void removeVariant(String key, {bool all = false}) {
    final line = _variantItems[key];
    if (line == null) return;
    if (all || line.quantity == 1) { _variantItems.remove(key); }
    else { _variantItems[key] = VariantSaleLine(line.choice, line.quantity - 1); }
    notifyListeners();
  }

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
    clearIfCurrent(_revision);
  }
}
