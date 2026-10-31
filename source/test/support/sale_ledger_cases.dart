import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';

const saleScope = SaleMutationScope(
  projectId: 'demo-f9-b07c',
  uid: 'u',
  storeId: 's',
);
Map<String, dynamic> saleIntent() => {
  'items': [
    {'productId': 'p', 'quantity': 1, 'expectedUnitPriceCents': 29},
  ],
  'expectedTotalCents': 29,
  'paymentMethod': 'PIX',
  'notes': ' original ',
  'customerId': null,
};

class SaleTestTransport implements SaleMutationTransport {
  final sent = <Map<String, dynamic>>[];
  final queried = <Map<String, dynamic>>[];
  Map<String, dynamic>? receipt;
  Future<Map<String, dynamic>> Function(Map<String, dynamic>)? sending;
  Future<Map<String, dynamic>> Function(Map<String, dynamic>)? querying;
  Map<String, dynamic> confirmed(Map<String, dynamic> c) => {
    'status': 'confirmed',
    'saleId': c['saleId'],
    'totalCents': c['expectedTotalCents'],
    'replayed': false,
  };
  @override
  Future<Map<String, dynamic>> send(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) async {
    sent.add(command);
    if (sending != null) return sending!(command);
    return receipt = confirmed(command);
  }

  @override
  Future<Map<String, dynamic>> recover(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) async {
    queried.add(command);
    if (querying != null) return querying!(command);
    return receipt ??
        {
          'status': 'not-recorded',
          'saleId': command['saleId'],
          'definitive': false,
        };
  }
}

class FailingSaleStore implements SaleMutationStore {
  final SaleMutationStore inner;
  bool Function(String value)? fail;
  FailingSaleStore(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) {
    if (fail?.call(value) == true) throw StateError('injected disk failure');
    return inner.compareAndSet(key, expected, value);
  }

  @override
  Future<void> close() => inner.close();
}

