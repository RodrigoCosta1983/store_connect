import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'product_mutation_command.dart';

// Synthetic preview only. Imports no Firebase, transport, repository or ledger.
dynamic _freeze(dynamic value) {
  if (value is List) return List<dynamic>.unmodifiable(value.map(_freeze));
  if (value is Map) {
    return Map<String, dynamic>.unmodifiable(
      requireObject(value).map((key, value) => MapEntry(key, _freeze(value))),
    );
  }
  return value;
}

Map<String, dynamic> _snapshot(Map<String, dynamic> value) =>
    _freeze(jsonDecode(productCanonicalJson(value))) as Map<String, dynamic>;

String _id(String value) {
  if (value.isEmpty ||
      value.trim() != value ||
      value.contains('/') ||
      value == '.' ||
      value == '..' ||
      RegExp(r'^__.*__$').hasMatch(value) ||
      utf8.encode(value).length > 1500 ||
      utf8.decode(utf8.encode(value)) != value ||
      value.runes.any((r) => r < 32 || (r >= 0xd800 && r <= 0xdfff))) {
    throw const FormatException('Identidade estável inválida.');
  }
  return value;
}

class VariantIdentity {
  final String productId;
  final String variantId;
  VariantIdentity(String productId, String variantId)
    : productId = _id(productId),
      variantId = _id(variantId);
  String get key => jsonEncode([productId, variantId]);
  @override
  bool operator ==(Object other) =>
      other is VariantIdentity && key == other.key;
  @override
  int get hashCode => key.hashCode;
}

class VariantBaseline {
  final Map<String, dynamic> token;
  VariantBaseline(Map<String, dynamic> value)
    : token = Map.unmodifiable(requireProductToken(value));
  String get exact =>
      '${token['seconds']}.${token['nanoseconds'].toString().padLeft(9, '0')}';
}

class VariantPreviewData {
  final Map<String, dynamic> data;
  VariantPreviewData(Map<String, dynamic> raw) : data = _snapshot(raw) {
    if (!(scope['projectId'] as String).startsWith('demo-')) {
      throw const FormatException('Prévia restrita a fixtures demo.');
    }
    for (final value in scope.values) {
      _id(value as String);
    }
    _id(productId);
    VariantBaseline(requireObject(data['baseline']));
    final seen = <String>{};
    final identities = <String>{};
    for (final row in variants) {
      final identity = VariantIdentity(productId, row['variantId'] as String);
      if (!identities.add(identity.key) ||
          !seen.add(combination(requireObject(row['attributes'])))) {
        throw const FormatException('Identidade ou combinação duplicada.');
      }
      VariantBaseline(requireObject(row['baseline']));
      validateInventory(row);
    }
  }
  String get productId => data['productId'] as String;
  String get name => data['name'] as String;
  bool get archived => data['isArchived'] == true;
  Map<String, dynamic> get scope => data['scope'] as Map<String, dynamic>;
  VariantBaseline get baseline =>
      VariantBaseline(requireObject(data['baseline']));
  List<Map<String, dynamic>> get definitions =>
      (data['definitions'] as List).cast<Map<String, dynamic>>();
  List<Map<String, dynamic>> get variants =>
      (data['variants'] as List).cast<Map<String, dynamic>>();
  Map<String, dynamic> variant(VariantIdentity identity) {
    if (identity.productId != productId) {
      throw const FormatException('Outro produto.');
    }
    return variants.firstWhere((v) => v['variantId'] == identity.variantId);
  }

  String combination(Map<String, dynamic> selected) =>
      combinationFor(definitions, selected);

  static String combinationFor(
    List<Map<String, dynamic>> definitions,
    Map<String, dynamic> selected,
  ) {
    final ids = definitions.map((d) => d['attributeId'] as String).toList()
      ..sort();
    if (ids.isEmpty ||
        selected.length != ids.length ||
        selected.keys.any((k) => !ids.contains(k))) {
      throw const FormatException(
        'Selecione todos os atributos explicitamente.',
      );
    }
    for (final id in ids) {
      final definition = definitions.firstWhere((d) => d['attributeId'] == id);
      if (!(definition['values'] as List).any(
        (v) => v['valueId'] == selected[id],
      )) {
        throw const FormatException('Valor de atributo inválido.');
      }
    }
    return jsonEncode([
      for (final id in ids) [id, selected[id]],
    ]);
  }
}

