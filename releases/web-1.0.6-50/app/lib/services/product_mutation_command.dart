import 'dart:convert';
import 'package:crypto/crypto.dart';

const productMutationOperations = {'updateProductV2', 'adjustProductStockV1'};

Map<String, dynamic> requireObject(dynamic value) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw const FormatException('Objeto JSON inválido.');
  }
  return Map<String, dynamic>.from(value);
}

Map<String, dynamic> requireProductToken(dynamic value) {
  final token = requireObject(value);
  final seconds = token['seconds'];
  final nanos = token['nanoseconds'];
  final parsed = seconds is String ? int.tryParse(seconds) : null;
  if (token.length != 2 ||
      parsed == null ||
      parsed.toString() != seconds ||
      parsed < -62135596800 ||
      parsed > 253402300799 ||
      nanos is! int ||
      nanos < 0 ||
      nanos >= 1000000000 ||
      nanos % 1000 != 0) {
    throw const FormatException('Token autoritativo inválido.');
  }
  return {'seconds': seconds, 'nanoseconds': nanos};
}

// This canonical encoding is the LOCAL ledger integrity protocol, not the
// Admin receipt hash. Recovery sends the full command; the server independently
// normalizes/hashes it using the existing writer contract.
dynamic canonicalProductJson(dynamic value) {
  if (value == null || value is String || value is bool) return value;
  if (value is num) {
    if (!value.isFinite) throw const FormatException('Número não finito.');
    if (value.abs() <= 9007199254740991 && value == value.truncateToDouble()) {
      return value.toInt();
    }
    return value;
  }
  if (value is List) return value.map(canonicalProductJson).toList();
  final map = requireObject(value);
  final keys = map.keys.toList()..sort();
  return {for (final key in keys) key: canonicalProductJson(map[key])};
}

String productCanonicalJson(dynamic value) =>
    jsonEncode(canonicalProductJson(value));
String productCommandHash(String operation, Map<String, dynamic> command) =>
    sha256
        .convert(
          utf8.encode(
            productCanonicalJson({'operation': operation, 'command': command}),
          ),
        )
        .toString();

