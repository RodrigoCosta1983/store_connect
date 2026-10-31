import 'package:flutter/foundation.dart';
import 'product_cod_service.dart';
import 'variant_preview_state.dart';

// Presentation state only. No scope, baseline, command, writer or persistence.
bool hasVariantProductMetadata(Map<String, dynamic> product) =>
    // Match the existing server C5 structural barrier by own presence, even
    // null/empty. This is an interface refusal, never proof of the stored type.
    ['productId', 'variantId', 'attributes', 'attributeDefinitions']
        .any(product.containsKey) ||
    product['productKind'] == 'variantParent' ||
    (product.containsKey('productKind') &&
        product['productKind'] != 'simple') ||
    (product.containsKey('variantSchemaVersion') &&
        (product['variantSchemaVersion'] != 1 ||
            product['productKind'] != 'simple'));

class ProductVariantFormEntry {
  final int key;
  final Map<String, dynamic> fields;
  final Map<String, dynamic> commercial;
  final Map<String, dynamic> initialStock;
  static dynamic _freeze(dynamic value) => value is Map ?
    Map<String, dynamic>.unmodifiable(value.map((k, v) => MapEntry(k as String, _freeze(v)))) :
    value is List ? List.unmodifiable(value.map(_freeze)) : value;
  ProductVariantFormEntry(this.key, Map<String, dynamic> value,
    {required Map<String, dynamic> commercial, required Map<String, dynamic> initialStock})
    : commercial = _freeze(commercial) as Map<String, dynamic>,
      initialStock = _freeze(initialStock) as Map<String, dynamic>,
      fields = Map.unmodifiable({
        ...value,
        'attributes': List.unmodifiable(
          (value['attributes'] as List).map(
            (p) => Map<String, dynamic>.unmodifiable(p as Map),
          ),
        ),
      });
}

class ProductVariantsFormDraft extends ChangeNotifier {
  final bool existingProduct;
  final bool existingVariantParent;
  final List<Map<String, dynamic>>? existingVariants;
  final List<Map<String, dynamic>> _definitions = [];
  final List<ProductVariantFormEntry> _entries = [];
  int _next = 0;
  bool _enabled;
  String? dataError;
  ProductVariantsFormDraft({
    this.existingProduct = false,
    this.existingVariantParent = false,
    List<Map<String, dynamic>> definitions = const [],
    this.existingVariants,
  }) : _enabled = existingVariantParent {
    try {
      for (final definition in definitions) {
        VariantIdentity('form', definition['attributeId'] as String);
        final options = (definition['values'] as List).map((v) {
          VariantIdentity('form', v['valueId'] as String);
          if (v['label'] is! String || (v['label'] as String).trim().isEmpty) {
            throw const FormatException('Opção inválida.');
          }
          return Map<String, dynamic>.unmodifiable(v as Map);
        }).toList();
        if (definition['label'] is! String ||
            (definition['label'] as String).trim().isEmpty ||
            options.isEmpty ||
            options.length > 100 ||
            options.map((v) => v['valueId']).toSet().length != options.length ||
            _definitions.any(
              (d) => d['attributeId'] == definition['attributeId'],
            )) {
          throw const FormatException('Atributo inválido.');
        }
        _definitions.add(
          Map.unmodifiable({
            ...definition,
            'values': List.unmodifiable(options),
          }),
        );
      }
      if (_definitions.length > 10 ||
          (existingVariantParent && _definitions.isEmpty)) {
        throw const FormatException('Definições de variantes inválidas.');
      }
    } catch (_) {
      _definitions.clear();
      dataError = 'Não foi possível interpretar os atributos deste produto.';
    }
  }
  bool get enabled => _enabled;
  bool get blocksLegacySave => _enabled || existingVariantParent;
  List<Map<String, dynamic>> get definitions => List.unmodifiable(_definitions);
  List<ProductVariantFormEntry> get entries => List.unmodifiable(_entries);
  void setEnabled(bool value) {
    if (existingProduct) {
      throw StateError('A conversão de produtos existentes está indisponível.');
    }
    _enabled = value;
    notifyListeners();
  }

