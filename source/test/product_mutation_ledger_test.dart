import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store.dart';
import 'package:store_connect/services/product_mutation_command.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';

class MemoryStore implements ProductMutationStore {
  final values = <String, String>{};
  bool fail = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<List<String>> keys(String prefix) async =>
      values.keys.where((k) => k.startsWith(prefix)).toList();
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    if (fail) throw StateError('storage failure');
    if (values[key] != expected) return false;
    values[key] = value;
    return true;
  }

  @override
  Future<void> close() async {}
}

class FakeTransport implements ProductMutationTransport {
  final sent = <Map<String, dynamic>>[];
  Future<Map<String, dynamic>> Function(Map<String, dynamic>)? sending;
  Map<String, dynamic> result = {};
  @override
  Future<Map<String, dynamic>> send(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) async {
    sent.add(requireObject(jsonDecode(jsonEncode(command))));
    if (sending != null) return sending!(command);
    return {
      'success': true,
      'productId': command['productId'],
      'requestId': command['requestId'],
      'changed': true,
    };
  }

  @override
  Future<Map<String, dynamic>> recover(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) async => {
    'operation': operation,
    'requestId': command['requestId'],
    'productId': command['productId'],
    ...result,
  };
}

const scope = ProductMutationScope(
  projectId: 'demo-local',
  uid: 'u',
  storeId: 's',
);
Map<String, dynamic> command({String id = 'r'}) => {
  'schemaVersion': 2,
  'requestId': id,
  'productId': 'p',
  'expectedUpdateTime': {'seconds': '1791970000', 'nanoseconds': 123456000},
  'changes': {
    'set': {'name': ' New '},
  },
};
const operation = 'updateProductV2';
void main() {
  test(
    'token must be explicit/exact; null, missing and milliseconds substitutes reject',
    () {
      for (final token in [
        null,
        {},
        {'seconds': '1', 'nanoseconds': null},
        {'seconds': '01', 'nanoseconds': 0},
        {'seconds': '1', 'nanoseconds': 1},
        {'updatedAt': 1234},
      ]) {
        expect(() => requireProductToken(token), throwsFormatException);
      }
    },
  );
  test(
    'normalization rejects null set and protected fields instead of synthesizing defaults',
    () {
      for (final changes in [
        {
          'set': null,
          'categories': {'ids': []},
        },
        {
          'set': {'quantidade': 0},
        },
        {
          'fiscal': {'set': null},
          'set': {'name': 'x'},
        },
        {
          'fiscal': {
            'set': {'secret': 'must-not-persist'},
          },
        },
      ]) {
        final data = command()..['changes'] = changes;
        expect(
          () => normalizeProductCommand(operation, data),
          throwsFormatException,
        );
      }
    },
  );
  test(
    'UI edits and caller modifications cannot alter frozen payload or hash',
    () async {
      final store = MemoryStore();
      final remote = FakeTransport();
      final ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      final ui = command();
      final saved = await ledger.prepare(scope, operation, ui);
      final original = productCanonicalJson(saved.payload);
      final hash = saved.commandHash;
      (ui['changes'] as Map)['set'] = {'name': 'UI later'};
      saved.payload['changes']['set']['name'] = 'detached copy';
      expect(
        productCanonicalJson(
          (await ledger.load(scope, operation, 'r')).payload,
        ),
        original,
      );
      expect((await ledger.load(scope, operation, 'r')).commandHash, hash);
      expect(saved.payload['changes']['set']['name'], 'New');
      await ledger.send(scope, operation, 'r');
      expect(productCanonicalJson(remote.sent.single), original);
    },
  );
  test(
    'crash after send before response: reopen unknown, retry keeps exact ID and command',
    () async {
      final store = MemoryStore();
      final remote = FakeTransport();
      final response = Completer<Map<String, dynamic>>();
      remote.sending = (_) => response.future;
      ProductMutationLedger ledger() => ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      final first = ledger();
      final saved = await first.prepare(scope, operation, command());
      final inFlight = first.send(scope, operation, 'r');
      while (remote.sent.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(
        (await ledger().reopen(scope)).single.state,
        ProductAttemptState.unknown,
      );
      remote.sending = null;
      final replay = await ledger().send(scope, operation, 'r');
      expect(replay.state, ProductAttemptState.confirmed);
      expect(remote.sent.length, 2);
      expect(remote.sent[0], remote.sent[1]);
      expect(replay.commandHash, saved.commandHash);
      response.completeError(StateError('lost response'));
      expect((await inFlight).state, ProductAttemptState.confirmed);
    },
  );
  test('closing/reopening coordinator preserves pending command', () async {
    final store = MemoryStore();
    final remote = FakeTransport();
    final first = ProductMutationLedger(
      store: store,
      transport: remote,
      activeScope: () async => scope,
    );
    final saved = await first.prepare(scope, operation, command());
    final reopened = ProductMutationLedger(
      store: store,
      transport: remote,
      activeScope: () async => scope,
    );
    expect(
      (await reopened.reopen(scope)).single.commandHash,
      saved.commandHash,
    );
    await reopened.send(scope, operation, 'r');
    expect(remote.sent.single, saved.payload);
  });
  test(
    'persistence failure before prepare or sending prevents network',
    () async {
      final store = MemoryStore();
      final remote = FakeTransport();
      final ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      store.fail = true;
      await expectLater(
        ledger.prepare(scope, operation, command()),
        throwsStateError,
      );
      store.fail = false;
      await ledger.prepare(scope, operation, command());
      store.fail = true;
      await expectLater(ledger.send(scope, operation, 'r'), throwsStateError);
      expect(remote.sent, isEmpty);
    },
  );
  test(
    'failure persisting confirmation leaves durable sending recoverable after restart',
    () async {
      final store = MemoryStore();
      final remote = FakeTransport();
      final ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      await ledger.prepare(scope, operation, command());
      remote.sending = (data) async {
        store.fail = true;
        return {'success': true, 'productId': 'p', 'requestId': 'r'};
      };
      await expectLater(ledger.send(scope, operation, 'r'), throwsStateError);
      store.fail = false;
      expect(
        (await ledger.reopen(scope)).single.state,
        ProductAttemptState.unknown,
      );
      remote.result = {
        'status': 'confirmed',
        'definitive': true,
        'result': {'success': true, 'productId': 'p', 'requestId': 'r'},
      };
      expect(
        (await ledger.recover(scope, operation, 'r')).state,
        ProductAttemptState.confirmed,
      );
    },
  );
  test(
    'not-recorded is unknown; confirmed/rejected/conflict are distinct persisted outcomes',
    () async {
      for (final status in [
        'not-recorded',
        'confirmed',
        'rejected',
        'identity-conflict',
      ]) {
        final store = MemoryStore();
        final remote = FakeTransport();
        final ledger = ProductMutationLedger(
          store: store,
          transport: remote,
          activeScope: () async => scope,
        );
        await ledger.prepare(scope, operation, command());
        remote.result = {
          'status': status,
          'definitive': status != 'not-recorded',
          if (status == 'confirmed')
            'result': {'success': true, 'productId': 'p', 'requestId': 'r'},
          if (status == 'rejected')
            'error': {'code': 'aborted', 'reason': 'product-version-conflict'},
        };
        final result = await ledger.recover(scope, operation, 'r');
        expect(
          result.state,
          {
            'not-recorded': ProductAttemptState.unknown,
            'confirmed': ProductAttemptState.confirmed,
            'rejected': ProductAttemptState.rejected,
            'identity-conflict': ProductAttemptState.identityConflict,
          }[status],
        );
        expect((await ledger.load(scope, operation, 'r')).state, result.state);
        if (status != 'not-recorded') {
          await ledger.send(scope, operation, 'r');
          expect(remote.sent, isEmpty);
        }
      }
    },
  );
  test(
    'account/project/store changes suspend attempts; lists are partitioned',
    () async {
      final store = MemoryStore();
      final remote = FakeTransport();
      ProductMutationScope? active = scope;
      final ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => active,
      );
      await ledger.prepare(scope, operation, command());
      for (final other in [
        const ProductMutationScope(projectId: 'other', uid: 'u', storeId: 's'),
        const ProductMutationScope(
          projectId: 'demo-local',
          uid: 'other',
          storeId: 's',
        ),
        const ProductMutationScope(
          projectId: 'demo-local',
          uid: 'u',
          storeId: 'other',
        ),
      ]) {
        active = other;
        await expectLater(ledger.send(scope, operation, 'r'), throwsStateError);
        await expectLater(ledger.load(scope, operation, 'r'), throwsStateError);
        expect(await ledger.reopen(other), isEmpty);
      }
      active = null;
      await expectLater(ledger.send(scope, operation, 'r'), throwsStateError);
      expect(remote.sent, isEmpty);
    },
  );
  test(
    'same ID with different payload rejects; concurrent prepare does not overwrite',
    () async {
      final store = MemoryStore();
      final remote = FakeTransport();
      final ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      await Future.wait([
        ledger.prepare(scope, operation, command()),
        ledger.prepare(scope, operation, command()),
      ]);
      final changed = command();
      changed['changes'] = {
        'set': {'price': 3},
      };
      await expectLater(
        ledger.prepare(scope, operation, changed),
        throwsStateError,
      );
      expect(store.values.length, 1);
    },
  );
  test('corruption blocks sending without deleting attempt', () async {
    final store = MemoryStore();
    final remote = FakeTransport();
    final ledger = ProductMutationLedger(
      store: store,
      transport: remote,
      activeScope: () async => scope,
    );
    await ledger.prepare(scope, operation, command());
    final key = store.values.keys.single;
    final record = requireObject(jsonDecode(store.values[key]!));
    record['command']['changes']['set']['name'] = 'tampered';
    store.values[key] = jsonEncode(record);
    await expectLater(
      ledger.send(scope, operation, 'r'),
      throwsFormatException,
    );
    expect(remote.sent, isEmpty);
    expect(store.values.length, 1);
  });
}
