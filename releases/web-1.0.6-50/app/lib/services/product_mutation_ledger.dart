import 'dart:convert';
import 'dart:math';
import '../data/local/product_mutation_store.dart';
import 'product_mutation_command.dart';

class ProductMutationScope {
  final String projectId;
  final String uid;
  final String storeId;
  const ProductMutationScope({
    required this.projectId,
    required this.uid,
    required this.storeId,
  });
  Map<String, dynamic> toJson() => {
    'projectId': projectId,
    'uid': uid,
    'storeId': storeId,
  };
  String get prefix {
    if ([projectId, uid, storeId].any((v) => v.isEmpty || v.trim() != v)) {
      throw const FormatException('Escopo inválido.');
    }
    return '${base64Url.encode(utf8.encode(productCanonicalJson(toJson())))}:';
  }
}

enum ProductAttemptState {
  persisted,
  sending,
  unknown,
  confirmed,
  rejected,
  identityConflict,
}

class ProductMutationAttempt {
  final String _encoded;
  ProductMutationAttempt._(this._encoded);
  Map<String, dynamic> get _record => requireObject(jsonDecode(_encoded));
  String get operation => _record['operation'] as String;
  String get requestId => payload['requestId'] as String;
  String get commandHash => _record['commandHash'] as String;
  // Every access returns a detached copy, including nested maps/lists.
  Map<String, dynamic> get payload => requireObject(_record['command']);
  ProductAttemptState get state =>
      ProductAttemptState.values.byName(_record['state'] as String);
  Map<String, dynamic>? get outcome =>
      _record['outcome'] == null ? null : requireObject(_record['outcome']);
}

abstract interface class ProductMutationTransport {
  Future<Map<String, dynamic>> send(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  );
  Future<Map<String, dynamic>> recover(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  );
}

class ProductMutationLedger {
  final ProductMutationStore store;
  final ProductMutationTransport transport;
  final Future<ProductMutationScope?> Function() activeScope;
  ProductMutationLedger({
    required this.store,
    required this.transport,
    required this.activeScope,
  });

