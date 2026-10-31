// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/services/navigation_service.dart';
import 'support/checkout_sale_preparation_cases.dart' show checkoutContext, checkoutDraft;
import 'fixtures/sales_characterization_fixtures.dart' show characterizationProduct;

class _NoNetwork extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) => throw StateError('Real network forbidden');
}

class _NoClearCart extends CartProvider {
  int clears = 0;
  @override
  void clear() { clears++; throw StateError('Recovery cannot clear a cart'); }
}

class _NoNavigation extends NavigatorObserver {
  bool armed = false;
  int effects = 0;
  void check() {
    if (armed) { effects++; throw StateError('Recovery cannot navigate'); }
  }
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => check();
  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => check();
  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) => check();
  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) => check();
}

// Borrowed real SQLite, instrumented only at its existing IO boundaries.
class _GuardedStore implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore inner;
  bool recovering = false;
  final writes = <Map<String, String>>[];
  Future<void> Function()? beforeWrite;
  Future<void> Function()? afterWrite;
  bool failReads = false;
  _GuardedStore(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) =>
      throw StateError('Unprotected CAS forbidden: recovery must validate association atomically');
  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) {
    if (failReads) throw StateError('Synthetic read failure');
    return inner.readSnapshot(scope);
  }
  @override
  Future<SaleAtomicCommit<T>> transact<T>(SaleAtomicScope scope,
      SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide) async {
    if (recovering) await beforeWrite?.call();
    final result = await inner.transact(scope, (snapshot) {
      final plan = decide(snapshot);
      if (recovering && plan.writes.isNotEmpty) {
        expect(plan.writes, hasLength(1));
        final entry = plan.writes.entries.single;
        expect(entry.key, contains('confirmSaleV2:'));
        final before = saleObject(jsonDecode(snapshot.values[entry.key]!));
        final next = saleObject(jsonDecode(entry.value));
        // These fail on prepare/send, new IDs, commands, binding or candidate writes.
        expect(next['prepared'], before['prepared'], reason: 'prepare forbidden');
        expect(next['attempts'], before['attempts'], reason: 'send forbidden');
        expect(next['state'], isNot('sending'), reason: 'dispatch forbidden');
        for (final field in ['state', 'outcome', 'updatedAtMs', 'claim', 'leaseUntilMs', 'recordHash']) {
          before.remove(field);
          next.remove(field);
        }
        expect(next, before);
        writes.add(plan.writes);
      }
      return plan;
    });
    if (recovering && result.writesApplied > 0) await afterWrite?.call();
    return result;
  }
  @override
  Future<void> close() => inner.close();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late String file;
  late SqliteSaleMutationStore raw;
  late _GuardedStore store;
  late CheckoutSaleSession session;
  late CheckoutSalePreparation preparation;
  late CheckoutAssociatedHandle handle;
  late Map<String, String> original;
  final commands = <Map<String, dynamic>>[];
  late Future<Map<String, dynamic>> Function(Map<String, dynamic>) answer;
  final remoteRows = <String, Object>{'sale': 'immutable', 'stock': 4};
  HttpOverrides? previousHttp;
  final channels = [
    'plugins.flutter.io/firebase_core', 'plugins.flutter.io/firebase_auth',
    'plugins.flutter.io/cloud_firestore', 'plugins.flutter.io/cloud_functions',
    'net.nfet.printing', 'store_connect/fiscal',
  ];
  final effects = <String>[];
  Map<String, dynamic> confirmed(Map<String, dynamic> c) => {
    'status': 'confirmed', 'saleId': c['saleId'],
    'totalCents': c['expectedTotalCents'], 'replayed': true,
  };
  Future<Map<String, dynamic>> lookup(SaleMutationScope scope, Map<String, dynamic> command) async {
    expect(scope.prefix, checkoutContext().scope.prefix);
    commands.add(saleObject(jsonDecode(saleJson(command))));
    final before = Map<String, Object>.from(remoteRows);
    final result = await answer(command);
    expect(remoteRows, before, reason: 'lookup cannot write remote sale/stock');
    return result;
  }
  Future<Map<String, String>> records() async => {
    for (final key in await raw.keys('')) key: (await raw.read(key))!,
  };
  String key(String marker) => original.keys.singleWhere((k) => k.contains(marker));
  Future<void> replace(String at, String value) async {
    expect(await raw.compareAndSet(at, await raw.read(at), value), true);
  }
  String seal(Map<String, dynamic> record) {
    record.remove('recordHash');
    return saleJson({...record, 'recordHash': saleHash(record)});
  }
  Future<void> markUnknown() async {
    final at = key('confirmSaleV2:');
    final record = saleObject(jsonDecode((await raw.read(at))!));
    record['state'] = 'unknown';
    await replace(at, seal(record));
    original = await records();
    handle = await preparation.resumeAssociated(handle.reference);
  }
  void assertIdentity(Map<String, String> after) {
    expect(after.keys.toSet(), original.keys.toSet());
    for (final at in original.keys.where((k) => !k.contains('confirmSaleV2:'))) {
      expect(after[at], original[at], reason: 'binding/candidate/legacy sentinel unchanged');
    }
    final before = saleObject(jsonDecode(original[key('confirmSaleV2:')]!));
    final next = saleObject(jsonDecode(after[key('confirmSaleV2:')]!));
    expect(next['command'], before['command']);
    expect(next['requestId'], before['requestId']);
    expect(next['saleId'], before['saleId']);
    expect(next['prepared'], before['prepared']);
    expect(next['attempts'], before['attempts']);
  }
  setUp(() async {
    previousHttp = HttpOverrides.current;
    HttpOverrides.global = _NoNetwork();
    effects.clear();
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    for (final channel in channels) {
      messenger.setMockMethodCallHandler(MethodChannel(channel), (_) async {
        effects.add(channel);
        throw StateError('Forbidden SDK/navigation/printing/fiscal channel: $channel');
      });
    }
    commands.clear();
    answer = (c) async => confirmed(c);
    file = '${Directory.systemTemp.createTempSync('p03b-').path}${Platform.pathSeparator}sale.sqlite';
    raw = SqliteSaleMutationStore(file);
    store = _GuardedStore(raw);
    session = CheckoutSaleSession(checkoutContext());
    preparation = CheckoutSalePreparation(store: store, session: session, associatedLookup: lookup);
    final candidate = preparation.newAssociatedPurchase(checkoutDraft());
    handle = await preparation.persistAssociated(candidate);
    // These are inert strings in this TEMP database, not access to actual PendingSales.
    await raw.compareAndSet('PendingSales-sentinel', null, 'legacy bytes');
    original = await records();
    store.recovering = true;
  });
  tearDown(() async {
    expect(effects, isEmpty);
    expect(remoteRows, {'sale': 'immutable', 'stock': 4});
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    for (final channel in channels) {
      messenger.setMockMethodCallHandler(MethodChannel(channel), null);
    }
    HttpOverrides.global = previousHttp;
    await store.close();
  });

  test('associated lookup is opt-in and never falls back to V1 lookup', () async {
    var historicalCalls = 0;
    final disabled = CheckoutSalePreparation(store: store, session: session,
      lookup: (_, c) async { historicalCalls++; return confirmed(c); });
    final own = await disabled.resumeAssociated(handle.reference);
    await expectLater(disabled.consultAssociated(own), throwsStateError);
    expect(historicalCalls, 0);
    expect(commands, isEmpty);
    expect(await records(), original);
  });
  for (final status in ['confirmed', 'rejected', 'identity-conflict']) {
    test('$status is durable on same canonical record with no dispatch or new evidence', () async {
      await markUnknown();
      answer = (c) async => status == 'confirmed' ? confirmed(c) : {
        'status': status, 'saleId': c['saleId'], 'reason': 'synthetic-rejection', 'replayed': true,
      };
      final result = await preparation.consultAssociated(handle);
      expect(result.attempt.state, {
        'confirmed': SaleAttemptState.confirmed, 'rejected': SaleAttemptState.rejected,
        'identity-conflict': SaleAttemptState.identityConflict,
      }[status]);
      expect(commands.single, handle.attempt.payload);
      expect(result.attempt.requestId, handle.attempt.requestId);
      final durable = (await records())[key('confirmSaleV2:')];
      expect(saleObject(jsonDecode(durable!))['outcome'], result.attempt.outcome);
      assertIdentity(await records());
      final repeated = await preparation.consultAssociated(result);
      expect(repeated.attempt.state, result.attempt.state);
      expect(commands, hasLength(1));
      expect((await records())[key('confirmSaleV2:')], durable);
    });
  }
  test('SQLite reopen resumes same intention and rejects handle from old owner', () async {
    await markUnknown();
    final ref = handle.reference;
    await store.close();
    raw = SqliteSaleMutationStore(file);
    store = _GuardedStore(raw)..recovering = true;
    session = CheckoutSaleSession(checkoutContext());
    preparation = CheckoutSalePreparation(store: store, session: session, associatedLookup: lookup);
    await expectLater(preparation.consultAssociated(handle), throwsStateError);
    final resumed = await preparation.resumeAssociated(ref);
    final result = await preparation.consultAssociated(resumed);
    expect(result.attempt.state, SaleAttemptState.confirmed);
    expect(result.attempt.payload, handle.attempt.payload);
    assertIdentity(await records());
  });
  test('not-recorded remains unknown through repeated lookup without cancellation or send', () async {
    answer = (c) async => {'status': 'not-recorded', 'saleId': c['saleId'], 'definitive': false};
    final first = await preparation.consultAssociated(handle);
    final second = await preparation.consultAssociated(first);
    expect(second.attempt.state, SaleAttemptState.unknown);
    expect(second.attempt.outcome, isNull);
    expect(commands, hasLength(2));
    expect(commands.every((c) => saleJson(c) == saleJson(handle.attempt.payload)), true);
    assertIdentity(await records());
  });
  for (final malformed in [
    {'status': 'confirmed', 'saleId': 'foreign', 'totalCents': 29, 'replayed': true},
    {'status': 'confirmed', 'totalCents': 999, 'replayed': true},
    {'status': 'confirmed', 'totalCents': 29, 'replayed': 'yes'},
  ]) {
    test('malformed result $malformed cannot fabricate confirmation', () async {
      answer = (c) async => {'saleId': c['saleId'], ...malformed};
      expect((await preparation.consultAssociated(handle)).attempt.state, SaleAttemptState.unknown);
      assertIdentity(await records());
    });
  }
  test('lookup error stays unknown and recoverable', () async {
    answer = (_) async => throw StateError('synthetic lookup error');
    final unknown = await preparation.consultAssociated(handle);
    expect(unknown.attempt.state, SaleAttemptState.unknown);
    answer = (c) async => confirmed(c);
    expect((await preparation.consultAssociated(unknown)).attempt.state, SaleAttemptState.confirmed);
    assertIdentity(await records());
  });
  test('timeout is unknown; late confirmation cannot publish or mutate the durable result', () async {
    final late = Completer<Map<String, dynamic>>();
    preparation = CheckoutSalePreparation(store: store, session: session, associatedLookup: lookup,
      lookupTimeout: const Duration(milliseconds: 10));
    handle = await preparation.resumeAssociated(handle.reference);
    answer = (_) => late.future;
    final unknown = await preparation.consultAssociated(handle);
    expect(unknown.attempt.state, SaleAttemptState.unknown);
    final before = await records();
    late.complete(confirmed(handle.attempt.payload));
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(await records(), before);
    expect(commands, hasLength(1));
  });
  test('real SQLite INSERT fault cannot acknowledge remote confirmation as durable', () async {
    await markUnknown();
    final fault = sqlite3.open(file);
    try {
      fault.execute("CREATE TRIGGER fail_result BEFORE INSERT ON attempts WHEN NEW.key LIKE '%confirmSaleV2:%' BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
      await expectLater(preparation.consultAssociated(handle), throwsA(anything));
      expect(commands, hasLength(1));
      expect(await records(), original);
      fault.execute('DROP TRIGGER fail_result');
      expect((await preparation.consultAssociated(handle)).attempt.state, SaleAttemptState.confirmed);
    } finally { fault.dispose(); }
  });
  test('storage failure before query leaves command and metadata intact', () async {
    store.failReads = true;
    await expectLater(preparation.consultAssociated(handle), throwsStateError);
    expect(commands, isEmpty);
    expect(await records(), original);
  });
  test('closed real SQLite refuses recovery before lookup', () async {
    await raw.close();
    await expectLater(preparation.consultAssociated(handle), throwsA(anything));
    expect(commands, isEmpty);
    // Reopen only the same temporary database so teardown retains ownership.
    raw = SqliteSaleMutationStore(file);
    store = _GuardedStore(raw)..recovering = true;
    expect(await records(), original);
  });
  test('error after SQLite commit does not return a fabricated successful Future', () async {
    store.afterWrite = () async => throw StateError('synthetic lost local commit acknowledgement');
    await expectLater(preparation.consultAssociated(handle), throwsStateError);
    final persisted = saleObject(jsonDecode((await records())[key('confirmSaleV2:')]!));
    expect(persisted['state'], 'confirmed');
    store.afterWrite = null;
    final resumed = await preparation.resumeAssociated(handle.reference);
    expect((await preparation.consultAssociated(resumed)).attempt.state, SaleAttemptState.confirmed);
    expect(commands, hasLength(1));
    assertIdentity(await records());
  });
  test('generation change after local commit preserves original result but suppresses stale handle', () async {
    store.afterWrite = () async { session.change(null); session.change(checkoutContext()); };
    await expectLater(preparation.consultAssociated(handle), throwsStateError);
    expect(saleObject(jsonDecode((await records())[key('confirmSaleV2:')]!))['state'], 'confirmed');
    store.afterWrite = null;
    final resumed = await preparation.resumeAssociated(handle.reference);
    expect(resumed.attempt.state, SaleAttemptState.confirmed);
    expect(commands, hasLength(1));
    assertIdentity(await records());
  });
  test('another preparation/store cannot consume an existing handle even with same session', () async {
    final otherRaw = SqliteSaleMutationStore('${file}other');
    try {
      final other = CheckoutSalePreparation(store: otherRaw, session: session, associatedLookup: lookup);
      await expectLater(other.consultAssociated(handle), throwsStateError);
      expect(commands, isEmpty);
      expect(await otherRaw.keys(''), isEmpty);
    } finally { await otherRaw.close(); }
    expect(await records(), original);
  });
  final contexts = <String, CheckoutSaleContext?>{
    'user': checkoutContext(uid: 'other'), 'store': checkoutContext(store: 'other'),
    'project': checkoutContext(project: 'demo-other'),
    'environment': CheckoutSaleContext(scope: checkoutContext().scope,
      environment: 'other', firestoreEndpoint: 'localhost:8080', functionsEndpoint: 'localhost:5001'),
    'firestore target': CheckoutSaleContext(scope: checkoutContext().scope,
      environment: 'synthetic', firestoreEndpoint: 'localhost:9080', functionsEndpoint: 'localhost:5001'),
    'functions target': CheckoutSaleContext(scope: checkoutContext().scope,
      environment: 'synthetic', firestoreEndpoint: 'localhost:8080', functionsEndpoint: 'localhost:9001'),
    'closed screen': null, 'ABA': checkoutContext(),
  };
  for (final entry in contexts.entries) {
    test('${entry.key} invalidates original handle before lookup', () async {
      if (entry.key == 'ABA') session.change(null);
      session.change(entry.value);
      await expectLater(preparation.consultAssociated(handle), throwsStateError);
      expect(commands, isEmpty);
      expect(await records(), original);
    });
    test('${entry.key} during lookup cannot return or persist old confirmation in new generation', () async {
      answer = (c) async {
        if (entry.key == 'ABA') session.change(null);
        session.change(entry.value);
        return confirmed(c);
      };
      await expectLater(preparation.consultAssociated(handle), throwsStateError);
      expect(await records(), original);
    });
  }
  for (final marker in ['checkout-binding:', 'checkout-candidate:']) {
    test('$marker corrupt before lookup blocks without repair', () async {
      await replace(key(marker), '{broken');
      final before = await records();
      await expectLater(preparation.consultAssociated(handle), throwsA(anything));
      expect(commands, isEmpty);
      expect(await records(), before);
    });
    test('$marker disappears during query; canonical is not modified or recreated', () async {
      answer = (c) async {
        final db = sqlite3.open(file);
        try { db.execute('DELETE FROM attempts WHERE key = ?', [key(marker)]); }
        finally { db.dispose(); }
        return confirmed(c);
      };
      await expectLater(preparation.consultAssociated(handle), throwsA(anything));
      final after = await records();
      expect(after[key('confirmSaleV2:')], original[key('confirmSaleV2:')]);
      expect(after.containsKey(key(marker)), false);
    });
  }
  test('association change immediately before canonical CAS is rejected atomically', () async {
    var changed = false;
    store.beforeWrite = () async {
      if (changed) return;
      // Resume transactions have no writes, so arm the fault only after lookup.
      if (commands.isEmpty) return;
      changed = true;
      await replace(key('checkout-binding:'), '{changed-before-CAS');
    };
    await expectLater(preparation.consultAssociated(handle), throwsA(anything));
    expect(changed, true);
    expect((await records())[key('confirmSaleV2:')], original[key('confirmSaleV2:')]);
  });
  test('concurrent late error cannot regress a durably confirmed result', () async {
    final entered = Completer<void>();
    final late = Completer<Map<String, dynamic>>();
    answer = (c) {
      if (!entered.isCompleted) { entered.complete(); return late.future; }
      return Future.value(confirmed(c));
    };
    final first = preparation.consultAssociated(handle);
    await entered.future;
    final second = await preparation.consultAssociated(handle);
    expect(second.attempt.state, SaleAttemptState.confirmed);
    final terminal = await records();
    late.completeError(StateError('late lookup failure'));
    expect((await first).attempt.state, SaleAttemptState.confirmed);
    expect(await records(), terminal);
  });
  test('legacy binding cannot be promoted to V2', () async {
    final at = key('checkout-binding:');
    final binding = saleObject(jsonDecode(original[at]!));
    binding['version'] = 1;
    await replace(at, seal(binding));
    final before = await records();
    await expectLater(preparation.consultAssociated(handle), throwsA(anything));
    expect(commands, isEmpty);
    expect(await records(), before);
  });
  for (final issue in ['missing', 'corrupted', 'version']) {
    test('$issue canonical evidence blocks without allocating replacement', () async {
      final at = key('confirmSaleV2:');
      if (issue == 'missing') {
        final db = sqlite3.open(file);
        try { db.execute('DELETE FROM attempts WHERE key = ?', [at]); }
        finally { db.dispose(); }
      } else if (issue == 'corrupted') {
        await replace(at, '{broken');
      } else {
        final record = saleObject(jsonDecode(original[at]!));
        record['ledgerVersion'] = 99;
        await replace(at, seal(record));
      }
      final before = await records();
      await expectLater(preparation.consultAssociated(handle), throwsA(anything));
      expect(commands, isEmpty);
      expect(await records(), before);
    });
  }
  testWidgets('confirmed lookup cannot clear cart, navigate, print, invoke fiscal or contact Firebase', (tester) async {
    final cart = _NoClearCart()..addItem(characterizationProduct());
    final observer = _NoNavigation();
    await tester.pumpWidget(ChangeNotifierProvider<CartProvider>.value(value: cart,
      child: MaterialApp(navigatorKey: NavigationService.navigatorKey,
        navigatorObservers: [observer], home: const Scaffold(body: Text('Read-only recovery')))));
    observer.armed = true;
    final result = await tester.runAsync(() => preparation.consultAssociated(handle));
    expect(result!.attempt.state, SaleAttemptState.confirmed);
    expect(cart.clears, 0);
    expect(cart.items, hasLength(1));
    expect(observer.effects, 0);
    expect(effects, isEmpty);
    assertIdentity(await records());
    observer.armed = false;
    await tester.pumpWidget(const SizedBox());
    cart.dispose();
  });
}
