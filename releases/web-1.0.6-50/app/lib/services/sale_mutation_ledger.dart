import 'dart:convert';
import '../data/local/sale_mutation_store.dart';
import '../data/local/contextual_sale_mutation_store.dart';
import 'sale_mutation_command.dart';
import 'sale_associated_reservation.dart';

enum SaleAttemptState {
  persisted,
  sending,
  unknown,
  confirmed,
  rejected,
  identityConflict,
}

class SaleMutationAttempt {
  final String _encoded;
  SaleMutationAttempt._(this._encoded);
  Map<String, dynamic> get _record => saleObject(jsonDecode(_encoded));
  String get intentKey => _record['intentKey'] as String;
  SaleMutationCommand get command =>
      SaleMutationCommand.fromJson(saleObject(_record['command']));
  String get requestId => command.requestId;
  Map<String, dynamic> get payload => command.payload;
  SaleAttemptState get state =>
      SaleAttemptState.values.byName(_record['state'] as String);
  bool get prepared => _record['prepared'] == true;
  Map<String, dynamic>? get outcome =>
      _record['outcome'] == null ? null : saleObject(_record['outcome']);
  bool get terminal => {
    SaleAttemptState.confirmed,
    SaleAttemptState.rejected,
    SaleAttemptState.identityConflict,
  }.contains(state);
}

abstract interface class SaleMutationTransport {
  Future<Map<String, dynamic>> send(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  );
  Future<Map<String, dynamic>> recover(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  );
}

class SaleAssociatedReservationResult {
  final SaleAssociationStatus status;
  final SaleMutationAttempt? attempt;
  final bool candidatePersisted;
  final String? reason;
  SaleAssociatedReservationResult._(
    this.status,
    this.attempt,
    this.candidatePersisted, [
    this.reason,
  ]);
}

// No checkout integration and no in-memory persistence fallback.
class SaleMutationLedger {
  final SaleMutationStore store;
  final SaleMutationTransport transport;
  final Future<SaleMutationScope?> Function() activeScope;
  final DateTime Function() now;
  final Duration callTimeout;
  final bool allowUnknownResend;
  SaleMutationLedger({
    required this.store,
    required this.transport,
    required this.activeScope,
    DateTime Function()? now,
    this.callTimeout = const Duration(seconds: 30),
    this.allowUnknownResend = true,
  }) : now = now ?? DateTime.now {
    if (callTimeout <= Duration.zero) throw ArgumentError('Timeout inválido.');
  }
  String _key(SaleMutationScope scope, String intentKey) =>
      '${scope.prefix}confirmSaleV2:${base64Url.encode(utf8.encode(saleId(intentKey)))}';
  Future<void> _checkScope(SaleMutationScope scope) async {
    if ((await activeScope())?.prefix != scope.prefix) {
      throw StateError('Venda suspensa: conta, loja ou projeto mudou.');
    }
  }

  String _seal(Map<String, dynamic> record) {
    record.remove('recordHash');
    return saleJson({...record, 'recordHash': saleHash(record)});
  }

  SaleMutationAttempt _decode(
    String raw,
    SaleMutationScope scope,
    String intentKey,
  ) {
    final attempt = SaleMutationAttempt._(raw);
    final record = attempt._record;
    final hash = record.remove('recordHash');
    if (hash != saleHash(record) ||
        record['ledgerVersion'] != 1 ||
        record['protocol'] != 'sale-v2' ||
        record['operation'] != 'confirmSaleV2' ||
        record['intentKey'] != intentKey ||
        record['prepared'] is! bool ||
        saleJson(record['scope']) != saleJson(scope.toJson()) ||
        attempt.command.scope.prefix != scope.prefix ||
        record['requestId'] != attempt.requestId ||
        record['saleId'] != attempt.requestId ||
        record['commandHash'] != attempt.command.integrityHash ||
        saleJson(record['command']) != saleJson(attempt.payload) ||
        record['attempts'] is! int ||
        (record['attempts'] as int) < 0 ||
        record['leaseUntilMs'] is! int ||
        (record['claim'] != null && record['claim'] is! String)) {
      throw const FormatException(
        'Ledger de vendas corrompido. Reconciliação necessária.',
      );
    }
    attempt.state;
    if (attempt.terminal &&
        _resultState(attempt, attempt.outcome ?? {}) != attempt.state) {
      throw const FormatException('Resultado durável incompatível.');
    }
    return attempt;
  }