void validateInventory(Map<String, dynamic> row) {
  bool quantity(dynamic value) =>
      value is int && value >= 0 && value <= 9007199254740991;
  if (!quantity(row['quantidade']) ||
      (row.containsKey('lotes') && row['lotes'] is! List)) {
    throw const FormatException('Estoque inválido.');
  }
  final lots = row['lotes'] as List? ?? [];
  var sum = 0;
  for (final raw in lots) {
    final lot = requireObject(raw);
    final date = requireObject(lot['validade']);
    final nanos = date['nanoseconds'];
    if (!quantity(lot['quantidade']) ||
        date.length != 2 ||
        nanos is! int ||
        nanos < 0 ||
        nanos >= 1000000000) {
      throw const FormatException('Lote inválido.');
    }
    requireProductToken({'seconds': date['seconds'], 'nanoseconds': 0});
    sum += lot['quantidade'] as int;
    if (!quantity(sum)) throw const FormatException('Soma insegura.');
  }
  if (lots.isNotEmpty && sum != row['quantidade']) {
    throw const FormatException('Lotes divergentes.');
  }
}

enum VariantPreviewPhase {
  loading,
  ready,
  prepared,
  conflict,
  replay,
  success,
  error,
  denied,
}

class VariantPreviewIntent {
  final String operation;
  final Map<String, dynamic> command;
  VariantPreviewIntent._(this.operation, Map<String, dynamic> command)
    : command = _snapshot(command);
  // Shared cadastral validation, without inventing scope or baseline for a form.
  static void validateCreationFields(Map<String, dynamic> body) {
    if (!body.containsKey('attributes') ||
        body.keys.any((k) => !{'attributes', 'name', 'cod'}.contains(k))) {
      throw const FormatException('Campos de intenção inválidos.');
    }
    final pairs = body['attributes'];
    final ids = <String>{};
    if (pairs is! List || pairs.isEmpty) {
      throw const FormatException('Combinação vazia.');
    }
    for (final pair in pairs) {
      final p = requireObject(pair);
      if (p.length != 2 || !p.keys.toSet().containsAll({'attributeId', 'valueId'})) {
        throw const FormatException('Campos de intenção inválidos.');
      }
      if (!ids.add(_id(p['attributeId'] as String))) {
        throw const FormatException('Atributo repetido.');
      }
      _id(p['valueId'] as String);
    }
    if (body.containsKey('cod') &&
        (body['cod'] is! String ||
            (body['cod'] as String).trim().toUpperCase().length > 40)) {
      throw const FormatException('COD inválido.');
    }
    if (body.containsKey('name') &&
        (body['name'] is! String ||
            (body['name'] as String).trim().isEmpty ||
            (body['name'] as String).length > 200)) {
      throw const FormatException('Nome inválido.');
    }
  }
  factory VariantPreviewIntent.fromJson(Map<String, dynamic> raw) {
    void keys(
      Map value,
      Set<String> required, [
      Set<String> optional = const {},
    ]) {
      if (!value.keys.toSet().containsAll(required) ||
          value.keys.any((k) => !{...required, ...optional}.contains(k))) {
        throw const FormatException('Campos de intenção inválidos.');
      }
    }

    keys(raw, {'operation', 'command'});
    final operation = raw['operation'];
    if (!{
      'createVariantC2',
      'adjustVariantStockC3',
      'archiveVariantC3',
    }.contains(operation)) {
      throw const FormatException('Protocolo de variante inválido.');
    }
    final command = requireObject(raw['command']);
    final create = operation == 'createVariantC2';
    keys(command, {
      'schemaVersion',
      'requestId',
      'scope',
      'productId',
      'variantId',
      'expectedProductUpdateTime',
      if (create) 'variant' else ...{'expectedVariantUpdateTime', 'reason'},
      if (operation == 'adjustVariantStockC3') 'stockChange',
    });
    if (command['schemaVersion'] != 1 ||
        _id(command['requestId'] as String).length > 128) {
      throw const FormatException('Versão ou requestId inválido.');
    }
    _id(command['productId'] as String);
    _id(command['variantId'] as String);
    final scope = requireObject(command['scope']);
    keys(scope, {'projectId', 'uid', 'storeId'});
    for (final value in scope.values) {
      _id(value as String);
    }
    if (!(scope['projectId'] as String).startsWith('demo-')) {
      throw const FormatException('Intenção local exige projeto demo.');
    }
    requireProductToken(command['expectedProductUpdateTime']);
    if (create) {
      final body = requireObject(command['variant']);
      validateCreationFields(body);
    } else {
      requireProductToken(command['expectedVariantUpdateTime']);
      if (command['reason'] is! String ||
          (command['reason'] as String).trim().isEmpty) {
        throw const FormatException('Motivo inválido.');
      }
      if (operation == 'adjustVariantStockC3') {
        normalizeProductCommand('adjustProductStockV1', {
          'schemaVersion': 1,
          'requestId': command['requestId'],
          'productId': command['productId'],
          'expectedUpdateTime': command['expectedVariantUpdateTime'],
          'reason': command['reason'],
          'stockChange': command['stockChange'],
        });
      }
    }
    return VariantPreviewIntent._(operation as String, command);
  }
  String get requestId => command['requestId'] as String;
  String get encoded =>
      productCanonicalJson({'operation': operation, 'command': command});
  Map<String, dynamic> toJson() =>
      _snapshot({'operation': operation, 'command': command});
}