// Same behavioral suite runs on VM, host SQLite and browser IndexedDB.
void saleLedgerCases(Future<SaleMutationStore> Function(String name) open) {
  var sequence = 0;
  Future<SaleMutationStore> fresh() =>
      open('sale_${DateTime.now().microsecondsSinceEpoch}_${sequence++}');
  SaleMutationLedger ledger(
    SaleMutationStore store,
    SaleTestTransport remote, {
    Future<SaleMutationScope?> Function()? active,
    DateTime Function()? now,
  }) => SaleMutationLedger(
    store: store,
    transport: remote,
    activeScope: active ?? () async => saleScope,
    now: now,
  );
  Future<SaleMutationAttempt> prepare(
    SaleMutationLedger l, [
    String key = 'intent',
  ]) async {
    await l.reserve(saleScope, key, saleIntent());
    return l.prepare(saleScope, key);
  }

  test(
    'actual coordinator deadline stays unknown and late remote commit is recovered',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = SaleMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => saleScope,
        callTimeout: const Duration(milliseconds: 20),
      );
      final original = await prepare(l);
      final pending = Completer<Map<String, dynamic>>();
      remote.sending = (_) => pending.future;
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.unknown,
      );
      remote.receipt = remote.confirmed(original.payload);
      pending.complete(remote.receipt!);
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      expect(remote.sent.length, 1);
    },
  );
  test(
    'closed durable store blocks submission without memory fallback',
    () async {
      final store = await fresh();
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      await store.close();
      await expectLater(
        l.reserve(saleScope, 'intent', saleIntent()),
        throwsA(anything),
      );
      expect(remote.sent, isEmpty);
    },
  );
  test(
    'writer rejection is durable and same intention cannot be resurrected',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      await prepare(l);
      remote.sending = (c) async => {
        'status': 'rejected',
        'saleId': c['saleId'],
        'reason': 'insufficient-stock',
        'replayed': false,
      };
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.rejected,
      );
      remote.sending = null;
      await l.prepare(saleScope, 'intent');
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.rejected,
      );
      expect(remote.sent.length, 1);
    },
  );

  test(
    'command committed before writer and detached from cart and caller',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      final cart = saleIntent();
      final reserved = await l.reserve(saleScope, 'intent', cart);
      (cart['items'] as List).clear();
      cart['notes'] = 'changed';
      final detached = reserved.payload;
      (detached['items'] as List).clear();
      await expectLater(l.send(saleScope, 'intent'), throwsStateError);
      expect(remote.sent, isEmpty);
      await l.prepare(saleScope, 'intent');
      remote.sending = (command) async {
        final persisted = await l.load(saleScope, 'intent');
        expect(persisted.state, SaleAttemptState.sending);
        expect(persisted.payload, command);
        expect(command['notes'], ' original ');
        return remote.confirmed(command);
      };
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
    },
  );
  test(
    'timeout before commit queries not-recorded then retries original identity and payload',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      final original = await prepare(l);
      remote.sending = (_) async => throw TimeoutException('before commit');
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.unknown,
      );
      expect(
        (await l.recover(saleScope, 'intent')).state,
        SaleAttemptState.unknown,
      );
      remote.sending = null;
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      expect(remote.sent, [original.payload, original.payload]);
      expect(remote.queried, [original.payload, original.payload]);
    },
  );
  test(
    'timeout after commit recovers confirmation without second writer',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      await prepare(l);
      remote.sending = (c) async {
        remote.receipt = remote.confirmed(c);
        throw TimeoutException('after commit');
      };
      await l.send(saleScope, 'intent');
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      expect(remote.sent.length, 1);
    },
  );
  for (final status in ['rejected', 'identity-conflict']) {
    test('$status from query is terminal and never resent', () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      final original = await prepare(l);
      remote.sending = (_) async => throw TimeoutException('lost');
      await l.send(saleScope, 'intent');
      remote.receipt = {
        'status': status,
        'saleId': original.requestId,
        if (status == 'rejected') 'reason': 'price-changed',
        if (status == 'rejected') 'replayed': true,
      };
      final finalState = status == 'rejected'
          ? SaleAttemptState.rejected
          : SaleAttemptState.identityConflict;
      expect((await l.recover(saleScope, 'intent')).state, finalState);
      expect((await l.send(saleScope, 'intent')).state, finalState);
      expect(remote.sent.length, 1);
    });
  }
  test('failed or malformed query does not authorize retry', () async {
    final store = await fresh();
    addTearDown(store.close);
    final remote = SaleTestTransport();
    final l = ledger(store, remote);
    await prepare(l);
    remote.sending = (_) async => throw TimeoutException('lost');
    await l.send(saleScope, 'intent');
    remote.querying = (_) async => throw StateError('offline');
    await l.send(saleScope, 'intent');
    remote.querying = (_) async => {
      'status': 'confirmed',
      'saleId': 'other',
      'totalCents': 29,
      'replayed': true,
    };
    expect((await l.send(saleScope, 'intent')).state, SaleAttemptState.unknown);
    expect(remote.sent.length, 1);
  });
  test('failure reserving or committing sending prevents writer', () async {
    final base = await fresh();
    final store = FailingSaleStore(base);
    addTearDown(store.close);
    final remote = SaleTestTransport();
    final l = ledger(store, remote);
    store.fail = (_) => true;
    await expectLater(
      l.reserve(saleScope, 'intent', saleIntent()),
      throwsStateError,
    );
    expect(remote.sent, isEmpty);
    store.fail = null;
    await prepare(l);
    store.fail = (v) => jsonDecode(v)['state'] == 'sending';
    await expectLater(l.send(saleScope, 'intent'), throwsStateError);
    expect(remote.sent, isEmpty);
    expect(
      (await l.load(saleScope, 'intent')).state,
      SaleAttemptState.persisted,
    );
  });
  test(
    'confirmation write failure remains recoverable with same identity',
    () async {
      final base = await fresh();
      final store = FailingSaleStore(base);
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      final original = await prepare(l);
      store.fail = (v) => jsonDecode(v)['state'] == 'confirmed';
      await expectLater(l.send(saleScope, 'intent'), throwsStateError);
      store.fail = null;
      expect(
        (await l.reopen(saleScope)).single.state,
        SaleAttemptState.unknown,
      );
      expect(
        (await l.recover(saleScope, 'intent')).requestId,
        original.requestId,
      );
      expect(
        (await l.load(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      expect(remote.sent.length, 1);
    },
  );
  test(
    'different commercial intentions with identical content have distinct IDs',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      final a = await prepare(l, 'a');
      final b = await prepare(l, 'b');
      expect(a.requestId, isNot(b.requestId));
      expect(
        (await l.reserve(saleScope, 'a', saleIntent())).requestId,
        a.requestId,
      );
      await expectLater(
        l.reserve(saleScope, 'a', {...saleIntent(), 'notes': 'incompatible'}),
        throwsStateError,
      );
      expect((await l.load(saleScope, 'a')).payload, a.payload);
    },
  );
  test(
    'account store project changes suspend network and preserve old pending command',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      var active = saleScope;
      final l = ledger(store, remote, active: () async => active);
      final original = await prepare(l);
      for (final changed in [
        const SaleMutationScope(
          projectId: 'demo-f9-b07c',
          uid: 'other',
          storeId: 's',
        ),
        const SaleMutationScope(
          projectId: 'demo-f9-b07c',
          uid: 'u',
          storeId: 'other',
        ),
        const SaleMutationScope(
          projectId: 'hml-project',
          uid: 'u',
          storeId: 's',
        ),
        const SaleMutationScope(
          projectId: 'prod-project',
          uid: 'u',
          storeId: 's',
        ),
      ]) {
        active = changed;
        await expectLater(l.send(saleScope, 'intent'), throwsStateError);
        await expectLater(l.recover(saleScope, 'intent'), throwsStateError);
        final separate = await l.reserve(changed, 'intent', saleIntent());
        expect(separate.requestId, isNot(original.requestId));
        expect((await l.load(saleScope, 'intent')).payload, original.payload);
      }
      expect(remote.sent, isEmpty);
      expect(remote.queried, isEmpty);
    },
  );
  test(
    'late failure after concurrent query confirmation cannot regress terminal state',
    () async {
      final store = await fresh();
      addTearDown(store.close);
      final remote = SaleTestTransport();
      final l = ledger(store, remote);
      await prepare(l);
      final pending = Completer<Map<String, dynamic>>();
      remote.sending = (c) {
        remote.receipt = remote.confirmed(c);
        return pending.future;
      };
      final sending = l.send(saleScope, 'intent');
      while (remote.sent.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(
        (await l.recover(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      pending.completeError(TimeoutException('late'));
      expect((await sending).state, SaleAttemptState.confirmed);
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      expect(remote.sent.length, 1);
    },
  );
  test('record or local hash corruption blocks recovery and send', () async {
    final store = await fresh();
    addTearDown(store.close);
    final remote = SaleTestTransport();
    final l = ledger(store, remote);
    await prepare(l);
    final key = (await store.keys(saleScope.prefix)).single;
    final raw = (await store.read(key))!;
    final damaged = saleObject(jsonDecode(raw));
    damaged['commandHash'] = 'corrupt';
    await store.compareAndSet(key, raw, jsonEncode(damaged));
    await expectLater(l.send(saleScope, 'intent'), throwsFormatException);
    await expectLater(l.reopen(saleScope), throwsFormatException);
    expect(remote.sent, isEmpty);
  });
  test(
    'two connections reserve once and only one CAS claim invokes writer',
    () async {
      final name =
          'concurrent_${DateTime.now().microsecondsSinceEpoch}_${sequence++}';
      final first = await open(name);
      final second = await open(name);
      addTearDown(first.close);
      addTearDown(second.close);
      final remote = SaleTestTransport();
      final a = ledger(first, remote);
      final b = ledger(second, remote);
      final reserved = await Future.wait([
        a.reserve(saleScope, 'intent', saleIntent()),
        b.reserve(saleScope, 'intent', saleIntent()),
      ]);
      expect(reserved.first.requestId, reserved.last.requestId);
      await a.prepare(saleScope, 'intent');
      final pending = Completer<Map<String, dynamic>>();
      remote.sending = (_) => pending.future;
      final calls = [a.send(saleScope, 'intent'), b.send(saleScope, 'intent')];
      while (remote.sent.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(remote.sent.length, 1);
      expect(
        (await b.reopen(saleScope)).single.state,
        SaleAttemptState.unknown,
      );
      expect(
        (await b.send(saleScope, 'intent')).state,
        SaleAttemptState.unknown,
      );
      expect(remote.sent.length, 1);
      pending.complete(remote.confirmed(reserved.first.payload));
      await Future.wait(calls);
      expect(
        (await b.load(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
    },
  );
  test(
    'reopen after reservation before preparation resumes same frozen command',
    () async {
      final name =
          'reopen_${DateTime.now().microsecondsSinceEpoch}_${sequence++}';
      var store = await open(name);
      final remote = SaleTestTransport();
      final original = await ledger(
        store,
        remote,
      ).reserve(saleScope, 'intent', saleIntent());
      await store.close();
      store = await open(name);
      addTearDown(store.close);
      final l = ledger(store, remote);
      final resumed = (await l.reopen(saleScope)).single;
      expect(resumed.requestId, original.requestId);
      expect(resumed.payload, original.payload);
      expect(resumed.prepared, false);
      await l.prepare(saleScope, 'intent');
      await l.send(saleScope, 'intent');
      expect(remote.sent.single, original.payload);
    },
  );
  test(
    'crash while sending retains lease then queries before retry after reopening',
    () async {
      final name =
          'crash_${DateTime.now().microsecondsSinceEpoch}_${sequence++}';
      var time = DateTime.utc(2026);
      var store = await open(name);
      final remote = SaleTestTransport();
      final originalLedger = ledger(store, remote, now: () => time);
      final original = await prepare(originalLedger);
      final pending = Completer<Map<String, dynamic>>();
      remote.sending = (_) => pending.future;
      final interrupted = originalLedger.send(saleScope, 'intent');
      while (remote.sent.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      await store.close();
      pending.completeError(StateError('process ended'));
      await expectLater(interrupted, throwsA(anything));
      store = await open(name);
      addTearDown(store.close);
      final l = ledger(store, remote, now: () => time);
      expect(
        (await l.reopen(saleScope)).single.state,
        SaleAttemptState.unknown,
      );
      await l.send(saleScope, 'intent');
      expect(remote.sent.length, 1);
      time = time.add(const Duration(minutes: 1));
      remote.sending = null;
      expect(
        (await l.send(saleScope, 'intent')).state,
        SaleAttemptState.confirmed,
      );
      expect(remote.sent, [original.payload, original.payload]);
      expect(remote.queried.length, 2);
    },
  );
}
