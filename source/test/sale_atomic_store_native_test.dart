import 'dart:io';
import 'dart:isolate';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'support/sale_atomic_store_cases.dart';

Future<void> _incrementWorker(List<Object> args) async {
  final store = SqliteSaleMutationStore(args[0] as String);
  final parent = args[1] as SendPort;
  final commands = ReceivePort();
  parent.send(commands.sendPort);
  await commands.first;
  commands.close();
  try {
    final scope = SaleAtomicScope(
      namespace: 'parallel:',
      keys: ['parallel:a', 'parallel:b', 'parallel:c'],
    );
    for (var i = 0; i < 12; i++) {
      await store.transact<void>(scope, (snapshot) {
        final next = int.parse(snapshot.values['parallel:a']!) + 1;
        return SaleAtomicPlan(
          writes: {for (final key in scope.keys) key: '$next'},
          value: null,
        );
      });
    }
    parent.send('done');
  } catch (error) {
    parent.send('failed: $error');
  } finally {
    await store.close();
  }
}

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07dc-a-sqlite-');
  saleAtomicStoreCases(
    (name) async => SqliteSaleMutationStore(
      '${directory.path}${Platform.pathSeparator}$name.sqlite',
    ),
  );

  test(
    'SQLite failure on last write rolls back earlier writes and remains usable',
    () async {
      final path =
          '${directory.path}${Platform.pathSeparator}last-write.sqlite';
      final store = SqliteSaleMutationStore(path);
      final raw = sqlite3.open(path);
      final scope = SaleAtomicScope(
        namespace: 'last:',
        keys: ['last:a', 'last:b', 'last:c'],
      );
      try {
        await store.compareAndSet('last:c', null, 'old');
        raw.execute(
          "CREATE TRIGGER fail_last BEFORE INSERT ON attempts WHEN NEW.key = 'last:c' BEGIN SELECT RAISE(ABORT, 'synthetic full/disk fault'); END",
        );
        await expectLater(
          store.transact<void>(
            scope,
            (_) => SaleAtomicPlan(
              writes: {'last:a': 'a', 'last:b': 'b', 'last:c': 'c'},
              value: null,
            ),
          ),
          throwsA(isA<SqliteException>()),
        );
        expect((await store.readSnapshot(scope)).values, {
          'last:a': null,
          'last:b': null,
          'last:c': 'old',
        });
        expect(await store.compareAndSet('last:a', null, 'usable'), isTrue);
      } finally {
        raw.dispose();
        await store.close();
      }
    },
  );

  test(
    'SQLite busy and closed storage refuse without partial writes',
    () async {
      final path = '${directory.path}${Platform.pathSeparator}busy.sqlite';
      final store = SqliteSaleMutationStore(path);
      final blocker = sqlite3.open(path);
      final scope = SaleAtomicScope(
        namespace: 'busy:',
        keys: ['busy:a', 'busy:b', 'busy:c'],
      );
      try {
        blocker.execute('BEGIN IMMEDIATE');
        await expectLater(
          store.transact<void>(
            scope,
            (_) => SaleAtomicPlan(writes: {'busy:a': 'blocked'}, value: null),
          ),
          throwsA(isA<SqliteException>()),
        );
        blocker.execute('ROLLBACK');
        expect(
          (await store.readSnapshot(scope)).values.values,
          everyElement(isNull),
        );
      } finally {
        blocker.dispose();
        await store.close();
      }
      await expectLater(store.readSnapshot(scope), throwsA(anything));
      await expectLater(
        store.transact<void>(
          scope,
          (_) => SaleAtomicPlan(writes: {}, value: null),
        ),
        throwsA(anything),
      );
    },
  );

  test(
    'SQLite independent isolates serialize increments of the same three keys',
    () async {
      final path = '${directory.path}${Platform.pathSeparator}isolates.sqlite';
      final store = SqliteSaleMutationStore(path);
      final scope = SaleAtomicScope(
        namespace: 'parallel:',
        keys: ['parallel:a', 'parallel:b', 'parallel:c'],
      );
      await store.transact<void>(
        scope,
        (_) => SaleAtomicPlan(
          writes: {for (final key in scope.keys) key: '0'},
          value: null,
        ),
      );
      final events = ReceivePort();
      final ready = <SendPort>[];
      final complete = <String>[];
      final done = events.takeWhile((event) {
        if (event is SendPort) {
          ready.add(event);
          if (ready.length == 2) {
            for (final port in ready) {
              port.send('go');
            }
          }
        } else {
          complete.add(event as String);
        }
        return complete.length < 2;
      }).drain<void>();
      await Isolate.spawn(_incrementWorker, <Object>[path, events.sendPort]);
      await Isolate.spawn(_incrementWorker, <Object>[path, events.sendPort]);
      try {
        await done.timeout(const Duration(seconds: 20));
        expect(complete, ['done', 'done']);
        expect(
          (await store.readSnapshot(scope)).values.values,
          everyElement('24'),
        );
      } finally {
        events.close();
        await store.close();
      }
    },
  );

  test(
    'PendingSales v2 synthetic rows stay intact and file remains WAL',
    () async {
      final path =
          '${directory.path}${Platform.pathSeparator}preservation.sqlite';
      final store = SqliteSaleMutationStore(path);
      final raw = sqlite3.open(path);
      final pending = AppDatabase.localPersistence(NativeDatabase.memory());
      try {
        await pending.persistLocalIntent(
          LocalSaleIntent.capturedBeforeNetwork(
            localId: 'prior',
            scope: LocalSaleScope(
              projectId: 'demo-prior',
              storeId: 's',
              uid: 'u',
              environment: 'local',
              firestoreEndpoint: 'localhost:8080',
              functionsEndpoint: 'localhost:5001',
            ),
            totalAmount: 1,
            productsJson: '[{"productId":"p","quantity":1}]',
            paymentMethod: 'PIX',
            createdAt: DateTime.utc(2026),
          ),
        );
        final before = await pending.readLocalIntents();
        final scope = SaleAtomicScope(
          namespace: 'safe:',
          keys: ['safe:a', 'safe:b', 'safe:c'],
        );
        await store.transact<void>(
          scope,
          (_) => SaleAtomicPlan(
            writes: {for (final key in scope.keys) key: 'new'},
            value: null,
          ),
        );
        expect(await pending.readLocalIntents(), before);
        expect(raw.select('PRAGMA journal_mode').single.values.single, 'wal');
      } finally {
        raw.dispose();
        await store.close();
        await pending.close();
      }
    },
  );
}