class VariantPreviewSession extends ChangeNotifier {
  VariantPreviewData _fixture;
  final String Function() newId;
  String role;
  bool revoked = false;
  VariantPreviewPhase phase = VariantPreviewPhase.loading;
  VariantIdentity? selected;
  VariantPreviewIntent? _pending;
  String? message;
  // Cadastral draft deliberately has no stock/lots fields.
  String draftName = '';
  String draftCod = '';
  bool codSupplied = false;
  final Map<String, String> selections = {};
  VariantPreviewSession(
    VariantPreviewData fixture, {
    String Function()? newId,
    this.role = 'admin',
  }) : _fixture = fixture,
       newId = newId ?? _syntheticId;
  static String _syntheticId() {
    final random = Random.secure();
    return 'preview-${List.generate(16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
  }

  VariantPreviewData get fixture => _fixture;
  VariantPreviewIntent? get pending => _pending;
  bool get permitted =>
      !revoked &&
      {'admin', 'gerente', 'operador', 'caixa', 'vendedor'}.contains(role);
  bool get canPrepare =>
      permitted &&
      !_fixture.archived &&
      _pending == null &&
      phase != VariantPreviewPhase.loading;
  void open() {
    phase = VariantPreviewPhase.ready;
    notifyListeners();
  }

  void select(VariantIdentity identity) {
    _fixture.variant(identity);
    selected = identity;
    notifyListeners();
  }

  void _check({bool archive = false}) {
    if (!permitted || (archive && role != 'admin')) {
      phase = VariantPreviewPhase.denied;
      notifyListeners();
      throw StateError('Permissão simulada negada.');
    }
    if (!canPrepare) {
      throw StateError('Intenção existente ou pai indisponível.');
    }
  }

  VariantPreviewIntent _prepare(
    String operation,
    Map<String, dynamic> command,
  ) {
    _pending = VariantPreviewIntent._(operation, command);
    phase = VariantPreviewPhase.prepared;
    message = 'Intenção preparada; nenhum comando enviado.';
    notifyListeners();
    return _pending!;
  }

  Map<String, dynamic> _base() => {
    'schemaVersion': 1,
    'requestId': _id(newId()),
    'scope': _fixture.scope,
    'productId': _fixture.productId,
    'expectedProductUpdateTime': _fixture.baseline.token,
  };
  VariantPreviewIntent prepareCreation() {
    _check();
    final key = _fixture.combination(selections);
    if (_fixture.variants.any(
      (v) => _fixture.combination(requireObject(v['attributes'])) == key,
    )) {
      throw const FormatException('Combinação existente, inclusive arquivada.');
    }
    if (draftName.length > 200 ||
        (draftName.isNotEmpty && draftName.trim().isEmpty) ||
        (codSupplied && draftCod.trim().toUpperCase().length > 40)) {
      throw const FormatException('Nome ou COD inválido.');
    }
    final ids = selections.keys.toList()..sort();
    return _prepare('createVariantC2', {
      ..._base(),
      'variantId': _id(newId()),
      'variant': {
        'attributes': [
          for (final id in ids) {'attributeId': id, 'valueId': selections[id]},
        ],
        if (draftName.isNotEmpty) 'name': draftName,
        if (codSupplied) 'cod': draftCod,
      },
    });
  }

  Map<String, dynamic> _target(String reason) {
    if (selected == null) {
      throw const FormatException('Selecione uma variante.');
    }
    final row = _fixture.variant(selected!);
    if (row['isArchived'] == true) {
      throw const FormatException('Variante arquivada.');
    }
    if (reason.trim().isEmpty) {
      throw const FormatException('Motivo obrigatório.');
    }
    return {
      ..._base(),
      'variantId': selected!.variantId,
      'expectedVariantUpdateTime': VariantBaseline(
        requireObject(row['baseline']),
      ).token,
      'reason': reason.trim(),
    };
  }