  static String newRequestId() {
    final random = Random.secure();
    return List.generate(
      24,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  String _key(ProductMutationScope scope, String operation, String requestId) =>
      '${scope.prefix}${base64Url.encode(utf8.encode(productCanonicalJson([operation, requestId])))}';

  Future<void> _checkScope(ProductMutationScope scope) async {
    final active = await activeScope();
    if (active == null || active.prefix != scope.prefix) {
      throw StateError('Tentativa suspensa: conta, loja ou projeto mudou.');
    }
  }

  ProductMutationAttempt _decode(String encoded, ProductMutationScope scope) {
    final attempt = ProductMutationAttempt._(encoded);
    final record = attempt._record;
    if (record['ledgerVersion'] != 1 ||
        productCanonicalJson(record['scope']) !=
            productCanonicalJson(scope.toJson()) ||
        productCanonicalJson(attempt.payload['scope']) !=
            productCanonicalJson(scope.toJson()) ||
        !productMutationOperations.contains(attempt.operation) ||
        attempt.commandHash !=
            productCommandHash(attempt.operation, attempt.payload) ||
        productCanonicalJson(
              normalizeProductCommand(attempt.operation, attempt.payload),
            ) !=
            productCanonicalJson(attempt.payload)) {
      throw const FormatException(
        'Ledger corrompido/incompatível. Envio bloqueado.',
      );
    }
    // Also validates that state is a known protocol state.
    attempt.state;
    return attempt;
  }

  Future<ProductMutationAttempt> prepare(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) async {
    await _checkScope(scope);
    if (command.containsKey('scope') &&
        productCanonicalJson(command['scope']) !=
            productCanonicalJson(scope.toJson())) {
      throw StateError('Escopo do comando diverge da tentativa.');
    }
    final normalized = normalizeProductCommand(operation, {
      ...command,
      'scope': scope.toJson(),
    });
    final key = _key(scope, operation, normalized['requestId'] as String);
    final encoded = productCanonicalJson({
      'ledgerVersion': 1,
      'scope': scope.toJson(),
      'operation': operation,
      'command': normalized,
      'commandHash': productCommandHash(operation, normalized),
      'state': ProductAttemptState.persisted.name,
      'createdAt': DateTime.now().toUtc().toIso8601String(),
    });
    if (!await store.compareAndSet(key, null, encoded)) {
      final previous = await load(
        scope,
        operation,
        normalized['requestId'] as String,
      );
      if (previous.commandHash != productCommandHash(operation, normalized) ||
          productCanonicalJson(previous.payload) !=
              productCanonicalJson(normalized)) {
        throw StateError('requestId já persistido com outro comando.');
      }
      return previous;
    }
    return _decode(encoded, scope);
  }

  Future<ProductMutationAttempt> load(
    ProductMutationScope scope,
    String operation,
    String requestId,
  ) async {
    await _checkScope(scope);
    final encoded = await store.read(_key(scope, operation, requestId));
    if (encoded == null) {
      throw StateError('Tentativa não encontrada no ledger.');
    }
    final attempt = _decode(encoded, scope);
    if (attempt.operation != operation || attempt.requestId != requestId) {
      throw const FormatException('Identidade corrompida.');
    }
    return attempt;
  }

  Future<ProductMutationAttempt> _transition(
    ProductMutationScope scope,
    String operation,
    String requestId,
    ProductAttemptState next, {
    Map<String, dynamic>? outcome,
  }) async {
    final key = _key(scope, operation, requestId);
    for (var retry = 0; retry < 20; retry++) {
      final previous = await load(scope, operation, requestId);
      if ({
        ProductAttemptState.confirmed,
        ProductAttemptState.rejected,
        ProductAttemptState.identityConflict,
      }.contains(previous.state)) {
        return previous;
      }
      final record = previous._record;
      record['state'] = next.name;
      record['updatedAt'] = DateTime.now().toUtc().toIso8601String();
      if (outcome != null) record['outcome'] = outcome;
      final encoded = productCanonicalJson(record);
      if (await store.compareAndSet(key, previous._encoded, encoded)) {
        return _decode(encoded, scope);
      }
    }
    throw StateError('Concorrência local excessiva. Tentativa preservada.');
  }

  Future<List<ProductMutationAttempt>> reopen(
    ProductMutationScope scope,
  ) async {
    await _checkScope(scope);
    final attempts = <ProductMutationAttempt>[];
    for (final key in await store.keys(scope.prefix)) {
      final raw = await store.read(key);
      if (raw == null) throw const FormatException('Tentativa desapareceu.');
      var attempt = _decode(raw, scope);
      if (key != _key(scope, attempt.operation, attempt.requestId)) {
        throw const FormatException('Chave corrompida.');
      }
      if (attempt.state == ProductAttemptState.sending) {
        attempt = await _transition(
          scope,
          attempt.operation,
          attempt.requestId,
          ProductAttemptState.unknown,
        );
      }
      attempts.add(attempt);
    }
    return attempts;
  }

  bool _confirmed(
    Map<String, dynamic> result,
    ProductMutationAttempt attempt,
  ) =>
      result['success'] == true &&
      result['productId'] == attempt.payload['productId'] &&
      result['requestId'] == attempt.requestId;

  Future<ProductMutationAttempt> send(
    ProductMutationScope scope,
    String operation,
    String requestId,
  ) async {
    await _checkScope(scope);
    var attempt = await load(scope, operation, requestId);
    if ({
      ProductAttemptState.confirmed,
      ProductAttemptState.rejected,
      ProductAttemptState.identityConflict,
    }.contains(attempt.state)) {
      return attempt;
    }
    // Persistence failure here prevents any network call. A crash after this
    // commit is conservatively recovered as unknown, never a new command.
    attempt = await _transition(
      scope,
      operation,
      requestId,
      ProductAttemptState.sending,
    );
    if (attempt.state != ProductAttemptState.sending) return attempt;
    await _checkScope(scope);
    Map<String, dynamic> result;
    try {
      result = await transport.send(scope, operation, attempt.payload);
    } catch (_) {
      // Even an apparent terminal exception is ambiguous unless the server
      // recovery protocol proves it. Do not synthesize rejected-no-commit.
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.unknown,
      );
    }
    if (_confirmed(result, attempt)) {
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.confirmed,
        outcome: {'status': 'confirmed', 'result': result},
      );
    }
    return _transition(
      scope,
      operation,
      requestId,
      ProductAttemptState.unknown,
    );
  }

  Future<ProductMutationAttempt> recover(
    ProductMutationScope scope,
    String operation,
    String requestId,
  ) async {
    await _checkScope(scope);
    final attempt = await load(scope, operation, requestId);
    if ({
      ProductAttemptState.confirmed,
      ProductAttemptState.rejected,
      ProductAttemptState.identityConflict,
    }.contains(attempt.state)) {
      return attempt;
    }
    Map<String, dynamic> outcome;
    try {
      outcome = await transport.recover(scope, operation, attempt.payload);
    } catch (_) {
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.unknown,
      );
    }
    final status = outcome['status'];
    if (outcome['requestId'] != requestId ||
        outcome['productId'] != attempt.payload['productId'] ||
        outcome['operation'] != operation) {
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.unknown,
      );
    }
    if (status == 'confirmed' &&
        outcome['definitive'] == true &&
        outcome['result'] is Map &&
        _confirmed(requireObject(outcome['result']), attempt)) {
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.confirmed,
        outcome: outcome,
      );
    }
    if (status == 'rejected' &&
        outcome['definitive'] == true &&
        outcome['error'] is Map) {
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.rejected,
        outcome: outcome,
      );
    }
    if (status == 'identity-conflict' && outcome['definitive'] == true) {
      return _transition(
        scope,
        operation,
        requestId,
        ProductAttemptState.identityConflict,
        outcome: outcome,
      );
    }
    return _transition(
      scope,
      operation,
      requestId,
      ProductAttemptState.unknown,
    );
  }
}
