import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'product_mutation_command.dart';
import 'variant_intent_ledger.dart';
import 'variant_preview_state.dart';

// Parsing is never authentication. There is deliberately no trusted constructor.
enum VariantResponseOrigin { unverifiedJson, syntheticFixture }

enum VariantReadStatus {
  available,
  confirmed,
  identityConflict,
  accessDenied,
  inconsistentState,
  unknown,
}

Never _bad() => throw const FormatException('Resposta B2-A invalida.');
void _keys(Map value, Set<String> required) {
  if (value.length != required.length ||
      !value.keys.toSet().containsAll(required)) {
    _bad();
  }
}

String _id(dynamic value) {
  if (value is! String ||
      value.isEmpty ||
      value.trim() != value ||
      value.contains('/') ||
      value == '.' ||
      value == '..' ||
      RegExp(r'^__.*__$').hasMatch(value) ||
      utf8.encode(value).length > 1500 ||
      value.runes.any((r) => r < 32 || (r >= 0xd800 && r <= 0xdfff))) {
    _bad();
  }
  return value;
}

dynamic _freeze(dynamic value) {
  if (value is Map) {
    return Map<String, dynamic>.unmodifiable(
      requireObject(value).map((k, v) => MapEntry(k, _freeze(v))),
    );
  }
  if (value is List) {
    return List<dynamic>.unmodifiable(value.map(_freeze));
  }
  if (value == null ||
      value is String ||
      value is bool ||
      (value is num && value.isFinite)) {
    return value;
  }
  _bad();
}

Map<String, dynamic> _scope(dynamic raw) {
  final value = requireObject(raw);
  _keys(value, {'projectId', 'uid', 'storeId'});
  value.values.forEach(_id);
  return Map.unmodifiable(value);
}

class VariantReadSnapshot {
  final Map<String, dynamic> data;
  final Map<String, dynamic> updateTime;
  VariantReadSnapshot._(Map raw, {bool parent = false})
    : data = _freeze(requireObject(raw['data'])),
      updateTime = Map.unmodifiable(requireProductToken(raw['updateTime'])) {
    _keys(raw, {'data', 'updateTime', if (parent) 'isSellable'});
    if (parent && raw['isSellable'] != false) {
      _bad();
    }
    if (data['variantSchemaVersion'] != 1 || data['isArchived'] is! bool) {
      _bad();
    }
    if (parent &&
        (data['productKind'] != 'variantParent' ||
            data['attributeDefinitions'] is! List)) {
      _bad();
    }
    if (!parent) {
      _id(data['productId']);
      if (data['attributes'] is! List || (data['attributes'] as List).isEmpty) {
        _bad();
      }
      validateInventory(data);
    }
  }
}

class VariantReceiptSnapshot {
  final String path;
  final Map<String, dynamic> updateTime;
  final Map<String, dynamic> data;
  VariantReceiptSnapshot._(Map raw)
    : path = raw['path'] is String ? raw['path'] as String : _bad(),
      updateTime = Map.unmodifiable(requireProductToken(raw['updateTime'])),
      data = _freeze(requireObject(raw['data'])) {
    _keys(raw, {'path', 'updateTime', 'data'});
    if (data['schemaVersion'] != 1) {
      _bad();
    }
    final createdAt = requireObject(data['createdAt']);
    final nanos = createdAt['nanoseconds'];
    if (createdAt.length != 2 ||
        nanos is! int ||
        nanos < 0 ||
        nanos >= 1000000000) {
      _bad();
    }
    requireProductToken({...createdAt, 'nanoseconds': 0});
    requireObject(data['command']);
    requireObject(data['result']);
  }
}