Map<String, dynamic> normalizeProductCommand(
  String operation,
  Map<String, dynamic> source,
) {
  if (!productMutationOperations.contains(operation)) {
    throw const FormatException('Operação de produto inválida.');
  }
  final data = requireObject(jsonDecode(productCanonicalJson(source)));
  final expectedKeys = operation == 'updateProductV2'
      ? {
          'schemaVersion',
          'requestId',
          'productId',
          'expectedUpdateTime',
          'changes',
        }
      : {
          'schemaVersion',
          'requestId',
          'productId',
          'expectedUpdateTime',
          'reason',
          'stockChange',
        };
  if (data.keys.toSet().difference({...expectedKeys, 'scope'}).isNotEmpty ||
      expectedKeys.difference(data.keys.toSet()).isNotEmpty ||
      data['schemaVersion'] != (operation == 'updateProductV2' ? 2 : 1)) {
    throw const FormatException('Envelope inválido.');
  }
  final requestId = data['requestId'];
  final productId = data['productId'];
  if (requestId is! String ||
      requestId.trim().isEmpty ||
      requestId.length > 128 ||
      productId is! String ||
      productId.isEmpty ||
      productId.trim() != productId ||
      productId.contains('/') ||
      productId == '.' ||
      productId == '..') {
    throw const FormatException('Identidade inválida.');
  }
  data['expectedUpdateTime'] = requireProductToken(data['expectedUpdateTime']);
  if (data.containsKey('scope')) {
    final scope = requireObject(data['scope']);
    if (scope.length != 3 ||
        !scope.keys.toSet().containsAll({'projectId', 'uid', 'storeId'}) ||
        scope.values.any(
          (v) =>
              v is! String ||
              v.isEmpty ||
              v.trim() != v ||
              v.contains('/') ||
              v == '.' ||
              v == '..',
        )) {
      throw const FormatException('Escopo do comando inválido.');
    }
    data['scope'] = scope;
  }
  if (operation == 'updateProductV2') {
    final changes = requireObject(data['changes']);
    if (changes.keys.any(
      (key) => !{'set', 'remove', 'fiscal', 'categories'}.contains(key),
    )) {
      throw const FormatException('Bloco de alteração inválido.');
    }
    Map<String, dynamic> patch(dynamic raw, {bool fiscal = false}) {
      final p = requireObject(raw);
      if (p.keys.any((key) => key != 'set' && key != 'remove')) {
        throw const FormatException('Patch inválido.');
      }
      final set = requireObject(
        p.containsKey('set') ? p['set'] : <String, dynamic>{},
      );
      const fiscalFields = {
        'ncm',
        'origem',
        'cfop',
        'unidade',
        'cest',
        'icmsSituacaoTributaria',
        'pisSituacaoTributaria',
        'cofinsSituacaoTributaria',
        'ibsCbsSituacaoTributaria',
        'ibsCbsClassificacaoTributaria',
      };
      const fields = {
        'name',
        'price',
        'minimumStock',
        'imageUrl',
        'cod',
        'barcode',
        'costPrice',
      };
      final allowed = fiscal ? fiscalFields : fields;
      for (final key in set.keys.toList()) {
        final value = set[key];
        if (!allowed.contains(key)) {
          throw const FormatException('Campo protegido/desconhecido.');
        }
        if (fiscal) {
          if (value != null && value is! String) {
            throw const FormatException('Fiscal inválido.');
          }
        } else if (key == 'price' ||
            key == 'costPrice' ||
            key == 'minimumStock') {
          if (value is! num ||
              value < 0 ||
              (key == 'minimumStock' &&
                  (value is! int || value > 9007199254740991))) {
            throw const FormatException('Número inválido.');
          }
        } else {
          if (value is! String) throw const FormatException('Texto inválido.');
          if (key != 'imageUrl') {
            set[key] = key == 'cod' ? value.trim().toUpperCase() : value.trim();
            if ((set[key] as String).isEmpty ||
                (key == 'cod' && (set[key] as String).length > 40)) {
              throw const FormatException('Texto vazio/inválido.');
            }
          }
        }
      }
      final remove = p.containsKey('remove') ? p['remove'] : <dynamic>[];
      final removable = fiscal ? fiscalFields : {'cod', 'barcode', 'costPrice'};
      if (remove is! List ||
          remove.any((key) => key is! String || !removable.contains(key)) ||
          remove.toSet().length != remove.length ||
          remove.any(set.containsKey)) {
        throw const FormatException('Remoção inválida.');
      }
      return {'set': set, 'remove': List<String>.from(remove)..sort()};
    }

    final normalized = patch({
      for (final key in ['set', 'remove'])
        if (changes.containsKey(key)) key: changes[key],
    });
    if (changes.containsKey('fiscal')) {
      normalized['fiscal'] = patch(changes['fiscal'], fiscal: true);
    }
    if (changes.containsKey('categories')) {
      final categories = requireObject(changes['categories']);
      final ids = categories['ids'];
      if (categories.length != 1 ||
          ids is! List ||
          ids.length > 10 ||
          ids.toSet().length != ids.length ||
          ids.any(
            (id) =>
                id is! String ||
                id.isEmpty ||
                id.trim() != id ||
                id.contains('/') ||
                id == '.' ||
                id == '..',
          )) {
        throw const FormatException('Categorias inválidas.');
      }
      normalized['categories'] = {'ids': ids};
    }
    final fiscal = normalized['fiscal'] as Map?;
    if ((normalized['set'] as Map).isEmpty &&
        (normalized['remove'] as List).isEmpty &&
        !normalized.containsKey('categories') &&
        (fiscal == null ||
            ((fiscal['set'] as Map).isEmpty &&
                (fiscal['remove'] as List).isEmpty))) {
      throw const FormatException('Comando vazio.');
    }
    data['changes'] = normalized;
  } else {
    final reason = data['reason'];
    if (reason is! String || reason.trim().isEmpty) {
      throw const FormatException('Motivo obrigatório.');
    }
    data['reason'] = reason.trim();
    final stock = requireObject(data['stockChange']);
    if (!{
      'setManualQuantity',
      'editLots',
      'convertToLots',
      'convertToManual',
    }.contains(stock['kind'])) {
      throw const FormatException('Operação de estoque inválida.');
    }
    void keys(Map<String, dynamic> value, Set<String> required) {
      if (value.keys.toSet().difference(required).isNotEmpty ||
          required.difference(value.keys.toSet()).isNotEmpty) {
        throw const FormatException('Campos de estoque inválidos.');
      }
    }

    void integer(dynamic value) {
      if (value is! int || value < 0 || value > 9007199254740991) {
        throw const FormatException('Inteiro de estoque inválido.');
      }
    }

    void validity(dynamic value) {
      if (value is! int || value < -62135596800000 || value > 253402300799999) {
        throw const FormatException('Validade inválida.');
      }
    }

    void lot(Map<String, dynamic> value) {
      integer(value['quantidade']);
      validity(value['validadeMs']);
      if (value['quantidade'] == 0) {
        throw const FormatException('Novo lote vazio.');
      }
    }

    switch (stock['kind']) {
      case 'setManualQuantity':
        keys(stock, {'kind', 'quantity'});
        integer(stock['quantity']);
      case 'convertToManual':
        keys(stock, {'kind', 'quantity', 'acknowledgement'});
        integer(stock['quantity']);
        if (stock['acknowledgement'] != true) {
          throw const FormatException('Confirmação obrigatória.');
        }
      case 'convertToLots':
        keys(stock, {'kind', 'lots'});
        final lots = stock['lots'];
        if (lots is! List || lots.isEmpty) {
          throw const FormatException('Lotes obrigatórios.');
        }
        for (final raw in lots) {
          final value = requireObject(raw);
          keys(value, {'quantidade', 'validadeMs'});
          lot(value);
        }
      case 'editLots':
        keys(stock, {'kind', 'operations'});
        final operations = stock['operations'];
        if (operations is! List || operations.isEmpty) {
          throw const FormatException('Operações obrigatórias.');
        }
        final indices = <int>{};
        for (final raw in operations) {
          final value = requireObject(raw);
          if (value['op'] == 'add') {
            keys(value, {'op', 'quantidade', 'validadeMs'});
            lot(value);
          } else {
            integer(value['index']);
            if (!indices.add(value['index'] as int)) {
              throw const FormatException('Índice repetido.');
            }
            if (value['op'] == 'remove') {
              keys(value, {'op', 'index'});
            } else if (value['op'] == 'update') {
              keys(value, {'op', 'index', 'set'});
              final set = requireObject(value['set']);
              if (set.isEmpty ||
                  set.keys.any(
                    (key) => key != 'quantidade' && key != 'validadeMs',
                  )) {
                throw const FormatException('Patch de lote inválido.');
              }
              if (set.containsKey('quantidade')) integer(set['quantidade']);
              if (set.containsKey('validadeMs')) validity(set['validadeMs']);
            } else {
              throw const FormatException('Operação de lote inválida.');
            }
          }
        }
    }
    // No lot filtering/reordering/default quantity is applied.
    data['stockChange'] = stock;
  }
  return requireObject(canonicalProductJson(data));
}
