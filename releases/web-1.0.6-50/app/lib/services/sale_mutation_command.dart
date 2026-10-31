import 'dart:convert';
import '../models/sale_payment_allocation.dart';
import 'dart:math';
import 'package:crypto/crypto.dart';

Map<String, dynamic> saleObject(dynamic value) {
  if (value is! Map || value.keys.any((k) => k is! String)) {
    throw const FormatException('Objeto de venda inválido.');
  }
  return Map<String, dynamic>.from(value);
}

void saleKeys(
  Map<String, dynamic> value,
  Set<String> allowed, [
  Set<String>? required,
]) {
  if (value.keys.toSet().difference(allowed).isNotEmpty ||
      (required ?? allowed).difference(value.keys.toSet()).isNotEmpty) {
    throw const FormatException('Campos de venda inválidos.');
  }
}

String saleId(dynamic value) {
  // ECMAScript trim whitespace, matching B07-B (Dart trim also removes U+0085).
  final boundaryWhitespace = RegExp(
    r'^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$',
  );
  if (value is! String ||
      value.isEmpty ||
      boundaryWhitespace.hasMatch(value) ||
      value.contains('/') ||
      value == '.' ||
      value == '..' ||
      RegExp(r'^__.*__$').hasMatch(value) ||
      utf8.encode(value).length > 1500 ||
      value.runes.any((r) => r < 32 || (r >= 0xd800 && r <= 0xdfff))) {
    throw const FormatException('Identidade de venda inválida.');
  }
  return value;
}

int saleInteger(dynamic value, {bool positive = false}) {
  if (value is! num ||
      !value.isFinite ||
      value.isNegative ||
      value < (positive ? 1 : 0) ||
      value > 9007199254740991 ||
      value != value.truncateToDouble()) {
    throw const FormatException('Inteiro seguro obrigatório.');
  }
  return value.toInt();
}

dynamic _canonical(dynamic v) {
  if (v == null || v is String || v is bool || v is int) return v;
  if (v is num) return saleInteger(v);
  if (v is List) return v.map(_canonical).toList();
  final map = saleObject(v);
  final keys = map.keys.toList()..sort();
  return {for (final key in keys) key: _canonical(map[key])};
}

// Local integrity only. Never used as an assertion about the server receipt hash.
String saleJson(dynamic value) => jsonEncode(_canonical(value));
String saleHash(dynamic value) =>
    sha256.convert(utf8.encode(saleJson(value))).toString();

class SaleMutationScope {
  final String projectId;
  final String uid;
  final String storeId;
  const SaleMutationScope({
    required this.projectId,
    required this.uid,
    required this.storeId,
  });
  factory SaleMutationScope.fromJson(dynamic raw) {
    final v = saleObject(raw);
    saleKeys(v, {'projectId', 'uid', 'storeId'});
    return SaleMutationScope(
      projectId: saleId(v['projectId']),
      uid: saleId(v['uid']),
      storeId: saleId(v['storeId']),
    );
  }
  Map<String, dynamic> toJson() => {
    'projectId': saleId(projectId),
    'uid': saleId(uid),
    'storeId': saleId(storeId),
  };
  String get prefix => '${base64Url.encode(utf8.encode(saleJson(toJson())))}:';
}

class SaleMutationCommand {
  final String _encoded;
  SaleMutationCommand._(this._encoded);
  factory SaleMutationCommand.fromJson(Map<String, dynamic> raw) {
    const required = {
      'schemaVersion',
      'requestId',
      'saleId',
      'scope',
      'origin',
      'saleKind',
      'items',
      'expectedTotalCents',
      'paymentMethod',
    };
    saleKeys(raw, {...required, 'notes', 'customerId', 'payments'}, required);
    final id = saleId(raw['requestId']);
    final scope = SaleMutationScope.fromJson(raw['scope']);
    if (raw['schemaVersion'] != 2 ||
        saleId(raw['saleId']) != id ||
        raw['origin'] != 'online' ||
        raw['saleKind'] != 'instant' ||
        !{
          'Dinheiro',
          'PIX',
          'Cartão de crédito',
          'Cartão de débito',
          splitPaymentMethod,
        }.contains(raw['paymentMethod']) ||
        raw['items'] is! List ||
        (raw['items'] as List).isEmpty ||
        (raw['notes'] != null && raw['notes'] is! String)) {
      throw const FormatException('Comando instantâneo inválido.');
    }
    final seen = <String>{};
    var total = 0;
    final items =
        (raw['items'] as List).map((rawItem) {
          final item = saleObject(rawItem);
          saleKeys(item, {'productId', 'quantity', 'expectedUnitPriceCents'});
          final product = saleId(item['productId']);
          if (!seen.add(product)) {
            throw const FormatException('Produto duplicado.');
          }
          final quantity = saleInteger(item['quantity'], positive: true);
          final price = saleInteger(item['expectedUnitPriceCents']);
          // Division guards multiplication on both Dart VM and JavaScript runtimes.
          if (price != 0 && quantity > 9007199254740991 ~/ price) {
            throw const FormatException('Subtotal excede inteiro seguro.');
          }
          final subtotal = quantity * price;
          if (total > 9007199254740991 - subtotal) {
            throw const FormatException('Total excede inteiro seguro.');
          }
          total += subtotal;
          return {
            'productId': product,
            'quantity': quantity,
            'expectedUnitPriceCents': price,
          };
        }).toList()..sort(
          (a, b) =>
              (a['productId'] as String).compareTo(b['productId'] as String),
        );
    if (saleInteger(raw['expectedTotalCents']) != total) {
      throw const FormatException('Total divergente.');
    }
    final payments = raw['paymentMethod'] == splitPaymentMethod
      ? validateSplitPayments((raw['payments'] as List? ?? []).map((payment) =>
          SalePaymentAllocation.fromJson(saleObject(payment))).toList(), total)
      : null;
    if (payments == null && raw.containsKey('payments')) throw const FormatException('Detalhamento inesperado.');
    return SaleMutationCommand._(
      saleJson({
        'schemaVersion': 2,
        'requestId': id,
        'saleId': id,
        'scope': scope.toJson(),
        'origin': 'online',
        'saleKind': 'instant',
        'items': items,
        'expectedTotalCents': total,
        'paymentMethod': raw['paymentMethod'],
        if (payments != null) 'payments': payments.map((payment) => payment.toJson()).toList(),
        'notes': raw['notes'],
        'customerId': raw['customerId'] == null
            ? null
            : saleId(raw['customerId']),
      }),
    );
  }
  static String newIdentity() {
    final random = Random.secure();
    return List.generate(
      24,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  Map<String, dynamic> get payload => saleObject(jsonDecode(_encoded));
  String get requestId => payload['requestId'] as String;
  SaleMutationScope get scope => SaleMutationScope.fromJson(payload['scope']);
  String get integrityHash => saleHash(payload);
}
