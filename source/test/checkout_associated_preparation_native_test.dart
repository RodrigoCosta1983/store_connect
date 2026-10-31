import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:drift/native.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'support/checkout_associated_preparation_cases.dart';
import 'support/checkout_sale_preparation_cases.dart'
    show checkoutContext, checkoutDraft;

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07dcc-a-');
  salePath(String name) =>
      '${directory.path}${Platform.pathSeparator}$name.sqlite';
  checkoutAssociatedPreparationCases(
    (name) async => SqliteSaleMutationStore(salePath(name)),
    deleteTemporaryEvidence: (name, key) async {
      final connection = sqlite3.open(salePath(name));
      try {
        connection.execute('DELETE FROM attempts WHERE key = ?', [key]);
      } finally {
        connection.dispose();
      }
    },
  );

  test(
    'actual final SQLite INSERT fault leaves no binding or candidate',
    () async {
      final store = SqliteSaleMutationStore(salePath('last-write'));
      final raw = sqlite3.open(salePath('last-write'));
      try {
        raw.execute(
          "CREATE TRIGGER fail_canonical BEFORE INSERT ON attempts WHEN instr(NEW.key, 'confirmSaleV2:') > 0 BEGIN SELECT RAISE(ABORT, 'synthetic full disk'); END",
        );
        final prep = CheckoutSalePreparation(
          store: store,
          session: CheckoutSaleSession(checkoutContext()),
        );
        await expectLater(
          prep.persistAssociated(prep.newAssociatedPurchase(checkoutDraft())),
          throwsA(anything),
        );
        expect(await store.keys(''), isEmpty);
      } finally {
        raw.dispose();
        await store.close();
      }
    },
  );

  test(
    'real synthetic PendingSales v2 rows preserved by associated preparation and resume',
    () async {
      final pending = AppDatabase.localPersistence(NativeDatabase.memory());
      final store = SqliteSaleMutationStore(salePath('pending'));
      try {
        await pending.persistLocalIntent(
          LocalSaleIntent.capturedBeforeNetwork(
            localId: 'legacy-pending',
            scope: LocalSaleScope(
              projectId: 'demo-legacy',
              storeId: 's',
              uid: 'u',
              environment: 'synthetic',
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
        final prep = CheckoutSalePreparation(
          store: store,
          session: CheckoutSaleSession(checkoutContext()),
        );
        final handle = await prep.persistAssociated(
          prep.newAssociatedPurchase(checkoutDraft()),
        );
        await prep.resumeAssociated(handle.reference);
        expect(await pending.readLocalIntents(), before);
      } finally {
        await store.close();
        await pending.close();
      }
    },
  );
}
