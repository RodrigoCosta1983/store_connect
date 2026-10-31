import 'dart:async';
import 'dart:convert';
import '../data/local/contextual_sale_mutation_store.dart';
import '../data/local/sale_mutation_store.dart';
import 'checkout_coordinator_ports.dart';
import 'checkout_sale_preparation.dart';
import 'sale_associated_reservation.dart';
import 'sale_mutation_command.dart';
import 'sale_mutation_ledger.dart';

enum CheckoutIntentionCategory {
  v2Recoverable,
  v2Unknown,
  v1Historical,
  v1HistoricalGap,
  orphanCandidate,
  bindingWithoutLedger,
  canonicalWithoutAssociation,
  corruptedMetadata,
  unknownVersion,
  referenceChanged,
  storageUnavailable,
  enumerationPartial,
  contextMismatch,
  missingCandidate,
  diagnosticCandidate,
}

enum CheckoutIntentionScanStatus {
  complete,
  partial,
  unavailable,
  contextInvalid,
}

/// Fan out the same BEFORE-mutation lifecycle event to this guard and B1.
/// This is not SDK observation and does not take ownership of B1's event port.
class CheckoutIntentionGeneration {
  Object _token = Object();
  void invalidate() {
    _token = Object();
  }
}

class CheckoutIntentionLimits {
  final int maxKeys, maxEntries, maxRecordCharacters;
  final Duration budget, readTimeout;
  CheckoutIntentionLimits({
    this.maxKeys = 256,
    this.maxEntries = 64,
    this.maxRecordCharacters = 262144,
    this.budget = const Duration(seconds: 2),
    this.readTimeout = const Duration(seconds: 5),
  }) {
    if (maxKeys < 1 ||
        maxKeys > 1024 ||
        maxEntries < 1 ||
        maxEntries > 256 ||
        maxRecordCharacters < 1 ||
        maxRecordCharacters > 1048576 ||
        budget <= Duration.zero ||
        readTimeout <= Duration.zero) {
      throw ArgumentError('Invalid read-only scan limits.');
    }
  }
}

class CheckoutIntentionEntry {
  final Set<CheckoutIntentionCategory> categories;
  final CheckoutSaleReference? reference;
  final int? metadataVersion;
  final SaleAttemptState? localState;
  final Map<String, String?> _proof;
  CheckoutIntentionEntry._(
    Iterable<CheckoutIntentionCategory> categories, {
    this.reference,
    this.metadataVersion,
    this.localState,
    Map<String, String?> proof = const {},
  }) : categories = Set.unmodifiable(categories),
       _proof = Map.unmodifiable(proof);
  bool get canSelectV2 =>
      categories.every(
        {
          CheckoutIntentionCategory.v2Recoverable,
          CheckoutIntentionCategory.v2Unknown,
          CheckoutIntentionCategory.diagnosticCandidate,
        }.contains,
      ) &&
      (categories.contains(CheckoutIntentionCategory.v2Recoverable) ||
          categories.contains(CheckoutIntentionCategory.v2Unknown));
}

class CheckoutIntentionScan {
  final CheckoutIntentionScanStatus _status;
  final List<CheckoutIntentionEntry> _entries;
  final Set<CheckoutIntentionCategory> _issues;
  final _ReadTicket? _ticket;
  final int inspectedKeys;
  CheckoutIntentionScan._(
    this._status,
    List<CheckoutIntentionEntry> entries,
    Set<CheckoutIntentionCategory> issues,
    this._ticket,
    this.inspectedKeys,
  ) : _entries = List.unmodifiable(entries),
      _issues = Set.unmodifiable(issues);
  bool get isCurrent => _ticket?.valid() ?? false;
  CheckoutIntentionScanStatus get status => _ticket != null && !isCurrent
      ? CheckoutIntentionScanStatus.contextInvalid
      : _status;
  List<CheckoutIntentionEntry> get entries => isCurrent ? _entries : const [];
  Set<CheckoutIntentionCategory> get issues => isCurrent ? _issues : const {};
  bool get isEmptyObservation =>
      status == CheckoutIntentionScanStatus.complete && entries.isEmpty;
  bool get isGlobalSnapshot => false;
}

