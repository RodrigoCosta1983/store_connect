import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'checkout_sale_preparation_cases.dart'
    show checkoutContext, checkoutDraft;
import 'sale_association_cases.dart'
    show AssociationFaultStore, AssociationLegacyStore;

class CheckoutAssociatedTestStore extends AssociationFaultStore {
  Future<void> Function(SaleAtomicSnapshot)? afterSnapshot;
  Future<void> Function()? beforeTransaction;
  final plans = <Map<String, String>>[];
  CheckoutAssociatedTestStore(super.inner);
  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) async {
    final result = await super.readSnapshot(scope);
    await afterSnapshot?.call(result);
    return result;
  }

  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) async {
    await beforeTransaction?.call();
    return super.transact(scope, (snapshot) {
      final plan = decide(snapshot);
      plans.add(plan.writes);
      return plan;
    });
  }

  @override
  Future<bool> compareAndSet(String key, String? expected, String value) =>
      throw StateError('New preparation must not use sequential CAS');
}

void checkoutAssociatedPreparationCases(
  Future<AtomicSaleMutationStore> Function(String name) open, {
  required Future<void> Function(String name, String key)
  deleteTemporaryEvidence,
}) {
  late String name;
  late AtomicSaleMutationStore raw;
  late CheckoutAssociatedTestStore store;
  late CheckoutSaleSession session;
  late CheckoutSalePreparation preparation;
  var queries = 0;
  final connections = <AtomicSaleMutationStore>[];
  Future<AtomicSaleMutationStore> connect(String name) async {
    final result = await open(name);
    connections.add(result);
    return result;
  }

  CheckoutSalePreparation adapter(
    AtomicSaleMutationStore store,
    CheckoutSaleSession session,
  ) => CheckoutSalePreparation(
    store: store,
    session: session,
    lookup: (_, command) async {
      queries++;
      throw StateError('No lookup is authorized by associated preparation');
    },
  );
  Future<Map<String, String>> records([AtomicSaleMutationStore? source]) async {
    final database = source ?? raw;
    return {
      for (final key in await database.keys(''))
        key: (await database.read(key))!,
    };
  }

  setUp(() async {
    name = SaleMutationCommand.newIdentity();
    raw = await connect(name);
    store = CheckoutAssociatedTestStore(raw);
    session = CheckoutSaleSession(checkoutContext());
    queries = 0;
    preparation = adapter(store, session);
  });
  tearDown(() async {
    expect(queries, 0);
    for (final connection in connections) {
      await connection.close();
    }
    connections.clear();
  });

  test(
    'explicit V2 preparation freezes input synchronously and commits exactly three records',
    () async {
      final draft = checkoutDraft();
      final candidate = preparation.newAssociatedPurchase(draft);
      (draft['items'] as List).single['quantity'] = 999;
      draft['paymentMethod'] = 'changed';
      expect(await records(), isEmpty);
      final handle = await preparation.persistAssociated(candidate);
      expect(handle.attempt.payload['items'][0]['quantity'], 1);
      expect(handle.attempt.payload['paymentMethod'], 'PIX');
      expect(handle.attempt.state, SaleAttemptState.persisted);
      expect(handle.attempt.prepared, false);
      expect(store.plans, hasLength(1));
      expect(store.plans.single, hasLength(3));
      expect(await records(), hasLength(3));
      final metadata = (await records()).values
          .map((v) => saleObject(jsonDecode(v)))
          .where((r) => r.containsKey('version'));
      expect(metadata.map((r) => r['version']).toList(), [2, 2]);
      expect(handle.attempt.requestId, isNot(candidate.reference.intentKey));
      expect(
        metadata.every(
          (r) => !r.containsKey('saleId') && !r.containsKey('requestId'),
        ),
        true,
      );
    },
  );

  test(
    'repeat candidate and explicit resume preserve original ID, command and all bytes',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      final first = await preparation.persistAssociated(candidate);
      final before = await records();
      final repeated = await preparation.persistAssociated(candidate);
      final resumed = await preparation.resumeAssociated(first.reference);
      expect(repeated.attempt.requestId, first.attempt.requestId);
      expect(resumed.attempt.payload, first.attempt.payload);
      expect(await records(), before);
    },
  );

  test(
    'concurrent repetitions of the same candidate share one atomic operation',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      final entered = Completer<void>();
      final release = Completer<void>();
      store.afterSnapshot = (_) async {
        if (!entered.isCompleted) entered.complete();
        await release.future;
      };
      final first = preparation.persistAssociated(candidate);
      await entered.future;
      final second = preparation.persistAssociated(candidate);
      release.complete();
      final handles = await Future.wait([first, second]);
      expect(handles[0].attempt.requestId, handles[1].attempt.requestId);
      expect(store.plans, hasLength(1));
      expect(await records(), hasLength(3));
    },
  );

  test(
    'invalid new draft does not invalidate an already captured candidate',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      expect(
        () => preparation.newAssociatedPurchase({
          ...checkoutDraft(),
          'expectedTotalCents': -1,
        }),
        throwsFormatException,
      );
      final handle = await preparation.persistAssociated(candidate);
      expect(handle.reference.intentKey, candidate.reference.intentKey);
      expect(await records(), hasLength(3));
    },
  );

  test(
    'tampered canonical pointer blocks resume without rewriting any record',
    () async {
      final handle = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      final entry = (await records()).entries.singleWhere(
        (e) => e.key.contains('checkout-binding:'),
      );
      final binding = saleObject(jsonDecode(entry.value))..remove('integrity');
      binding['ledgerKey'] = 'foreign';
      final corrupt = saleJson({...binding, 'integrity': saleHash(binding)});
      await raw.compareAndSet(entry.key, entry.value, corrupt);
      final before = await records();
      await expectLater(
        preparation.resumeAssociated(handle.reference),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
      expect(await records(), before);
    },
  );

  test(
    'resume never repairs original evidence deleted between read and atomic validation',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      final handle = await preparation.persistAssociated(candidate);
      final key = (await records()).keys.singleWhere(
        (k) => k.contains('checkout-candidate:'),
      );
      store.beforeTransaction = () async {
        store.beforeTransaction = null;
        await deleteTemporaryEvidence(name, key);
      };
      await expectLater(
        preparation.resumeAssociated(handle.reference),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
      final remaining = await records();
      expect(remaining, hasLength(2));
      expect(remaining.containsKey(key), false);
    },
  );

  test('two identical purchases are independent explicit intentions', () async {
    final a = preparation.newAssociatedPurchase(checkoutDraft());
    final ha = await preparation.persistAssociated(a);
    final b = preparation.newAssociatedPurchase(checkoutDraft());
    final hb = await preparation.persistAssociated(b);
    expect(b.reference.intentKey, isNot(a.reference.intentKey));
    expect(hb.attempt.requestId, isNot(ha.attempt.requestId));
    expect(await records(), hasLength(6));
    await expectLater(preparation.persistAssociated(a), throwsStateError);
  });

  test(
    'reopened connection/session resumes without caller draft or new records',
    () async {
      final first = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      final before = await records();
      await raw.close();
      connections.remove(raw);
      raw = await connect(name);
      final reopened = adapter(raw, CheckoutSaleSession(checkoutContext()));
      final handle = await reopened.resumeAssociated(
        CheckoutSaleReference(
          context: checkoutContext(),
          intentKey: first.reference.intentKey,
        ),
      );
      expect(handle.attempt.requestId, first.attempt.requestId);
      expect(handle.attempt.payload, first.attempt.payload);
      expect(await records(), before);
    },
  );

  for (final divergent in [false, true]) {
    test(
      'two connections ${divergent ? 'preserve conflicting candidate' : 'adopt winner'} on one intentKey',
      () async {
        final candidate = preparation.newAssociatedPurchase(checkoutDraft());
        final secondRaw = await connect(name);
        final other = adapter(
          secondRaw,
          CheckoutSaleSession(checkoutContext()),
        );
        final contender = other.candidateForAssociatedIntention(
          candidate.reference,
          {...checkoutDraft(), if (divergent) 'notes': 'different'},
        );
        // Both execute concurrently. An existing-only contender that observes
        // absence must block, then may retry that same candidate after COMMIT.
        final concurrent = other
            .persistAssociated(contender)
            .then<Object>(
              (h) => h,
              onError: (Object e) {
                if (e is CheckoutAssociatedBlocked ||
                    e is CheckoutAssociatedConflict) {
                  return e;
                }
                throw e;
              },
            );
        final first = await preparation.persistAssociated(candidate);
        final observation = await concurrent;
        if (divergent) {
          if (observation is CheckoutAssociatedBlocked) {
            await expectLater(
              other.persistAssociated(contender),
              throwsA(
                isA<CheckoutAssociatedConflict>().having(
                  (e) => e.original.requestId,
                  'original ID',
                  first.attempt.requestId,
                ),
              ),
            );
          } else {
            expect(
              observation,
              isA<CheckoutAssociatedConflict>().having(
                (e) => e.original.requestId,
                'original ID',
                first.attempt.requestId,
              ),
            );
          }
          expect(
            (await other.readAssociatedCandidate(
              candidate.reference,
              contender.candidateId,
            ))['intent']['notes'],
            'different',
          );
        } else {
          final adopted = observation is CheckoutAssociatedBlocked
              ? await other.persistAssociated(contender)
              : observation as CheckoutAssociatedHandle;
          expect(adopted.attempt.requestId, first.attempt.requestId);
        }
        expect(await records(), hasLength(4));
      },
    );
  }

  test(
    'before-commit failure leaves no partial sale and cannot automatically recreate',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      store.before = true;
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsStateError,
      );
      expect(await records(), isEmpty);
      store.before = false;
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
      final remaining = await records();
      expect(remaining, hasLength(1));
      expect(remaining.keys.single, contains('checkout-candidate:'));
      await expectLater(
        preparation.resumeAssociated(candidate.reference),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
    },
  );

  test(
    'lost commit response resumes exact identity and never uses fallback CAS',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      store.after = true;
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsStateError,
      );
      final before = await records();
      expect(before, hasLength(3));
      store.after = false;
      final recovered = await preparation.resumeAssociated(candidate.reference);
      final retried = await preparation.persistAssociated(candidate);
      expect(retried.attempt.requestId, recovered.attempt.requestId);
      expect(await records(), before);
    },
  );

  test(
    'divergence reports conflict only with durable evidence; original never replaced',
    () async {
      final first = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      final before = await records();
      final divergent = preparation.candidateForAssociatedIntention(
        first.reference,
        {...checkoutDraft(), 'notes': 'divergent'},
      );
      await expectLater(
        preparation.persistAssociated(divergent),
        throwsA(
          isA<CheckoutAssociatedConflict>()
              .having((e) => e.candidatePersisted, 'durable', true)
              .having(
                (e) => e.candidate,
                'candidate retained',
                same(divergent),
              ),
        ),
      );
      final after = await records();
      for (final e in before.entries) {
        expect(after[e.key], e.value);
      }
      expect(after, hasLength(4));
      final diagnostic = await preparation.readAssociatedCandidate(
        first.reference,
        divergent.candidateId,
      );
      expect(diagnostic['intent']['notes'], 'divergent');
      final resumed = await preparation.resumeAssociated(first.reference);
      expect(resumed.attempt.payload, first.attempt.payload);
    },
  );

  test(
    'failed diagnostic commit propagates storage failure and preserves in-memory candidate',
    () async {
      final first = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      final before = await records();
      final candidate = preparation.candidateForAssociatedIntention(
        first.reference,
        {...checkoutDraft(), 'notes': 'not-saved'},
      );
      store.before = true;
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsStateError,
      );
      expect(candidate.draft['notes'], 'not-saved');
      expect(await records(), before);
      store.before = false;
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsA(isA<CheckoutAssociatedConflict>()),
      );
    },
  );

  test(
    'V1 gap blocked unchanged; V1 complete record remains V1 and resumable only via legacy API',
    () async {
      final legacy = adapter(raw, session);
      final gap = legacy.newPurchase(checkoutDraft());
      // Produce historical evidence using the unchanged V1 producer and fail its
      // ledger CAS; no new implementation is used to manufacture a V1 sale ID.
      final historical = _LegacyGapStore(raw);
      final old = CheckoutSalePreparation(store: historical, session: session);
      await expectLater(old.persist(gap), throwsStateError);
      final gapBefore = await records();
      expect(gapBefore, hasLength(2));
      await expectLater(
        preparation.resumeAssociated(gap.reference),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
      expect(await records(), gapBefore);
      final known = await legacy.persist(legacy.newPurchase(checkoutDraft()));
      final completeBefore = await records();
      await expectLater(
        preparation.resumeAssociated(known.reference),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
      expect(
        (await legacy.resume(known.reference)).attempt.requestId,
        known.attempt.requestId,
      );
      expect(await records(), completeBefore);
    },
  );

  for (final missing in [
    'checkout-binding:',
    'checkout-candidate:',
    'confirmSaleV2:',
  ]) {
    test(
      'V2 partial set missing $missing never inferred or repaired',
      () async {
        final first = await preparation.persistAssociated(
          preparation.newAssociatedPurchase(checkoutDraft()),
        );
        final destination = await connect(SaleMutationCommand.newIdentity());
        for (final e in (await records()).entries.where(
          (e) => !e.key.contains(missing),
        )) {
          await destination.compareAndSet(e.key, null, e.value);
        }
        final before = await records(destination);
        final resumed = adapter(
          destination,
          CheckoutSaleSession(checkoutContext()),
        );
        await expectLater(
          resumed.resumeAssociated(first.reference),
          throwsA(isA<CheckoutAssociatedBlocked>()),
        );
        expect(await records(destination), before);
      },
    );
  }

  test(
    'missing known reference never creates identity or diagnostic record',
    () async {
      final ref = CheckoutSaleReference(
        context: checkoutContext(),
        intentKey: 'missing',
      );
      await expectLater(
        preparation.resumeAssociated(ref),
        throwsA(isA<CheckoutAssociatedBlocked>()),
      );
      expect(await records(), isEmpty);
    },
  );

  for (final other in [
    checkoutContext(project: 'other'),
    checkoutContext(uid: 'other'),
    checkoutContext(store: 'other'),
    checkoutContext(endpoint: 'localhost:9080'),
  ]) {
    test(
      'foreign context ${other.scope.prefix}/${other.target} blocked without exposure',
      () async {
        final candidate = preparation.newAssociatedPurchase(checkoutDraft());
        final first = await preparation.persistAssociated(candidate);
        final before = await records();
        session.change(other);
        await expectLater(
          preparation.persistAssociated(candidate),
          throwsStateError,
        );
        await expectLater(
          preparation.resumeAssociated(first.reference),
          throwsStateError,
        );
        final foreignRef = CheckoutSaleReference(
          context: other,
          intentKey: first.reference.intentKey,
        );
        await expectLater(
          preparation.resumeAssociated(foreignRef),
          throwsA(isA<CheckoutAssociatedBlocked>()),
        );
        expect(await records(), before);
      },
    );
  }

  test(
    'ABA during read before commit rejects obsolete callback with zero writes',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      store.afterSnapshot = (_) async {
        session.change(checkoutContext(uid: 'other'));
        session.change(checkoutContext());
      };
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsStateError,
      );
      expect(await records(), isEmpty);
    },
  );

  test(
    'ABA after commit preserves original namespace; new generation resumes stable ID',
    () async {
      final candidate = preparation.newAssociatedPurchase(checkoutDraft());
      store.afterCommit = () {
        session.change(checkoutContext(uid: 'other'));
        session.change(checkoutContext());
      };
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsStateError,
      );
      final before = await records();
      expect(before, hasLength(3));
      store.afterCommit = null;
      final resumed = await preparation.resumeAssociated(candidate.reference);
      expect(
        resumed.attempt.payload['scope'],
        checkoutContext().scope.toJson(),
      );
      expect(await records(), before);
      await expectLater(
        preparation.persistAssociated(candidate),
        throwsStateError,
      );
    },
  );

  test(
    'late read after screen close cannot publish a recovered handle',
    () async {
      final first = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      final before = await records();
      final entered = Completer<void>();
      final release = Completer<void>();
      store.afterSnapshot = (_) async {
        if (!entered.isCompleted) entered.complete();
        await release.future;
      };
      final pending = preparation.resumeAssociated(first.reference);
      final assertion = expectLater(pending, throwsStateError);
      await entered.future;
      session.change(null);
      release.complete();
      await assertion;
      expect(await records(), before);
    },
  );

  test(
    'store without atomic capability refuses before writes or session attachment',
    () async {
      final legacy = CheckoutSalePreparation(
        store: AssociationLegacyStore(),
        session: session,
      );
      expect(
        () => legacy.newAssociatedPurchase(checkoutDraft()),
        throwsUnsupportedError,
      );
      await expectLater(
        legacy.resumeAssociated(
          CheckoutSaleReference(context: checkoutContext(), intentKey: 'known'),
        ),
        throwsUnsupportedError,
      );
      expect(await records(), isEmpty);
    },
  );

  test('closed storage refuses preparation; no partial success', () async {
    final candidate = preparation.newAssociatedPurchase(checkoutDraft());
    await raw.close();
    connections.remove(raw);
    await expectLater(
      preparation.persistAssociated(candidate),
      throwsA(anything),
    );
  });

  test(
    'UNKNOWN retains command, state and receipt fields without lookup or send',
    () async {
      final first = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      final entry = (await records()).entries.singleWhere(
        (e) => e.key.contains('confirmSaleV2:'),
      );
      final record = saleObject(jsonDecode(entry.value))..remove('recordHash');
      record['state'] = 'unknown';
      record['prepared'] = true;
      final unknown = saleJson({...record, 'recordHash': saleHash(record)});
      await raw.compareAndSet(entry.key, entry.value, unknown);
      final before = await records();
      final result = await preparation.resumeAssociated(first.reference);
      expect(result.attempt.state, SaleAttemptState.unknown);
      expect(result.attempt.payload, first.attempt.payload);
      expect(await records(), before);
    },
  );

  test(
    'B07-C unwrapped records and PendingSales sentinel untouched by new path',
    () async {
      const key = 'historical-unwrapped-ledger';
      const value = '{"untouched":"B07-C/PendingSales"}';
      await raw.compareAndSet(key, null, value);
      final handle = await preparation.persistAssociated(
        preparation.newAssociatedPurchase(checkoutDraft()),
      );
      await preparation.resumeAssociated(handle.reference);
      expect(await raw.read(key), value);
      final canonical = saleObject(
        jsonDecode(
          (await records()).values.singleWhere(
            (v) => v.contains('"protocol":"sale-v2"'),
          ),
        ),
      );
      final hash = canonical.remove('recordHash');
      expect(hash, saleHash(canonical));
      expect(canonical['commandHash'], handle.attempt.command.integrityHash);
      expect(canonical['command'], handle.attempt.payload);
      expect(canonical['ledgerVersion'], 1);
    },
  );
}

class _LegacyGapStore implements SaleMutationStore {
  final SaleMutationStore inner;
  _LegacyGapStore(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<void> close() => inner.close();
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) {
    if (key.contains('confirmSaleV2:')) {
      throw StateError('historical crash gap');
    }
    return inner.compareAndSet(key, expected, value);
  }
}
