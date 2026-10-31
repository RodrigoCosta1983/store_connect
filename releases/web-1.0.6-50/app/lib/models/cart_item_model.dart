// lib/models/cart_item_model.dart
import 'dart:convert';

class CartItem {
  final String productId; // MODIFICADO: ID do produto no banco
  // Historical F10 identity only. Simple sale commands retain their old shape.
  final String? variantId;
  final String name;
  final int quantity;
  final double price;
  final Map<String, dynamic> _history;
  Map<String, dynamic> get historicalSnapshot => Map.unmodifiable(_copy(_history) as Map<String, dynamic>);
  List<Map<String, dynamic>> get attributes => ((_history['attributes'] as List?) ?? [])
    .map((v) => Map<String, dynamic>.unmodifiable(v as Map)).toList(growable: false);
  String? get cod => _history['cod'] as String?;
  String get receiptDescription {
    if (variantId == null) return name;
    final labels = attributes.map((a) => '${a['attributeLabel'] ?? a['attributeId']}: ${a['valueLabel'] ?? a['valueId']}').toList();
    return [name, if (labels.isNotEmpty && labels.any((label) => !name.contains(label))) labels.join(' · '),
      if (cod != null && cod!.isNotEmpty) 'COD: $cod'].join('\n');
  }
  int? get knownCostCents {
    if (_history['costCents'] is int) return _history['costCents'] as int;
    final cost = _history['commercialSnapshot'] is Map ? _history['commercialSnapshot']['costCents'] : null;
    return cost is Map && cost['state'] == 'value' && cost['value'] is int ? cost['value'] as int : null;
  }
  static dynamic _copy(dynamic v) => jsonDecode(jsonEncode(v));

  CartItem({
    required this.productId, // MODIFICADO
    this.variantId,
    required this.name,
    required this.quantity,
    required this.price,
    Map<String, dynamic> historicalSnapshot = const {},
  }) : _history = Map.unmodifiable(_copy(historicalSnapshot) as Map<String, dynamic>);

  factory CartItem.fromMap(Map<String, dynamic> map) {
    return CartItem(
      productId: map['productId'] ?? '', // MODIFICADO
      variantId: map['variantId'] as String?,
      name: map['name'] ?? 'Produto sem nome',
      quantity: (map['quantity'] as num).toInt(),
      price: (map['price'] as num).toDouble(),
      historicalSnapshot: {for (final key in ['schemaVersion', 'parentName', 'variantName', 'attributes', 'cod', 'parentCod',
        'unitPriceCents', 'subtotalCents', 'costCents', 'commercialSnapshot', 'fiscalSnapshotV1'])
        if (map.containsKey(key)) key: map[key]},
    );
  }

  Map<String, dynamic> toMap() {
    return {
      ...(_copy(_history) as Map<String, dynamic>),
      'productId': productId, // MODIFICADO
      if (variantId != null) 'variantId': variantId,
      'name': name,
      'quantity': quantity,
      'price': price,
    };
  }
}
