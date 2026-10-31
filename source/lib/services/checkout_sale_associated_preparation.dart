part of 'checkout_sale_preparation.dart';

/// Explicit V2 path. Distinct types prevent accidental use by V1 persist/consult
/// or the historical confirmation/UI gate. A candidate has no sale identity.
class CheckoutAssociatedCandidate {
  final CheckoutSaleReference reference;
  final _CheckoutTicket _ticket;
  final SaleAssociationRequest _request;
  Future<CheckoutAssociatedHandle>? _pending;
  CheckoutAssociatedCandidate._(this.reference, this._ticket, this._request);
  String get candidateId => _request.candidateId;
  Map<String, dynamic> get draft => _request.intent;
}

/// Associated local evidence; never authorization to send or clear a cart.
class CheckoutAssociatedHandle {
  final CheckoutSaleReference reference;
  final SaleMutationAttempt attempt;
  final CheckoutSalePreparation _owner;
  final _CheckoutTicket _ticket;
  CheckoutAssociatedHandle._(
    this.reference, this.attempt, this._owner, this._ticket,
  );
}

class CheckoutAssociatedConflict implements Exception {
  final CheckoutAssociatedCandidate candidate;
  final SaleMutationAttempt original;
  final bool candidatePersisted;
  CheckoutAssociatedConflict._(
    this.candidate,
    this.original,
    this.candidatePersisted,
  );
  @override
  String toString() =>
      'Associated checkout candidate conflicts with the durable command.';
}

class CheckoutAssociatedBlocked implements Exception {
  final CheckoutSaleReference reference;
  final CheckoutAssociatedCandidate? candidate;
  final String reason;
  final bool candidatePersisted;
  CheckoutAssociatedBlocked._(
    this.reference,
    this.reason, {
    this.candidate,
    this.candidatePersisted = false,
  });
  @override
  String toString() => 'Associated checkout blocked: $reason.';
}

/// Additive, isolated API: V1 methods above remain unchanged. No SDK observation,
/// commercial dispatch, UI callbacks or storage lifecycle ownership.
extension AssociatedCheckoutSalePreparation on CheckoutSalePreparation {
  SaleStoreContext _associatedContext(CheckoutSaleReference ref) =>
      SaleStoreContext(scope: ref.context.scope, target: ref.context.target);

  ContextualAtomicSaleStore _associatedView(
    CheckoutSaleReference ref,
    _CheckoutTicket ticket,
  ) => ContextualAtomicSaleStore(
    store: _store,
    context: _associatedContext(ref),
    checkCurrent: () => _check(ticket),
  );

  CheckoutAssociatedCandidate newAssociatedPurchase(
    Map<String, dynamic> draft,
  ) {
    requireAtomicSaleMutationStore(_store);
    final captured = session._capture();
    final ref = CheckoutSaleReference(
      context: captured.context,
      intentKey: SaleMutationCommand.newIdentity(),
    );
    // Reuse the existing canonical normalizer; freeze before any await/attach.
    final frozen = _normalizeDraft(ref, draft);
    session.attach(ref);
    return CheckoutAssociatedCandidate._(
      ref,
      session._capture(),
      SaleAssociationRequest.newIntention(
        context: _associatedContext(ref),
        intentKey: ref.intentKey,
        candidateId: SaleMutationCommand.newIdentity(),
        intent: frozen,
      ),
    );
  }

  CheckoutAssociatedCandidate candidateForAssociatedIntention(
    CheckoutSaleReference ref,
    Map<String, dynamic> draft,
  ) {
    requireAtomicSaleMutationStore(_store);
    final ticket = _ticketFor(ref);
    return CheckoutAssociatedCandidate._(
      ref,
      ticket,
      SaleAssociationRequest.forExisting(
        context: _associatedContext(ref),
        intentKey: ref.intentKey,
        candidateId: SaleMutationCommand.newIdentity(),
        intent: _normalizeDraft(ref, draft),
      ),
    );
  }

  Future<CheckoutAssociatedHandle> persistAssociated(
    CheckoutAssociatedCandidate candidate,
  ) async {
    _check(candidate._ticket);
    final pending = candidate._pending;
    if (pending != null) return pending;
    final operation = _persistAssociatedCandidate(candidate);
    candidate._pending = operation;
    try {
      return await operation;
    } finally {
      candidate._pending = null;
    }
  }