  void addAttribute(String label, String values) {
    if (existingProduct || _entries.isNotEmpty) {
      throw StateError(
        'Os atributos de variantes existentes não podem ser alterados aqui.',
      );
    }
    final options = values.split(',').map((v) => v.trim()).toList();
    if (label.trim().isEmpty || options.any((v) => v.isEmpty)) {
      throw const FormatException(
        'Informe o atributo e suas opções separadas por vírgula.',
      );
    }
    if (_definitions.length >= 10 || options.length > 100) {
      throw const FormatException(
        'Limite local: 10 atributos e 100 opções por atributo.',
      );
    }
    final id = 'attribute-${_definitions.length + 1}';
    _definitions.add(
      Map.unmodifiable({
        'attributeId': id,
        'label': label.trim(),
        'values': List.unmodifiable([
          for (var i = 0; i < options.length; i++)
            Map<String, dynamic>.unmodifiable({
              'valueId': '$id-value-${i + 1}',
              'label': options[i],
            }),
        ]),
      }),
    );
    notifyListeners();
  }

  Map<String, String> selections(Map<String, dynamic> fields) => {
    for (final p in fields['attributes'] as List)
      p['attributeId'] as String: p['valueId'] as String,
  };
  void apply(
    Map<String, String> selected,
    String name,
    String cod, {
    int? editingKey,
    String parentCod = '',
    int? priceCents,
    int? costCents,
    String costReason = '',
    int quantity = 0,
    int? minimumStock,
    List<Map<String, dynamic>> lots = const [],
  }) {
    if (!_enabled || existingProduct || dataError != null) {
      throw StateError('A edição de variantes gravadas está indisponível.');
    }
    if (editingKey != null && !_entries.any((e) => e.key == editingKey)) {
      throw StateError('Rascunho não encontrado.');
    }
    final combination = VariantPreviewData.combinationFor(
      definitions,
      selected,
    );
    final body = <String, dynamic>{
      'attributes': [
        for (final d in definitions)
          {
            'attributeId': d['attributeId'],
            'valueId': selected[d['attributeId']],
          },
      ],
      if (name.isNotEmpty) 'name': name,
      if (cod.isNotEmpty) 'cod': cod,
    };
    VariantPreviewIntent.validateCreationFields(body);
    var lotTotal = 0;
    for (final lot in lots) {
      final n = lot['quantidade'];
      final expiry = lot['validadeMs'];
      if (n is! int || n <= 0 || n > 9007199254740991 || expiry is! int ||
          expiry < -62135596800000 || expiry > 253402300799999) {
        throw const FormatException('Lote inicial deve ter saldo positivo e validade válida.');
      }
      lotTotal += n;
      if (lotTotal > 9007199254740991) throw const FormatException('Soma dos lotes fora do limite seguro.');
    }
    if (quantity < 0 || quantity > 9007199254740991 ||
        (minimumStock != null && (minimumStock < 0 || minimumStock > 9007199254740991)) ||
        (priceCents != null && (priceCents < 0 || priceCents > 9007199254740991)) ||
        (costCents != null && (costCents < 0 || costCents > 9007199254740991 || costReason.trim().isEmpty))) {
      throw const FormatException('Valores comerciais ou justificativa inválidos.');
    }
    for (final entry in _entries.where((e) => e.key != editingKey)) {
      if (VariantPreviewData.combinationFor(
            definitions,
            selections(entry.fields),
          ) ==
          combination) {
        throw const FormatException('Essa combinação já está no rascunho.');
      }
    }
    final normalized = normalizeProductCod(cod);
    if (normalized.isNotEmpty &&
        (normalized == normalizeProductCod(parentCod) ||
            _entries.any(
              (e) =>
                  e.key != editingKey &&
                  normalizeProductCod(e.fields['cod'] as String?) == normalized,
            ))) {
      throw const FormatException(
        'Esse COD já está no produto ou em outra variante do rascunho.',
      );
    }
    if (editingKey == null && _entries.length >= 200) {
      throw const FormatException('Limite local de 200 variantes.');
    }
    final value = ProductVariantFormEntry(editingKey ?? _next++, body,
      commercial: {
        'priceCents': priceCents == null ? {'mode': 'inherit'} : {'mode': 'override', 'value': priceCents},
        'costCents': costCents == null ? {'mode': 'inherit'} : {'mode': 'override', 'value': costCents, 'reason': costReason.trim()},
        'imageUrl': {'mode': 'inherit'}, 'fiscal': {'mode': 'inherit'},
        if (minimumStock != null) 'minimumStock': minimumStock,
      },
      initialStock: lots.isEmpty ? {'kind': 'setManualQuantity', 'quantity': quantity} :
        {'kind': 'convertToLots', 'lots': lots.map((v) => Map<String, dynamic>.from(v)).toList()},
    );
    if (editingKey == null) {
      _entries.add(value);
    } else {
      _entries[_entries.indexWhere((e) => e.key == editingKey)] = value;
    }
    notifyListeners();
  }

  void remove(int key) {
    _entries.removeWhere((e) => e.key == key);
    notifyListeners();
  }
}
