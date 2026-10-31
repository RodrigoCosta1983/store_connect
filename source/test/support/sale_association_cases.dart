import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/contextual_sale_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/sale_associated_reservation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'sale_ledger_cases.dart' show SaleTestTransport, saleIntent, saleScope;

SaleStoreContext associationContext({
  SaleMutationScope scope = saleScope,
  String environment = 'test',
}) => SaleStoreContext(
  scope: scope,
  target: saleJson({
    'environment': environment,
    'firestoreEndpoint': 'emulator',
    'functionsEndpoint': 'emulator',
  }),
);

class AssociationHarness {
  final AtomicSaleMutationStore raw;
  final SaleStoreContext context;
  final transport = SaleTestTransport();
  Object generation = Object();
  late final ContextualAtomicSaleStore view;
  late final SaleMutationLedger ledger;
  AssociationHarness(this.raw, {SaleStoreContext? context})
    : context = context ?? associationContext() {
    final captured = generation;
    view = ContextualAtomicSaleStore(
      store: raw,
      context: this.context,
      checkCurrent: () {
        if (!identical(captured, generation)) {
          throw StateError('Stale session generation');
        }
      },
    );
    ledger = SaleMutationLedger(
      store: view,
      transport: transport,
      activeScope: () async => this.context.scope,
      now: () => DateTime.fromMillisecondsSinceEpoch(123),
    );
  }
  SaleAssociationRequest request({
    String key = 'intent',
    String candidate = 'candidate',
    Map<String, dynamic>? intent,
    bool existing = false,
  }) => existing
      ? SaleAssociationRequest.forExisting(
          context: context,
          intentKey: key,
          candidateId: candidate,
          intent: intent ?? saleIntent(),
        )
      : SaleAssociationRequest.newIntention(
          context: context,
          intentKey: key,
          candidateId: candidate,
          intent: intent ?? saleIntent(),
        );
  Future<Map<String, String>> records() async => {
    for (final key in await raw.keys('')) key: (await raw.read(key))!,
  };
  void noCommercialIO() {
    expect(transport.sent, isEmpty);
    expect(transport.queried, isEmpty);
  }
}

/// Faults wrap an actual transaction; no memory store substitutes for commit.
class AssociationFaultStore implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore inner;
  bool before = false;
  bool after = false;
  void Function()? afterCommit;
  AssociationFaultStore(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) =>
      inner.compareAndSet(key, expected, value);
  @override
  Future<void> close() => inner.close();
  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) =>
      inner.readSnapshot(scope);
  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) async {
    final commit = await inner.transact<T>(scope, (snapshot) {
      final plan = decide(snapshot);
      if (before) throw StateError('synthetic failure before commit');
      return plan;
    });
    afterCommit?.call();
    if (after) throw StateError('synthetic lost commit response');
    return commit;
  }
}

class AssociationLegacyStore implements SaleMutationStore {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw StateError('Legacy store must not be called');
}