  Future<CheckoutAssociatedHandle> _persistAssociatedCandidate(
    CheckoutAssociatedCandidate candidate, {
    bool resumeOnly = false,
  }) async {
    final ref = candidate.reference;
    final ticket = candidate._ticket;
    _check(ticket);
    final ledger = SaleMutationLedger(
      store: resumeOnly
          ? _CheckoutAssociatedResumeView(
              _store,
              _associatedContext(ref),
              () => _check(ticket),
              ref,
            )
          : _associatedView(ref, ticket),
      activeScope: () async {
        _check(ticket);
        return ref.context.scope;
      },
      // Even an injected legacy lookup is not connected to this path.
      transport: _LookupOnly(null, () => _check(ticket)),
    );
    final result = await ledger.reserveAssociated(candidate._request);
    _check(ticket);
    switch (result.status) {
      case SaleAssociationStatus.created:
      case SaleAssociationStatus.adopted:
        return CheckoutAssociatedHandle._(ref, result.attempt!, this, ticket);
      case SaleAssociationStatus.conflict:
        // Raised only AFTER the ledger committed the diagnostic evidence.
        throw CheckoutAssociatedConflict._(
          candidate,
          result.attempt!,
          result.candidatePersisted,
        );
      case SaleAssociationStatus.blocked:
        throw CheckoutAssociatedBlocked._(
          ref,
          result.reason ?? 'invalidAssociation',
          candidate: candidate,
          candidatePersisted: result.candidatePersisted,
        );
    }
  }

  Map<String, dynamic> _associatedEvidence(
    String? raw,
    CheckoutSaleReference ref,
    String kind,
  ) {
    if (raw == null) {
      throw const FormatException('Missing associated evidence.');
    }
    // Metadata probe only, never passed to reserveAssociated or normalized as a
    // commercial draft. No sale ID is allocated to inspect evidence.
    final probe = SaleAssociationRequest.forExisting(
      context: _associatedContext(ref),
      intentKey: ref.intentKey,
      candidateId: 'metadata-probe',
      intent: {},
    );
    return decodeSaleAssociation(raw, probe, kind);
  }

  /// No caller/cart draft and no new candidate identity. Load the original V2
  /// evidence, then require the ledger's consistent validation of the full set.
  /// Missing/V1/partial data is never promoted or repaired.
  Future<CheckoutAssociatedHandle> resumeAssociated(
    CheckoutSaleReference ref,
  ) async {
    final ticket = _ticketFor(ref);
    final view = _associatedView(ref, ticket);
    final bindingKey = _bindingKey(ref);
    final observed = await view.readSnapshot(
      SaleAtomicScope(namespace: ref.context.scope.prefix, keys: [bindingKey]),
    );
    final bindingRaw = observed.values[bindingKey];
    late Map<String, dynamic> binding;
    late String originalId;
    try {
      binding = _associatedEvidence(bindingRaw, ref, 'binding');
      originalId = saleId(binding['originalCandidateId']);
    } on FormatException {
      throw CheckoutAssociatedBlocked._(
        ref,
        'missingInvalidOrHistoricalBinding',
      );
    }
    final candidateKey = _candidateKey(ref, originalId);
    final snapshot = await view.readSnapshot(
      SaleAtomicScope(
        namespace: ref.context.scope.prefix,
        keys: [bindingKey, candidateKey],
      ),
    );
    if (snapshot.values[bindingKey] != bindingRaw) {
      throw CheckoutAssociatedBlocked._(ref, 'associationChangedDuringResume');
    }
    late CheckoutAssociatedCandidate candidate;
    try {
      final evidence = _associatedEvidence(
        snapshot.values[candidateKey],
        ref,
        'candidate',
      );
      if (evidence['candidateId'] != originalId) {
        throw const FormatException('Original candidate mismatch.');
      }
      candidate = CheckoutAssociatedCandidate._(
        ref,
        ticket,
        SaleAssociationRequest.forExisting(
          context: _associatedContext(ref),
          intentKey: ref.intentKey,
          candidateId: originalId,
          intent: _normalizeDraft(ref, saleObject(evidence['intent'])),
        ),
      );
    } on FormatException {
      throw CheckoutAssociatedBlocked._(
        ref,
        'missingOrInvalidOriginalCandidate',
      );
    }
    _check(ticket);
    return _persistAssociatedCandidate(candidate, resumeOnly: true);
  }