// One immutable discriminated DTO; status-specific fields cannot be constructed
// independently. Unknown receipt metadata is retained, never treated as authority.
class VariantAuthoritativeResponse {
  final VariantReadStatus status;
  final VariantResponseOrigin origin;
  final String? reason;
  final String? operation;
  final String? persistedOperation;
  final Map<String, dynamic>? scope;
  final String? productId;
  final String? variantId;
  final VariantReadSnapshot? parent;
  final VariantReadSnapshot? variant;
  final VariantReceiptSnapshot? receipt;
  VariantAuthoritativeResponse._(
    this.status,
    this.origin, {
    this.reason,
    this.operation,
    this.persistedOperation,
    this.scope,
    this.productId,
    this.variantId,
    this.parent,
    this.variant,
    this.receipt,
  });
  bool get isTrustedCommitProof => false;
  factory VariantAuthoritativeResponse.decode(
    dynamic input, {
    VariantResponseOrigin origin = VariantResponseOrigin.unverifiedJson,
  }) {
    final raw = requireObject(_freeze(input));
    const names = {
      'available': VariantReadStatus.available,
      'confirmed': VariantReadStatus.confirmed,
      'identity-conflict': VariantReadStatus.identityConflict,
      'access-denied': VariantReadStatus.accessDenied,
      'inconsistent-state': VariantReadStatus.inconsistentState,
      'unknown': VariantReadStatus.unknown,
    };
    final status = names[raw['status']] ?? _bad();
    if (status == VariantReadStatus.confirmed) {
      _keys(raw, {'status', 'operation', 'persistedOperation', 'receipt'});
      final operation = raw['operation'];
      if (operation is! String ||
          !variantPersistedOperations.containsKey(operation) ||
          raw['persistedOperation'] != variantPersistedOperations[operation]) {
        _bad();
      }
      final receipt = VariantReceiptSnapshot._(requireObject(raw['receipt']));
      if (receipt.data['operation'] != raw['persistedOperation']) {
        _bad();
      }
      final command = requireObject(receipt.data['command']);
      final scope = _scope(command['scope']);
      final requestId = _id(command['requestId']);
      if (requestId.length > 128 || command['schemaVersion'] != 1) {
        _bad();
      }
      _id(command['productId']);
      final isProduct = operation.startsWith('createProduct');
      if (!isProduct) {
        final validationOperation = operation == 'createVariantC1'
            ? 'createVariantC2'
            : operation;
        VariantPreviewIntent.fromJson({
          'operation': validationOperation,
          'command': command,
        });
        if (operation == 'createVariantC1' &&
            requireObject(command['variant']).containsKey('cod')) {
          _bad();
        }
      } else {
        _keys(command, {
          'schemaVersion',
          'requestId',
          'scope',
          'productId',
          'product',
        });
        final product = requireObject(command['product']);
        if (!{'simple', 'variantParent'}.contains(product['productKind']) ||
            product['variantSchemaVersion'] != 1 ||
            product['isArchived'] != false ||
            product['quantidade'] != 0 ||
            product['lotes'] is! List ||
            (product['lotes'] as List).isNotEmpty ||
            product['name'] is! String ||
            (product['name'] as String).trim().isEmpty) {
          _bad();
        }
        if (product.containsKey('cod') &&
            (operation == 'createProductC1' || product['cod'] is! String)) {
          _bad();
        }
      }
      final digest = sha256
          .convert(utf8.encode(jsonEncode([scope['uid'], requestId])))
          .toString();
      if (receipt.path !=
          'stores/${scope['storeId']}/auditLogs/f10-c1-$digest') {
        _bad();
      }
      final creation = operation.startsWith('create');
      final result = requireObject(receipt.data['result']);
      _keys(result, {
        'schemaVersion',
        'productId',
        'variantId',
        'status',
        'replayed',
        if (!creation) ...{'requestId', 'changed'},
      });
      if (result['schemaVersion'] != 1 ||
          result['productId'] != command['productId'] ||
          result['variantId'] != (isProduct ? null : command['variantId']) ||
          result['replayed'] != false ||
          result['status'] !=
              (creation
                  ? 'created'
                  : operation == 'archiveVariantC3'
                  ? 'archived'
                  : 'adjusted')) {
        _bad();
      }
      if (!creation) {
        final audit = requireObject(receipt.data['audit']);
        final before = requireObject(audit['before']);
        final after = requireObject(audit['after']);
        if (result['requestId'] != requestId ||
            result['changed'] is! bool ||
            audit['reason'] != command['reason']) {
          _bad();
        }
        if (operation == 'archiveVariantC3') {
          if (before['isArchived'] is! bool ||
              after['isArchived'] != true ||
              result['changed'] != !(before['isArchived'] as bool)) {
            _bad();
          }
        } else {
          validateInventory(before);
          validateInventory(after);
        }
      }
      return VariantAuthoritativeResponse._(
        status,
        origin,
        operation: operation,
        persistedOperation: raw['persistedOperation'] as String,
        receipt: receipt,
      );
    }
    if (status == VariantReadStatus.available) {
      final identity = requireObject(raw['identity']);
      _keys(identity, {'productId', 'variantId'});
      final product = _id(identity['productId']);
      final variantId = identity['variantId'] == null
          ? null
          : _id(identity['variantId']);
      _keys(raw, {
        'status',
        'scope',
        'identity',
        'parent',
        if (variantId != null) 'variant',
      });
      final variant = variantId == null
          ? null
          : VariantReadSnapshot._(requireObject(raw['variant']));
      final parent = VariantReadSnapshot._(
        requireObject(raw['parent']),
        parent: true,
      );
      final definitions = parent.data['attributeDefinitions'] as List;
      final values = <String, Set<String>>{};
      if (definitions.isEmpty || definitions.length > 10) {
        _bad();
      }
      for (final rawDefinition in definitions) {
        final definition = requireObject(rawDefinition);
        final id = _id(definition['attributeId']);
        if (values.containsKey(id) || definition['values'] is! List) {
          _bad();
        }
        final options = definition['values'] as List;
        if (options.isEmpty || options.length > 100) {
          _bad();
        }
        values[id] = <String>{};
        for (final rawOption in options) {
          if (!values[id]!.add(_id(requireObject(rawOption)['valueId']))) {
            _bad();
          }
        }
      }
      if (variant != null) {
        final pairs = variant.data['attributes'] as List;
        final ids = values.keys.toList()..sort();
        if (pairs.length != ids.length) {
          _bad();
        }
        for (var i = 0; i < pairs.length; i++) {
          final pair = requireObject(pairs[i]);
          _keys(pair, {'attributeId', 'valueId'});
          if (pair['attributeId'] != ids[i] ||
              !values[ids[i]]!.contains(pair['valueId'])) {
            _bad();
          }
        }
      }
      if (variant != null && variant.data['productId'] != product) {
        _bad();
      }
      return VariantAuthoritativeResponse._(
        status,
        origin,
        scope: _scope(raw['scope']),
        productId: product,
        variantId: variantId,
        parent: parent,
        variant: variant,
      );
    }
    _keys(raw, {'status', 'reason'});
    if (raw['reason'] is! String || (raw['reason'] as String).trim().isEmpty) {
      _bad();
    }
    return VariantAuthoritativeResponse._(
      status,
      origin,
      reason: raw['reason'] as String,
    );
  }
}

