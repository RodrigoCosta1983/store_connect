// ignore_for_file: depend_on_referenced_packages
import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/services/offline_sales_sync_service.dart';

class _SyntheticPaths extends PathProviderPlatform {
  final String path;
  _SyntheticPaths(this.path);
  @override
  Future<String?> getApplicationDocumentsPath() async => path;
  @override
  Future<String?> getTemporaryPath() async => path;
}

class _NoRemoteFunctions implements FirebaseFunctions {
  int calls = 0;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    calls++;
    throw StateError('No remote access allowed in this test.');
  }
}

class _NoRemoteFirestore implements FirebaseFirestore {
  int calls = 0;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    calls++;
    throw StateError('No remote access allowed in this test.');
  }
}

final _time = DateTime.utc(2026, 10, 17, 12);
const _json = '[ {"productId":"p","quantity":2,"name":"Histórico","price":5.125} ]';

LocalSaleScope scope({String project = 'project-a', String store = 'store-a',
  String uid = 'uid-a', String endpoint = 'localhost:8080'}) => LocalSaleScope(
    projectId: project, storeId: store, uid: uid, environment: 'synthetic-emulator',
    firestoreEndpoint: endpoint, functionsEndpoint: 'localhost:5001');

LocalSaleIntent intent({String id = 'new', LocalSaleScope? origin,
  String products = _json, double total = 10.25}) =>
  LocalSaleIntent.capturedBeforeNetwork(localId: id, scope: origin ?? scope(),
    totalAmount: total, productsJson: products, paymentMethod: 'Dinheiro',
    notes: '  bytes originais  ', createdAt: _time);

