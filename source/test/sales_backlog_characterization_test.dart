// Existing repository, isolated temporary SQLite. No production database.
// ignore_for_file: depend_on_referenced_packages
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';

class _TemporaryPaths extends PathProviderPlatform {
  final String path;
  _TemporaryPaths(this.path);
  @override
  Future<String?> getApplicationDocumentsPath() async => path;
  @override
  Future<String?> getTemporaryPath() async => path;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'backlog retains original payload and interrupted sync; reservations stay within their store',
    () async {
      final directory = await Directory.systemTemp.createTemp(
        'f9-b07a-backlog-',
      );
      PathProviderPlatform.instance = _TemporaryPaths(directory.path);
      final db = AppDatabase.instance;
      final repo = OfflineSalesRepository(database: db);
      final products = [
        {'productId': 'p', 'name': 'Historical', 'quantity': 2, 'price': 5.0},
      ];
      try {
        await repo.validateStockAndSaveSale(
          localId: 'legacy-id',
          storeId: 'store-a',
          totalAmount: 10,
          products: products,
          paymentMethod: 'Dinheiro',
          knownStockByProduct: {'p': 3},
        );
        final original = (await repo.getSale('legacy-id'))!;
        expect(original.status, OfflineSaleStatus.pending);
        await repo.saveSale(
          localId: 'legacy-id',
          storeId: 'store-b',
          totalAmount: 999,
          products: products,
          paymentMethod: 'PIX',
        );
        expect((await repo.getSale('legacy-id'))!.storeId, 'store-a');
        expect((await repo.getSale('legacy-id'))!.totalAmount, 10);
        expect(await repo.validateStockAndSaveSale(
            localId: 'second',
            storeId: 'store-b',
            totalAmount: 10,
            products: products,
            paymentMethod: 'Dinheiro',
            knownStockByProduct: {'p': 3},
          ), 'second');
        await expectLater(
          repo.validateStockAndSaveSale(
            localId: 'same-store-conflict', storeId: 'store-a', totalAmount: 10,
            products: products, paymentMethod: 'Dinheiro', knownStockByProduct: {'p': 3},
          ),
          throwsA(isA<OfflineStockValidationException>()),
        );
        await repo.markAsSyncing('legacy-id');
        expect(await repo.recoverInterruptedSyncs(), 1);
        final waiting = await repo.getWaitingSales();
        expect(waiting, hasLength(2));
        final recovered = waiting.singleWhere((sale) => sale.localId == 'legacy-id');
        expect(waiting.singleWhere((sale) => sale.localId == 'second').storeId, 'store-b');
        expect(recovered.localId, original.localId);
        expect(recovered.productsJson, original.productsJson);
        expect(recovered.createdAt, original.createdAt);
        expect(recovered.syncAttempts, 1);
        expect(recovered.status, OfflineSaleStatus.pending);
        final columns = await db
            .customSelect('PRAGMA table_info(pending_sales)')
            .get();
        expect(columns.map((r) => r.data['name']), isNot(contains('uid')));
        expect(
          columns.map((r) => r.data['name']),
          isNot(contains('project_id')),
        );
      } finally {
        await db.close();
      }
      final persisted = sqlite3.open(
        '${directory.path}${Platform.pathSeparator}store_connect_local.sqlite',
      );
      try {
        final row = persisted.select('SELECT * FROM pending_sales WHERE local_id = ?', ['legacy-id']).single;
        expect(persisted.select('SELECT * FROM pending_sales WHERE local_id = ?', ['second']).single['store_id'], 'store-b');
        expect(row['local_id'], 'legacy-id');
        expect(row['store_id'], 'store-a');
        expect(row['status'], 'pending');
        expect(row['sync_attempts'], 1);
      } finally {
        persisted.dispose();
      }
      // Retain only this synthetic directory as diagnostic evidence.
    },
  );
}
