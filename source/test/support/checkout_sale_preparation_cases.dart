import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';

CheckoutSaleContext checkoutContext({
  String project = 'demo-checkout',
  String uid = 'u',
  String store = 's',
  String endpoint = 'localhost:8080',
}) => CheckoutSaleContext(
  scope: SaleMutationScope(projectId: project, uid: uid, storeId: store),
  environment: 'synthetic',
  firestoreEndpoint: endpoint,
  functionsEndpoint: 'localhost:5001',
);
Map<String, dynamic> checkoutDraft() => {
  'items': [
    {'productId': 'p', 'quantity': 1, 'expectedUnitPriceCents': 29},
  ],
  'expectedTotalCents': 29,
  'paymentMethod': 'PIX',
  'notes': 'original',
};

class CheckoutTestStore implements SaleMutationStore {
  final SaleMutationStore inner;
  Future<void> Function(String key, String value)? afterWrite;
  bool Function(String key, String value)? failWrite;
  CheckoutTestStore(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    if (failWrite?.call(key, value) == true) {
      throw StateError('Synthetic disk/quota error.');
    }
    final changed = await inner.compareAndSet(key, expected, value);
    if (changed && afterWrite != null) await afterWrite!(key, value);
    return changed;
  }

  @override
  Future<void> close() => inner.close();
}