  Future<Map<String, dynamic>> readAssociatedCandidate(
    CheckoutSaleReference ref,
    String candidateId,
  ) async {
    final ticket = _ticketFor(ref);
    final id = saleId(candidateId);
    final key = _candidateKey(ref, id);
    final snapshot = await _associatedView(ref, ticket).readSnapshot(
      SaleAtomicScope(namespace: ref.context.scope.prefix, keys: [key]),
    );
    final evidence = _associatedEvidence(
      snapshot.values[key],
      ref,
      'candidate',
    );
    if (evidence['candidateId'] != id) {
      throw const FormatException('Candidate mismatch.');
    }
    _check(ticket);
    return evidence; // Detached diagnostic evidence, no sending authority.
  }

  Future<_CheckoutAssociatedRecoveryView> _validatedAssociatedView(
    CheckoutAssociatedHandle handle,
  ) async {
    if (!identical(handle._owner, this)) {
      throw StateError('Associated handle belongs to another preparation.');
    }
    final ticket = handle._ticket;
    final ref = handle.reference;
    _check(ticket);
    if (!ticket.context.same(ref.context)) {
      throw StateError('Associated handle context mismatch.');
    }
    final current = await resumeAssociated(ref);
    _check(ticket);
    if (saleJson(current.attempt.payload) != saleJson(handle.attempt.payload)) {
      throw const FormatException('Associated command changed.');
    }
    final view = _associatedView(ref, ticket);
    final bindingKey = _bindingKey(ref);
    final bindingRaw = await view.read(bindingKey);
    final binding = _associatedEvidence(bindingRaw, ref, 'binding');
    final candidateKey = _candidateKey(ref, saleId(binding['originalCandidateId']));
    final proof = await view.readSnapshot(SaleAtomicScope(
      namespace: ref.context.scope.prefix, keys: [bindingKey, candidateKey],
    ));
    if (proof.values[bindingKey] != bindingRaw) {
      throw const FormatException('Associated binding changed during lookup preparation.');
    }
    final candidate = _associatedEvidence(proof.values[candidateKey], ref, 'candidate');
    final fields = _normalizeDraft(ref, {
      for (final key in ['items', 'expectedTotalCents', 'paymentMethod', 'notes', 'customerId'])
        key: current.attempt.payload[key],
      if (current.attempt.payload.containsKey('payments')) 'payments': current.attempt.payload['payments'],
    });
    if (binding['commandHash'] != current.attempt.command.integrityHash ||
        candidate['candidateId'] != binding['originalCandidateId'] ||
        saleJson(_normalizeDraft(ref, saleObject(candidate['intent']))) != saleJson(fields)) {
      throw const FormatException('Associated result evidence mismatch.');
    }
    return _CheckoutAssociatedRecoveryView(
      _store, _associatedContext(ref), () => _check(ticket),
      proof.values, binding['ledgerKey'] as String, current.attempt.payload,
    );
  }

  /// Remote lookup only. Never sends, prepares or creates an identity.
  Future<CheckoutAssociatedHandle> consultAssociated(
    CheckoutAssociatedHandle handle,
  ) async {
    final lookup = _associatedLookup;
    if (lookup == null) throw StateError('No associated result lookup configured.');
    final recovery = await _validatedAssociatedView(handle);
    final ref = handle.reference;
    final ticket = handle._ticket;
    final ledger = SaleMutationLedger(
      store: recovery,
      activeScope: () async {
        _check(ticket);
        return ref.context.scope;
      },
      callTimeout: lookupTimeout,
      transport: _LookupOnly((scope, command) async {
        await recovery.read(recovery.canonicalKey);
        _check(ticket);
        final result = await lookup(scope, command);
        _check(ticket);
        await recovery.read(recovery.canonicalKey);
        _check(ticket);
        return result;
      }, () => _check(ticket)),
    );
    await ledger.recover(ref.context.scope, ref.intentKey);
    _check(ticket);
    final result = await resumeAssociated(ref);
    _check(ticket);
    await recovery.read(recovery.canonicalKey);
    _check(ticket);
    return result;
  }

