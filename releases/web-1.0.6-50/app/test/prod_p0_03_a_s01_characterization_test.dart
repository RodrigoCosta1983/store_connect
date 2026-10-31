// Legacy duplication evidence plus directed acceptance of stale-cart protection.
// Passing this file does not certify S01 idempotency or release readiness.
// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/widgets/payment_options_sheet.dart';
import 'fixtures/sales_characterization_fixtures.dart';
import 'support/sales_characterization_firestore.dart';

class _DemoCore extends MockFirebaseApp {
  @override
  Future<List<CoreInitializeResponse>> initializeCore() async => [
    CoreInitializeResponse(name: '[DEFAULT]', options: CoreFirebaseOptions(
      apiKey: 'synthetic-key', appId: '1:123:web:synthetic',
      messagingSenderId: '123', projectId: 'demo-prod-p0-03-a'), pluginConstants: {}),
  ];
}

// Controls transaction admission and the response after the fake applies S01 writes.
class _DelayedResponse extends SalesCharacterizationFirestore {
  var committed = Completer<void>();
  Completer<void>? response;
  Completer<void>? admission;
  Object? responseError;
  @override
  Future<T?> runTransaction<T>(TransactionHandler<T> handler, {
    Duration timeout = const Duration(seconds: 30), int maxAttempts = 5,
  }) async {
    if (admission != null) await admission!.future;
    final result = await super.runTransaction(handler, timeout: timeout, maxAttempts: maxAttempts);
    if (!committed.isCompleted) committed.complete();
    if (response != null) await response!.future;
    if (responseError != null) throw responseError!;
    return result;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _DelayedResponse db;
  late CartProvider cart;
  List<Map<String, dynamic>> rows() => db.rows('$characterizationStore/sales');
  setUpAll(() async {
    TestFirebaseCoreHostApi.setUp(_DemoCore());
    await Firebase.initializeApp();
    FieldValueFactoryPlatform.instance = SalesFieldValues();
    db = _DelayedResponse();
    FirebaseFirestorePlatform.instance = db;
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    db.docs.clear();
    db.reads.clear();
    db.commits.clear();
    db.ids = 0;
    db.failAfterCommit = false;
    db.committed = Completer<void>();
    db.response = null;
    db.admission = null;
    db.responseError = null;
    db.docs[characterizationStore] = {'subscriptionStatus': 'active', 'subscriptionType': 'pro'};
    db.docs['$characterizationStore/products/p'] = manualStock();
    cart = CartProvider()..addItem(characterizationProduct());
  });
  tearDown(() => cart.dispose());
  Future<void> open(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ChangeNotifierProvider.value(value: cart,
      child: MaterialApp(home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () => showDialog<void>(context: context, builder: (_) => const Material(
          child: PaymentOptionsSheet(storeId: 'characterization', notes: 'original'))),
        child: const Text('Open'),
      ))))));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
  }
  Future<void> loseResponse(WidgetTester tester) async {
    db.failAfterCommit = true;
    await open(tester);
    await tester.tap(find.text('Dinheiro'));
    await tester.pumpAndSettle();
    expect(rows(), hasLength(1));
    expect(db.commits, hasLength(1));
    expect(cart.items['p']!.quantity, 1);
  }
  Future<void> retry(WidgetTester tester) async {
    // Actual registered callback; no claim of physical snackbar hit testing.
    tester.widget<SnackBarAction>(find.byType(SnackBarAction)).onPressed();
    await tester.pumpAndSettle();
  }
  testWidgets('LEGACY duplicate sale identities after committed response is lost', (tester) async {
    await loseResponse(tester);
    final first = rows().single['localSaleId'];
    await retry(tester);
    expect(rows(), hasLength(2));
    expect(rows().map((r) => r['localSaleId']).toSet(), hasLength(2));
    expect(rows().first['localSaleId'], first);
    expect(db.reads.where((p) => p.contains('/sales/')), isEmpty);
  });
  testWidgets('LEGACY independent evidence of double stock debit for one retry', (tester) async {
    await loseResponse(tester);
    expect(db.docs['$characterizationStore/products/p']!['quantidade'], 19);
    await retry(tester);
    expect(db.docs['$characterizationStore/products/p']!['quantidade'], 18);
    expect(db.commits.where((paths) => paths.contains('$characterizationStore/products/p')), hasLength(2));
    expect(db.rows('$characterizationStore/cash_flow'), isEmpty);
  });
  testWidgets('S01 stale retry preserves replacement cart and original receipt', (tester) async {
    await loseResponse(tester);
    final originalReceipt = cloneSalesValue(rows().single);
    cart.clear();
    cart.addItem(characterizationProduct(price: 7));
    await retry(tester);
    expect(rows(), hasLength(1));
    expect(rows().first, originalReceipt);
    expect(cart.totalAmount, 7);
    expect(db.docs['$characterizationStore/products/p']!['quantidade'], 19);
    // Commercial snapshots only: no thermal PDF or physical printer is invoked here.
  });
  testWidgets('S01 late successful response preserves replacement cart', (tester) async {
    db.response = Completer<void>();
    await open(tester);
    await tester.tap(find.text('Dinheiro'));
    for (var i = 0; i < 20 && !db.committed.isCompleted; i++) {
      await tester.pump(const Duration(milliseconds: 1));
    }
    expect(db.committed.isCompleted, true);
    final savedReceipt = cloneSalesValue(rows().single);
    cart.clear();
    cart.addItem(characterizationProduct(price: 7));
    expect(cart.totalAmount, 7);
    db.response!.complete();
    await tester.pumpAndSettle();
    expect(rows(), hasLength(1));
    expect(rows().single, savedReceipt);
    expect(rows().single['totalAmount'], 100);
    expect(cart.totalAmount, 7);
    expect(find.byType(PaymentOptionsSheet), findsOneWidget);
    expect(db.docs['$characterizationStore/products/p']!['quantidade'], 19);
  });

  testWidgets('S01 cart change before transaction prevents sale and stock debit', (tester) async {
    db.admission = Completer<void>();
    await open(tester);
    await tester.tap(find.text('Dinheiro'));
    await tester.pump();
    cart.addItem(characterizationProduct());
    db.admission!.complete();
    await tester.pumpAndSettle();
    expect(rows(), isEmpty);
    expect(db.commits, isEmpty);
    expect(cart.items['p']!.quantity, 2);
    expect(db.docs['$characterizationStore/products/p']!['quantidade'], 20);
  });

  testWidgets('S01 late failure does not offer retry for replacement cart', (tester) async {
    db.response = Completer<void>();
    db.responseError = StateError('synthetic late failure after commit');
    await open(tester);
    await tester.tap(find.text('Dinheiro'));
    for (var i = 0; i < 20 && !db.committed.isCompleted; i++) {
      await tester.pump(const Duration(milliseconds: 1));
    }
    expect(db.committed.isCompleted, true);
    cart.clear();
    cart.addItem(characterizationProduct(price: 7));
    db.response!.complete();
    await tester.pumpAndSettle();
    expect(rows(), hasLength(1));
    expect(cart.totalAmount, 7);
    expect(find.byType(SnackBarAction), findsNothing);
    expect(find.byType(PaymentOptionsSheet), findsOneWidget);
  });

  testWidgets('S01 stale retry is invalid after cart A-B-A', (tester) async {
    await loseResponse(tester);
    cart.clear();
    cart.addItem(characterizationProduct());
    await retry(tester);
    expect(rows(), hasLength(1));
    expect(cart.totalAmount, 100);
    expect(db.docs['$characterizationStore/products/p']!['quantidade'], 19);
  });
}