class CheckoutIntentionSelection {
  final CheckoutSaleReference _reference;
  final _ReadTicket _ticket;
  CheckoutIntentionSelection._(this._reference, this._ticket);
  CheckoutSaleReference get reference {
    if (!_ticket.valid()) {
      throw CheckoutIntentionSelectionBlocked(
        CheckoutIntentionCategory.contextMismatch,
      );
    }
    return _reference;
  }
}

class CheckoutIntentionSelectionBlocked implements Exception {
  final CheckoutIntentionCategory? reason;
  CheckoutIntentionSelectionBlocked([this.reason]);
}

class _ReadInvalidated implements Exception {}

class _ReadTicket {
  final CheckoutContextBinding binding;
  final CheckoutContextPort context;
  final CheckoutIntentionGeneration generation;
  final Object captured;
  final Object owner;
  _ReadTicket(this.binding, this.context, this.generation, this.owner)
    : captured = generation._token;
  bool valid() {
    try {
      return identical(captured, generation._token) &&
          context.isCurrent(binding);
    } catch (_) {
      return false;
    }
  }

  void check() {
    if (!valid()) throw _ReadInvalidated();
  }
}

class _Group {
  final CheckoutSaleReference reference;
  final Set<String> discovered = {};
  _Group(this.reference);
}

/// No persistent catalog, ledger mutation, network or automatic cart attachment.
class CheckoutIntentionReader {
  final SaleMutationStore store;
  final CheckoutContextPort context;
  final CheckoutIntentionGeneration generation;
  CheckoutIntentionReader({
    required this.store,
    required this.context,
    required this.generation,
  });

  String _binding(CheckoutSaleReference ref) =>
      '${ref.context.scope.prefix}checkout-binding:${ref.intentKey}';
  String _canonical(CheckoutSaleReference ref) =>
      '${ref.context.scope.prefix}confirmSaleV2:${base64Url.encode(utf8.encode(ref.intentKey))}';
  String _candidate(CheckoutSaleReference ref, String id) =>
      '${ref.context.scope.prefix}checkout-candidate:${saleId(id)}';
  ContextualAtomicSaleStore _view(_ReadTicket ticket) =>
      ContextualAtomicSaleStore(
        store: store,
        context: SaleStoreContext(
          scope: ticket.binding.context.scope,
          target: ticket.binding.context.target,
        ),
        checkCurrent: ticket.check,
      );
  Future<SaleAtomicSnapshot> _snapshot(
    ContextualAtomicSaleStore view,
    _ReadTicket ticket,
    Iterable<String> keys,
    CheckoutIntentionLimits limits,
  ) async {
    ticket.check();
    final result = await view
        .readSnapshot(
          SaleAtomicScope(
            namespace: ticket.binding.context.scope.prefix,
            keys: keys,
          ),
        )
        .timeout(limits.readTimeout);
    ticket.check();
    return result;
  }

  Map<String, dynamic> _object(String raw, CheckoutIntentionLimits limits) {
    if (raw.length > limits.maxRecordCharacters) {
      throw const FormatException('Oversized evidence');
    }
    return saleObject(jsonDecode(raw));
  }

  bool _origin(
    Map<String, dynamic> record,
    _ReadTicket ticket, {
    required bool metadata,
  }) {
    final scope = saleObject(record['scope']);
    if (metadata && record['target'] is! String) {
      throw const FormatException('Missing target evidence');
    }
    return saleJson(scope) == saleJson(ticket.binding.context.scope.toJson()) &&
        (!metadata || record['target'] == ticket.binding.context.target);
  }