  /// Explicit local/demo composition only. Sends the already durable canonical
  /// command, never the cart/candidate. Unknown/sending only query; no fallback.
  Future<CheckoutAssociatedHandle> dispatchAssociatedLocally(
    CheckoutAssociatedHandle handle,
  ) async {
    if (_associatedLocalSend == null || _associatedLookup == null ||
        !handle.reference.context.scope.projectId.startsWith('demo-')) {
      throw StateError('Associated dispatch requires explicit local/demo transport and recovery.');
    }
    return _dispatchAssociated(handle);
  }

  /// Commercial transport is explicit; the demo entry point keeps its guard.
  Future<CheckoutAssociatedHandle> dispatchAssociatedCommercially(CheckoutAssociatedHandle handle) {
    final context = handle.reference.context;
    final target = saleObject(jsonDecode(context.target));
    final project = context.scope.projectId;
    if (_associatedLocalSend == null || _associatedLookup == null ||
        !['store-connect-hml', 'store-connect-app'].contains(project) ||
        target['environment'] != 'commercial-flutterfire' ||
        target['firestoreEndpoint'] != 'https://firestore.googleapis.com' ||
        target['functionsEndpoint'] != 'https://us-central1-$project.cloudfunctions.net') {
      throw StateError('Commercial checkout destination rejected.');
    }
    return _dispatchAssociated(handle);
  }

  Future<CheckoutAssociatedHandle> _dispatchAssociated(CheckoutAssociatedHandle handle) async {
    final sender = _associatedLocalSend!;
    final proof = await _validatedAssociatedView(handle);
    final ref = handle.reference;
    final ticket = handle._ticket;
    final current = await resumeAssociated(ref);
    _check(ticket);
    if (current.attempt.terminal) return current;
    if (current.attempt.state != SaleAttemptState.persisted) {
      return consultAssociated(current);
    }
    final view = _CheckoutAssociatedDispatchView(
      _store, proof.context, () => _check(ticket), proof._association,
      proof.canonicalKey, current.attempt.payload,
    );
    Future<Map<String, dynamic>> guarded(
      CheckoutResultLookup operation, SaleMutationScope scope,
      Map<String, dynamic> command,
    ) async {
      await view.read(view.canonicalKey);
      _check(ticket);
      final result = await operation(scope, command);
      _check(ticket);
      await view.read(view.canonicalKey);
      return result;
    }
    final ledger = SaleMutationLedger(
      store: view,
      activeScope: () async { _check(ticket); return ref.context.scope; },
      callTimeout: lookupTimeout,
      allowUnknownResend: false,
      transport: _AssociatedLocalTransport(
        (scope, command) => guarded(sender, scope, command),
        (scope, command) => guarded(_associatedLookup!, scope, command),
      ),
    );
    final prepared = await ledger.prepare(ref.context.scope, ref.intentKey);
    _check(ticket);
    if (prepared.state == SaleAttemptState.persisted) {
      await ledger.send(ref.context.scope, ref.intentKey);
    } else if (!prepared.terminal) {
      // Another instance may have sent while this one awaited local persistence.
      await ledger.recover(ref.context.scope, ref.intentKey);
    }
    _check(ticket);
    final result = await resumeAssociated(ref);
    _check(ticket);
    await view.read(view.canonicalKey);
    return result;
  }
}

class _AssociatedLocalTransport implements SaleMutationTransport {
  final CheckoutResultLookup _send;
  final CheckoutResultLookup _lookup;
  _AssociatedLocalTransport(this._send, this._lookup);
  @override
  Future<Map<String, dynamic>> send(SaleMutationScope scope, Map<String, dynamic> command) =>
      _send(scope, command);
  @override
  Future<Map<String, dynamic>> recover(SaleMutationScope scope, Map<String, dynamic> command) =>
      _lookup(scope, command);
}

/// Same borrowed database and canonical record. Association bytes are checked
/// in the SAME atomic transaction as the ledger CAS, including after lookup.
class _CheckoutAssociatedRecoveryView extends ContextualAtomicSaleStore {
  final Map<String, String?> _association;
  final String canonicalKey;
  final String _command;
  _CheckoutAssociatedRecoveryView(
    SaleMutationStore store, SaleStoreContext context, void Function() check,
    Map<String, String?> association, this.canonicalKey, Map<String, dynamic> command,
  ) : _association = Map.unmodifiable(association),
      _command = saleJson(command),
      super(store: store, context: context, checkCurrent: check);