  VariantPreviewIntent prepareStock(
    Map<String, dynamic> change,
    String reason,
  ) {
    _check();
    final base = _target(reason);
    final row = _fixture.variant(selected!);
    validateInventory(row);
    final normalized =
        normalizeProductCommand('adjustProductStockV1', {
              'schemaVersion': 1,
              'requestId': base['requestId'],
              'productId': base['productId'],
              'expectedUpdateTime': base['expectedVariantUpdateTime'],
              'reason': reason,
              'stockChange': change,
            })['stockChange']
            as Map<String, dynamic>;
    final lots = row['lotes'] as List? ?? [];
    final kind = normalized['kind'];
    if ((kind == 'setManualQuantity' || kind == 'convertToLots') &&
            lots.isNotEmpty ||
        (kind == 'editLots' || kind == 'convertToManual') && lots.isEmpty) {
      throw const FormatException('Operação incompatível com modo atual.');
    }
    if (kind == 'editLots') {
      final quantities = <int, int>{
        for (var i = 0; i < lots.length; i++) i: lots[i]['quantidade'] as int,
      };
      var added = 0, addedCount = 0;
      for (final op in normalized['operations'] as List) {
        if (op['op'] == 'add') {
          added += op['quantidade'] as int;
          addedCount++;
          continue;
        }
        final index = op['index'] as int;
        if (!quantities.containsKey(index)) {
          throw const FormatException('Índice fora do baseline.');
        }
        if (op['op'] == 'remove') {
          quantities.remove(index);
        } else if ((op['set'] as Map).containsKey('quantidade')) {
          quantities[index] = op['set']['quantidade'] as int;
        }
      }
      if (quantities.isEmpty && addedCount == 0) {
        throw const FormatException('Remover todos exige conversão.');
      }
      if (quantities.values.fold<int>(added, (n, q) => n + q) >
          9007199254740991) {
        throw const FormatException('Soma insegura.');
      }
    }
    if (kind == 'convertToLots' &&
        (normalized['lots'] as List).fold<int>(
              0,
              (n, l) => n + (l['quantidade'] as int),
            ) >
            9007199254740991) {
      throw const FormatException('Soma insegura.');
    }
    return _prepare('adjustVariantStockC3', {
      ...base,
      'stockChange': normalized,
    });
  }

  VariantPreviewIntent prepareArchive(
    String reason, {
    required bool confirmed,
  }) {
    _check(archive: true);
    if (!confirmed) {
      throw const FormatException('Confirmação de arquivamento obrigatória.');
    }
    return _prepare('archiveVariantC3', _target(reason));
  }

  VariantPreviewIntent retry() {
    if (!permitted ||
        (_pending?.operation == 'archiveVariantC3' && role != 'admin')) {
      phase = VariantPreviewPhase.denied;
      notifyListeners();
      throw StateError('Permissão simulada negada.');
    }
    if (_pending == null) throw StateError('Nenhuma intenção.');
    phase = VariantPreviewPhase.prepared;
    notifyListeners();
    return _pending!;
  }

  void simulate(VariantPreviewPhase result) {
    if (_pending == null ||
        !{
          VariantPreviewPhase.conflict,
          VariantPreviewPhase.replay,
          VariantPreviewPhase.success,
          VariantPreviewPhase.error,
          VariantPreviewPhase.denied,
        }.contains(result)) {
      throw StateError('Resultado simulado inválido.');
    }
    phase = result;
    message = 'Resultado simulado; fixture não foi persistida ou alterada.';
    notifyListeners();
  }

  void acceptSyntheticRead(VariantPreviewData fresh) {
    if (productCanonicalJson(fresh.scope) !=
            productCanonicalJson(_fixture.scope) ||
        fresh.productId != _fixture.productId) {
      throw const FormatException('Leitura pertence a outro escopo.');
    }
    _fixture = fresh; // Never changes the frozen pending intent or its tokens.
    notifyListeners();
  }

  void resume(VariantPreviewIntent intent) {
    if (_pending != null ||
        productCanonicalJson(intent.command['scope']) !=
            productCanonicalJson(_fixture.scope) ||
        intent.command['productId'] != _fixture.productId ||
        !{
          'createVariantC2',
          'adjustVariantStockC3',
          'archiveVariantC3',
        }.contains(intent.operation)) {
      throw const FormatException('Retomada incompatível.');
    }
    _pending = VariantPreviewIntent._(intent.operation, intent.command);
    phase = VariantPreviewPhase.prepared;
    notifyListeners();
  }
}