  Future<CheckoutIntentionScan> scan({
    CheckoutContextBinding? expectedBinding,
    CheckoutIntentionLimits? limits,
  }) async {
    final bounds = limits ?? CheckoutIntentionLimits();
    CheckoutContextBinding? binding;
    try {
      binding = context.capture();
    } catch (_) {
      /* Failed origin observation. */
    }
    if (binding == null ||
        (expectedBinding != null && !identical(binding, expectedBinding))) {
      return CheckoutIntentionScan._(
        CheckoutIntentionScanStatus.contextInvalid,
        [],
        {},
        null,
        0,
      );
    }
    final ticket = _ReadTicket(binding, context, generation, this);
    final entries = <CheckoutIntentionEntry>[];
    final issues = <CheckoutIntentionCategory>{};
    var inspected = 0;
    final clock = Stopwatch()..start();
    try {
      ticket.check();
      final view = _view(ticket);
      final prefix = binding.context.scope.prefix;
      final discovered = await view.keys(prefix).timeout(bounds.readTimeout);
      ticket.check();
      final keys = <String>[];
      var visited = 0;
      for (final key in discovered) {
        if (visited++ == bounds.maxKeys) {
          issues.add(CheckoutIntentionCategory.enumerationPartial);
          break;
        }
        final suffix = key.substring(prefix.length);
        if (!suffix.startsWith('checkout-binding:') &&
            !suffix.startsWith('checkout-candidate:') &&
            !suffix.startsWith('confirmSaleV2:')) {
          continue;
        }
        keys.add(key);
      }
      if (keys.isEmpty) {
        return CheckoutIntentionScan._(
          issues.isEmpty
              ? CheckoutIntentionScanStatus.complete
              : CheckoutIntentionScanStatus.partial,
          [],
          issues,
          ticket,
          0,
        );
      }
      if (clock.elapsed >= bounds.budget) {
        return CheckoutIntentionScan._(
          CheckoutIntentionScanStatus.partial,
          [],
          {CheckoutIntentionCategory.enumerationPartial},
          ticket,
          0,
        );
      }
      final observed = await _snapshot(view, ticket, keys, bounds);
      final groups = <String, _Group>{};
      for (final key in keys) {
        if (entries.length + groups.length >= bounds.maxEntries ||
            clock.elapsed >= bounds.budget) {
          issues.add(CheckoutIntentionCategory.enumerationPartial);
          break;
        }
        inspected++;
        final raw = observed.values[key];
        if (raw == null) {
          entries.add(
            CheckoutIntentionEntry._([
              CheckoutIntentionCategory.referenceChanged,
            ]),
          );
          issues.add(CheckoutIntentionCategory.enumerationPartial);
          continue;
        }
        try {
          final record = _object(raw, bounds);
          final isCanonical = key.startsWith('${prefix}confirmSaleV2:');
          if (!_origin(record, ticket, metadata: !isCanonical)) {
            entries.add(
              CheckoutIntentionEntry._([
                CheckoutIntentionCategory.contextMismatch,
              ]),
            );
            continue;
          }
          if (isCanonical
              ? record['ledgerVersion'] != 1
              : ![1, 2].contains(record['version'])) {
            entries.add(
              CheckoutIntentionEntry._([
                CheckoutIntentionCategory.unknownVersion,
              ]),
            );
            continue;
          }
          final ref = CheckoutSaleReference(
            context: binding.context,
            intentKey: saleId(record['intentKey']),
          );
          if ((isCanonical && key != _canonical(ref)) ||
              (key.startsWith('${prefix}checkout-binding:') &&
                  key != _binding(ref)) ||
              (key.startsWith('${prefix}checkout-candidate:') &&
                  key != _candidate(ref, saleId(record['candidateId'])))) {
            throw const FormatException('Evidence key mismatch');
          }
          groups
              .putIfAbsent(ref.intentKey, () => _Group(ref))
              .discovered
              .add(key);
        } on FormatException {
          entries.add(
            CheckoutIntentionEntry._([
              CheckoutIntentionCategory.corruptedMetadata,
            ]),
          );
        } on ArgumentError {
          entries.add(
            CheckoutIntentionEntry._([
              CheckoutIntentionCategory.corruptedMetadata,
            ]),
          );
        }
      }
      for (final group in groups.values) {
        if (clock.elapsed >= bounds.budget) {
          issues.add(CheckoutIntentionCategory.enumerationPartial);
          break;
        }
        // Yield to lifecycle events; do not monopolize the UI event queue.
        await Future<void>.delayed(Duration.zero);
        ticket.check();
        final result = await _readGroup(view, ticket, group, observed, bounds);
        entries.add(result);
        if (result.categories.contains(
              CheckoutIntentionCategory.referenceChanged,
            ) ||
            result.categories.contains(
              CheckoutIntentionCategory.enumerationPartial,
            )) {
          issues.add(CheckoutIntentionCategory.enumerationPartial);
        }
      }
      ticket.check();
      return CheckoutIntentionScan._(
        issues.isEmpty
            ? CheckoutIntentionScanStatus.complete
            : CheckoutIntentionScanStatus.partial,
        entries,
        issues,
        ticket,
        inspected,
      );
    } on _ReadInvalidated {
      return CheckoutIntentionScan._(
        CheckoutIntentionScanStatus.contextInvalid,
        [],
        {},
        null,
        inspected,
      );
    } catch (_) {
      if (!ticket.valid()) {
        return CheckoutIntentionScan._(
          CheckoutIntentionScanStatus.contextInvalid,
          [],
          {},
          null,
          inspected,
        );
      }
      issues.add(CheckoutIntentionCategory.storageUnavailable);
      if (entries.isNotEmpty) {
        issues.add(CheckoutIntentionCategory.enumerationPartial);
      }
      return CheckoutIntentionScan._(
        entries.isEmpty
            ? CheckoutIntentionScanStatus.unavailable
            : CheckoutIntentionScanStatus.partial,
        entries,
        issues,
        ticket,
        inspected,
      );
    }
  }