void saleAssociationCases(
  Future<AtomicSaleMutationStore> Function(String name) open,
) {
  Future<AtomicSaleMutationStore> fresh() =>
      open(SaleMutationCommand.newIdentity());

  test(
    'associated commit creates three records; exact B07-C schema and hashes; no IO',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      final result = await h.ledger.reserveAssociated(h.request());
      expect(result.status, SaleAssociationStatus.created);
      expect(result.attempt!.prepared, false);
      final records = await h.records();
      expect(records, hasLength(3));
      final canonical = saleObject(
        jsonDecode(
          records.values.singleWhere(
            (r) => saleObject(jsonDecode(r))['ledgerVersion'] == 1,
          ),
        ),
      );
      final hash = canonical.remove('recordHash');
      expect(hash, saleHash(canonical));
      expect(canonical, {
        'ledgerVersion': 1,
        'protocol': 'sale-v2',
        'operation': 'confirmSaleV2',
        'intentKey': 'intent',
        'scope': saleScope.toJson(),
        'requestId': result.attempt!.requestId,
        'saleId': result.attempt!.requestId,
        'command': result.attempt!.payload,
        'commandHash': result.attempt!.command.integrityHash,
        'state': 'persisted',
        'prepared': false,
        'outcome': null,
        'createdAtMs': 123,
        'updatedAtMs': 123,
        'attempts': 0,
        'claim': null,
        'leaseUntilMs': 0,
      });
      for (final record in records.values.where(
        (r) => saleObject(jsonDecode(r))['version'] == 2,
      )) {
        expect(record, isNot(contains(result.attempt!.requestId)));
      }
      h.noCommercialIO();
    },
  );

  test(
    'frozen command; equivalent retry adopts winner and preserves original bytes',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      final intent = saleIntent();
      final request = h.request(intent: intent);
      intent['expectedTotalCents'] = 999;
      final first = await h.ledger.reserveAssociated(request);
      final before = await h.records();
      final second = await h.ledger.reserveAssociated(
        h.request(candidate: 'next', existing: true),
      );
      expect(second.status, SaleAssociationStatus.adopted);
      expect(second.attempt!.requestId, first.attempt!.requestId);
      final after = await h.records();
      for (final entry in before.entries) {
        expect(after[entry.key], entry.value);
      }
      expect(after.length, before.length + 1);
      h.noCommercialIO();
    },
  );

  test(
    'two legitimate identical purchases use distinct intent keys and IDs',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      final a = await h.ledger.reserveAssociated(h.request());
      final b = await h.ledger.reserveAssociated(
        h.request(key: 'new-purchase', candidate: 'new-candidate'),
      );
      expect(a.attempt!.requestId, isNot(b.attempt!.requestId));
      expect(await h.records(), hasLength(6));
    },
  );

  test(
    'divergent command commits durable candidate; canonical winner unchanged after reopen',
    () async {
      final name = SaleMutationCommand.newIdentity();
      final raw = await open(name);
      final h = AssociationHarness(raw);
      final a = await h.ledger.reserveAssociated(h.request());
      final before = await h.records();
      final conflict = await h.ledger.reserveAssociated(
        h.request(
          candidate: 'conflicting',
          intent: {...saleIntent(), 'notes': 'different'},
        ),
      );
      expect(conflict.status, SaleAssociationStatus.conflict);
      expect(conflict.candidatePersisted, true);
      expect(conflict.attempt!.requestId, a.attempt!.requestId);
      await raw.close();
      final reopened = await open(name);
      addTearDown(reopened.close);
      final r = AssociationHarness(reopened);
      final records = await r.records();
      for (final e in before.entries) {
        expect(records[e.key], e.value);
      }
      expect(records.length, 4);
      expect(records.values.any((v) => v.contains('different')), true);
      h.noCommercialIO();
      r.noCommercialIO();
    },
  );

  test(
    'candidate identity collision never overwrites either original evidence or command',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      await h.ledger.reserveAssociated(h.request());
      final before = await h.records();
      final result = await h.ledger.reserveAssociated(
        h.request(intent: {...saleIntent(), 'notes': 'collision'}),
      );
      expect(result.status, SaleAssociationStatus.blocked);
      expect(result.candidatePersisted, false);
      expect(await h.records(), before);
    },
  );

  for (final conflict in [false, true]) {
    test(
      'two real connections ${conflict ? 'diagnose conflict' : 'adopt same winner'}',
      () async {
        final name = SaleMutationCommand.newIdentity();
        final a = await open(name);
        final b = await open(name);
        addTearDown(a.close);
        addTearDown(b.close);
        final ha = AssociationHarness(a);
        final hb = AssociationHarness(b);
        final results = await Future.wait([
          ha.ledger.reserveAssociated(ha.request(candidate: 'one')),
          hb.ledger.reserveAssociated(
            hb.request(
              candidate: 'two',
              intent: {...saleIntent(), if (conflict) 'notes': 'different'},
            ),
          ),
        ]);
        expect(
          results.map((r) => r.status),
          contains(SaleAssociationStatus.created),
        );
        expect(
          results.map((r) => r.status),
          contains(
            conflict
                ? SaleAssociationStatus.conflict
                : SaleAssociationStatus.adopted,
          ),
        );
        expect(results.map((r) => r.attempt!.requestId).toSet(), hasLength(1));
        expect(await ha.records(), hasLength(4));
      },
    );
  }

  test(
    'failure before COMMIT aborts all records; same request cannot recreate',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final fault = AssociationFaultStore(raw)..before = true;
      final h = AssociationHarness(fault);
      final request = h.request();
      await expectLater(h.ledger.reserveAssociated(request), throwsStateError);
      expect(await h.records(), isEmpty);
      fault.before = false;
      final resumed = await h.ledger.reserveAssociated(request);
      expect(resumed.status, SaleAssociationStatus.blocked);
      expect(resumed.attempt, isNull);
    },
  );

  test(
    'lost response after COMMIT recovers exact original identity, including conflict evidence',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final fault = AssociationFaultStore(raw)..after = true;
      final h = AssociationHarness(fault);
      final request = h.request();
      await expectLater(h.ledger.reserveAssociated(request), throwsStateError);
      final before = await h.records();
      expect(before, hasLength(3));
      fault.after = false;
      final resumed = await h.ledger.reserveAssociated(request);
      expect(resumed.status, SaleAssociationStatus.adopted);
      expect(await h.records(), before);
      fault.after = true;
      await expectLater(
        h.ledger.reserveAssociated(
          h.request(
            candidate: 'conflict',
            intent: {...saleIntent(), 'notes': 'different'},
          ),
        ),
        throwsStateError,
      );
      expect(await h.records(), hasLength(4));
      h.noCommercialIO();
    },
  );

  for (final missing in [
    'checkout-binding:',
    'checkout-candidate:',
    'confirmSaleV2:',
  ]) {
    test(
      'partial association missing $missing is blocked without inferred repair',
      () async {
        final source = await fresh();
        final destination = await fresh();
        addTearDown(source.close);
        addTearDown(destination.close);
        final original = AssociationHarness(source);
        await original.ledger.reserveAssociated(original.request());
        final initial = await original.records();
        for (final e in initial.entries.where(
          (e) => !e.key.contains(missing),
        )) {
          await destination.compareAndSet(e.key, null, e.value);
        }
        final h = AssociationHarness(destination);
        final before = await h.records();
        final result = await h.ledger.reserveAssociated(
          h.request(candidate: 'recovery', existing: true),
        );
        expect(result.status, SaleAssociationStatus.blocked);
        expect(result.attempt, isNull);
        final after = await h.records();
        for (final e in before.entries) {
          expect(after[e.key], e.value);
        }
        expect(after.length, before.length + 1);
      },
    );
  }

  for (final historical in [true, false]) {
    test(
      '${historical ? 'historical v1' : 'corrupted'} binding remains blocked and unchanged',
      () async {
        final raw = await fresh();
        addTearDown(raw.close);
        final h = AssociationHarness(raw);
        final key =
            '${h.context.targetPrefix}${saleScope.prefix}checkout-binding:intent';
        final value = historical
            ? saleJson({'version': 1, 'saleId': 'old'})
            : 'not-json';
        await raw.compareAndSet(key, null, value);
        final result = await h.ledger.reserveAssociated(h.request());
        expect(result.status, SaleAssociationStatus.blocked);
        expect(await raw.read(key), value);
        h.noCommercialIO();
      },
    );
  }

  test(
    'conflict cannot be announced when evidence transaction aborts',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final fault = AssociationFaultStore(raw);
      final h = AssociationHarness(fault);
      await h.ledger.reserveAssociated(h.request());
      final before = await h.records();
      fault.before = true;
      await expectLater(
        h.ledger.reserveAssociated(
          h.request(
            candidate: 'conflict',
            intent: {...saleIntent(), 'notes': 'different'},
          ),
        ),
        throwsStateError,
      );
      expect(await h.records(), before);
      h.noCommercialIO();
    },
  );

  test(
    'binding pointer mismatch preserves original and commits diagnostic only',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      await h.ledger.reserveAssociated(h.request());
      final records = await h.records();
      final entry = records.entries.singleWhere(
        (e) => e.key.contains('checkout-binding:'),
      );
      final binding = saleObject(jsonDecode(entry.value))..remove('integrity');
      binding['commandHash'] = 'wrong';
      final corrupt = sealSaleAssociation(binding);
      await raw.compareAndSet(entry.key, entry.value, corrupt);
      final result = await h.ledger.reserveAssociated(
        h.request(candidate: 'diagnostic', existing: true),
      );
      expect(result.status, SaleAssociationStatus.blocked);
      expect(await raw.read(entry.key), corrupt);
      expect(await h.records(), hasLength(4));
      h.noCommercialIO();
    },
  );

  test('missing storage on explicit resume cannot create ID', () async {
    final raw = await fresh();
    addTearDown(raw.close);
    final h = AssociationHarness(raw);
    final result = await h.ledger.reserveAssociated(h.request(existing: true));
    expect(result.status, SaleAssociationStatus.blocked);
    expect(result.attempt, isNull);
    expect(await h.records(), hasLength(1));
  });

  for (final field in ['commandHash', 'state', 'scope', 'recordHash']) {
    test(
      'corrupted canonical $field blocks without rewriting original',
      () async {
        final raw = await fresh();
        addTearDown(raw.close);
        final h = AssociationHarness(raw);
        await h.ledger.reserveAssociated(h.request());
        final before = await h.records();
        final entry = before.entries.singleWhere(
          (e) => e.key.contains('confirmSaleV2:'),
        );
        final record = saleObject(jsonDecode(entry.value));
        record.remove('recordHash');
        record[field] = field == 'state' ? 7 : 'corrupted';
        final corrupt = saleJson({
          ...record,
          'recordHash': field == 'recordHash' ? 'bad' : saleHash(record),
        });
        await raw.compareAndSet(entry.key, entry.value, corrupt);
        final result = await h.ledger.reserveAssociated(
          h.request(candidate: 'diagnostic', existing: true),
        );
        expect(result.status, SaleAssociationStatus.blocked);
        expect(result.attempt, isNull);
        expect(await raw.read(entry.key), corrupt);
        expect(await h.records(), hasLength(4));
        h.noCommercialIO();
      },
    );
  }

  test(
    'unknown record adopted unchanged without query, retry, confirmation or lease effects',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      await h.ledger.reserveAssociated(h.request());
      final entry = (await h.records()).entries.singleWhere(
        (e) => e.key.contains('confirmSaleV2:'),
      );
      final record = saleObject(jsonDecode(entry.value))..remove('recordHash');
      record['state'] = 'unknown';
      record['prepared'] = true;
      final unknown = saleJson({...record, 'recordHash': saleHash(record)});
      await raw.compareAndSet(entry.key, entry.value, unknown);
      final result = await h.ledger.reserveAssociated(
        h.request(existing: true),
      );
      expect(result.status, SaleAssociationStatus.adopted);
      expect(result.attempt!.state, SaleAttemptState.unknown);
      expect(await raw.read(entry.key), unknown);
      h.noCommercialIO();
    },
  );

  test('invalid command and stale generation reject before writing', () async {
    final raw = await fresh();
    addTearDown(raw.close);
    final h = AssociationHarness(raw);
    await expectLater(
      h.ledger.reserveAssociated(
        h.request(intent: {...saleIntent(), 'expectedTotalCents': -1}),
      ),
      throwsFormatException,
    );
    h.generation = Object();
    await expectLater(
      h.ledger.reserveAssociated(h.request()),
      throwsStateError,
    );
    expect(await h.records(), isEmpty);
    h.noCommercialIO();
  });

  test('closed storage never reports success or calls a transport', () async {
    final raw = await fresh();
    final h = AssociationHarness(raw);
    await raw.close();
    await expectLater(
      h.ledger.reserveAssociated(h.request()),
      throwsA(anything),
    );
    h.noCommercialIO();
  });

  test(
    'session ABA after commit rejects callback but preserves original durable association',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final fault = AssociationFaultStore(raw);
      final h = AssociationHarness(fault);
      fault.afterCommit = () {
        h.generation = Object();
      };
      await expectLater(
        h.ledger.reserveAssociated(h.request()),
        throwsStateError,
      );
      expect(await h.records(), hasLength(3));
      fault.afterCommit = null;
      final resumed = AssociationHarness(raw);
      expect(
        (await resumed.ledger.reserveAssociated(
          resumed.request(existing: true),
        )).status,
        SaleAssociationStatus.adopted,
      );
      h.noCommercialIO();
    },
  );

  test(
    'target/project/store/user are isolated; foreign request fails before writing',
    () async {
      final raw = await fresh();
      addTearDown(raw.close);
      final h = AssociationHarness(raw);
      final original = await h.ledger.reserveAssociated(h.request());
      for (final context in [
        associationContext(environment: 'other'),
        associationContext(
          scope: const SaleMutationScope(
            projectId: 'other',
            uid: 'u',
            storeId: 's',
          ),
        ),
        associationContext(
          scope: SaleMutationScope(
            projectId: saleScope.projectId,
            uid: 'other',
            storeId: 's',
          ),
        ),
        associationContext(
          scope: SaleMutationScope(
            projectId: saleScope.projectId,
            uid: 'u',
            storeId: 'other',
          ),
        ),
      ]) {
        final other = AssociationHarness(raw, context: context);
        await expectLater(
          other.ledger.reserveAssociated(h.request()),
          throwsStateError,
        );
        final result = await other.ledger.reserveAssociated(
          other.request(existing: true),
        );
        expect(result.status, SaleAssociationStatus.blocked);
      }
      final adopted = await h.ledger.reserveAssociated(
        h.request(existing: true),
      );
      expect(adopted.attempt!.requestId, original.attempt!.requestId);
    },
  );

  test('legacy store refuses capability before any storage access', () async {
    final legacy = AssociationLegacyStore();
    expect(
      () => ContextualAtomicSaleStore(
        store: legacy,
        context: associationContext(),
        checkCurrent: () {},
      ),
      throwsUnsupportedError,
    );
    final ledger = SaleMutationLedger(
      store: legacy,
      transport: SaleTestTransport(),
      activeScope: () async => saleScope,
    );
    await expectLater(
      ledger.reserveAssociated(
        SaleAssociationRequest.newIntention(
          context: associationContext(),
          intentKey: 'i',
          candidateId: 'c',
          intent: saleIntent(),
        ),
      ),
      throwsUnsupportedError,
    );
  });
}
