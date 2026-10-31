import 'dart:convert';

import '../data/local/contextual_sale_mutation_store.dart';
import '../data/local/sale_mutation_store.dart';
import 'sale_associated_reservation.dart';
import 'sale_mutation_command.dart';
import 'sale_mutation_ledger.dart';

part 'checkout_sale_associated_preparation.dart';

/// Local destination metadata. Never added to the canonical V2 command/hash.
class CheckoutSaleContext {
  final SaleMutationScope scope;
  final String target;
  CheckoutSaleContext({
    required this.scope,
    required String environment,
    required String firestoreEndpoint,
    required String functionsEndpoint,
  }) : target = saleJson({
         'environment': environment,
         'firestoreEndpoint': firestoreEndpoint,
         'functionsEndpoint': functionsEndpoint,
       }) {
    scope.toJson();
    if ([
      environment,
      firestoreEndpoint,
      functionsEndpoint,
    ].any((v) => v.trim().isEmpty)) {
      throw ArgumentError('Incomplete checkout target.');
    }
  }
  bool same(CheckoutSaleContext other) =>
      scope.prefix == other.scope.prefix && target == other.target;
}

/// The future SDK/UI adapter must rotate this on EVERY session, target, screen,
/// or cart revision event, including A -> B -> A. No Firebase observation here.
class CheckoutSaleSession {
  CheckoutSaleContext? _context;
  Object _generation = Object();
  String? _attachedIntentKey;
  CheckoutSaleSession(CheckoutSaleContext context) : _context = context;
  void change(CheckoutSaleContext? context) {
    _context = context;
    _generation = Object();
    _attachedIntentKey = null;
  }

  /// Explicitly bind a reconstructed checkout to a selected durable intention.
  /// Loading/querying a record alone must not authorize clearing the current cart.
  void attach(CheckoutSaleReference ref) {
    if (_context == null || !_context!.same(ref.context)) {
      throw StateError(
        'Cannot attach an intention from another checkout context.',
      );
    }
    _generation = Object();
    _attachedIntentKey = ref.intentKey;
  }

  _CheckoutTicket _capture() {
    final context = _context;
    if (context == null) throw StateError('Checkout session unavailable.');
    return _CheckoutTicket(context, _generation);
  }

  bool _matches(_CheckoutTicket ticket) =>
      identical(_generation, ticket.generation) &&
      _context != null &&
      _context!.same(ticket.context);
}

class _CheckoutTicket {
  final CheckoutSaleContext context;
  final Object generation;
  _CheckoutTicket(this.context, this.generation);
}

class CheckoutSaleReference {
  final CheckoutSaleContext context;
  final String intentKey;
  CheckoutSaleReference({required this.context, required String intentKey})
    : intentKey = saleId(intentKey);
}

class CheckoutSaleCandidate {
  final CheckoutSaleReference reference;
  final String candidateId;
  final _CheckoutTicket _ticket;
  final String _draft;
  final bool _existingOnly;
  bool _started = false;
  CheckoutSaleCandidate._(
    this.reference,
    this._ticket,
    Map<String, dynamic> draft,
    this._existingOnly,
  ) : candidateId = SaleMutationCommand.newIdentity(),
      _draft = saleJson(_normalizeDraft(reference, draft));
  Map<String, dynamic> get draft => saleObject(jsonDecode(_draft));
}

Map<String, dynamic> _normalizeDraft(
  CheckoutSaleReference ref,
  Map<String, dynamic> draft,
) {
  saleKeys(
    draft,
    {'items', 'expectedTotalCents', 'paymentMethod', 'notes', 'customerId', 'payments'},
    {'items', 'expectedTotalCents', 'paymentMethod'},
  );
  final command = SaleMutationCommand.fromJson({
    ...draft,
    'schemaVersion': 2,
    'requestId': ref.intentKey,
    'saleId': ref.intentKey,
    'scope': ref.context.scope.toJson(),
    'origin': 'online',
    'saleKind': 'instant',
  }).payload;
  return {
    for (final key in [
      'items',
      'expectedTotalCents',
      'paymentMethod',
      'notes',
      'customerId',
    ])
      key: command[key],
    if (command.containsKey('payments')) 'payments': command['payments'],
  };
}

class CheckoutSaleHandle {
  final CheckoutSaleReference reference;
  final SaleMutationAttempt attempt;
  final _CheckoutTicket _ticket;
  bool _applied = false;
  CheckoutSaleHandle._(this.reference, this.attempt, this._ticket);
}

class CheckoutSaleConflict implements Exception {
  final CheckoutSaleCandidate candidate;
  final SaleMutationAttempt original;
  CheckoutSaleConflict(this.candidate, this.original);
  @override
  String toString() => 'Checkout candidate conflicts with the durable command.';
}

typedef CheckoutResultLookup =
    Future<Map<String, dynamic>> Function(
      SaleMutationScope scope,
      Map<String, dynamic> frozenCommand,
    );