  void _validateIntentFields(Map<String, dynamic> intent) {
    if (intent.keys.any(
      (k) => !{
        'items',
        'expectedTotalCents',
        'paymentMethod',
        'payments',
        'notes',
        'customerId',
      }.contains(k),
    )) {
      throw const FormatException('Campos de intenção inválidos.');
    }
  }

  SaleMutationCommand _command(
    SaleMutationScope scope,
    String identity,
    Map<String, dynamic> intent,
  ) {
    _validateIntentFields(intent);
    return SaleMutationCommand.fromJson({
      ...intent,
      'schemaVersion': 2,
      'requestId': identity,
      'saleId': identity,
      'scope': scope.toJson(),
      'origin': 'online',
      'saleKind': 'instant',
    });
  }

  SaleMutationCommand _reservationCommand(
    SaleMutationScope scope,
    Map<String, dynamic> intent, [
    SaleMutationAttempt? existing,
  ]) => _command(
    scope,
    existing?.requestId ?? SaleMutationCommand.newIdentity(),
    intent,
  );

  String _initialRecord(SaleMutationCommand command, String intentKey) =>
      _seal({
        'ledgerVersion': 1,
        'protocol': 'sale-v2',
        'operation': 'confirmSaleV2',
        'intentKey': intentKey,
        'scope': command.scope.toJson(),
        'requestId': command.requestId,
        'saleId': command.requestId,
        'command': command.payload,
        'commandHash': command.integrityHash,
        'state': SaleAttemptState.persisted.name,
        'prepared': false,
        'outcome': null,
        'createdAtMs': now().millisecondsSinceEpoch,
        'updatedAtMs': now().millisecondsSinceEpoch,
        'attempts': 0,
        'claim': null,
        'leaseUntilMs': 0,
      });

  // The caller supplies a stable, recoverable commercial-intent key, never a
  // content hash. This first atomic commit reserves identity AND original payload.
  // If the future is interrupted after commit, reserve/load by the same key resumes it.
  Future<SaleMutationAttempt> reserve(
    SaleMutationScope scope,
    String intentKey,
    Map<String, dynamic> intent,
  ) async {
    await _checkScope(scope);
    _validateIntentFields(intent);
    final key = _key(scope, intentKey);
    final existingRaw = await store.read(key);
    final existing = existingRaw == null
        ? null
        : _decode(existingRaw, scope, intentKey);
    final command = _reservationCommand(scope, intent, existing);
    if (existing != null) {
      if (saleJson(command.payload) != saleJson(existing.payload)) {
        throw StateError(
          'Intenção já reservada com outro comando. Reconciliação necessária.',
        );
      }
      return existing;
    }
    final raw = _initialRecord(command, intentKey);
    if (await store.compareAndSet(key, null, raw)) {
      return _decode(raw, scope, intentKey);
    }
    final previous = await load(scope, intentKey);
    final comparable = command.payload;
    comparable['requestId'] = previous.requestId;
    comparable['saleId'] = previous.requestId;
    if (saleJson(comparable) != saleJson(previous.payload)) {
      throw StateError(
        'Intenção já reservada com outro comando. Reconciliação necessária.',
      );
    }
    return previous;
  }