  SaleAtomicScope get _recoveryScope => SaleAtomicScope(
    namespace: context.scope.prefix, keys: [..._association.keys, canonicalKey],
  );
  String _validate(SaleAtomicSnapshot snapshot) {
    if (_association.entries.any((e) => e.value == null || snapshot.values[e.key] != e.value)) {
      throw const FormatException('Associated evidence changed during recovery.');
    }
    final raw = snapshot.values[canonicalKey];
    if (raw == null ||
        saleJson(saleObject(jsonDecode(raw))['command']) != _command) {
      throw const FormatException('Canonical recovery command changed or disappeared.');
    }
    return raw;
  }
  @override
  Future<String?> read(String key) async {
    if (key != canonicalKey) throw StateError('Recovery may only read its canonical ledger key.');
    return _validate(await super.readSnapshot(_recoveryScope));
  }
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    if (key != canonicalKey || expected == null) {
      throw StateError('Recovery cannot create or prepare an intention.');
    }
    return (await super.transact<bool>(_recoveryScope, (snapshot) {
      if (_validate(snapshot) != expected) return SaleAtomicPlan(writes: {}, value: false);
      final previous = saleObject(jsonDecode(expected));
      final next = saleObject(jsonDecode(value));
      if (!['unknown', 'confirmed', 'rejected', 'identityConflict'].contains(next['state'])) {
        throw StateError('Recovery cannot dispatch a sale.');
      }
      for (final field in ['state', 'outcome', 'updatedAtMs', 'claim', 'leaseUntilMs', 'recordHash']) {
        previous.remove(field);
        next.remove(field);
      }
      if (saleJson(previous) != saleJson(next)) {
        throw StateError('Recovery cannot change immutable command or preparation fields.');
      }
      return SaleAtomicPlan(writes: {key: value}, value: true);
    })).value;
  }
}

/// Same association guard as recovery, with the existing ledger's prepare/claim
/// transitions. No new canonical record, binding, candidate or identity allowed.
class _CheckoutAssociatedDispatchView extends _CheckoutAssociatedRecoveryView {
  _CheckoutAssociatedDispatchView(
    super.store, super.context, super.check, super.association,
    super.canonicalKey, super.command,
  );
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    if (key != canonicalKey || expected == null) {
      throw StateError('Dispatch requires an existing canonical intention.');
    }
    return (await super.transact<bool>(_recoveryScope, (snapshot) {
      if (_validate(snapshot) != expected) return SaleAtomicPlan(writes: {}, value: false);
      final previous = saleObject(jsonDecode(expected));
      final next = saleObject(jsonDecode(value));
      if (next['prepared'] != true ||
          !SaleAttemptState.values.any((state) => state.name == next['state'])) {
        throw StateError('Invalid dispatch transition.');
      }
      for (final field in ['state', 'outcome', 'updatedAtMs', 'claim', 'leaseUntilMs',
        'recordHash', 'prepared', 'attempts']) {
        previous.remove(field);
        next.remove(field);
      }
      if (saleJson(previous) != saleJson(next)) {
        throw StateError('Dispatch cannot replace identity or command.');
      }
      return SaleAtomicPlan(writes: {key: value}, value: true);
    })).value;
  }
}

/// A resume cannot recreate even diagnostic data that disappeared after its
/// preliminary reads. The entire proposed write unit is rejected before puts.
class _CheckoutAssociatedResumeView extends ContextualAtomicSaleStore {
  final CheckoutSaleReference reference;
  _CheckoutAssociatedResumeView(
    SaleMutationStore store,
    SaleStoreContext context,
    void Function() check,
    this.reference,
  ) : super(store: store, context: context, checkCurrent: check);

  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) => super.transact(scope, (snapshot) {
    final plan = decide(snapshot);
    if (plan.writes.isNotEmpty) {
      throw CheckoutAssociatedBlocked._(
        reference,
        'associationChangedDuringResume',
      );
    }
    return plan;
  });
}