const variantPersistedOperations = {
  'createProductC1': 'createProductC1',
  'createProductC2': 'createProductC1',
  'createVariantC1': 'createVariantC1',
  'createVariantC2': 'createVariantC1',
  'adjustVariantStockC3': 'adjustVariantStockC3',
  'archiveVariantC3': 'archiveVariantC3',
};

class VariantReconciliationPlan {
  final String originalEncoded;
  final String requestId;
  final String fingerprint;
  final VariantIntentStatus expectedStatus;
  final bool compatibleConfirmed;
  const VariantReconciliationPlan._(
    this.originalEncoded,
    this.requestId,
    this.fingerprint,
    this.expectedStatus,
    this.compatibleConfirmed,
  );
  // B2-B2 must establish provenance, revalidate access before/after awaits and
  // perform ledger CAS against the original intent/status. No mutation here.
  bool get mayCommit => false;
  bool get mayCreateNewIntent => false;
}

VariantReconciliationPlan inspectVariantResponse(
  VariantLedgerAttempt attempt,
  VariantAuthoritativeResponse? response,
  VariantLocalAccess access, {
  required String expectedSessionToken,
}) {
  final original = attempt.intent;
  final command = original.command;
  final allowed =
      !access.revoked &&
      access.sessionToken == expectedSessionToken &&
      productCanonicalJson(access.scope) ==
          productCanonicalJson(command['scope']) &&
      {
        'admin',
        'gerente',
        'operador',
        'caixa',
        'vendedor',
      }.contains(access.role) &&
      (original.operation != 'archiveVariantC3' || access.role == 'admin');
  if (!allowed) {
    throw StateError('Sessao ou escopo incompativel; intencao preservada.');
  }
  var compatible = false;
  if (response?.status == VariantReadStatus.confirmed) {
    final receipt = response!.receipt!;
    final expected = requireObject(jsonDecode(productCanonicalJson(command)));
    // Only the historical C3 reason normalization is allowed for B1 intents.
    if (expected.containsKey('reason')) {
      expected['reason'] = (expected['reason'] as String).trim();
    }
    if (original.operation == 'adjustVariantStockC3') {
      expected['stockChange'] =
          normalizeProductCommand('adjustProductStockV1', {
            'schemaVersion': 1,
            'requestId': original.requestId,
            'productId': command['productId'],
            'expectedUpdateTime': command['expectedVariantUpdateTime'],
            'reason': command['reason'],
            'stockChange': command['stockChange'],
          })['stockChange'];
    }
    final digest = sha256
        .convert(
          utf8.encode(jsonEncode([access.scope['uid'], original.requestId])),
        )
        .toString();
    final result = requireObject(receipt.data['result']);
    final create = original.operation == 'createVariantC2';
    final expectedResult = {
      'schemaVersion': 1,
      'productId': command['productId'],
      'variantId': command['variantId'],
      'status': create
          ? 'created'
          : original.operation == 'archiveVariantC3'
          ? 'archived'
          : 'adjusted',
      'replayed': false,
      if (!create) 'requestId': original.requestId,
      if (!create) 'changed': result['changed'],
    };
    compatible =
        response.operation == original.operation &&
        receipt.path ==
            'stores/${access.scope['storeId']}/auditLogs/f10-c1-$digest' &&
        productCanonicalJson(receipt.data['command']) ==
            productCanonicalJson(expected) &&
        productCanonicalJson(result) == productCanonicalJson(expectedResult) &&
        (create ||
            (result['changed'] is bool &&
                requireObject(receipt.data['audit'])['reason'] ==
                    expected['reason']));
  }
  if (response?.status == VariantReadStatus.available &&
      (productCanonicalJson(response!.scope) !=
              productCanonicalJson(command['scope']) ||
          response.productId != command['productId'] ||
          response.variantId != command['variantId'])) {
    throw const FormatException('Leitura de outra identidade.');
  }
  return VariantReconciliationPlan._(
    original.encoded,
    original.requestId,
    attempt.fingerprint,
    attempt.status,
    compatible,
  );
}

// Future read-only transport boundary. Implementations must never manufacture
// trust from origin, JSON shape, receipt timestamp or a caller-supplied flag.
abstract interface class VariantB2ReadTransport {
  Future<VariantAuthoritativeResponse> queryReceipt(
    VariantLocalAccess access,
    VariantPreviewIntent original,
  );
  Future<VariantAuthoritativeResponse> readState(
    VariantLocalAccess access,
    VariantIdentity identity,
  );
}
