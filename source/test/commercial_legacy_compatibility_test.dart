// Directed native compatibility: real local guard, fake Firestore only.
// ignore_for_file: depend_on_referenced_packages
import 'dart:io';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/screens/reports/customer_debt_detail_screen.dart';
import 'package:store_connect/screens/management/customer_receivables_screen.dart';
import 'package:store_connect/widgets/order_item_widget.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/debt_payment_service.dart';
import 'package:store_connect/services/commercial_operation_service.dart';
import 'package:store_connect/widgets/confirm_fiado_dialog.dart';
import 'package:store_connect/screens/finance/manual_cash_screen.dart';
import 'package:store_connect/screens/cart/cart_screen.dart';
import 'package:store_connect/services/commercial_checkout_legacy_guard.dart';
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'fixtures/sales_characterization_fixtures.dart';
import 'support/sales_characterization_firestore.dart';

class _Paths extends PathProviderPlatform {
  final String path;
  _Paths(this.path);
  @override
  Future<String?> getApplicationSupportPath() async => path;
}

class _DemoCore extends MockFirebaseApp {
  @override
  Future<List<CoreInitializeResponse>> initializeCore() async => [
    CoreInitializeResponse(
      name: '[DEFAULT]',
      options: CoreFirebaseOptions(
        apiKey: 'fake-local-key',
        appId: '1:123:web:local',
        messagingSenderId: '123',
        projectId: 'demo-f9-b07a',
      ),
      pluginConstants: {},
    ),
  ];
}