/// Isolated preparation/recovery, plus explicitly injected demo-only dispatch.
/// No commercial SDK wiring. Storage is borrowed, never opened/migrated here.
class CheckoutSalePreparation {
  final SaleMutationStore _store;
  final CheckoutSaleSession session;
  final CheckoutResultLookup? _lookup;
  final CheckoutResultLookup? _associatedLookup;
  final CheckoutResultLookup? _associatedLocalSend;
  final Duration lookupTimeout;
  CheckoutSalePreparation({
    required SaleMutationStore store,
    required this.session,
    CheckoutResultLookup? lookup,
    CheckoutResultLookup? associatedLookup,
    CheckoutResultLookup? associatedLocalSend,
    this.lookupTimeout = const Duration(seconds: 30),
  }) : _store = store,
       _lookup = lookup,
       _associatedLookup = associatedLookup,
       _associatedLocalSend = associatedLocalSend;

  CheckoutSaleCandidate newPurchase(Map<String, dynamic> draft) {
    var ticket = session._capture();
    final ref = CheckoutSaleReference(
      context: ticket.context,
      intentKey: SaleMutationCommand.newIdentity(),
    );
    // Validate before changing UI association.
    _normalizeDraft(ref, draft);
    session.attach(ref);
    ticket = session._capture();
    return CheckoutSaleCandidate._(ref, ticket, draft, false);
  }

  /// Revising a known candidate never creates a replacement sale identity.
  CheckoutSaleCandidate candidateForExisting(
    CheckoutSaleReference ref,
    Map<String, dynamic> draft,
  ) {
    final ticket = _ticketFor(ref);
    return CheckoutSaleCandidate._(ref, ticket, draft, true);
  }

  _CheckoutTicket _ticketFor(CheckoutSaleReference ref) {
    final ticket = session._capture();
    if (!ticket.context.same(ref.context)) {
      throw StateError('Checkout context mismatch.');
    }
    return ticket;
  }

  void _check(_CheckoutTicket ticket) {
    if (!session._matches(ticket)) {
      throw StateError('Checkout generation changed.');
    }
  }

  SaleMutationStore _view(CheckoutSaleReference ref, _CheckoutTicket ticket) =>
      _CheckoutStoreView(_store, ref.context, () => _check(ticket));
  String _bindingKey(CheckoutSaleReference ref) =>
      '${ref.context.scope.prefix}checkout-binding:${ref.intentKey}';
  String _candidateKey(CheckoutSaleReference ref, String id) =>
      '${ref.context.scope.prefix}checkout-candidate:$id';
  SaleMutationLedger _ledger(
    CheckoutSaleReference ref,
    _CheckoutTicket ticket,
  ) => SaleMutationLedger(
    store: _view(ref, ticket),
    activeScope: () async {
      _check(ticket);
      return ref.context.scope;
    },
    transport: _LookupOnly(_lookup, () => _check(ticket)),
    callTimeout: lookupTimeout,
  );

  Map<String, dynamic> _metadata(CheckoutSaleReference ref) => {
    'version': 1,
    'intentKey': ref.intentKey,
    'scope': ref.context.scope.toJson(),
    'target': ref.context.target,
  };
  String _seal(Map<String, dynamic> record) =>
      saleJson({...record, 'integrity': saleHash(record)});
  Map<String, dynamic> _decode(String? raw, CheckoutSaleReference ref) {
    if (raw == null) {
      throw StateError('Checkout evidence missing; reconciliation required.');
    }
    final record = saleObject(jsonDecode(raw));
    final hash = record.remove('integrity');
    if (hash != saleHash(record) ||
        record['version'] != 1 ||
        record['intentKey'] != ref.intentKey ||
        record['target'] != ref.context.target ||
        saleJson(record['scope']) != saleJson(ref.context.scope.toJson())) {
      throw const FormatException('Invalid checkout evidence.');
    }
    return record;
  }

  Future<CheckoutSaleHandle> persist(CheckoutSaleCandidate candidate) async {
    final ref = candidate.reference;
    final ticket = candidate._ticket;
    _check(ticket);
    final view = _view(ref, ticket);
    // Diagnostic candidate, in the SAME V2 store, has no sending state/authority.
    // It survives conflicts/crash; it is not a second commercial owner.
    final evidence = _seal({
      ..._metadata(ref),
      'candidateId': candidate.candidateId,
      'draft': candidate.draft,
    });
    final key = _candidateKey(ref, candidate.candidateId);
    if (!await view.compareAndSet(key, null, evidence) &&
        await view.read(key) != evidence) {
      throw StateError('Candidate evidence conflict.');
    }
    _check(ticket);
    final mayReserve = !candidate._existingOnly && !candidate._started;
    candidate._started = true;
    final binding = _seal({..._metadata(ref), 'draft': candidate.draft});
    final ownsFirstReservation =
        mayReserve && await view.compareAndSet(_bindingKey(ref), null, binding);
    _check(ticket);
    final ledger = _ledger(ref, ticket);
    final attempt = ownsFirstReservation
        ? await ledger.reserve(
            ref.context.scope,
            ref.intentKey,
            candidate.draft,
          )
        : await ledger.load(ref.context.scope, ref.intentKey);
    _check(ticket);
    final originalDraft = _normalizeDraft(ref, {
      for (final key in [
        'items',
        'expectedTotalCents',
        'paymentMethod',
        'notes',
        'customerId',
      ])
        key: attempt.payload[key],
      if (attempt.payload.containsKey('payments')) 'payments': attempt.payload['payments'],
    });
    if (saleJson(originalDraft) != candidate._draft) {
      throw CheckoutSaleConflict(candidate, attempt);
    }
    _decode(await view.read(_bindingKey(ref)), ref);
    _check(ticket);
    return CheckoutSaleHandle._(ref, attempt, ticket);
  }

