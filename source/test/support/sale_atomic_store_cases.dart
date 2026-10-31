import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'sale_ledger_cases.dart' show saleIntent, saleScope;

class LegacyOnlySaleStore implements SaleMutationStore {
  int calls = 0;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    calls++;
    throw StateError('Legacy store must not be called.');
  }
}

class NoAtomicCommercialTransport implements SaleMutationTransport {
  int calls = 0;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    calls++;
    throw StateError('No commercial call allowed.');
  }
}

void saleAtomicStoreCases(
  Future<AtomicSaleMutationStore> Function(String name) open,
) {
  late AtomicSaleMutationStore store;
  late SaleAtomicScope scope;
  late List<String> keys;
  late String name;
  final connections = <SaleMutationStore>[];
  Future<AtomicSaleMutationStore> connect(String value) async {
    final connection = await open(value);
    connections.add(connection);
    return connection;
  }

  setUp(() async {
    name = 'atomic_${SaleMutationCommand.newIdentity()}';
    store = await connect(name);
    keys = ['test:scope:a', 'test:scope:b', 'test:scope:c'];
    scope = SaleAtomicScope(namespace: 'test:scope:', keys: keys);
  });
  tearDown(() async {
    for (final connection in connections) {
      await connection.close();
    }
    connections.clear();
  });

  test(
    'three keys commit together with typed result and immutable snapshots',
    () async {
      final result = await store.transact<String>(scope, (before) {
        expect(before.values, {for (final key in keys) key: null});
        expect(() => before.values[keys.first] = 'bad', throwsUnsupportedError);
        return SaleAtomicPlan(
          writes: {for (final key in keys) key: 'original'},
          value: 'created',
        );
      });
      expect(result.value, 'created');
      expect(result.writesApplied, 3);
      expect(result.before.values.values, everyElement(isNull));
      expect(result.after.values.values, everyElement('original'));
      expect((await store.readSnapshot(scope)).values, result.after.values);
      expect(() => result.after.values.clear(), throwsUnsupportedError);
    },
  );

  test(
    'decision exception aborts; old values and unrelated keys survive',
    () async {
      await store.compareAndSet(keys.first, null, 'existing');
      await store.compareAndSet('unrelated', null, 'old bytes');
      final before = await store.readSnapshot(scope);
      await expectLater(
        store.transact<void>(scope, (_) => throw StateError('abort decision')),
        throwsStateError,
      );
      expect((await store.readSnapshot(scope)).values, before.values);
      expect(await store.read('unrelated'), 'old bytes');
    },
  );

  test('out of scope and undeclared writes abort the entire plan', () async {
    for (final outside in ['other:scope:a', 'test:scope:undeclared']) {
      await expectLater(
        store.transact<void>(
          scope,
          (_) => SaleAtomicPlan(
            writes: {keys.first: 'must not persist', outside: 'invalid'},
            value: null,
          ),
        ),
        throwsArgumentError,
      );
      expect(
        (await store.readSnapshot(scope)).values.values,
        everyElement(isNull),
      );
      expect(await store.read(outside), isNull);
    }
    expect(
      () => SaleAtomicScope(namespace: 'test:scope:', keys: ['other:a']),
      throwsArgumentError,
    );
    expect(
      () => SaleAtomicScope(namespace: 'test:scope', keys: keys),
      throwsArgumentError,
    );
    expect(
      () => SaleAtomicScope(
        namespace: 'test:scope:',
        keys: [keys.first, keys.first],
      ),
      throwsArgumentError,
    );
  });

  test(
    'empty plan returns adoption without overwriting existing values',
    () async {
      await store.compareAndSet(keys.first, null, 'frozen');
      final result = await store.transact<String>(
        scope,
        (snapshot) =>
            SaleAtomicPlan(writes: {}, value: snapshot.values[keys.first]!),
      );
      expect(result.value, 'frozen');
      expect(result.writesApplied, 0);
      expect(result.before.values, result.after.values);
    },
  );

  test(
    'legacy CAS remains compatible before and after atomic changes',
    () async {
      expect(await store.compareAndSet(keys.first, null, 'v1'), isTrue);
      expect(await store.compareAndSet(keys.first, null, 'wrong'), isFalse);
      await store.transact<void>(
        scope,
        (_) => SaleAtomicPlan(writes: {keys[1]: 'v2'}, value: null),
      );
      expect(await store.compareAndSet(keys.first, 'v1', 'v3'), isTrue);
      expect((await store.readSnapshot(scope)).values, {
        keys[0]: 'v3',
        keys[1]: 'v2',
        keys[2]: null,
      });
    },
  );

  test(
    'two connections contend for one set and adopt the committed winner',
    () async {
      final other = await connect(name);
      Future<String> compete(
        AtomicSaleMutationStore connection,
        String id,
      ) async => (await connection.transact<String>(
        scope,
        (snapshot) => snapshot.values[keys.first] == null
            ? SaleAtomicPlan(
                writes: {for (final key in keys) key: id},
                value: id,
              )
            : SaleAtomicPlan(writes: {}, value: snapshot.values[keys.first]!),
      )).value;
      final results = await Future.wait([
        compete(store, 'a'),
        compete(other, 'b'),
      ]);
      expect(results[0], results[1]);
      expect(
        (await other.readSnapshot(scope)).values.values,
        everyElement(results.first),
      );
    },
  );

  test(
    'reader sees one consistent version while another connection changes all keys',
    () async {
      final other = await connect(name);
      await store.transact<void>(
        scope,
        (_) => SaleAtomicPlan(
          writes: {for (final key in keys) key: '0'},
          value: null,
        ),
      );
      await Future.wait([
        () async {
          for (var i = 1; i <= 15; i++) {
            await store.transact<void>(
              scope,
              (_) => SaleAtomicPlan(
                writes: {for (final key in keys) key: '$i'},
                value: null,
              ),
            );
          }
        }(),
        () async {
          for (var i = 0; i < 15; i++) {
            final snapshot = await other.readSnapshot(scope);
            expect(snapshot.values.values.toSet().length, 1);
          }
        }(),
      ]);
    },
  );

  test(
    'lost response after commit recovers full set without another mutation',
    () async {
      await expectLater(
        store
            .transact<String>(
              scope,
              (_) => SaleAtomicPlan(
                writes: {for (final key in keys) key: 'same-id'},
                value: 'committed',
              ),
            )
            .then<void>(
              (_) => throw StateError('lost application response after COMMIT'),
            ),
        throwsStateError,
      );
      final reopened = await connect(name);
      expect((await reopened.readSnapshot(scope)).values, {
        for (final key in keys) key: 'same-id',
      });
    },
  );

  test(
    'atomic operations preserve an actual B07-C reservation byte for byte',
    () async {
      final remote = NoAtomicCommercialTransport();
      final ledger = SaleMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => saleScope,
      );
      final reserved = await ledger.reserve(
        saleScope,
        'prior-intent',
        saleIntent(),
      );
      final existing = {
        for (final key in await store.keys(saleScope.prefix))
          key: await store.read(key),
      };
      await store.transact<void>(
        scope,
        (_) => SaleAtomicPlan(
          writes: {for (final key in keys) key: 'diagnostic'},
          value: null,
        ),
      );
      expect({
        for (final key in existing.keys) key: await store.read(key),
      }, existing);
      expect(
        (await ledger.load(saleScope, 'prior-intent')).payload,
        reserved.payload,
      );
      expect(remote.calls, 0);
    },
  );

  test(
    'store without capability refuses explicitly without any sequential fallback',
    () {
      final legacy = LegacyOnlySaleStore();
      expect(
        () => requireAtomicSaleMutationStore(legacy),
        throwsUnsupportedError,
      );
      expect(legacy.calls, 0);
      expect(requireAtomicSaleMutationStore(store), same(store));
    },
  );

  test(
    'snapshot and plan copy their input; async decision cannot be accepted',
    () async {
      final raw = {keys.first: 'fixed'};
      final plan = SaleAtomicPlan(writes: raw, value: 'typed');
      raw[keys.first] = 'modified';
      await store.transact(scope, (_) => plan);
      expect(await store.read(keys.first), 'fixed');
      await expectLater(
        store.transact<void>(
          scope,
          (_) =>
              Future.value(
                    SaleAtomicPlan<void>(
                      writes: {keys.first: 'bad'},
                      value: null,
                    ),
                  )
                  as dynamic,
        ),
        throwsA(anything),
      );
      expect(await store.read(keys.first), 'fixed');
    },
  );
}
