import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqlite3/sqlite3.dart' as sql;
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/services/android_checkout_cart.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'package:store_connect/services/commercial_operation_service.dart';
import 'package:store_connect/widgets/payment_options_sheet.dart';

class TestAndroidOrigin extends AndroidCheckoutOrigin {
  CheckoutContextBinding binding;
  bool authenticated = true;
  int sends = 0, queries = 0;
  final commands = <Map<String, dynamic>>[];
  Future<Map<String, dynamic>> Function(Map<String, dynamic>)? sending, lookup;
  TestAndroidOrigin([String project = 'demo-store-connect-android04']) : binding = CheckoutContextBinding(
    CheckoutSaleContext(scope: SaleMutationScope(projectId: project, uid: 'u', storeId: 's'),
      environment: 'android-emulator-auth9194', firestoreEndpoint: 'http://127.0.0.1:8194',
      functionsEndpoint: 'http://127.0.0.1:5194/$project/us-central1'), Object());
  void rotate([String? uid, String? store]) {
    binding = CheckoutContextBinding(CheckoutSaleContext(scope: SaleMutationScope(
      projectId: binding.context.scope.projectId, uid: uid ?? binding.context.scope.uid,
      storeId: store ?? binding.context.scope.storeId), environment: 'android-emulator-auth9194',
      firestoreEndpoint: 'http://127.0.0.1:8194', functionsEndpoint: binding.context.target.isEmpty ? '' :
        'http://127.0.0.1:5194/${binding.context.scope.projectId}/us-central1'), Object());
    notifyListeners();
  }
  @override
  CheckoutContextBinding? capture() => authenticated ? binding : null;
  @override
  bool isCurrent(CheckoutContextBinding value) => authenticated && identical(value, binding);
  @override
  Future<CheckoutContextBinding> authorize() async {
    if (!authenticated) throw StateError('unauthenticated');
    return binding;
  }
  @override
  Future<Map<String, dynamic>> readStore() async => {'subscriptionStatus': 'active'};
  Map<String, dynamic> confirmed(Map<String, dynamic> command) => {
    'status': 'confirmed', 'saleId': command['saleId'], 'totalCents': command['expectedTotalCents'], 'replayed': false};
  @override
  Future<Map<String, dynamic>> send(SaleMutationScope scope, Map<String, dynamic> command) async {
    sends++; commands.add(command);
    return sending == null ? confirmed(command) : sending!(command);
  }
  @override
  Future<Map<String, dynamic>> recover(SaleMutationScope scope, Map<String, dynamic> command) async {
    queries++; commands.add(command);
    return lookup == null ? confirmed(command) : lookup!(command);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;
  late SqliteSaleMutationStore store;
  late TestAndroidOrigin origin;
  late AndroidCheckoutCart checkout;
  late CartProvider cart;
  String getPath() => '${dir.path}/cart.sqlite';
  Future<AndroidCartSale> submit() => checkout.submit(cart, 's', 'PIX', '');
  setUp(() {
    dir = Directory.systemTemp.createTempSync('android-cart04-');
    store = SqliteSaleMutationStore(getPath());
    origin = TestAndroidOrigin();
    checkout = AndroidCheckoutCart(origin: origin, store: store);
    cart = CartProvider()..addItem(Product(id: 'p', name: 'Synthetic', price: 0.29, quantidade: 5, minimumStock: 0));
  });
  tearDown(() async {checkout.close(); await store.close(); dir.deleteSync(recursive: true);});

  test('normal sale: cart pointer, association, prepared command and claim durable before send', () async {
    origin.sending = (command) async {
      final keys = await store.keys('');
      expect(keys.where((key) => key.endsWith('android-active-cart')), hasLength(1));
      expect(keys.where((key) => key.contains('checkout-binding:')), hasLength(1));
      expect(keys.where((key) => key.contains('confirmSaleV2:')), hasLength(1));
      return origin.confirmed(command);
    };
    final sale = await submit();
    expect(sale.handle.attempt.state, SaleAttemptState.confirmed);
    expect(origin.sends, 1);
    expect(await checkout.applyConfirmed(sale), true);
    expect(cart.itemCount, 0);
    expect(await checkout.applyConfirmed(sale), false);
  });
  test('unknown deferred intention blocks instant checkout without a sale or legacy fallback', () async {
    final deferred=CommercialOperationService(store:store,call:(endpoint,command)async {
      if(endpoint=='getDeferredSaleResultV1')return {'status':'not-recorded','requestId':command['requestId']};
      throw TimeoutException('lost deferred response');
    });
    await expectLater(deferred.execute(operation:CommercialOperation.deferredSale,
      scope:origin.binding.context.scope.toJson(),isCurrent:()=>true,intent:{'customerId':'c'}),throwsA(isA<TimeoutException>()));
    await expectLater(submit(),throwsStateError);expect(origin.sends,0);
    expect((await store.keys('')).where((key)=>key.endsWith('android-active-cart')),isEmpty);
  });
  for(final deferredFirst in [true,false]) {
    test('atomic shared reservation prevents concurrent fiado and instant intentions ($deferredFirst)',()async{
      var deferredSends=0;
      final deferred=CommercialOperationService(store:store,call:(endpoint,command)async{
        if(endpoint=='getDeferredSaleResultV1')return {'status':'not-recorded','requestId':command['requestId']};
        deferredSends++;return {'status':'confirmed','requestId':command['requestId']};
      });
      Future<bool> credit()async{
        try {await deferred.execute(operation:CommercialOperation.deferredSale,
          scope:origin.binding.context.scope.toJson(),isCurrent:()=>true,intent:{'customerId':'c'});return true;}
        on StateError{return false;}
      }
      Future<bool> instant()async{try{await submit();return true;}on StateError{return false;}}
      final results=await Future.wait(deferredFirst?[credit(),instant()]:[instant(),credit()]);
      expect(results.where((value)=>value),hasLength(1));expect(deferredSends+origin.sends,1);
    });
  }
  test('retry confirmed same cart returns original result without another send', () async {
    final first = await submit();
    final replay = await submit();
    expect(replay.handle.attempt.requestId, first.handle.attempt.requestId);
    expect(origin.sends, 1);
  });
  test('new cart created during asynchronous completion cannot receive old navigation success', () async {
    final sale = await submit();
    void nextCart() {
      if (cart.itemCount == 0) {
        scheduleMicrotask(() => cart.addItem(
          Product(id: 'next', name: 'Next', price: 0.29, quantidade: 5, minimumStock: 0)));
      }
    }
    cart.addListener(nextCart);
    expect(await checkout.applyConfirmed(sale), false);
    cart.removeListener(nextCart);
    expect(cart.items.keys, contains('next'));
  });
  test('response lost, close/reopen SQLite and session: lookup original identity only', () async {
    origin.sending = (_) async => throw TimeoutException('synthetic lost response');
    final first = await submit();
    expect(first.handle.attempt.state, SaleAttemptState.unknown);
    checkout.close(); await store.close();
    store = SqliteSaleMutationStore(getPath()); origin.rotate();
    checkout = AndroidCheckoutCart(origin: origin, store: store);
    final recovered = await submit();
    expect(recovered.handle.attempt.state, SaleAttemptState.confirmed);
    expect(recovered.handle.attempt.requestId, first.handle.attempt.requestId);
    expect(origin.sends, 1); expect(origin.queries, 1);
    expect(origin.commands[0], origin.commands[1]);
  });
  test('not-recorded never authorizes resend or new identity', () async {
    origin.sending = (_) async => throw TimeoutException('before delivery');
    origin.lookup = (command) async => {'status': 'not-recorded', 'saleId': command['saleId'], 'definitive': false};
    final first = await submit();
    final again = await submit();
    expect(again.handle.attempt.state, SaleAttemptState.unknown);
    expect(again.handle.attempt.requestId, first.handle.attempt.requestId);
    expect(origin.sends, 1); expect(origin.queries, 1);
  });
  test('fresh empty cart after restart queries original intention without attaching or clearing it', () async {
    origin.sending = (_) async => throw TimeoutException('synthetic response lost');
    final original = await submit();
    checkout.close(); await store.close();
    store = SqliteSaleMutationStore(getPath()); origin.rotate();
    checkout = AndroidCheckoutCart(origin: origin, store: store);
    cart = CartProvider();
    final recovered = await checkout.recoverActive('s');
    expect(recovered!.attempt.requestId, original.handle.attempt.requestId);
    expect(recovered.attempt.state, SaleAttemptState.confirmed);
    expect(cart.itemCount, 0); expect(origin.sends, 1); expect(origin.queries, 1);
    origin.rotate(null, 'foreign');
    await expectLater(checkout.recoverActive('s'), throwsStateError);
  });
  test('divergent draft preserves original association and does not send', () async {
    final first = await submit();
    cart.addItem(Product(id: 'p', name: 'Synthetic', price: 0.29, quantidade: 5, minimumStock: 0));
    await expectLater(submit(), throwsA(isA<CheckoutAssociatedConflict>()));
    expect(origin.sends, 1);
    expect(first.handle.attempt.payload['expectedTotalCents'], 29);
  });
  test('simultaneous UI action blocked while original remains in flight', () async {
    final entered = Completer<void>(), release = Completer<void>();
    origin.sending = (command) async {entered.complete(); await release.future; return origin.confirmed(command);};
    final pending = submit(); await entered.future;
    expect(submit, throwsStateError);
    release.complete(); await pending;
    expect(origin.sends, 1);
  });
  test('two controllers and SQLite connections share original intention without second send', () async {
    final entered = Completer<void>(), release = Completer<void>();
    origin.sending = (command) async {entered.complete(); await release.future; return origin.confirmed(command);};
    origin.lookup = (command) async => {'status': 'not-recorded', 'saleId': command['saleId'], 'definitive': false};
    final secondStore = SqliteSaleMutationStore(getPath());
    final second = AndroidCheckoutCart(origin: origin, store: secondStore);
    try {
      final first = submit(); await entered.future;
      final other = await second.submit(cart, 's', 'PIX', '');
      release.complete(); final result = await first;
      expect(other.handle.attempt.requestId, result.handle.attempt.requestId);
      expect(origin.sends, 1);
    } finally {second.close(); await secondStore.close();}
  });
  for (final transition in ['cart', 'user', 'store', 'A-B-A', 'closed']) {
    test('late response after $transition cannot clear the current cart', () async {
      final entered = Completer<void>(), release = Completer<void>();
      origin.sending = (command) async {entered.complete(); await release.future; return origin.confirmed(command);};
      final pending = submit(); await entered.future;
      final expectedFailure = expectLater(pending, throwsStateError);
      if (transition == 'cart') {cart.removeItem('p'); cart.addItem(Product(id: 'p', name: 'Changed', price: 0.29, quantidade: 5, minimumStock: 0));}
      if (transition == 'user') origin.rotate('other');
      if (transition == 'store') origin.rotate(null, 'other');
      if (transition == 'A-B-A') {origin.rotate('other'); origin.rotate('u');}
      if (transition == 'closed') checkout.close();
      release.complete(); await expectedFailure;
      expect(cart.itemCount, 1);
    });
  }
  test('unauthenticated or wrong store: no identity/command persisted and no send', () async {
    origin.authenticated = false;
    await expectLater(submit(), throwsStateError);
    origin.authenticated = true; origin.rotate(null, 'foreign');
    await expectLater(submit(), throwsStateError);
    expect(await store.keys(''), isEmpty); expect(origin.sends, 0);
  });
  test('PROD scope rejected even from injected origin', () async {
    checkout.close(); origin = TestAndroidOrigin('store-connect-app');
    checkout = AndroidCheckoutCart(origin: origin, store: store);
    await expectLater(submit(), throwsStateError);
    expect(await store.keys(''), isEmpty);
  });
  test('cart association transaction failure commits neither pointer nor sale identity', () async {
    final control = sql.sqlite3.open(getPath());
    control.execute("CREATE TRIGGER fail_cart_link BEFORE INSERT ON attempts WHEN NEW.key LIKE '%android-active-cart' BEGIN SELECT RAISE(ABORT, 'synthetic-link-fault'); END");
    try {await expectLater(submit(), throwsA(isA<sql.SqliteException>()));}
    finally {control.execute('DROP TRIGGER fail_cart_link'); control.dispose();}
    expect(origin.sends, 0);
    expect(await store.keys(''), isEmpty);
  });
  testWidgets('real commercial payment sheet uses injected V2 and clears only confirmed current cart', (tester) async {
    SharedPreferences.setMockInitialValues({'fiado_enabled': false});
    await tester.pumpWidget(ChangeNotifierProvider.value(value: cart,
      child: MaterialApp(home: Scaffold(body: Builder(builder: (context) => TextButton(
        onPressed: () => showModalBottomSheet<void>(context: context, builder: (_) =>
          PaymentOptionsSheet(storeId: 's', notes: '', localV2Checkout: checkout)),
        child: const Text('Open checkout')))))));
    await tester.tap(find.text('Open checkout')); await tester.pumpAndSettle();
    await tester.tap(find.text('Dinheiro')); await tester.pumpAndSettle();
    expect(origin.sends, 1); expect(cart.itemCount, 0);
    expect(find.byType(PaymentOptionsSheet), findsNothing);
  });
  testWidgets('real sheet unknown outcome stays open and next action queries original without legacy SDK', (tester) async {
    SharedPreferences.setMockInitialValues({'fiado_enabled': false});
    origin.sending = (_) async => throw TimeoutException('synthetic lost response');
    await tester.pumpWidget(ChangeNotifierProvider.value(value: cart,
      child: MaterialApp(home: Scaffold(body: PaymentOptionsSheet(storeId: 's', notes: '', localV2Checkout: checkout)))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Dinheiro')); await tester.pumpAndSettle();
    expect(cart.itemCount, 1); expect(origin.sends, 1);
    await tester.tap(find.text('Dinheiro')); await tester.pumpAndSettle();
    expect(origin.sends, 1); expect(origin.queries, 1);
    expect(origin.commands[0], origin.commands[1]);
  });
  testWidgets('payment presentation notes A-B-A suppresses late confirmation and preserves cart', (tester) async {
    SharedPreferences.setMockInitialValues({'fiado_enabled': false});
    final entered = Completer<void>(), release = Completer<void>();
    origin.sending = (command) async {entered.complete(); await release.future; return origin.confirmed(command);};
    final notes = ValueNotifier('A');
    await tester.pumpWidget(ChangeNotifierProvider.value(value: cart, child: MaterialApp(home: Scaffold(
      body: ValueListenableBuilder<String>(valueListenable: notes, builder: (_, value, _) =>
        PaymentOptionsSheet(storeId: 's', notes: value, localV2Checkout: checkout))))));
    await tester.pumpAndSettle(); await tester.tap(find.text('Dinheiro')); await tester.pump();
    await tester.runAsync(() => entered.future);
    notes.value = 'B'; await tester.pump(); notes.value = 'A'; await tester.pump();
    release.complete(); await tester.pumpAndSettle();
    expect(cart.itemCount, 1); expect(origin.sends, 1);
    expect(find.byType(PaymentOptionsSheet), findsOneWidget);
    await tester.pumpWidget(const SizedBox()); notes.dispose();
  });
}