  /// Load-only: missing storage never invokes reserve or invents a new ID.
  Future<CheckoutSaleHandle> resume(CheckoutSaleReference ref) async {
    final ticket = _ticketFor(ref);
    final binding = _decode(
      await _view(ref, ticket).read(_bindingKey(ref)),
      ref,
    );
    final attempt = await _ledger(
      ref,
      ticket,
    ).load(ref.context.scope, ref.intentKey);
    final expected = _normalizeDraft(ref, saleObject(binding['draft']));
    final actual = _normalizeDraft(ref, {
      for (final key in expected.keys) key: attempt.payload[key],
    });
    if (saleJson(expected) != saleJson(actual)) {
      throw const FormatException('Checkout binding mismatch.');
    }
    _check(ticket);
    return CheckoutSaleHandle._(ref, attempt, ticket);
  }

  /// Read-only enumeration, not ledger.reopen (which mutates sending to unknown).
  Future<List<CheckoutSaleReference>> listIntentions() async {
    final ticket = session._capture();
    final probe = CheckoutSaleReference(
      context: ticket.context,
      intentKey: 'probe',
    );
    final view = _view(probe, ticket);
    final prefix = '${ticket.context.scope.prefix}checkout-binding:';
    final refs = <CheckoutSaleReference>[];
    for (final key in await view.keys(prefix)) {
      final ref = CheckoutSaleReference(
        context: ticket.context,
        intentKey: key.substring(prefix.length),
      );
      _decode(await view.read(key), ref);
      refs.add(ref);
    }
    _check(ticket);
    return List.unmodifiable(refs);
  }

  Future<Map<String, dynamic>> readCandidate(
    CheckoutSaleReference ref,
    String id,
  ) async {
    final ticket = _ticketFor(ref);
    final record = _decode(
      await _view(ref, ticket).read(_candidateKey(ref, saleId(id))),
      ref,
    );
    _check(ticket);
    return record; // Detached diagnostic data; never an authorization to send.
  }

  /// UNKNOWN only queries. No path calls ledger.send, even after not-recorded.
  Future<CheckoutSaleHandle> consult(CheckoutSaleHandle handle) async {
    _check(handle._ticket);
    if (_lookup == null) throw StateError('No result lookup configured.');
    await resume(handle.reference);
    final ref = handle.reference;
    await _ledger(
      ref,
      handle._ticket,
    ).recover(ref.context.scope, ref.intentKey);
    _check(handle._ticket);
    return resume(ref);
  }

  /// Optional synchronous UI gate; no cart import or active checkout integration.
  bool applyConfirmation(CheckoutSaleHandle handle, void Function() apply) {
    if (!session._matches(handle._ticket) ||
        handle._applied ||
        session._attachedIntentKey != handle.reference.intentKey ||
        handle.attempt.state != SaleAttemptState.confirmed) {
      return false;
    }
    handle._applied = true;
    apply();
    return true;
  }
}

/// Target separation is an adapter namespace, not a change to B07-C record/hash.
/// Every storage boundary checks generation before and after the asynchronous IO.
class _CheckoutStoreView implements SaleMutationStore {
  final SaleMutationStore inner;
  final String prefix;
  final void Function() check;
  _CheckoutStoreView(this.inner, CheckoutSaleContext context, this.check)
    : prefix = 'checkout-v1:${base64Url.encode(utf8.encode(context.target))}:';
  @override
  Future<String?> read(String key) async {
    check();
    final value = await inner.read('$prefix$key');
    check();
    return value;
  }

  @override
  Future<List<String>> keys(String key) async {
    check();
    final keys = await inner.keys('$prefix$key');
    check();
    return keys.map((key) => key.substring(prefix.length)).toList();
  }

  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    check();
    final result = await inner.compareAndSet('$prefix$key', expected, value);
    check();
    return result;
  }

  @override
  Future<void> close() async =>
      throw StateError('Borrowed store cannot be closed by the view.');
}

class _LookupOnly implements SaleMutationTransport {
  final CheckoutResultLookup? lookup;
  final void Function() check;
  _LookupOnly(this.lookup, this.check);
  @override
  Future<Map<String, dynamic>> send(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) => throw StateError(
    'Commercial sending is disabled in checkout preparation.',
  );
  @override
  Future<Map<String, dynamic>> recover(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) async {
    check();
    if (lookup == null) throw StateError('No result lookup configured.');
    final result = await lookup!(scope, command);
    check();
    return result;
  }
}
