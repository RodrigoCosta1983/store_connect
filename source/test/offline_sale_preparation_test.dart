import 'dart:async';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/services/offline_sale_preparation.dart';

LocalSaleScope scope({String uid = 'u', String store = 's', String project = 'p'}) =>
    LocalSaleScope(projectId: project, storeId: store, uid: uid,
      environment: 'synthetic', firestoreEndpoint: 'localhost:8080',
      functionsEndpoint: 'localhost:5001');

class DelayedRepository extends OfflineSalesRepository {
  final gate = Completer<void>();
  DelayedRepository(AppDatabase database) : super(database: database);
  @override
  Future<LocalIntentInsertResult> persistLocalIntent(LocalSaleIntent intent) async {
    final result = await super.persistLocalIntent(intent);
    await gate.future;
    return result;
  }
}

void main() {
  late AppDatabase db;
  late OfflineSalesRepository repo;
  LocalSaleScope? active;
  setUp(() {
    db = AppDatabase.localPersistence(NativeDatabase.memory());
    repo = OfflineSalesRepository(database: db);
    active = scope();
  });
  tearDown(() => db.close());
  OfflineSalePreparation capture({List<Map<String, dynamic>>? products}) =>
      OfflineSalePreparation.capture(repository: repo, activeScope: () => active,
        scope: scope(), totalAmount: 5, products: products ?? [
          {'productId': 'x', 'quantity': 1, 'price': 5.0},
        ], paymentMethod: 'Dinheiro', createdAt: DateTime.utc(2026), localId: 'same');

  test('freezes snapshot and persists same identity without any transport', () async {
    final products = [{'productId': 'x', 'quantity': 1, 'price': 5.0}];
    final preparation = capture(products: products);
    products.single['quantity'] = 9;
    expect(await preparation.persist(), LocalIntentInsertResult.inserted);
    expect(await preparation.persist(), LocalIntentInsertResult.existing);
    expect((await db.readLocalIntent('same'))!['products_json'], contains('"quantity":1'));
    expect((await repo.localReservations(scope())).quantities, {'x': 1});
  });

  test('conflict preserves original and candidate without replacement ID', () async {
    await capture().persist();
    final candidate = capture(products: [{'productId': 'x', 'quantity': 2}]);
    expect(await candidate.persist(), LocalIntentInsertResult.conflict);
    expect(candidate.intent.localId, 'same');
    expect(candidate.intent.values['products_json'], contains('"quantity":2'));
    expect((await db.readLocalIntent('same'))!['products_json'], contains('"quantity":1'));
    expect((await repo.localReservations(scope())).uncertain, isTrue);
  });

  test('disk failure retains candidate and no success is returned', () async {
    await db.readLocalIntents();
    await db.customStatement("CREATE TRIGGER fail_insert BEFORE INSERT ON pending_sales BEGIN SELECT RAISE(ABORT, 'disk'); END");
    final candidate = capture();
    await expectLater(candidate.persist(), throwsA(anything));
    expect(candidate.intent.localId, 'same');
    expect(await db.readLocalIntents(), isEmpty);
  });

  for (final changed in [scope(uid: 'other'), scope(store: 'other'), scope(project: 'other')]) {
    test('context mismatch prevents persistence ${changed.uid}/${changed.storeId}/${changed.projectId}', () async {
      final candidate = capture();
      active = changed;
      await expectLater(candidate.persist(), throwsStateError);
      expect(await db.readLocalIntents(), isEmpty);
    });
  }

  test('late persistence completion cannot authorize another session', () async {
    final delayed = DelayedRepository(db);
    repo = delayed;
    final candidate = capture();
    final pending = candidate.persist();
    final assertion = expectLater(pending, throwsStateError);
    active = null;
    delayed.gate.complete();
    await assertion;
    expect((await db.readLocalIntent('same'))!['origin_uid'], 'u');
    expect((await repo.localReservations(scope())).quantities, {'x': 1});
  });
}