void checkoutPreparationCases(
  Future<SaleMutationStore> Function(String name) open,
) {
  late String name;
  late SaleMutationStore store;
  late CheckoutSaleSession session;
  late CheckoutSalePreparation preparation;
  var queries = 0;
  final connections = <SaleMutationStore>[];
  Future<SaleMutationStore> connect(String name) async {
    final value = await open(name);
    connections.add(value);
    return value;
  }

  setUp(() async {
    name = 'checkout_${SaleMutationCommand.newIdentity()}';
    store = await connect(name);
    session = CheckoutSaleSession(checkoutContext());
    queries = 0;
    preparation = CheckoutSalePreparation(
      store: store,
      session: session,
      lookup: (scope, command) async {
        queries++;
        return {
          'status': 'not-recorded',
          'saleId': command['saleId'],
          'definitive': false,
        };
      },
    );
  });
  tearDown(() async {
    for (final connection in connections) {
      await connection.close();
    }
    connections.clear();
  });

  Future<void> seedUncertain(
    CheckoutSaleHandle handle, {
    String state = 'unknown',
  }) async {
    // Synthetic interrupted B07-C record. No commercial transport is invoked.
    for (final key in await store.keys('checkout-v1:')) {
      final record = saleObject(jsonDecode((await store.read(key))!));
      if (record['protocol'] != 'sale-v2' ||
          record['intentKey'] != handle.reference.intentKey) {
        continue;
      }
      final before = (await store.read(key))!;
      record.remove('recordHash');
      record['state'] = state;
      record['prepared'] = true;
      final after = saleJson({...record, 'recordHash': saleHash(record)});
      expect(await store.compareAndSet(key, before, after), isTrue);
      return;
    }
    fail('Synthetic ledger record not found.');
  }

  Map<String, dynamic> confirmed(Map<String, dynamic> command) => {
    'status': 'confirmed',
    'saleId': command['saleId'],
    'totalCents': command['expectedTotalCents'],
    'replayed': true,
  };

  test(
    'snapshot freezes synchronously; durable identity precedes any query',
    () async {
      final draft = checkoutDraft();
      final candidate = preparation.newPurchase(draft);
      (draft['items'] as List).single['quantity'] = 9;
      final handle = await preparation.persist(candidate);
      expect(handle.attempt.payload['items'][0]['quantity'], 1);
      expect(handle.attempt.prepared, isFalse);
      expect(queries, 0);
      expect(
        (await preparation.resume(candidate.reference)).attempt.requestId,
        handle.attempt.requestId,
      );
      expect(
        (await preparation.persist(candidate)).attempt.requestId,
        handle.attempt.requestId,
      );
      expect(
        handle.attempt.command.integrityHash,
        SaleMutationCommand.fromJson(handle.attempt.payload).integrityHash,
      );
      expect(
        handle.attempt.payload['scope'],
        candidate.reference.context.scope.toJson(),
      );
      expect(handle.attempt.payload.containsKey('target'), isFalse);
    },
  );

  test(
    'two equal legitimate purchases have distinct intentKey and sale ID',
    () async {
      final a = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      final b = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      expect(a.reference.intentKey, isNot(b.reference.intentKey));
      expect(a.attempt.requestId, isNot(b.attempt.requestId));
      expect(queries, 0);
    },
  );

  test(
    'conflict retains original and durable candidate after adapter reopening',
    () async {
      final original = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      final draft = checkoutDraft()..['notes'] = 'conflicting';
      final candidate = preparation.candidateForExisting(
        original.reference,
        draft,
      );
      await expectLater(
        preparation.persist(candidate),
        throwsA(isA<CheckoutSaleConflict>()),
      );
      final reopened = CheckoutSalePreparation(
        store: await connect(name),
        session: session,
      );
      final evidence = await reopened.readCandidate(
        candidate.reference,
        candidate.candidateId,
      );
      expect(evidence['draft']['notes'], 'conflicting');
      final saved = await reopened.resume(original.reference);
      expect(saved.attempt.requestId, original.attempt.requestId);
      expect(saved.attempt.payload['notes'], 'original');
      expect(queries, 0);
    },
  );

  test(
    'failed candidate persistence blocks reservation and retains in-memory draft',
    () async {
      final failing = CheckoutTestStore(store)..failWrite = (_, value) => true;
      final adapter = CheckoutSalePreparation(store: failing, session: session);
      final candidate = adapter.newPurchase(checkoutDraft());
      await expectLater(adapter.persist(candidate), throwsStateError);
      expect(await store.keys(''), isEmpty);
      expect(candidate.draft['notes'], 'original');
      expect(queries, 0);
    },
  );

  test(
    'gap before ledger commit preserves evidence but never regenerates identity',
    () async {
      final failing = CheckoutTestStore(store)
        ..failWrite = (_, value) => value.contains('"protocol":"sale-v2"');
      final adapter = CheckoutSalePreparation(store: failing, session: session);
      final candidate = adapter.newPurchase(checkoutDraft());
      await expectLater(adapter.persist(candidate), throwsStateError);
      failing.failWrite = null;
      await expectLater(adapter.persist(candidate), throwsStateError);
      expect(
        (await adapter.listIntentions()).single.intentKey,
        candidate.reference.intentKey,
      );
      expect(
        (await adapter.readCandidate(
          candidate.reference,
          candidate.candidateId,
        ))['draft'],
        candidate.draft,
      );
      expect(queries, 0);
    },
  );

  test(
    'restart enumerates and resumes exact original identity and payload',
    () async {
      final handle = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      connections.remove(store);
      await store.close();
      final restarted = CheckoutSalePreparation(
        store: await connect(name),
        session: CheckoutSaleSession(checkoutContext()),
      );
      final refs = await restarted.listIntentions();
      final restored = await restarted.resume(refs.single);
      expect(restored.attempt.requestId, handle.attempt.requestId);
      expect(restored.attempt.payload, handle.attempt.payload);
      expect(queries, 0);
    },
  );

  test(
    'interruption after ledger commit resumes committed identity without replacement',
    () async {
      String? committedId;
      final interrupted = CheckoutTestStore(store)
        ..afterWrite = (key, value) async {
          final record = saleObject(jsonDecode(value));
          if (record['protocol'] == 'sale-v2') {
            committedId = record['requestId'] as String;
            throw StateError('Synthetic interruption after COMMIT.');
          }
        };
      final adapter = CheckoutSalePreparation(
        store: interrupted,
        session: session,
      );
      final candidate = adapter.newPurchase(checkoutDraft());
      await expectLater(adapter.persist(candidate), throwsStateError);
      interrupted.afterWrite = null;
      expect(committedId, isNotNull);
      final restored = await adapter.resume(candidate.reference);
      expect(restored.attempt.requestId, committedId);
      expect((await adapter.persist(candidate)).attempt.requestId, committedId);
      expect(queries, 0);
    },
  );

  test(
    'lost storage resume never reserves; retry candidate cannot recreate sale',
    () async {
      final candidate = preparation.newPurchase(checkoutDraft());
      final handle = await preparation.persist(candidate);
      final empty = await connect('${name}_lost');
      final adapter = CheckoutSalePreparation(store: empty, session: session);
      await expectLater(adapter.resume(handle.reference), throwsStateError);
      await expectLater(adapter.persist(candidate), throwsStateError);
      expect(
        (await empty.keys('')).where((k) => k.contains('confirmSaleV2:')),
        isEmpty,
      );
      expect(queries, 0);
    },
  );

  for (final mismatch in [
    checkoutContext(project: 'other'),
    checkoutContext(store: 'other'),
    checkoutContext(uid: 'other'),
    checkoutContext(endpoint: 'localhost:9080'),
  ]) {
    test(
      'context mismatch suspends ${mismatch.scope.prefix}/${mismatch.target}',
      () async {
        final candidate = preparation.newPurchase(checkoutDraft());
        session.change(mismatch);
        await expectLater(preparation.persist(candidate), throwsStateError);
        await expectLater(
          preparation.resume(candidate.reference),
          throwsStateError,
        );
        expect(await store.keys(''), isEmpty);
        expect(queries, 0);
      },
    );
  }

  test(
    'target namespace isolates identical scope without modifying canonical command',
    () async {
      final handle = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      session.change(checkoutContext(endpoint: 'localhost:9080'));
      expect(await preparation.listIntentions(), isEmpty);
      session.change(checkoutContext());
      expect(
        (await preparation.resume(handle.reference)).attempt.payload,
        handle.attempt.payload,
      );
    },
  );

  test(
    'ABA during committed IO invalidates callback and does not reserve ledger',
    () async {
      final entered = Completer<void>();
      final released = Completer<void>();
      final delayed = CheckoutTestStore(store)
        ..afterWrite = (key, value) async {
          if (key.contains('checkout-candidate:')) {
            entered.complete();
            await released.future;
          }
        };
      final adapter = CheckoutSalePreparation(store: delayed, session: session);
      final candidate = adapter.newPurchase(checkoutDraft());
      final pending = adapter.persist(candidate);
      final assertion = expectLater(pending, throwsStateError);
      await entered.future;
      session.change(checkoutContext(uid: 'other'));
      session.change(checkoutContext());
      released.complete();
      await assertion;
      expect(
        (await store.keys('')).where((k) => k.contains('confirmSaleV2:')),
        isEmpty,
      );
      expect(
        (await adapter.readCandidate(
          candidate.reference,
          candidate.candidateId,
        ))['draft'],
        candidate.draft,
      );
    },
  );

  test(
    'unknown and sending can query absence repeatedly without commercial send',
    () async {
      final handle = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      await seedUncertain(handle, state: 'sending');
      var restored = await preparation.resume(handle.reference);
      restored = await preparation.consult(restored);
      restored = await preparation.consult(restored);
      expect(restored.attempt.state, SaleAttemptState.unknown);
      expect(restored.attempt.requestId, handle.attempt.requestId);
      expect(queries, 2);
    },
  );

  test(
    'lookup timeout and later remote completion do not trigger writer or UI',
    () async {
      final handle = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      await seedUncertain(handle);
      final remote = Completer<Map<String, dynamic>>();
      final adapter = CheckoutSalePreparation(
        store: store,
        session: session,
        lookupTimeout: const Duration(milliseconds: 10),
        lookup: (_, command) => remote.future,
      );
      final timedOut = await adapter.consult(
        await adapter.resume(handle.reference),
      );
      expect(timedOut.attempt.state, SaleAttemptState.unknown);
      remote.complete(confirmed(handle.attempt.payload));
      await Future<void>.delayed(Duration.zero);
      expect(
        (await adapter.resume(handle.reference)).attempt.state,
        SaleAttemptState.unknown,
      );
      expect(
        adapter.applyConfirmation(timedOut, () => fail('Must not apply')),
        isFalse,
      );
    },
  );

  test(
    'late query after ABA or closing screen cannot persist/apply old confirmation',
    () async {
      final handle = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      await seedUncertain(handle);
      final remote = Completer<Map<String, dynamic>>();
      final entered = Completer<void>();
      final adapter = CheckoutSalePreparation(
        store: store,
        session: session,
        lookup: (_, command) {
          entered.complete();
          return remote.future;
        },
      );
      final pending = adapter.consult(await adapter.resume(handle.reference));
      final assertion = expectLater(pending, throwsStateError);
      await entered.future;
      session.change(null);
      session.change(checkoutContext());
      remote.complete(confirmed(handle.attempt.payload));
      await assertion;
      expect(
        (await adapter.resume(handle.reference)).attempt.state,
        SaleAttemptState.unknown,
      );
    },
  );

  test(
    'confirmation is durable; synchronous UI gate rejects previous cart generation',
    () async {
      final handle = await preparation.persist(
        preparation.newPurchase(checkoutDraft()),
      );
      await seedUncertain(handle);
      final adapter = CheckoutSalePreparation(
        store: store,
        session: session,
        lookup: (_, command) async => confirmed(command),
      );
      final result = await adapter.consult(
        await adapter.resume(handle.reference),
      );
      var clears = 0;
      session.change(checkoutContext()); // New cart, same uid/store/project.
      expect(adapter.applyConfirmation(result, () => clears++), isFalse);
      final rebound = await adapter.resume(handle.reference);
      expect(rebound.attempt.state, SaleAttemptState.confirmed);
      expect(adapter.applyConfirmation(rebound, () => clears++), isFalse);
      session.attach(
        handle.reference,
      ); // Explicit restoration of THIS checkout.
      final attached = await adapter.resume(handle.reference);
      expect(adapter.applyConfirmation(attached, () => clears++), isTrue);
      expect(adapter.applyConfirmation(attached, () => clears++), isFalse);
      expect(clears, 1);
    },
  );

  test(
    'two connections racing same candidate retain one immutable ledger identity',
    () async {
      final candidate = preparation.newPurchase(checkoutDraft());
      final other = CheckoutSalePreparation(
        store: await connect(name),
        session: session,
      );
      // A racing observer can suspend until the first reservation commits.
      final results = await Future.wait([
        preparation
            .persist(candidate)
            .then<Object>((h) => h, onError: (Object e) => e),
        other
            .persist(candidate)
            .then<Object>((h) => h, onError: (Object e) => e),
      ]);
      expect(results.whereType<CheckoutSaleHandle>(), isNotEmpty);
      final a = await preparation.resume(candidate.reference);
      final b = await other.resume(candidate.reference);
      expect(a.attempt.requestId, b.attempt.requestId);
      expect(
        (await store.keys(
          '',
        )).where((k) => k.contains('confirmSaleV2:')).length,
        1,
      );
      expect(queries, 0);
    },
  );

  test(
    'unwrapped B07-C records and PendingSales sentinel remain untouched',
    () async {
      const legacyKey = 'legacy-ledger-key';
      const sentinelKey = 'PendingSales-test-sentinel';
      await store.compareAndSet(legacyKey, null, 'old-bytes');
      await store.compareAndSet(sentinelKey, null, 'pending-original');
      await preparation.persist(preparation.newPurchase(checkoutDraft()));
      expect(await store.read(legacyKey), 'old-bytes');
      expect(await store.read(sentinelKey), 'pending-original');
      expect(queries, 0);
    },
  );
}