  Future<CheckoutIntentionEntry> _readGroup(
    ContextualAtomicSaleStore view,
    _ReadTicket ticket,
    _Group group,
    SaleAtomicSnapshot observed,
    CheckoutIntentionLimits limits,
  ) async {
    final ref = group.reference;
    final keys = {...group.discovered, _binding(ref), _canonical(ref)};
    try {
      final raw = observed.values[_binding(ref)];
      if (raw != null) {
        final binding = _object(raw, limits);
        if (binding['version'] == 2 &&
            _origin(binding, ticket, metadata: true)) {
          keys.add(_candidate(ref, saleId(binding['originalCandidateId'])));
        }
      }
    } on FormatException {
      /* Classify malformed pointer in the consistent set. */
    }
    final snapshot = await _snapshot(view, ticket, keys, limits);
    if (keys.any(
      (key) =>
          observed.values.containsKey(key) &&
          snapshot.values[key] != observed.values[key],
    )) {
      return CheckoutIntentionEntry._([
        CheckoutIntentionCategory.referenceChanged,
      ]);
    }
    return _classify(ticket, ref, snapshot, limits);
  }

  Future<CheckoutIntentionEntry> _classify(
    _ReadTicket ticket,
    CheckoutSaleReference ref,
    SaleAtomicSnapshot snapshot,
    CheckoutIntentionLimits limits,
  ) async {
    final categories = <CheckoutIntentionCategory>{};
    final work = Stopwatch()..start();
    final bindingRaw = snapshot.values[_binding(ref)];
    final canonicalRaw = snapshot.values[_canonical(ref)];
    final candidates = snapshot.values.entries
        .where(
          (e) =>
              e.key.startsWith(
                '${ref.context.scope.prefix}checkout-candidate:',
              ) &&
              e.value != null,
        )
        .toList();
    int? version;
    SaleMutationAttempt? attempt;
    try {
      // Reuse existing public readers on IMMUTABLE snapshots. No mutation API
      // can reach the real store through these validation adapters.
      final decodedStore = _EvidenceSnapshotStore(
        snapshot.values,
        ticket.check,
      );
      final ledger = SaleMutationLedger(
        store: decodedStore,
        transport: _UnavailableTransport(),
        activeScope: () async => ref.context.scope,
      );
      if (canonicalRaw != null) {
        final record = _object(canonicalRaw, limits);
        if (!_origin(record, ticket, metadata: false)) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.contextMismatch,
          ]);
        }
        if (record['ledgerVersion'] != 1) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.unknownVersion,
          ]);
        }
        attempt = await ledger.load(ref.context.scope, ref.intentKey);
      }
      final targetPrefix = SaleStoreContext(
        scope: ref.context.scope,
        target: ref.context.target,
      ).targetPrefix;
      final legacy = CheckoutSalePreparation(
        store: _EvidenceSnapshotStore(
          snapshot.values,
          ticket.check,
          physicalPrefix: targetPrefix,
        ),
        session: CheckoutSaleSession(ref.context),
      );
      Map<String, dynamic>? binding;
      if (bindingRaw != null) {
        binding = _object(bindingRaw, limits);
        if (!_origin(binding, ticket, metadata: true)) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.contextMismatch,
          ]);
        }
        if (![1, 2].contains(binding['version'])) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.unknownVersion,
          ]);
        }
        version = binding['version'] as int;
        if (version == 1) {
          await legacy
              .listIntentions(); // V1 decoder only, in the captured map.
        } else {
          binding = _v2(bindingRaw, ref, 'binding');
          if (binding['ledgerKey'] != _canonical(ref)) {
            throw const FormatException('Canonical pointer mismatch');
          }
          saleId(binding['originalCandidateId']);
        }
      }
      final validCandidates = <String, Map<String, dynamic>>{};
      for (final entry in candidates) {
        if (validCandidates.length % 16 == 0) {
          await Future<void>.delayed(Duration.zero);
          ticket.check();
        }
        if (work.elapsed >= limits.budget) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.enumerationPartial,
          ]);
        }
        final record = _object(entry.value!, limits);
        if (!_origin(record, ticket, metadata: true)) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.contextMismatch,
          ]);
        }
        final id = saleId(record['candidateId']);
        if (_candidate(ref, id) != entry.key) {
          throw const FormatException('Candidate pointer mismatch');
        }
        if (![1, 2].contains(record['version'])) {
          return CheckoutIntentionEntry._([
            CheckoutIntentionCategory.unknownVersion,
          ]);
        }
        if (version != null && version != record['version']) {
          throw const FormatException('Mixed metadata versions');
        }
        version ??= record['version'] as int;
        final checked = record['version'] == 1
            ? await legacy.readCandidate(ref, id)
            : _v2(entry.value!, ref, 'candidate');
        validCandidates[id] = checked;
      }
      ticket.check();
      if (binding == null) {
        if (attempt != null) {
          categories.add(CheckoutIntentionCategory.canonicalWithoutAssociation);
        }
        if (validCandidates.isNotEmpty) {
          categories.add(CheckoutIntentionCategory.orphanCandidate);
        }
      } else if (attempt == null) {
        categories.add(CheckoutIntentionCategory.bindingWithoutLedger);
        if (version == 1) {
          categories.add(CheckoutIntentionCategory.v1HistoricalGap);
        }
      } else if (version == 1) {
        await legacy.resume(
          ref,
        ); // Validates V1 binding/command using original logic.
        if (!validCandidates.values.any(
          (c) => _matches(attempt!, saleObject(c['draft'])),
        )) {
          categories.add(CheckoutIntentionCategory.v1HistoricalGap);
          categories.add(CheckoutIntentionCategory.missingCandidate);
        } else {
          categories.add(CheckoutIntentionCategory.v1Historical);
        }
      } else {
        final original =
            validCandidates[saleId(binding['originalCandidateId'])];
        if (original == null) {
          categories.add(CheckoutIntentionCategory.missingCandidate);
        } else if (binding['commandHash'] != attempt.command.integrityHash ||
            !_matches(attempt, saleObject(original['intent']))) {
          throw const FormatException('Immutable command mismatch');
        } else {
          categories.add(
            {
                  SaleAttemptState.sending,
                  SaleAttemptState.unknown,
                }.contains(attempt.state)
                ? CheckoutIntentionCategory.v2Unknown
                : CheckoutIntentionCategory.v2Recoverable,
          );
          if (validCandidates.length > 1) {
            categories.add(CheckoutIntentionCategory.diagnosticCandidate);
          }
        }
      }
      if (categories.isEmpty) {
        categories.add(CheckoutIntentionCategory.corruptedMetadata);
      }
      return CheckoutIntentionEntry._(
        categories,
        reference: ref,
        metadataVersion: version,
        localState: attempt?.state,
        proof: snapshot.values,
      );
    } on _ReadInvalidated {
      rethrow;
    } on FormatException {
      return CheckoutIntentionEntry._([
        CheckoutIntentionCategory.corruptedMetadata,
      ]);
    } on ArgumentError {
      return CheckoutIntentionEntry._([
        CheckoutIntentionCategory.corruptedMetadata,
      ]);
    } on TypeError {
      return CheckoutIntentionEntry._([
        CheckoutIntentionCategory.corruptedMetadata,
      ]);
    }
  }

  Map<String, dynamic> _v2(
    String raw,
    CheckoutSaleReference ref,
    String kind,
  ) => decodeSaleAssociation(
    raw,
    SaleAssociationRequest.forExisting(
      context: SaleStoreContext(
        scope: ref.context.scope,
        target: ref.context.target,
      ),
      intentKey: ref.intentKey,
      candidateId: 'read-only-probe',
      intent: {},
    ),
    kind,
  );
  bool _matches(SaleMutationAttempt attempt, Map<String, dynamic> draft) {
    saleKeys(
      draft,
      {'items', 'expectedTotalCents', 'paymentMethod', 'notes', 'customerId', 'payments'},
      {'items', 'expectedTotalCents', 'paymentMethod'},
    );
    final command = SaleMutationCommand.fromJson({
      ...attempt.payload,
      ...draft,
      'notes': draft['notes'],
      'customerId': draft['customerId'],
    });
    return saleJson(command.payload) == saleJson(attempt.payload);
  }

  /// Explicit read-only selection. Caller may hand reference to B1.resume;
  /// this method never calls preparation, attaches a cart or starts an action.
  Future<CheckoutIntentionSelection> selectV2(
    CheckoutIntentionScan scan,
    CheckoutIntentionEntry entry,
  ) async {
    try {
      return await _selectV2(scan, entry);
    } on CheckoutIntentionSelectionBlocked {
      rethrow;
    } on _ReadInvalidated {
      throw CheckoutIntentionSelectionBlocked(
        CheckoutIntentionCategory.contextMismatch,
      );
    } catch (_) {
      throw CheckoutIntentionSelectionBlocked(
        CheckoutIntentionCategory.storageUnavailable,
      );
    }
  }

  Future<CheckoutIntentionSelection> _selectV2(
    CheckoutIntentionScan scan,
    CheckoutIntentionEntry entry,
  ) async {
    final ticket = scan._ticket;
    if (ticket == null ||
        !identical(ticket.owner, this) ||
        !scan.isCurrent ||
        !scan.entries.contains(entry) ||
        !entry.canSelectV2) {
      throw CheckoutIntentionSelectionBlocked();
    }
    ticket.check();
    final limits = CheckoutIntentionLimits();
    final current = await _snapshot(
      _view(ticket),
      ticket,
      entry._proof.keys,
      limits,
    );
    if (entry._proof.keys.any((k) => entry._proof[k] != current.values[k])) {
      throw CheckoutIntentionSelectionBlocked(
        CheckoutIntentionCategory.referenceChanged,
      );
    }
    final checked = await _classify(ticket, entry.reference!, current, limits);
    ticket.check();
    if (!checked.canSelectV2) throw CheckoutIntentionSelectionBlocked();
    return CheckoutIntentionSelection._(checked.reference!, ticket);
  }
}

/// Pure validation view, NOT a second database or commercial owner. Mutations
/// are unavailable; the original readers can only read these captured values.
class _EvidenceSnapshotStore implements SaleMutationStore {
  final Map<String, String?> values;
  final void Function() check;
  final String physicalPrefix;
  _EvidenceSnapshotStore(
    Map<String, String?> snapshot,
    this.check, {
    this.physicalPrefix = '',
  }) : values = Map.unmodifiable(snapshot);
  @override
  Future<String?> read(String key) async {
    check();
    return key.startsWith(physicalPrefix)
        ? values[key.substring(physicalPrefix.length)]
        : null;
  }

  @override
  Future<List<String>> keys(String prefix) async {
    check();
    return [
      for (final e in values.entries)
        if (e.value != null && '$physicalPrefix${e.key}'.startsWith(prefix))
          '$physicalPrefix${e.key}',
    ];
  }

  @override
  Future<bool> compareAndSet(String key, String? expected, String value) =>
      throw UnsupportedError('Read-only validation snapshot');
  @override
  Future<void> close() => throw UnsupportedError('Borrowed read-only snapshot');
}

class _UnavailableTransport implements SaleMutationTransport {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('No transport in local enumeration');
}