  /// Local associated reservation only. No prepare/send/recover, no V1 repair.
  /// A conflict is returned only after its diagnostic evidence has committed.
  Future<SaleAssociatedReservationResult> reserveAssociated(
    SaleAssociationRequest request,
  ) async {
    final atomic = requireAtomicSaleMutationStore(store);
    final contextual = store;
    if (contextual is! ContextualAtomicSaleStore ||
        !contextual.context.same(request.context)) {
      throw StateError(
        'Associated reservation requires its fixed contextual atomic store.',
      );
    }
    contextual.checkCurrent();
    final scope = request.context.scope;
    final intentKey = request.intentKey;
    final candidateId = request.candidateId;
    // Validation/freezing occurs synchronously, before the first scope await.
    final normalized = _command(scope, intentKey, request.intent).payload;
    final intent = {
      for (final field in [
        'items',
        'expectedTotalCents',
        'paymentMethod',
        'notes',
        'customerId',
      ])
        field: normalized[field],
      if (normalized.containsKey('payments')) 'payments': normalized['payments'],
    };
    final mayCreate = request.takeCreationPermit();
    final ledgerKey = _key(scope, intentKey);
    final bindingKey = '${scope.prefix}checkout-binding:$intentKey';
    String candidateKey(String id) =>
        '${scope.prefix}checkout-candidate:${saleId(id)}';
    final evidenceKey = candidateKey(candidateId);
    final evidence = sealSaleAssociation({
      ...saleAssociationMetadata(request, 'candidate'),
      'candidateId': candidateId,
      'intent': intent,
    });
    var observedExisting = false;
    for (var retry = 0; retry < 8; retry++) {
      await _checkScope(scope);
      contextual.checkCurrent();
      // The binding reveals the original diagnostic key. Recheck its exact bytes
      // in the write transaction; contention restarts only this read, never an ID.
      final before = await atomic.readSnapshot(
        SaleAtomicScope(namespace: scope.prefix, keys: [bindingKey]),
      );
      final expectedBinding = before.values[bindingKey];
      String? originalId;
      if (expectedBinding != null) {
        observedExisting = true;
        try {
          originalId = saleId(
            decodeSaleAssociation(
              expectedBinding,
              request,
              'binding',
            )['originalCandidateId'],
          );
        } on FormatException {
          /* Classified conservatively inside the transaction. */
        }
      }
      final keys = {
        ledgerKey,
        bindingKey,
        evidenceKey,
        if (originalId != null) candidateKey(originalId),
      };
      final commit = await atomic.transact<SaleAssociatedReservationResult?>(
        SaleAtomicScope(namespace: scope.prefix, keys: keys),
        (snapshot) {
          if (snapshot.values[bindingKey] != expectedBinding) {
            return SaleAtomicPlan(writes: {}, value: null);
          }
          final savedCandidate = snapshot.values[evidenceKey];
          final diagnostic = savedCandidate == null
              ? {evidenceKey: evidence}
              : <String, String>{};
          final candidateMatches =
              savedCandidate == null || savedCandidate == evidence;
          SaleAtomicPlan<SaleAssociatedReservationResult?> blocked(
            String reason,
          ) => SaleAtomicPlan(
            writes: candidateMatches ? diagnostic : {},
            value: SaleAssociatedReservationResult._(
              SaleAssociationStatus.blocked,
              null,
              candidateMatches,
              candidateMatches ? reason : 'candidateIdentityConflict',
            ),
          );
          if (!candidateMatches) return blocked('candidateIdentityConflict');
          final raw = snapshot.values[ledgerKey];
          final bindingRaw = snapshot.values[bindingKey];
          if (raw == null &&
              bindingRaw == null &&
              savedCandidate == null &&
              mayCreate &&
              !observedExisting) {
            final command = _reservationCommand(scope, intent);
            final initial = _initialRecord(command, intentKey);
            final binding = sealSaleAssociation({
              ...saleAssociationMetadata(request, 'binding'),
              'ledgerKey': ledgerKey,
              'commandHash': command.integrityHash,
              'originalCandidateId': candidateId,
            });
            return SaleAtomicPlan(
              writes: {
                evidenceKey: evidence,
                bindingKey: binding,
                ledgerKey: initial,
              },
              value: SaleAssociatedReservationResult._(
                SaleAssociationStatus.created,
                _decode(initial, scope, intentKey),
                true,
              ),
            );
          }
          if (raw == null || bindingRaw == null) {
            return blocked('partialOrMissingAssociation');
          }
          SaleMutationAttempt original;
          Map<String, dynamic> binding;
          try {
            binding = decodeSaleAssociation(bindingRaw, request, 'binding');
            original = _decode(raw, scope, intentKey);
            if (binding['ledgerKey'] != ledgerKey ||
                binding['commandHash'] != original.command.integrityHash ||
                originalId == null ||
                binding['originalCandidateId'] != originalId) {
              return blocked('associationReferenceMismatch');
            }
            final originRaw = snapshot.values[candidateKey(originalId)];
            if (originRaw == null) return blocked('missingOriginalCandidate');
            final origin = decodeSaleAssociation(
              originRaw,
              request,
              'candidate',
            );
            if (origin['candidateId'] != originalId ||
                saleJson(
                      _command(
                        scope,
                        original.requestId,
                        saleObject(origin['intent']),
                      ).payload,
                    ) !=
                    saleJson(original.payload)) {
              return blocked('originalCandidateMismatch');
            }
          } on FormatException {
            return blocked('invalidOrHistoricalAssociation');
          } on ArgumentError {
            return blocked('invalidOrHistoricalAssociation');
          } on TypeError {
            return blocked('invalidOrHistoricalAssociation');
          }
          final equivalent =
              saleJson(_command(scope, original.requestId, intent).payload) ==
              saleJson(original.payload);
          return SaleAtomicPlan(
            writes: diagnostic,
            value: SaleAssociatedReservationResult._(
              equivalent
                  ? SaleAssociationStatus.adopted
                  : SaleAssociationStatus.conflict,
              original,
              true,
              equivalent ? null : 'immutableCommandConflict',
            ),
          );
        },
      );
      if (commit.value != null) {
        await _checkScope(scope);
        contextual.checkCurrent();
        return commit.value!;
      }
    }
    throw StateError('Association contention; original intention preserved.');
  }