class _User extends Fake with MockPlatformInterfaceMixin implements UserPlatform {
  final String id;
  _User([this.id='financial-user']);
  @override
  String get uid => id;
}
class _Auth extends FirebaseAuthPlatform {
  UserPlatform? user = _User();
  final events = StreamController<UserPlatform?>.broadcast();
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({dynamic currentUser, String? languageCode}) => this;
  @override
  UserPlatform? get currentUser => user;
  @override
  Stream<UserPlatform?> authStateChanges() async* { yield user; yield* events.stream; }
}
class _FailWriteStore implements SaleMutationStore {
  final SaleMutationStore inner;
  _FailWriteStore(this.inner);
  @override
  Future<String?> read(String key)=>inner.read(key);
  @override
  Future<List<String>> keys(String prefix)=>inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key,String? expected,String value)async=>throw StateError('synthetic local persistence failure');
  @override
  Future<void> close()async{}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final directory = Directory.systemTemp.createTempSync('commercial06-legacy-');
  PathProviderPlatform.instance = _Paths(directory.path);
  tearDownAll(() => directory.deleteSync(recursive: true));
  late SalesCharacterizationFirestore db;
  late CartProvider cart;
  late SalesProvider sales;
  late SqliteSaleMutationStore storage;
  late DebtPaymentService service;
  late CommercialOperationService commercial;
  final commercialCalls=<Map<String,dynamic>>[];
  final auth = _Auth();
  final calls = <Map<String, dynamic>>[];
  final outcomes = <String, Map<String, dynamic>>{};
  var beforeCommit = false, afterCommit = false, serial = 0;
  Completer<void>? pause;
  Future<Map<String, dynamic>> call(String endpoint, Map<String, dynamic> command) async {
    calls.add({'endpoint': endpoint, ...command});
    final id = command['requestId'] as String;
    if (endpoint == 'getDebtPaymentResultV1') return outcomes[id] ?? {'status': 'not-recorded', 'requestId': id};
    if (pause != null) await pause!.future;
    if (beforeCommit) throw TimeoutException('before commit');
    final result = outcomes.putIfAbsent(id, () => {'status': 'confirmed', 'requestId': id});
    if (afterCommit) throw TimeoutException('after commit');
    return result;
  }
  Future<Map<String,dynamic>> commercialCall(String endpoint,Map<String,dynamic> command) async {
    commercialCalls.add({'endpoint':endpoint,...command});
    final id=command['requestId'] as String;
    if(endpoint.startsWith('get'))return outcomes[id]??{'status':'not-recorded','requestId':id};
    if(pause!=null)await pause!.future;
    if(beforeCommit)throw TimeoutException('before commit');
    final result=outcomes.putIfAbsent(id,()=>{'status':'confirmed','requestId':id,
      if(endpoint=='createDeferredSaleV1')'saleId':id,
      if(endpoint=='createManualCashV1')'cashFlowId':id});
    if(afterCommit)throw TimeoutException('after commit');
    return result;
  }
  int getSendCount() => calls.where((c) => c['endpoint'] == 'receiveDebtPaymentV1').length;
  Future<void> receive([double amount = 30]) => sales.receiveCustomerDebtPayment(
    customerId: 'customer', customerName: 'Synthetic', amountToPay: amount, expectedStoreId: 'characterization');
  List<Map<String, dynamic>> saleRows() =>
      db.rows('$characterizationStore/sales');
  List<Map<String, dynamic>> cashRows() =>
      db.rows('$characterizationStore/cash_flow');
  setUpAll(() async {
    TestFirebaseCoreHostApi.setUp(_DemoCore());
    await Firebase.initializeApp();
    FirebaseAuthPlatform.instance = auth;
    FieldValueFactoryPlatform.instance = SalesFieldValues();
    db = SalesCharacterizationFirestore();
    FirebaseFirestorePlatform.instance = db;
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    db.docs.clear();
    db.reads.clear();
    db.commits.clear();
    db.ids = 0;
    db.failAfterCommit = false;
    db.failCash = false;
    db.failAfterBatchCommit = false;
    db.docs[characterizationStore] = {
      'subscriptionStatus': 'active',
      'subscriptionType': 'pro',
    };
    db.docs['$characterizationStore/products/p'] = manualStock();
    cart = CartProvider()..addItem(characterizationProduct());
    calls.clear(); commercialCalls.clear(); outcomes.clear(); beforeCommit = false; afterCommit = false; pause = null;
    auth.user = _User();
    storage = SqliteSaleMutationStore('${directory.path}/financial-${serial++}.sqlite');
    service = DebtPaymentService(store: storage, call: call);
    commercial = CommercialOperationService(store:storage,call:commercialCall);
    sales = SalesProvider(debtPayments: service,commercialOperations:commercial)..updateStoreId('characterization');
  });
  tearDown(() async {
    cart.dispose();
    sales.dispose();
    await storage.close();
  });

  test(
    'legacy fiado without a V2 intention stays unpaid with original customer and due date',
    () async {
      final due = DateTime(2032, 1, 31);
      await sales.addOrder(
        cartProducts: cart.items.values.toList(),
        total: cart.totalAmount,
        customer: Customer(id: 'customer', name: 'Synthetic'),
        dueDate: due,
        notes: 'credit',
      );
      expect(saleRows(), isEmpty);
      expect(commercialCalls.last['endpoint'],'createDeferredSaleV1');
      expect(commercialCalls.last['customerId'], 'customer');
      expect(commercialCalls.last['firstDueDate'],'2032-01-31');
      expect(commercialCalls.last['installmentCount'],1);
      expect(cashRows(), isEmpty);
    },
  );
  // S06/S07 financial invariants now run against the real callable/transaction in
  // debtPaymentHttp.emulator.test.js. Here the real provider/SQLite verify routing,
  // identity, session fencing and recovery; no financial algorithm is duplicated.
  test('provider persists identity before dispatch and repeated callback reuses receipt', () async {
    await receive(); await receive();
    expect(getSendCount(), 1);
    expect(calls.first['amountCents'], 3000);
    expect(calls.first['scope'], {'projectId': 'demo-f9-b07a', 'uid': 'financial-user', 'storeId': 'characterization'});
    expect(saleRows(), isEmpty); expect(cashRows(), isEmpty);
  });
  test('explicit next receipt of the same amount is a distinct legitimate operation', () async {
    await receive(); final first = calls.last['requestId'];
    await sales.beginCustomerDebtPayment('customer'); await receive();
    expect(getSendCount(), 2); expect(calls.last['requestId'], isNot(first));
  });
  test('failure before commit resumes original frozen receipt and blocks a changed amount', () async {
    beforeCommit = true;
    await expectLater(receive(), throwsA(isA<TimeoutException>()));
    final id = calls.last['requestId'];
    await expectLater(sales.beginCustomerDebtPayment('customer'), throwsStateError);
    await expectLater(receive(20), throwsStateError);
    beforeCommit = false;
    await sales.recoverCustomerDebtPayment('customer');
    expect(calls.last['requestId'], id); expect(outcomes, hasLength(1));
  });
  test('lost response and SQLite reopen recover original without another send', () async {
    afterCommit = true;
    await expectLater(receive(), throwsA(isA<TimeoutException>()));
    await storage.close(); storage = SqliteSaleMutationStore('${directory.path}/financial-${serial-1}.sqlite');
    service = DebtPaymentService(store: storage, call: call);
    sales.dispose(); sales = SalesProvider(debtPayments: service)..updateStoreId('characterization');
    afterCommit = false;
    await sales.recoverCustomerDebtPayment('customer');
    expect(getSendCount(), 1); expect(outcomes, hasLength(1));
  });
  test('legacy mark paid routes settlement and cash to one command and retries same identity', () async {
    final cash = CashFlowProvider();
    await sales.markOrderAsPaid('legacy', 70, cash, expectedStoreId: 'characterization');
    await sales.markOrderAsPaid('legacy', 70, cash, expectedStoreId: 'characterization');
    expect(getSendCount(), 1); expect(calls.last['saleId'], 'legacy');
    expect(calls.last['amountCents'], 7000); expect(calls.last['customerId'], isNull);
    expect(saleRows(), isEmpty); expect(cashRows(), isEmpty); cash.dispose();
  });
  test('legacy settlement after a partial is distinct, lost settlement recovers through customer account', () async {
    await receive();
    final partialId = calls.last['requestId'];
    final cash = CashFlowProvider(); afterCommit = true;
    await expectLater(sales.markOrderAsPaid('legacy', 70, cash, customerId: 'customer'),
      throwsA(isA<TimeoutException>()));
    final settlementId = calls.last['requestId']; expect(settlementId, isNot(partialId));
    afterCommit = false;
    await sales.recoverCustomerDebtPayment('customer');
    expect(calls.last['requestId'], settlementId); expect(getSendCount(), 2);
    await sales.markOrderAsPaid('legacy', 70, cash, customerId: 'customer');
    expect(getSendCount(), 2); cash.dispose();
  });
  test('invalid amount or originating store never reaches financial transport', () async {
    for (final amount in [0.0, -1.0, double.nan, double.infinity, 1.005, 1000000000.01]) {
      await expectLater(receive(amount), throwsArgumentError);
    }
    await expectLater(sales.receiveCustomerDebtPayment(customerId: 'customer', customerName: 'Synthetic',
      amountToPay: 30, expectedStoreId: 'other'), throwsStateError);
    expect(calls, isEmpty);
  });
  test('store ABA during network call never applies late confirmation', () async {
    pause = Completer<void>();
    final pending = receive();
    final rejected = expectLater(pending, throwsStateError);
    while (getSendCount() == 0) { await Future<void>.delayed(Duration.zero); }
    sales.updateStoreId('other'); sales.updateStoreId('characterization');
    pause!.complete(); await rejected;
    pause = null; await sales.recoverCustomerDebtPayment('customer'); expect(getSendCount(), 1);
  });
  test('logout during send preserves receipt for recovery in original session', () async {
    pause = Completer<void>();
    final pending = receive(); final rejected = expectLater(pending, throwsStateError);
    while (getSendCount() == 0) { await Future<void>.delayed(Duration.zero); }
    auth.user = null; auth.events.add(null); await Future<void>.delayed(Duration.zero);
    auth.user = _User(); auth.events.add(auth.user); pause!.complete(); await rejected;
    pause = null; await sales.recoverCustomerDebtPayment('customer'); expect(getSendCount(), 1);
  });
  testWidgets('real debt screen receives partial amounts and explicit next receipt', (tester) async {
    db.docs['$characterizationStore/sales/legacy'] = legacyDebt();
    final cash = CashFlowProvider();
    await tester.pumpWidget(MultiProvider(providers: [
      ChangeNotifierProvider<SalesProvider>.value(value: sales),
      ChangeNotifierProvider<CashFlowProvider>.value(value: cash),
    ], child: const MaterialApp(home: CustomerDebtDetailScreen(
      storeId: 'characterization', customerId: 'customer', customerName: 'Synthetic'))));
    await tester.pumpAndSettle();
    for (var i = 0; i < 2; i++) {
      await tester.runAsync(() async {
        await tester.tap(find.text('Abater Saldo'));
        await Future<void>.delayed(const Duration(milliseconds: 30));
      });
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '30');
      await tester.runAsync(() async {
        await tester.tap(find.text('Confirmar'));
        await Future<void>.delayed(const Duration(milliseconds: 30));
      });
      await tester.pumpAndSettle();
    }
    expect(getSendCount(), 2); expect(outcomes, hasLength(2));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink()); cash.dispose();
  });
  testWidgets('customer account keeps recovery reachable after full settlement and restart', (tester) async {
    afterCommit = true;
    await tester.runAsync(() => expectLater(receive(100), throwsA(isA<TimeoutException>())));
    afterCommit = false;
    await tester.pumpWidget(ChangeNotifierProvider<SalesProvider>.value(value: sales,
      child: const MaterialApp(home: CustomerReceivablesScreen(
        storeId: 'characterization', customerId: 'customer', customerName: 'Synthetic'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Receber / consultar')); await tester.pumpAndSettle();
    expect(find.text('Este cliente não possui dívidas pendentes.'), findsOneWidget);
    await tester.runAsync(() async {
      await tester.tap(find.text('Consultar recebimento'));
      await Future<void>.delayed(const Duration(milliseconds: 30));
    });
    await tester.pumpAndSettle();
    expect(find.text('Recebimento confirmado.'), findsOneWidget);
    expect(getSendCount(), 1);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('real legacy mark paid button sends remaining debt rather than original total', (tester) async {
    db.docs['$characterizationStore/sales/legacy'] = legacyDebt(paid: 30);
    final snapshot = await tester.runAsync(() => FirebaseFirestore.instance
      .collection('stores').doc('characterization').collection('sales').doc('legacy').get());
    final order = SaleOrder.fromFirestore(snapshot!);
    final cash = CashFlowProvider();
    await tester.pumpWidget(MultiProvider(providers: [
      ChangeNotifierProvider<SalesProvider>.value(value: sales),
      ChangeNotifierProvider<CashFlowProvider>.value(value: cash),
    ], child: MaterialApp(home: Scaffold(body: SingleChildScrollView(
      child: OrderItemWidget(order: order, storeId: 'characterization'))))));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(ExpansionTile)); await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Marcar Pago'));
    await tester.runAsync(() async {
      await tester.tap(find.text('Marcar Pago'));
      await Future<void>.delayed(const Duration(milliseconds: 30));
    });
    await tester.pumpAndSettle();
    expect(calls.last['amountCents'], 7000); expect(calls.last['saleId'], 'legacy');
    expect(find.text('Recebimento confirmado.'), findsOneWidget);
    await tester.runAsync(() async {
      await sales.recoverOrderDebtPayment('legacy', customerId: 'customer');
    });
    expect(getSendCount(), 1);
    await tester.pumpWidget(const SizedBox.shrink()); cash.dispose();
  });
  Future<Map<String,dynamic>> createFiado() => sales.addOrder(cartProducts:cart.items.values.toList(),
    total:cart.totalAmount,customer:Customer(id:'customer',name:'Synthetic'),dueDate:DateTime(2032,1,31),
    notes:'credit',installmentCount:3,expectedStoreId:'characterization');
  test('fiado provider freezes a separate installment command and retries the same identity',()async{
    final first=await createFiado(),second=await createFiado();
    expect(first['requestId'],second['requestId']);
    expect(commercialCalls.where((c)=>c['endpoint']=='createDeferredSaleV1'),hasLength(1));
    expect(commercialCalls.last['installmentCount'],3);expect(commercialCalls.last.containsKey('saleKind'),false);
    expect(saleRows(),isEmpty);expect(cashRows(),isEmpty);
  });
  test('fiado unknown blocks legacy fallback; SQLite restart recovers same command and preserves cart',()async{
    afterCommit=true;await expectLater(createFiado(),throwsA(isA<TimeoutException>()));
    final id=commercialCalls.last['requestId'];
    await expectLater(requireNoActiveCommercialCheckout('demo-f9-b07a','characterization',borrowedStore:storage),throwsStateError);
    await storage.close();storage=SqliteSaleMutationStore('${directory.path}/financial-${serial-1}.sqlite');
    commercial=CommercialOperationService(store:storage,call:commercialCall);sales.dispose();
    sales=SalesProvider(commercialOperations:commercial)..updateStoreId('characterization');afterCommit=false;
    expect((await sales.recoverDeferredSale('characterization'))['requestId'],id);
    expect(commercialCalls.where((c)=>c['endpoint']=='createDeferredSaleV1'),hasLength(1));expect(cart.items,isNotEmpty);
    await sales.acknowledgeDeferredSale('characterization');
    await requireNoActiveCommercialCheckout('demo-f9-b07a','characterization',borrowedStore:storage);
  });
  test('invalid fiado plan never persists an identity or reaches transport',()async{
    await expectLater(sales.addOrder(cartProducts:cart.items.values.toList(),total:0.06,
      customer:Customer(id:'customer',name:'Synthetic'),dueDate:DateTime(2032),notes:'',installmentCount:12),throwsArgumentError);
    expect(commercialCalls,isEmpty);expect(await storage.keys('checkout-v1:fiado-create-v1:'),isEmpty);
  });
  test('manual cash provider permits independent equal values only after explicit next operation',()async{
    final cash=CashFlowProvider(operations:commercial);
    Future<Map<String,dynamic>> receiveManual()=>cash.addCashFlowEntry(description:'Ajuste',amount:12.5,type:'Entrada',storeId:'characterization',category:'Operação');
    final first=await receiveManual();expect((await receiveManual())['requestId'],first['requestId']);
    await cash.beginNew('characterization');final next=await receiveManual();expect(next['requestId'],isNot(first['requestId']));
    expect(commercialCalls.where((c)=>c['endpoint']=='createManualCashV1'),hasLength(2));expect(cashRows(),isEmpty);cash.dispose();
  });
  test('manual cash response lost is recovered without another entry and immutable payload survives edits',()async{
    final cash=CashFlowProvider(operations:commercial);afterCommit=true;
    await expectLater(cash.addCashFlowEntry(description:'Ajuste',amount:12.5,type:'Saída',storeId:'characterization'),throwsA(isA<TimeoutException>()));
    afterCommit=false;
    await expectLater(cash.addCashFlowEntry(description:'Outra',amount:13,type:'Entrada',storeId:'characterization'),throwsStateError);
    await expectLater(cash.beginNew('characterization'),throwsStateError);
    expect((await cash.recover('characterization'))['status'],'confirmed');
    expect(commercialCalls.where((c)=>c['endpoint']=='createManualCashV1'),hasLength(1));cash.dispose();
  });
  test('fiado account or store ABA in flight cannot acknowledge or apply a late result',()async{
    pause=Completer<void>();final pending=createFiado();final rejected=expectLater(pending,throwsStateError);
    while(!commercialCalls.any((c)=>c['endpoint']=='createDeferredSaleV1')){await Future<void>.delayed(Duration.zero);}
    sales.updateStoreId('other');sales.updateStoreId('characterization');pause!.complete();await rejected;pause=null;
    expect((await sales.recoverDeferredSale('characterization'))['status'],'confirmed');
    expect(cart.items,isNotEmpty);
  });
  test('another operator cannot adopt an unknown fiado but can create after original acknowledgment',()async{
    final first=await createFiado();auth.user=_User('next-user');
    await expectLater(sales.recoverDeferredSale('characterization'),throwsStateError);
    auth.user=_User();await sales.acknowledgeDeferredSale('characterization');
    auth.user=_User('next-user');final second=await createFiado();
    expect(second['requestId'],isNot(first['requestId']));expect(commercialCalls.last['scope']['uid'],'next-user');
  });
  test('local persistence failure prevents every commercial network call',()async{
    final failing=CommercialOperationService(store:_FailWriteStore(storage),call:commercialCall);
    await expectLater(failing.execute(operation:CommercialOperation.manualCash,
      scope:{'projectId':'demo-f9-b07a','uid':'financial-user','storeId':'characterization'},isCurrent:()=>true,
      intent:{'amountCents':100,'type':'Entrada','category':'Outros','reason':'Synthetic'}),throwsStateError);
    expect(commercialCalls,isEmpty);expect(await storage.keys('manual-cash-v1:'),isEmpty);
  });
  test('commercial payload is detached from caller mutations after durable persistence',()async{
    final draft=<String,dynamic>{'amountCents':100,'type':'Entrada','category':'Outros','reason':'Original'};
    final detached=CommercialOperationService(store:storage,call:(endpoint,command)async{
      if(endpoint.startsWith('get')){draft['reason']='Changed';return {'status':'not-recorded','requestId':command['requestId']};}
      expect(command['reason'],'Original');return {'status':'confirmed','requestId':command['requestId']};
    });
    await detached.execute(operation:CommercialOperation.manualCash,
      scope:{'projectId':'demo-f9-b07a','uid':'financial-user','storeId':'characterization'},isCurrent:()=>true,intent:draft);
  });
  for(final mutateCart in [false,true]) {
  testWidgets('real ConfirmFiadoDialog freezes reviewed cart and sends installment sale once ($mutateCart)',(tester)async{
    await tester.pumpWidget(MultiProvider(providers:[
      ChangeNotifierProvider<SalesProvider>.value(value:sales),ChangeNotifierProvider<CartProvider>.value(value:cart)],
      child:MaterialApp(home:Scaffold(body:Builder(builder:(ctx)=>ElevatedButton(onPressed:()=>showDialog<bool>(
        context:ctx,barrierDismissible:false,builder:(_)=>ConfirmFiadoDialog(storeId:'characterization',
          customer:Customer(id:'customer',name:'Synthetic'),notes:'credit')),child:const Text('Abrir fiado')))))));
    await tester.tap(find.text('Abrir fiado'));await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<int>));await tester.pumpAndSettle();
    await tester.tap(find.text('3 parcelas').last);await tester.pumpAndSettle();
    await tester.tap(find.text('Escolher'));await tester.pumpAndSettle();await tester.tap(find.text('OK'));await tester.pumpAndSettle();
    if(mutateCart)cart.addItem(characterizationProduct());
    await tester.runAsync(()async{
      await tester.tap(find.text('Confirmar Venda'));await tester.tap(find.text('Confirmar Venda'));
      await Future<void>.delayed(const Duration(milliseconds:40));
    });await tester.pumpAndSettle();
    if(mutateCart) {
      expect(commercialCalls,isEmpty);expect(cart.items,isNotEmpty);
    }else{
      expect(commercialCalls.where((c)=>c['endpoint']=='createDeferredSaleV1'),hasLength(1));
      expect(commercialCalls.last['installmentCount'],3);expect(cart.items,isEmpty);
    }
    expect(cashRows(),isEmpty);
    expect(tester.takeException(),isNull);await tester.pumpWidget(const SizedBox.shrink());
  });
  }
  testWidgets('real manual cash screen records entry and equal output as distinct operations',(tester)async{
    final cash=CashFlowProvider(operations:commercial);
    await tester.pumpWidget(ChangeNotifierProvider<CashFlowProvider>.value(value:cash,
      child:const MaterialApp(home:ManualCashScreen(storeId:'characterization'))));await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('cash-amount')),'12,50');
    await tester.enterText(find.byKey(const Key('cash-reason')),'Ajuste');
    await tester.runAsync(()async{
      await tester.tap(find.text('Registrar movimentação'));await tester.tap(find.text('Registrar movimentação'));
      await Future<void>.delayed(const Duration(milliseconds:40));
    });await tester.pumpAndSettle();
    expect(commercialCalls.where((c)=>c['endpoint']=='createManualCashV1'),hasLength(1));
    await tester.runAsync(()async{await tester.tap(find.text('Nova movimentação'));await Future<void>.delayed(const Duration(milliseconds:30));});
    await tester.pumpAndSettle();await tester.enterText(find.byKey(const Key('cash-amount')),'12,50');
    await tester.enterText(find.byKey(const Key('cash-reason')),'Ajuste');
    await tester.tap(find.byType(DropdownButtonFormField<String>));await tester.pumpAndSettle();
    await tester.tap(find.text('Saída').last);await tester.pumpAndSettle();
    await tester.runAsync(()async{await tester.tap(find.text('Registrar movimentação'));await Future<void>.delayed(const Duration(milliseconds:40));});
    await tester.pumpAndSettle();
    expect(commercialCalls.where((c)=>c['endpoint']=='createManualCashV1'),hasLength(2));expect(commercialCalls.last['type'],'Saída');
    expect(cashRows(),isEmpty);expect(tester.takeException(),isNull);
    await tester.pumpWidget(const SizedBox.shrink());cash.dispose();
  });
  testWidgets('empty commercial cart recovers durable fiado and explicitly closes terminal reference',(tester)async{
    afterCommit=true;
    await tester.runAsync(()=>expectLater(createFiado(),throwsA(isA<TimeoutException>())));
    afterCommit=false;cart.clear();
    await tester.pumpWidget(MultiProvider(providers:[
      ChangeNotifierProvider<SalesProvider>.value(value:sales),ChangeNotifierProvider<CartProvider>.value(value:cart)],
      child:const MaterialApp(home:CartScreen(storeId:'characterization'))));await tester.pumpAndSettle();
    await tester.runAsync(()async{await tester.tap(find.byTooltip('Consultar fiado'));await Future<void>.delayed(const Duration(milliseconds:40));});
    await tester.pumpAndSettle();expect(find.text('Resultado do fiado'),findsOneWidget);expect(cart.items,isEmpty);
    await tester.runAsync(()async{await tester.tap(find.text('Encerrar resultado'));await Future<void>.delayed(const Duration(milliseconds:40));});
    await tester.pumpAndSettle();
    expect(commercialCalls.where((c)=>c['endpoint']=='createDeferredSaleV1'),hasLength(1));
    await tester.runAsync(()=>requireNoActiveCommercialCheckout('demo-f9-b07a','characterization',borrowedStore:storage));
    expect(tester.takeException(),isNull);await tester.pumpWidget(const SizedBox.shrink());
  });
}
