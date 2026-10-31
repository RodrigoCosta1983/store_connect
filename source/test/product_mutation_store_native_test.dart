import 'dart:io';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_native.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'product_mutation_ledger_test.dart'
    show FakeTransport, scope, command, operation;

void main() {
  test(
    'SQLite FULL commit survives close/reopen and competing connections use CAS',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'f9-product-ledger-',
      );
      final path = '${directory.path}${Platform.pathSeparator}ledger.sqlite';
      var store = SqliteProductMutationStore(path);
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
      // Observe the sending commit through another connection before simulating
      // an app ending with no response. No in-memory attempt object is reused.
      while (remote.sent.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      await store.close();
      lostResponse.completeError(StateError('process ended before response'));
      await expectLater(interrupted, throwsA(anything));
      store = SqliteProductMutationStore(path);
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
      final competing = SqliteProductMutationStore(path);
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
      final reopened = SqliteProductMutationStore(path);
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
}
