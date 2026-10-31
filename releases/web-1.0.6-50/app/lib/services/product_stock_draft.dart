import 'product_mutation_api.dart';
import 'product_mutation_command.dart';

/// Stock intents never serialize the product or its lot metadata.
class ProductStockDraft {
  final ProductEditState baseline;
  Map<String, dynamic>? _change;
  String reason = '';
  ProductStockDraft(this.baseline);
  int get quantity => baseline.product['quantidade'] as int;
  List<Map<String, dynamic>> get lots =>
      (baseline.product['lotes'] as List? ?? []).map(requireObject).toList();
  bool get valid {
    bool integer(dynamic n) => n is int && n >= 0 && n <= 9007199254740991;
    final p = baseline.product;
    if (p['isArchived'] == true ||
        !integer(p['quantidade']) ||
        baseline.unavailable.any(
          (f) => f == 'quantidade' || f.startsWith('lotes'),
        ) ||
        (p.containsKey('lotes') && p['lotes'] is! List)) {
      return false;
    }
    var sum = 0;
    for (var i = 0; i < lots.length; i++) {
      final lot = lots[i];
      if (lot['index'] != i || !integer(lot['quantidade'])) return false;
      try {
        final date = requireObject(lot['validade']);
        final nanos = date['nanoseconds'];
        if (date.length != 2 ||
            nanos is! int ||
            nanos < 0 ||
            nanos >= 1000000000) {
          return false;
        }
        requireProductToken({'seconds': date['seconds'], 'nanoseconds': 0});
      } on FormatException {
        return false;
      }
      sum += lot['quantidade'] as int;
      if (!integer(sum)) return false;
    }
    return lots.isEmpty || sum == quantity;
  }

  Map<String, dynamic>? get change =>
      _change == null ? null : requireObject(canonicalProductJson(_change));
  int? get requestedQuantity {
    final c = _change;
    if (c == null) return null;
    if (c.containsKey('quantity')) return c['quantity'] as int;
    if (c['kind'] == 'convertToLots') {
      return (c['lots'] as List).fold<int>(
        0,
        (n, l) => n + (l['quantidade'] as int),
      );
    }
    final quantities = {
      for (final l in lots) l['index'] as int: l['quantidade'] as int,
    };
    var added = 0;
    for (final op in c['operations'] as List) {
      if (op['op'] == 'add') {
        added += op['quantidade'] as int;
      } else if (op['op'] == 'remove') {
        quantities.remove(op['index']);
      } else if ((op['set'] as Map).containsKey('quantidade')) {
        quantities[op['index'] as int] = op['set']['quantidade'] as int;
      }
    }
    return quantities.values.fold<int>(added, (n, q) => n + q);
  }

  void select(Map<String, dynamic> change, {bool conversionConfirmed = false}) {
    if (!valid) {
      throw const FormatException('Estoque legado inválido ou arquivado.');
    }
    final kind = change['kind'];
    if ((kind == 'convertToLots' || kind == 'convertToManual') &&
        !conversionConfirmed) {
      throw const FormatException('Confirme explicitamente a conversão.');
    }
    if ((kind == 'setManualQuantity' || kind == 'convertToLots') &&
            lots.isNotEmpty ||
        (kind == 'editLots' || kind == 'convertToManual') && lots.isEmpty) {
      throw const FormatException('Operação incompatível com o modo atual.');
    }
    final normalized =
        normalizeProductCommand('adjustProductStockV1', {
              'schemaVersion': 1,
              'requestId': 'draft',
              'productId': baseline.productId,
              'expectedUpdateTime': baseline.expectedUpdateTime,
              'reason': 'validation',
              'stockChange': change,
            })['stockChange']
            as Map<String, dynamic>;
    if (kind == 'editLots') {
      final indices = <int>{for (var i = 0; i < lots.length; i++) i};
      for (final op in normalized['operations'] as List) {
        if (op['op'] == 'add') continue;
        if (!indices.contains(op['index'])) {
          throw const FormatException('Índice fora do baseline.');
        }
      }
      final removed = (normalized['operations'] as List)
          .where((op) => op['op'] == 'remove')
          .length;
      final added = (normalized['operations'] as List)
          .where((op) => op['op'] == 'add')
          .length;
      if (lots.length - removed + added == 0) {
        throw const FormatException('Use conversão para manual.');
      }
    }
    final previous = _change;
    _change = normalized;
    if (requestedQuantity! > 9007199254740991) {
      _change = previous;
      throw const FormatException('Saldo total inválido.');
    }
  }

  void manual(String intent, int value) {
    if (!valid) {
      throw const FormatException('Estoque legado inválido ou arquivado.');
    }
    if (value < 0 || !{'entry', 'exit', 'set'}.contains(intent)) {
      throw const FormatException('Quantidade inválida.');
    }
    final next = intent == 'entry'
        ? quantity + value
        : intent == 'exit'
        ? quantity - value
        : value;
    if (next < 0) throw const FormatException('Estoque insuficiente.');
    select({'kind': 'setManualQuantity', 'quantity': next});
  }
}
