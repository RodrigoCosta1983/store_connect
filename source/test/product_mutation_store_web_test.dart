@TestOn('browser')
library;

import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_web.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'product_mutation_ledger_test.dart'
    show FakeTransport, scope, command, operation;

void main() {
  test(
    'IndexedDB survives connection reopen and competing tabs cannot replace command',
    () async {
      final name = 'f9_test_${DateTime.now().microsecondsSinceEpoch}';
      var store = await IndexedDbProductMutationStore.open(name: name);
      final remote = FakeTransport();
      var ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      final saved = await ledger.prepare(scope, operation, command());
      final lostResponse = Completer<Map<String, dynamic>>();
      remote.sending = (_) => lostResponse.future;
      final interrupted = ledger.send(scope, operation, 'r');
      while (remote.sent.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      await store.close();
      lostResponse.completeError(StateError('app ended before response'));
      await expectLater(interrupted, throwsA(anything));
      store = await IndexedDbProductMutationStore.open(name: name);
      ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      final recovered = (await ledger.reopen(scope)).single;
      expect(recovered.payload, saved.payload);
      expect(recovered.state, ProductAttemptState.unknown);
      expect(
        (await ledger.load(scope, operation, 'r')).commandHash,
        saved.commandHash,
      );
      final competing = await IndexedDbProductMutationStore.open(name: name);
      final results = await Future.wait([
        store.compareAndSet('cas', null, 'first'),
        competing.compareAndSet('cas', null, 'second'),
      ]);
      expect(results.where((value) => value).length, 1);
      remote.sending = null;
      await ledger.send(scope, operation, 'r');
      expect(remote.sent.first, remote.sent.last);
      await competing.close();
      await store.close();
      final reopened = await IndexedDbProductMutationStore.open(name: name);
      expect(
        (await ProductMutationLedger(
          store: reopened,
          transport: remote,
          activeScope: () async => scope,
        ).load(scope, operation, 'r')).state,
        ProductAttemptState.confirmed,
      );
      await reopened.close();
    },
  );
  test(
    'closed IndexedDB fails persistence instead of falling back to memory',
    () async {
      final store = await IndexedDbProductMutationStore.open(
        name: 'f9_closed_${DateTime.now().microsecondsSinceEpoch}',
      );
      await store.close();
      final remote = FakeTransport();
      final ledger = ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => scope,
      );
      await expectLater(
        ledger.prepare(scope, operation, command()),
        throwsA(anything),
      );
      expect(remote.sent, isEmpty);
    },
  );
}
