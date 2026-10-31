import 'dart:io';
import 'dart:async';
import 'dart:isolate';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'support/sale_association_cases.dart';

Future<void> associationWorker(List<Object> args) async {
  final port = args[1] as SendPort;
  final commands = ReceivePort();
  final store = SqliteSaleMutationStore(args[0] as String);
  late Object outcome;
  try {
    port.send(commands.sendPort);
    await commands.first;
    final h = AssociationHarness(store);
    final result = await h.ledger.reserveAssociated(
      h.request(candidate: args[2] as String),
    );
    outcome = [result.status.name, result.attempt!.requestId];
  } catch (error) {
    outcome = 'failed: $error';
  } finally {
    commands.close();
    await store.close();
  }
  // Publish completion after closing the writer, before verifier reopens WAL.
  port.send(outcome);
}

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07dc-b-');
  saleAssociationCases(
    (name) async => SqliteSaleMutationStore(
      '${directory.path}${Platform.pathSeparator}$name.sqlite',
    ),
  );

  test(
    'SQLite final canonical INSERT failure rolls back candidate and binding',
    () async {
      final path =
          '${directory.path}${Platform.pathSeparator}last-write.sqlite';
      final store = SqliteSaleMutationStore(path);
      final connection = sqlite3.open(path);
      try {
        connection.execute(
          "CREATE TRIGGER fail_canonical BEFORE INSERT ON attempts WHEN instr(NEW.key, 'confirmSaleV2:') > 0 BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END",
        );
        final h = AssociationHarness(store);
        await expectLater(
          h.ledger.reserveAssociated(h.request()),
          throwsA(anything),
        );
        expect(await h.records(), isEmpty);
        h.noCommercialIO();
      } finally {
        connection.dispose();
        await store.close();
      }
    },
  );

  test(
    'independent SQLite isolates racing adoption persist only one identity',
    () async {
      final path = '${directory.path}${Platform.pathSeparator}isolates.sqlite';
      final ports = [ReceivePort(), ReceivePort()];
      final streams = ports.map((p) => StreamIterator(p)).toList();
      try {
        for (var i = 0; i < 2; i++) {
          await Isolate.spawn(associationWorker, <Object>[
            path,
            ports[i].sendPort,
            'candidate-$i',
          ]);
          expect(await streams[i].moveNext(), true);
        }
        for (final stream in streams) {
          (stream.current as SendPort).send('start');
        }
        final outcomes = <List<dynamic>>[];
        for (final stream in streams) {
          expect(await stream.moveNext(), true);
          expect(stream.current, isA<List>());
          outcomes.add(stream.current as List<dynamic>);
        }
        expect(outcomes.map((o) => o[0]).toSet(), {'created', 'adopted'});
        expect(outcomes.map((o) => o[1]).toSet(), hasLength(1));
        final store = SqliteSaleMutationStore(path);
        try {
          expect(await store.keys(''), hasLength(4));
        } finally {
          await store.close();
        }
      } finally {
        for (final stream in streams) {
          await stream.cancel();
        }
        for (final port in ports) {
          port.close();
        }
      }
    },
  );
}
