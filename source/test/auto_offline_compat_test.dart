// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/services/offline_sales_sync_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const scope = {'projectId': 'store-connect-app', 'uid': 'synthetic-owner', 'storeId': 'synthetic-store'};
  late Directory directory;
  late AppDatabase db;
  late OfflineSalesRepository repo;
  late Map<String, dynamic> active;
  late List<String> endpoints;
  late List<String> payloads;
  late Map<String, Map<String, dynamic>> committed;
  late int effects;
  late bool lose, unavailable, refreshFails;
  Future<Map<String, dynamic>> gateway(String endpoint, Map<String, dynamic> envelope) async {
    endpoints.add(endpoint);
    if (endpoint == 'getOfflineSaleResultV1') return {'status': 'not-recorded', 'requestId': envelope['requestId']};
    expect(endpoint, 'syncOfflineSale');
    expect(envelope['scope'], scope);
    final payload = Map<String, dynamic>.from(envelope['payload'] as Map);
    payloads.add(jsonEncode(payload));
    if (unavailable) throw FirebaseFunctionsException(code: 'unavailable', message: 'Synthetic offline');
    final id = payload['localSaleId'] as String;
    if (committed.containsKey(id)) return {...committed[id]!, 'alreadyProcessed': true};
    effects++;
    committed[id] = {'success': true, 'serverSaleId': id, 'alreadyProcessed': false, 'shouldRequestNfce': false};
    if (lose) throw TimeoutException('Synthetic lost response after commit');
    return committed[id]!;
  }
  OfflineSalesSyncService worker() => OfflineSalesSyncService(repository: repo, activeScope: () async => active,
    call: gateway, refresh: (_) async {
      if (refreshFails) throw FirebaseException(plugin: 'cloud_firestore', code: 'unavailable');
    }, requestFiscal: (_) async => fail('No fiscal request expected'));
  Future<String> capture({String id = 'synthetic-sale', Map<String, dynamic> origin = scope}) =>
    repo.validateStockAndSaveSale(localId: id, originScope: origin, storeId: 'synthetic-store', totalAmount: 20,
      products: [{'productId': 'p', 'name': 'Synthetic', 'price': 10, 'quantity': 2}],
      paymentMethod: 'Dinheiro', knownStockByProduct: {'p': 20});
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('offline-auto-compat-');
    db = AppDatabase.offlineQueue(NativeDatabase(File('${directory.path}/queue.db')));
    repo = OfflineSalesRepository(database: db); active = {...scope}; endpoints = []; payloads = [];
    committed = {}; effects = 0; lose = false; unavailable = false; refreshFails = false;
  });
  tearDown(() async { await db.close(); await directory.delete(recursive: true); });

  test('new offline capture pins original PROD API and synchronizes automatically without receipt button', () async {
    await capture(); final original = await repo.readCommand('synthetic-sale');
    expect(endpoints, isEmpty); expect(await repo.readTransport('synthetic-sale'), isNotNull);
    expect((await worker().syncPendingSales()).syncedCount, 1);
    expect(endpoints, ['syncOfflineSale']); expect(effects, 1);
    expect((await repo.getSale('synthetic-sale'))!.status, 'synced'); expect(await repo.readCommand('synthetic-sale'), original);
  });
  test('temporary network refusal schedules automatic retry with identical original payload and ID', () async {
    await capture(); unavailable = true;
    final first = await worker().syncPendingSales(); expect(first.retryAutomatically, true); expect(effects, 0);
    unavailable = false; expect((await worker().syncPendingSales()).syncedCount, 1);
    expect(payloads[0], payloads[1]); expect(effects, 1); expect(endpoints.every((e) => e == 'syncOfflineSale'), true);
  });
  test('lost response and SQLite restart retry same original API without another commercial effect', () async {
    await capture(); final original = await repo.readCommand('synthetic-sale'); final route = await repo.readTransport('synthetic-sale');
    lose = true; expect((await worker().syncPendingSales()).retryAutomatically, true);
    expect((await repo.getSale('synthetic-sale'))!.status, 'unknown'); expect(effects, 1);
    await db.close(); db = AppDatabase.offlineQueue(NativeDatabase(File('${directory.path}/queue.db')));
    repo = OfflineSalesRepository(database: db); lose = false;
    expect((await worker().syncPendingSales()).syncedCount, 1); expect(effects, 1);
    expect(payloads[0], payloads[1]); expect(await repo.readCommand('synthetic-sale'), original);
    expect(await repo.readTransport('synthetic-sale'), route);
  });
  test('cache refresh failure preserves reservation and same-ID retry confirms without second effect', () async {
    await capture(); refreshFails = true; final first = await worker().syncPendingSales();
    expect(first.retryAutomatically, true); expect((await repo.getSale('synthetic-sale'))!.status, 'confirmedRefreshPending');
    expect((await db.getUnsyncedSalesForLocalStock()).length, 1); refreshFails = false;
    expect((await worker().syncPendingSales()).syncedCount, 1); expect(effects, 1);
  });
  test('old unknown without a recorded transport is never reassigned or automatically sent to original API', () async {
    await capture(); await db.customStatement('DELETE FROM offline_sale_transports_v1');
    await db.customStatement("UPDATE pending_sales SET status='unknown'"); final original = await repo.readCommand('synthetic-sale');
    await worker().syncPendingSales(); expect(endpoints, ['getOfflineSaleResultV1']); expect(effects, 0);
    expect(await repo.readTransport('synthetic-sale'), null); expect(await repo.readCommand('synthetic-sale'), original);
    expect((await repo.getSale('synthetic-sale'))!.status, 'unknown');
  });
  test('support receipt-only operation never sends a new legacy transport or changes pending state', () async {
    await capture(); await worker().recoverPendingReceipts(); expect(endpoints, isEmpty); expect(effects, 0);
    expect((await repo.getSale('synthetic-sale'))!.status, 'pending');
  });
  test('failed transport persistence atomically rolls back sale, immutable command and route', () async {
    await db.prepareS03(); await db.customStatement("CREATE TRIGGER fail_route BEFORE INSERT ON offline_sale_transports_v1 BEGIN SELECT RAISE(ABORT, 'synthetic disk full'); END");
    await expectLater(capture(), throwsA(anything)); expect(await repo.getSale('synthetic-sale'), null);
    expect(await repo.readCommand('synthetic-sale'), null); expect(await repo.readTransport('synthetic-sale'), null);
  });
  test('session switch or mismatched stored transport cannot send another store intent', () async {
    await capture(); active = {...scope, 'uid': 'other'}; await worker().syncPendingSales(); expect(endpoints, isEmpty);
    active = {...scope}; final route = jsonDecode((await repo.readTransport('synthetic-sale'))!) as Map;
    (route['payload'] as Map)['storeId'] = 'other';
    await db.customStatement('UPDATE offline_sale_transports_v1 SET transport_json=?', [jsonEncode(route)]);
    await worker().syncPendingSales(); expect(endpoints, isEmpty); expect(effects, 0);
  });
  test('HML captures retain V1 transport and are not redirected to PROD legacy API', () async {
    final hml = {...scope, 'projectId': 'store-connect-hml'}; await capture(origin: hml);
    expect(await repo.readTransport('synthetic-sale'), null);
  });
  test('modified products with the same total cannot replace the captured original intent', () async {
    await capture(); final route = jsonDecode((await repo.readTransport('synthetic-sale'))!) as Map;
    ((route['payload'] as Map)['products'] as List).first['productId'] = 'other-product';
    await db.customStatement('UPDATE offline_sale_transports_v1 SET transport_json=?', [jsonEncode(route)]);
    await worker().syncPendingSales(); expect(endpoints, isEmpty); expect(effects, 0);
    expect((await repo.getSale('synthetic-sale'))!.status, 'unknown');
  });
}