void seed(String path, {bool failMigration = false}) {
  final db = sqlite3.open(path);
  try {
    db.execute('''CREATE TABLE pending_sales (
      local_id TEXT NOT NULL PRIMARY KEY, store_id TEXT NOT NULL,
      total_amount REAL NOT NULL, products_json TEXT NOT NULL,
      payment_method TEXT NOT NULL, notes TEXT, customer_id TEXT, customer_name TEXT,
      created_at INTEGER NOT NULL, synced_at INTEGER, status TEXT NOT NULL DEFAULT 'pending',
      sync_attempts INTEGER NOT NULL DEFAULT 0, last_sync_error TEXT, server_sale_id TEXT)''');
    for (final status in ['pending', 'failed', 'syncing', 'synced', 'strange', 'malformed']) {
      db.execute('''INSERT INTO pending_sales VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        [status, 'store-a', 10.123456789, status == 'malformed' ? '{bad-json' : _json,
         'PIX', '  notas\n originais  ', 'customer', 'José', 1712345678,
         status == 'synced' ? 1712345680 : null, status, 7, 'old error',
         status == 'synced' ? 'server-historical' : null]);
    }
    if (failMigration) {
      db.execute("CREATE TRIGGER fail_migration BEFORE UPDATE ON pending_sales BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
    }
    db.execute('PRAGMA user_version = 1');
  } finally { db.dispose(); }
}

List<Map<String, Object?>> raw(String path) {
  final db = sqlite3.open(path);
  try { return db.select('SELECT * FROM pending_sales ORDER BY local_id')
      .map((r) => Map<String, Object?>.from(r)).toList(); }
  finally { db.dispose(); }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory directory;
  late String path;
  final opened = <AppDatabase>[];
  AppDatabase open() {
    final db = AppDatabase.localPersistence(NativeDatabase(File(path)));
    opened.add(db);
    return db;
  }
  Future<String?> claim(AppDatabase db, {int version = 0, String owner = 'worker'}) =>
    db.claimLocalIntent(id: 'new', version: version, scope: scope(), owner: owner,
      now: _time, lease: const Duration(minutes: 1));
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('f10-cb-r2-sqlite-');
    path = '${directory.path}${Platform.pathSeparator}synthetic.sqlite';
  });
  tearDown(() async {
    for (final db in opened) { await db.close(); }
    opened.clear();
    // Keep synthetic files for diagnosis; never open a client database.
  });

  test('01 migration preserves all historical values, bytes, dates and PK', () async {
    seed(path);
    final before = raw(path);
    final db = open();
    expect(db.schemaVersion, 2);
    final rows = await db.readLocalIntents();
    expect(rows.length, 6);
    final after = raw(path);
    for (var i = 0; i < before.length; i++) {
      for (final entry in before[i].entries) { expect(after[i][entry.key], entry.value); }
    }
    final columns = await db.customSelect('PRAGMA table_info(pending_sales)').get();
    expect(columns.where((r) => r.data['pk'] == 1).single.data['name'], 'local_id');
    expect((await db.readLocalIntent('failed'))!['remote_phase'], 'unknown');
    expect((await db.readLocalIntent('syncing'))!['remote_phase'], 'unknown');
    expect((await db.readLocalIntent('pending'))!['context_gate'], 'ambiguous');
  });

  test('02 failed migration rolls back columns, values and user_version', () async {
    seed(path, failMigration: true);
    final before = raw(path);
    final db = open();
    await expectLater(db.readLocalIntents(), throwsA(anything));
    expect(raw(path), before);
    final check = sqlite3.open(path);
    try {
      expect(check.select('PRAGMA user_version').single.values.single, 1);
      expect(check.select('PRAGMA table_info(pending_sales)').map((r) => r['name']),
        isNot(contains('remote_phase')));
    } finally { check.dispose(); }
  });

  test('03 malformed and unrecognized historical rows remain quarantined', () async {
    seed(path);
    final corrupt = sqlite3.open(path);
    try { corrupt.execute("UPDATE pending_sales SET store_id = '  ' WHERE local_id = 'malformed'"); }
    finally { corrupt.dispose(); }
    final db = open();
    for (final id in ['strange', 'malformed']) {
      final row = (await db.readLocalIntent(id))!;
      expect(row['context_gate'], 'integrityBlocked');
      expect(row['local_phase'], 'held');
    }
    expect((await db.readLocalIntent('malformed'))!['products_json'], '{bad-json');
    expect((await db.localReservations(scope(store: 'unrelated'))).uncertain, true);
  });

  test('04 restart preserves migrated envelope and original bytes', () async {
    seed(path);
    final db = open();
    final before = await db.readLocalIntents();
    await db.close(); opened.remove(db);
    expect(await open().readLocalIntents(), before);
  });

  test('05 identity is frozen and read results cannot mutate storage', () async {
    final db = open();
    final candidate = intent();
    expect(await db.persistLocalIntent(candidate), LocalIntentInsertResult.inserted);
    expect(() => candidate.values['store_id'] = 'other', throwsUnsupportedError);
    final row = (await db.readLocalIntent('new'))!;
    expect(() => row['products_json'] = '[]', throwsUnsupportedError);
    expect(row['products_json'], _json);
    expect(row['created_at'], _time.millisecondsSinceEpoch ~/ 1000);
    expect(row['notes'], '  bytes originais  ');
  });

  test('06 same identity and exact payload explicitly returns existing', () async {
    final db = open();
    expect(await db.persistLocalIntent(intent()), LocalIntentInsertResult.inserted);
    expect(await db.persistLocalIntent(intent()), LocalIntentInsertResult.existing);
    expect((await db.readLocalIntents()).length, 1);
  });

  test('07 divergent payload returns conflict and keeps original', () async {
    final db = open(); await db.persistLocalIntent(intent());
    final before = await db.readLocalIntent('new');
    expect(await db.persistLocalIntent(intent(total: 999)), LocalIntentInsertResult.conflict);
    final after = (await db.readLocalIntent('new'))!;
    for (final key in LocalSaleIntent.immutableKeys) { expect(after[key], before![key]); }
    expect(after['context_gate'], 'integrityBlocked');
    expect(await claim(db, version: after['state_version'] as int), null);
    expect((await db.localReservations(scope())).uncertain, true);
  });

  test('08 divergent project store user or target conflicts without row loss', () async {
    final db = open(); await db.persistLocalIntent(intent());
    for (final other in [scope(project: 'b'), scope(store: 'b'), scope(uid: 'b'), scope(endpoint: 'other:8080')]) {
      expect(await db.persistLocalIntent(intent(origin: other)), LocalIntentInsertResult.conflict);
    }
    expect((await db.readLocalIntents()).length, 1);
  });

  test('09 two independent connections have only one CAS claim winner', () async {
    final a = open(); await a.persistLocalIntent(intent());
    final b = open(); await b.readLocalIntents();
    final tokens = await Future.wait([claim(a), claim(b, owner: 'other')]);
    expect(tokens.whereType<String>().length, 1);
    expect((await a.readLocalIntent('new'))!['state_version'], 1);
  });

  test('10 live claim is respected and not recovered', () async {
    final db = open(); await db.persistLocalIntent(intent());
    final token = await claim(db);
    expect(token, isNotNull);
    expect(await claim(db, version: 1), isNull);
    expect(await db.recoverExpiredLocalClaims(_time.add(const Duration(seconds: 59))), 0);
    expect((await db.readLocalIntent('new'))!['claim_token'], token);
  });

  test('11 expired claim becomes unknown and cannot be resent', () async {
    final db = open(); await db.persistLocalIntent(intent()); await claim(db);
    expect(await db.recoverExpiredLocalClaims(_time.add(const Duration(minutes: 1))), 1);
    final row = (await db.readLocalIntent('new'))!;
    expect(row['remote_phase'], 'unknown'); expect(row['previous_uncertainty'], 1);
    expect(await claim(db, version: 2), isNull);
    expect((await db.localReservations(scope())).quantities, {'p': 2});
  });

  test('12 crash and reopen preserve live claim then recover only to unknown', () async {
    final db = open(); await db.persistLocalIntent(intent()); final token = await claim(db);
    await db.close(); opened.remove(db);
    final reopened = open();
    expect((await reopened.readLocalIntent('new'))!['claim_token'], token);
    await reopened.recoverExpiredLocalClaims(_time.add(const Duration(hours: 1)));
    expect((await reopened.readLocalIntent('new'))!['remote_phase'], 'unknown');
  });

  Future<String> confirm(AppDatabase db) async {
    await db.persistLocalIntent(intent()); final token = (await claim(db))!;
    expect(await db.recordLocalConfirmation(id: 'new', version: 1, token: token,
      scope: scope(), observedAt: _time, response: {'success': true, 'localSaleId': 'new',
        'serverSaleId': 'new', 'alreadyProcessed': false}), true);
    return token;
  }

  test('13 remote confirmation is durable and cannot regress or resend', () async {
    final db = open(); final token = await confirm(db);
    expect(await db.finishLocalAttempt(id: 'new', version: 2, token: token, validationBlocked: false), false);
    expect(await claim(db, version: 2), isNull);
    final before = await db.readLocalIntent('new');
    await db.close(); opened.remove(db);
    expect(await open().readLocalIntent('new'), before);
    expect(before!['remote_phase'], 'remoteConfirmed');
    expect(jsonDecode(before['remote_evidence_json'] as String)['level'], 'legacyAttemptCommitted');
  });

  test('14 partial refresh keeps full reservation and full refresh cannot bypass P04', () async {
    final db = open(); await confirm(db);
    expect(await db.recordLocalRefresh(id: 'new', version: 2, scope: scope(),
      refreshedProductIds: {}, completedAt: _time), false);
    expect((await db.readLocalIntent('new'))!['refresh_completed_at'], null);
    expect((await db.localReservations(scope())).quantities, {'p': 2});
    expect(await db.recordLocalRefresh(id: 'new', version: 2, scope: scope(),
      refreshedProductIds: {'p'}, completedAt: _time), true);
    expect((await db.readLocalIntent('new'))!['local_phase'], 'refreshPending');
    expect((await db.localReservations(scope())).quantities, {'p': 2});
  });

  test('15 other users share physical reservations without receiving payload', () async {
    final db = open(); await db.persistLocalIntent(intent());
    await db.persistLocalIntent(intent(id: 'other', origin: scope(uid: 'other')));
    final result = await db.localReservations(scope(uid: 'third'));
    expect(result.quantities, {'p': 4}); expect(result.uncertain, false);
    expect(() => result.quantities['p'] = 0, throwsUnsupportedError);
  });

  test('16 proven distinct projects stores and targets do not contaminate stock', () async {
    final db = open(); await db.persistLocalIntent(intent());
    for (final other in [scope(project: 'b'), scope(store: 'b'), scope(endpoint: 'other:8080')]) {
      expect((await db.localReservations(other)).quantities, isEmpty);
      expect((await db.localReservations(other)).uncertain, false);
    }
  });

  test('17 login never assigns origin to historical records', () async {
    seed(path); final db = open();
    expect(await db.setLocalContext(id: 'pending', version: 0, activeScope: scope()), true);
    final row = (await db.readLocalIntent('pending'))!;
    expect(row['origin_project_id'], null); expect(row['origin_uid'], null);
    expect(row['context_gate'], 'ambiguous');
    expect(await db.claimLocalIntent(id: 'pending', version: 1, scope: scope(),
      owner: 'worker', now: _time, lease: const Duration(seconds: 1)), null);
  });

  test('18 ambiguity is unavailable and malformed row does not erase known reservations', () async {
    seed(path); final db = open(); await db.persistLocalIntent(intent());
    final result = await db.localReservations(scope());
    expect(result.uncertain, true); expect(result.allowsOfflineAvailability, false);
    expect(result.quantities, {'p': 2});
    expect((await db.localReservations(scope(store: 'different'))).uncertain, false);
  });

  test('19 conflict with historical ID preserves every historical byte and line', () async {
    seed(path); final db = open(); final before = await db.readLocalIntents();
    expect(await db.persistLocalIntent(intent(id: 'pending')), LocalIntentInsertResult.conflict);
    final after = await db.readLocalIntents();
    expect(after.length, before.length);
    for (var i = 0; i < before.length; i++) {
      for (final key in LocalSaleIntent.immutableKeys) { expect(after[i][key], before[i][key]); }
      expect(after[i]['status'], before[i]['status']);
    }
    expect((await db.getAllLocalSales()).length, 6);
  });

  test('20 only PendingSales and its indexes exist; no B07-C ledger reused', () async {
    final db = open(); await db.persistLocalIntent(intent());
    final tables = await db.customSelect("SELECT name FROM sqlite_master WHERE type='table'").get();
    expect(tables.map((r) => r.data['name']), ['pending_sales']);
  });

  test('21 stale version and late callback cannot change recovered unknown', () async {
    final db = open(); await db.persistLocalIntent(intent()); final token = (await claim(db))!;
    expect(await db.finishLocalAttempt(id: 'new', version: 0, token: token, validationBlocked: false), false);
    await db.recoverExpiredLocalClaims(_time.add(const Duration(hours: 1)));
    expect(await db.recordLocalConfirmation(id: 'new', version: 1, token: token,
      scope: scope(), observedAt: _time, response: {'success': true, 'localSaleId': 'new',
      'serverSaleId': 'new', 'alreadyProcessed': false}), false);
    expect((await db.readLocalIntent('new'))!['remote_phase'], 'unknown');
  });

  test('22 write errors do not acknowledge persistence or lose original', () async {
    final db = open(); await db.persistLocalIntent(intent());
    await db.customStatement("CREATE TRIGGER reject_insert BEFORE INSERT ON pending_sales BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END");
    await expectLater(db.persistLocalIntent(intent(id: 'fail')), throwsA(anything));
    expect(await db.readLocalIntent('fail'), null);
    expect((await db.readLocalIntents()).length, 1);
  });

  test('23 legacy APIs all refuse v2, including service entry before any network', () async {
    seed(path); final db = open(); await db.readLocalIntents();
    final repo = OfflineSalesRepository(database: db);
    expect(() => db.getPendingSales(), throwsStateError);
    expect(() => repo.getWaitingSales(), throwsStateError);
    expect(() => repo.watchWaitingSales(), throwsStateError);
    await expectLater(repo.countWaitingSales(), throwsStateError);
    expect(() => repo.recoverInterruptedSyncs(), throwsStateError);
    await expectLater(repo.markAsSyncing('pending'), throwsStateError);
    await expectLater(repo.markAsFailed(localId: 'pending', error: 'error'), throwsStateError);
    await expectLater(repo.markAsSynced(localId: 'pending', serverSaleId: 'pending'), throwsStateError);
    await expectLater(repo.retry('pending'), throwsStateError);
    expect(() => repo.watchReservedQuantitiesByProduct(), throwsStateError);
    expect(() => db.getUnsyncedSalesForLocalStock(), throwsStateError);
    expect(() => db.deleteLocalSale('pending'), throwsStateError);
    await expectLater(repo.saveSale(localId: 'blocked', storeId: 's', totalAmount: 1,
      products: [], paymentMethod: 'PIX'), throwsStateError);
    await expectLater(repo.validateStockAndSaveSale(localId: 'blocked', storeId: 's', totalAmount: 1,
      products: [], paymentMethod: 'PIX', knownStockByProduct: {}), throwsStateError);
    final functions = _NoRemoteFunctions();
    final firestore = _NoRemoteFirestore();
    final service = OfflineSalesSyncService(repository: repo, functions: functions,
      firestore: firestore);
    await expectLater(service.syncPendingSales(), throwsStateError);
    expect(functions.calls, 0); expect(firestore.calls, 0);
    expect(service.isSyncing, false);
    expect((await db.readLocalIntent('syncing'))!['remote_phase'], 'unknown');
  });

  test('24 historical synced stays completed without invented remote evidence', () async {
    seed(path); final db = open(); final row = (await db.readLocalIntent('synced'))!;
    expect(row['status'], 'synced'); expect(row['local_phase'], 'finalized');
    expect(row['remote_phase'], null); expect(row['remote_evidence_json'], null);
    expect(row['origin_uid'], null); expect(row['server_sale_id'], 'server-historical');
    expect(await db.claimLocalIntent(id: 'synced', version: 0, scope: scope(), owner: 'w',
      now: _time, lease: const Duration(minutes: 1)), null);
  });

  test('25 suspended context preserves confirmation and physical reservation', () async {
    final db = open(); await confirm(db);
    expect(await db.setLocalContext(id: 'new', version: 2, activeScope: scope(uid: 'b')), true);
    expect((await db.readLocalIntent('new'))!['remote_phase'], 'remoteConfirmed');
    expect((await db.localReservations(scope(uid: 'b'))).quantities, {'p': 2});
    expect(await db.recordLocalRefresh(id: 'new', version: 3, scope: scope(uid: 'b'),
      refreshedProductIds: {'p'}, completedAt: _time), false);
  });

  test('26 validation block keeps reservation and malformed response becomes unknown', () async {
    final db = open(); await db.persistLocalIntent(intent()); final token = (await claim(db))!;
    expect(await db.finishLocalAttempt(id: 'new', version: 1, token: token, validationBlocked: true), true);
    expect((await db.readLocalIntent('new'))!['remote_phase'], 'validationBlocked');
    expect(await claim(db, version: 2), null);
    expect((await db.localReservations(scope())).quantities, {'p': 2});
    await db.persistLocalIntent(intent(id: 'invalid-response'));
    final second = (await db.claimLocalIntent(id: 'invalid-response', version: 0, scope: scope(),
      owner: 'w', now: _time, lease: const Duration(seconds: 1)))!;
    expect(await db.recordLocalConfirmation(id: 'invalid-response', version: 1, token: second,
      scope: scope(), observedAt: _time, response: {'success': true, 'serverSaleId': 'wrong'}), false);
    expect((await db.readLocalIntent('invalid-response'))!['remote_phase'], 'unknown');
  });

  test('27 singleton remains v1 and rejects new APIs using synthetic paths only', () async {
    final originalPaths = PathProviderPlatform.instance;
    PathProviderPlatform.instance = _SyntheticPaths(directory.path);
    final db = AppDatabase.instance;
    try {
      // drift_flutter starts asynchronous path resolution at construction.
      // Await opening under synthetic paths and close before restoring them.
      await db.customSelect('SELECT 1').get();
      expect(db.schemaVersion, 1); expect(db.localPersistenceEnabled, false);
      await expectLater(db.persistLocalIntent(intent()), throwsStateError);
    } finally {
      await db.close();
      PathProviderPlatform.instance = originalPaths;
    }
  });

  test('28 failed confirmation write remains claimed then recovers as unknown', () async {
    final db = open(); await db.persistLocalIntent(intent()); final token = (await claim(db))!;
    await db.customStatement("CREATE TRIGGER reject_confirmation BEFORE UPDATE ON pending_sales WHEN NEW.remote_phase = 'remoteConfirmed' BEGIN SELECT RAISE(ABORT, 'synthetic confirmation write failure'); END");
    await expectLater(db.recordLocalConfirmation(id: 'new', version: 1, token: token,
      scope: scope(), observedAt: _time, response: {'success': true, 'localSaleId': 'new',
      'serverSaleId': 'new', 'alreadyProcessed': false}), throwsA(anything));
    expect((await db.readLocalIntent('new'))!['remote_phase'], 'claimed');
    expect((await db.readLocalIntent('new'))!['remote_evidence_json'], null);
    await db.close(); opened.remove(db);
    final reopened = open();
    await reopened.recoverExpiredLocalClaims(_time.add(const Duration(hours: 1)));
    expect((await reopened.readLocalIntent('new'))!['remote_phase'], 'unknown');
    expect((await reopened.localReservations(scope())).quantities, {'p': 2});
  });

  test('29 tracked response may preserve original evidence after context suspension', () async {
    final db = open(); await db.persistLocalIntent(intent()); final token = (await claim(db))!;
    await db.setLocalContext(id: 'new', version: 1, activeScope: scope(uid: 'other'));
    expect(await db.recordLocalConfirmation(id: 'new', version: 2, token: token,
      scope: scope(uid: 'other'), observedAt: _time, response: {'success': true, 'localSaleId': 'new',
      'serverSaleId': 'new', 'alreadyProcessed': true}), false);
    expect(await db.recordLocalConfirmation(id: 'new', version: 2, token: token,
      scope: scope(), observedAt: _time, response: {'success': true, 'localSaleId': 'new',
      'serverSaleId': 'new', 'alreadyProcessed': true}), true);
    final row = (await db.readLocalIntent('new'))!;
    expect(row['origin_uid'], 'uid-a'); expect(row['context_gate'], 'incompatible');
    expect(row['remote_phase'], 'remoteConfirmed');
    expect(jsonDecode(row['remote_evidence_json'] as String)['level'], 'legacyIdentityAcknowledged');
    expect((await db.localReservations(scope())).quantities, {'p': 2});
  });
}