  Future<SaleMutationAttempt> load(
    SaleMutationScope scope,
    String intentKey,
  ) async {
    final raw = await store.read(_key(scope, intentKey));
    if (raw == null) throw StateError('Intenção não encontrada.');
    return _decode(raw, scope, intentKey);
  }

  Future<SaleMutationAttempt> _update(
    SaleMutationScope scope,
    String intentKey,
    void Function(Map<String, dynamic>) update, {
    String? claim,
  }) async {
    for (var retry = 0; retry < 20; retry++) {
      final previous = await load(scope, intentKey);
      if (previous.terminal ||
          (claim != null && previous._record['claim'] != claim)) {
        return previous;
      }
      final record = previous._record;
      update(record);
      record['updatedAtMs'] = now().millisecondsSinceEpoch;
      final raw = _seal(record);
      if (await store.compareAndSet(
        _key(scope, intentKey),
        previous._encoded,
        raw,
      )) {
        return _decode(raw, scope, intentKey);
      }
    }
    throw StateError('Concorrência excessiva. Intenção preservada.');
  }

  Future<SaleMutationAttempt> prepare(
    SaleMutationScope scope,
    String intentKey,
  ) async {
    await _checkScope(scope);
    return _update(scope, intentKey, (r) => r['prepared'] = true);
  }

  Future<List<SaleMutationAttempt>> reopen(SaleMutationScope scope) async {
    final attempts = <SaleMutationAttempt>[];
    for (final key in await store.keys('${scope.prefix}confirmSaleV2:')) {
      final raw = await store.read(key);
      if (raw == null) throw const FormatException('Registro desapareceu.');
      final intentKey = saleObject(jsonDecode(raw))['intentKey'] as String;
      if (key != _key(scope, intentKey)) {
        throw const FormatException('Chave corrompida.');
      }
      var attempt = _decode(raw, scope, intentKey);
      if (attempt.state == SaleAttemptState.sending) {
        // Preserve claim lease: opening another tab must not immediately steal
        // an active writer. Queries remain safe while a previous call is in flight.
        attempt = await _update(
          scope,
          intentKey,
          (r) => r['state'] = SaleAttemptState.unknown.name,
        );
      }
      attempts.add(attempt);
    }
    return attempts;
  }

  SaleAttemptState? _resultState(
    SaleMutationAttempt attempt,
    Map<String, dynamic> result,
  ) {
    if (result['saleId'] != attempt.requestId) return null;
    switch (result['status']) {
      case 'confirmed':
        if (result['totalCents'] == attempt.payload['expectedTotalCents'] &&
            result['replayed'] is bool) {
          return SaleAttemptState.confirmed;
        }
      case 'rejected':
        if (result['reason'] is String &&
            (result['reason'] as String).isNotEmpty &&
            result['replayed'] is bool) {
          return SaleAttemptState.rejected;
        }
      case 'identity-conflict':
        return SaleAttemptState.identityConflict;
    }
    return null;
  }

