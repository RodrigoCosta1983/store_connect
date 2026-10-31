import 'dart:io';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'support/checkout_sale_preparation_cases.dart';

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07d-a-');
  checkoutPreparationCases(
    (name) async => SqliteSaleMutationStore(
      '${directory.path}${Platform.pathSeparator}$name.sqlite',
    ),
  );
  test(
    'checkout ledger leaves real synthetic PendingSales v2 unchanged',
    () async {
      final pending = AppDatabase.localPersistence(NativeDatabase.memory());
      final ledgerStore = SqliteSaleMutationStore(
        '${directory.path}${Platform.pathSeparator}pending-isolation.sqlite',
      );
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
        final adapter = CheckoutSalePreparation(
          store: ledgerStore,
          session: CheckoutSaleSession(checkoutContext()),
        );
        final handle = await adapter.persist(
          adapter.newPurchase(checkoutDraft()),
        );
        await adapter.resume(handle.reference);
        expect(await pending.readLocalIntents(), before);
        expect(
          (await pending.readLocalIntents()).single['local_id'],
          'legacy-pending',
        );
      } finally {
        await ledgerStore.close();
        await pending.close();
      }
    },
  );
}