  Future<SaleMutationAttempt> _accept(
    SaleMutationScope scope,
    String intentKey,
    SaleMutationAttempt attempt,
    Map<String, dynamic>? result, {
    String? claim,
  }) {
    final state = result == null ? null : _resultState(attempt, result);
    return _update(scope, intentKey, (r) {
      r['state'] = (state ?? SaleAttemptState.unknown).name;
      if (state != null) r['outcome'] = result;
      // A query with no result must not release another instance's writer lease.
      if (state != null || claim != null) {
        r['claim'] = null;
        r['leaseUntilMs'] = 0;
      }
    }, claim: state == null ? claim : null);
  }

  Future<SaleMutationAttempt> recover(
    SaleMutationScope scope,
    String intentKey,
  ) async {
    await _checkScope(scope);
    final attempt = await load(scope, intentKey);
    if (attempt.terminal) return attempt;
    Map<String, dynamic>? result;
    try {
      await _checkScope(scope);
      result = await transport
          .recover(scope, attempt.payload)
          .timeout(callTimeout);
    } catch (_) {
      return _accept(scope, intentKey, attempt, null);
    }
    return _accept(scope, intentKey, attempt, result);
  }

  Future<SaleMutationAttempt> send(
    SaleMutationScope scope,
    String intentKey,
  ) async {
    await _checkScope(scope);
    var attempt = await load(scope, intentKey);
    if (attempt.terminal || attempt.state == SaleAttemptState.sending) {
      return attempt;
    }
    if (!attempt.prepared) throw StateError('Preparar ledger antes do envio.');
    // An uncertain operation always queries using the original full command.
    if (attempt.state == SaleAttemptState.unknown) {
      if (!allowUnknownResend) return recover(scope, intentKey);
      // Only an explicit not-recorded permits retry. A failed/malformed query
      // must not silently authorize another writer invocation.
      return _queryForRetry(scope, intentKey);
    }
    return _claimAndSend(scope, intentKey, attempt);
  }

  Future<SaleMutationAttempt> _queryForRetry(
    SaleMutationScope scope,
    String intentKey,
  ) async {
    await _checkScope(scope);
    final attempt = await load(scope, intentKey);
    if (attempt.terminal) return attempt;
    Map<String, dynamic> result;
    try {
      await _checkScope(scope);
      result = await transport
          .recover(scope, attempt.payload)
          .timeout(callTimeout);
    } catch (_) {
      return _accept(scope, intentKey, attempt, null);
    }
    if (result['status'] != 'not-recorded' ||
        result['definitive'] != false ||
        result['saleId'] != attempt.requestId) {
      return _accept(scope, intentKey, attempt, result);
    }
    return _claimAndSend(scope, intentKey, await load(scope, intentKey));
  }

  Future<SaleMutationAttempt> _claimAndSend(
    SaleMutationScope scope,
    String intentKey,
    SaleMutationAttempt attempt,
  ) async {
    if (attempt.terminal ||
        (attempt._record['leaseUntilMs'] as int) >
            now().millisecondsSinceEpoch) {
      return attempt;
    }
    await _checkScope(scope);
    final claim = SaleMutationCommand.newIdentity();
    final record = attempt._record;
    record['claim'] = claim;
    record['state'] = SaleAttemptState.sending.name;
    record['attempts'] = (record['attempts'] as int) + 1;
    record['leaseUntilMs'] = now()
        .add(callTimeout + const Duration(seconds: 5))
        .millisecondsSinceEpoch;
    record['updatedAtMs'] = now().millisecondsSinceEpoch;
    final raw = _seal(record);
    if (!await store.compareAndSet(
      _key(scope, intentKey),
      attempt._encoded,
      raw,
    )) {
      return load(scope, intentKey);
    }
    Map<String, dynamic>? result;
    try {
      await _checkScope(scope);
      result = await transport
          .send(scope, attempt.payload)
          .timeout(callTimeout);
    } catch (_) {
      return _accept(scope, intentKey, attempt, null, claim: claim);
    }
    // Local commit errors propagate; a remote confirmation is never returned as
    // durably confirmed if its persistence failed. Reopen queries the same ID.
    return _accept(scope, intentKey, attempt, result, claim: claim);
  }
}
