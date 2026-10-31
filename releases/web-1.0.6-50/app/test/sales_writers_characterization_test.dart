// CURRENT behavior, including known unsafe legacy outcomes. These expectations
// characterize S01/S02/S06/S07; they are NOT acceptance criteria for V2.
// ignore_for_file: depend_on_referenced_packages
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/widgets/confirm_fiado_dialog.dart';
import 'package:store_connect/widgets/payment_options_sheet.dart';
import 'fixtures/sales_characterization_fixtures.dart';
import 'support/sales_characterization_firestore.dart';

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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late SalesCharacterizationFirestore db;
  late CartProvider cart;
  late SalesProvider sales;
  List<Map<String, dynamic>> saleRows() =>
      db.rows('$characterizationStore/sales');
  List<Map<String, dynamic>> cashRows() =>
      db.rows('$characterizationStore/cash_flow');
  setUpAll(() async {
    TestFirebaseCoreHostApi.setUp(_DemoCore());
    await Firebase.initializeApp();
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
    sales = SalesProvider()..updateStoreId('characterization');
  });
  tearDown(() {
    cart.dispose();
    sales.dispose();
  });

  Future<void> open(WidgetTester tester, {bool fiado = false}) async {
    tester.view.physicalSize = const Size(1200, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: cart,
        child: MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () {
                  showDialog<void>(
                    context: context,
                    builder: (_) => fiado
                        ? ConfirmFiadoDialog(
                            storeId: 'characterization',
                            customer: Customer(
                              id: 'customer',
                              name: 'Nome escolhido',
                            ),
                            notes: 'Nota histórica',
                          )
                        : const Material(
                            child: PaymentOptionsSheet(
                              storeId: 'characterization',
                              notes: 'Nota histórica',
                            ),
                          ),
                  );
                },
                child: const Text('Abrir'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
  }

  Future<void> chooseFiadoPlan(
    WidgetTester tester, {
    int count = 3,
    String date = '01/31/2032',
  }) async {
    await tester.tap(find.byType(DropdownButtonFormField<int>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('$count parcelas').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Escolher'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.edit_outlined));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).last, date);
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'S01 current manual sale uses cart price/name, paid document, no cash or cost snapshot',
    (tester) async {
      await open(tester);
      await tester.tap(find.text('Dinheiro'));
      await tester.pumpAndSettle();
      final sale = saleRows().single;
      expect(sale.keys.toSet(), {
        'totalAmount',
        'products',
        'createdAt',
        'storeId',
        'notes',
        'paymentMethod',
        'isPaid',
        'customerId',
        'customerName',
        'localSaleId',
        'syncOrigin',
      });
      expect(sale['products'], [
        {
          'productId': 'p',
          'name': 'Nome no carrinho',
          'quantity': 1,
          'price': 100.0,
        },
      ]);
      expect(sale['totalAmount'], 100);
      expect(sale['isPaid'], true);
      expect(sale['paymentMethod'], 'Dinheiro');
      expect(sale['syncOrigin'], 'online');
      expect(sale['createdAt'], isA<Timestamp>());
      expect(db.docs['$characterizationStore/products/p']!['quantidade'], 19);
      expect(db.docs['$characterizationStore/products/p']!['unknown'], {
        'preserve': true,
      });
      expect(cashRows(), isEmpty);
      expect(cart.items, isEmpty);
      expect(db.reads.where((p) => p.contains('/sales/')), isEmpty);
    },
  );
  testWidgets(
    'S01 current FIFO preserves surviving metadata and timestamp, consumes earliest lot',
    (tester) async {
      db.docs['$characterizationStore/products/p'] = lotStock();
      await open(tester);
      await tester.tap(find.text('Cartão de débito'));
      await tester.pumpAndSettle();
      final p = db.docs['$characterizationStore/products/p']!;
      expect(p['quantidade'], 4);
      expect(p['lotes'][0], {
        ...(lotStock()['lotes'] as List)[1] as Map,
        'quantidade': 1,
      });
      expect(p['lotes'][1], (lotStock()['lotes'] as List)[0]);
      expect(saleRows().single['paymentMethod'], 'Cartão de débito');
    },
  );
  testWidgets(
    'S01 current insufficient stock creates no sale and leaves cart intact',
    (tester) async {
      db.docs['$characterizationStore/products/p'] = manualStock(quantity: 0);
      await open(tester);
      await tester.tap(find.text('Dinheiro'));
      await tester.pumpAndSettle();
      expect(saleRows(), isEmpty);
      expect(db.commits, isEmpty);
      expect(cart.items, isNotEmpty);
      expect(find.textContaining('Estoque insuficiente'), findsOneWidget);
    },
  );
  testWidgets(
    'S01 CURRENT DEFECT lost response followed by Snackbar retry creates new sale and second debit',
    (tester) async {
      db.failAfterCommit = true;
      await open(tester);
      await tester.tap(find.text('Dinheiro'));
      await tester.pumpAndSettle();
      final first = saleRows().single['localSaleId'];
      expect(cart.items, isNotEmpty);
      // Invoke the actual registered retry callback. The test dialog obscures
      // the Scaffold snackbar; this is not a physical hit-test/UI certification.
      tester.widget<SnackBarAction>(find.byType(SnackBarAction)).onPressed();
      await tester.pumpAndSettle();
      expect(saleRows().length, 2);
      expect(saleRows().last['localSaleId'], isNot(first));
      expect(db.docs['$characterizationStore/products/p']!['quantidade'], 18);
      expect(cashRows(), isEmpty);
    },
  );
  testWidgets(
    'S02 current 100/3 uses last installment residual and civil end-of-month schedule',
    (tester) async {
      await open(tester, fiado: true);
      await chooseFiadoPlan(tester);
      await tester.tap(find.text('Confirmar Venda'));
      await tester.pumpAndSettle();
      final sale = saleRows().single;
      expect(sale.keys.toSet(), {
        'totalAmount',
        'products',
        'createdAt',
        'storeId',
        'notes',
        'paymentMethod',
        'isPaid',
        'dueDate',
        'installmentCount',
        'installments',
        'customerId',
        'customerName',
      });
      expect(sale['paymentMethod'], 'A prazo');
      expect(sale['isPaid'], false);
      expect(sale['customerId'], 'customer');
      expect(sale['installmentCount'], 3);
      final rows = sale['installments'] as List;
      expect(rows.map((r) => r['amount']), [33.33, 33.33, 33.34]);
      expect(rows.map((r) => (r['dueDate'] as Timestamp).toDate()), [
        DateTime(2032, 1, 31),
        DateTime(2032, 2, 29),
        DateTime(2032, 3, 31),
      ]);
      expect(sale['dueDate'], rows.first['dueDate']);
      for (final row in rows) {
        expect(row['paidAmount'], 0);
        expect(row['isPaid'], false);
        expect(row['paidAt'], null);
      }
      expect(cashRows(), isEmpty);
      expect(db.docs['$characterizationStore/products/p']!['quantidade'], 19);
      expect(db.commits.single.length, 2);
    },
  );
  testWidgets(
    'S02 CURRENT DEFECT batch accepts insufficient stock and does not update lots',
    (tester) async {
      final product = lotStock()..['quantidade'] = 0;
      db.docs['$characterizationStore/products/p'] = product;
      await open(tester, fiado: true);
      await chooseFiadoPlan(tester);
      await tester.tap(find.text('Confirmar Venda'));
      await tester.pumpAndSettle();
      expect(saleRows().length, 1);
      expect(db.docs['$characterizationStore/products/p']!['quantidade'], -1);
      expect(
        db.docs['$characterizationStore/products/p']!['lotes'],
        lotStock()['lotes'],
      );
      expect(db.reads.where((p) => p.contains('/products/')), isEmpty);
    },
  );
  testWidgets(
    'S02 CURRENT DEFECT lost batch response retry creates another sale ID and debt',
    (tester) async {
      db.failAfterBatchCommit = true;
      await open(tester, fiado: true);
      await chooseFiadoPlan(tester);
      await tester.tap(find.text('Confirmar Venda'));
      await tester.pumpAndSettle();
      expect(saleRows().length, 1);
      expect(cart.items, isNotEmpty);
      await tester.tap(find.text('Confirmar Venda'));
      await tester.pumpAndSettle();
      expect(saleRows().length, 2);
      expect(db.commits[0].first, isNot(db.commits[1].first));
      expect(db.docs['$characterizationStore/products/p']!['quantidade'], 18);
      expect(cashRows(), isEmpty);
    },
  );
  testWidgets(
    'S02 CURRENT tiny amount rounding can create a negative last installment',
    (tester) async {
      cart.clear();
      cart.addItem(characterizationProduct(price: 0.06));
      await open(tester, fiado: true);
      await chooseFiadoPlan(tester, count: 12);
      await tester.tap(find.text('Confirmar Venda'));
      await tester.pumpAndSettle();
      final installments = saleRows().single['installments'] as List;
      expect(
        installments.take(11).map((r) => r['amount']),
        List.filled(11, 0.01),
      );
      expect(installments.last['amount'], -0.05);
    },
  );
  test(
    'S06 current cascading across sales follows dueDate and creates one cash entry',
    () async {
      db.docs['$characterizationStore/sales/later'] = legacyDebt(total: 20)
        ..['dueDate'] = Timestamp.fromDate(DateTime.utc(2031));
      db.docs['$characterizationStore/sales/earlier'] = legacyDebt(total: 10);
      await sales.receiveCustomerDebtPayment(
        customerId: 'customer',
        customerName: 'Atual',
        amountToPay: 15,
      );
      expect(
        db.docs['$characterizationStore/sales/earlier']!['paidAmount'],
        10,
      );
      expect(db.docs['$characterizationStore/sales/later']!['paidAmount'], 5);
      expect(cashRows().single['amount'], 15);
      expect(db.commits.single.length, 3);
    },
  );
  test(
    'S06 current legacy partial/full receipts preserve history and create one cash entry per invocation',
    () async {
      final original = legacyDebt();
      db.docs['$characterizationStore/sales/legacy'] = original;
      await sales.receiveCustomerDebtPayment(
        customerId: 'customer',
        customerName: 'Atual',
        amountToPay: 30,
      );
      final partial = db.docs['$characterizationStore/sales/legacy']!;
      expect(partial['paidAmount'], 30);
      expect(partial['isPaid'], false);
      for (final key in [
        'products',
        'createdAt',
        'dueDate',
        'fiscal',
        'unknown',
        'customerName',
      ]) {
        expect(partial[key], original[key]);
      }
      expect(cashRows().single['amount'], 30);
      await sales.receiveCustomerDebtPayment(
        customerId: 'customer',
        customerName: 'Atual',
        amountToPay: 70,
      );
      expect(db.docs['$characterizationStore/sales/legacy']!['isPaid'], true);
      expect(
        db.docs['$characterizationStore/sales/legacy']!['paidAmount'],
        100,
      );
      expect(cashRows().map((r) => r['amount']), [30, 70]);
    },
  );
  test(
    'S06 current installment cascading partial/full maintains paidAt and summary',
    () async {
      db.docs['$characterizationStore/sales/plan'] = installmentDebt();
      await sales.receiveCustomerDebtPayment(
        customerId: 'customer',
        customerName: 'Atual',
        amountToPay: 60,
      );
      final p = db.docs['$characterizationStore/sales/plan']!;
      expect(p['installments'][0]['paidAmount'], 50);
      expect(p['installments'][0]['isPaid'], true);
      expect(p['installments'][0]['paidAt'], isA<Timestamp>());
      expect(p['installments'][0]['metadata'], 'keep');
      expect(p['installments'][1]['paidAmount'], 10);
      expect(p['installments'][1]['paidAt'], null);
      expect(p['totalPaidAmount'], 60);
      expect(p['isPaid'], false);
      await sales.receiveCustomerDebtPayment(
        customerId: 'customer',
        customerName: 'Atual',
        amountToPay: 40,
      );
      expect(db.docs['$characterizationStore/sales/plan']!['isPaid'], true);
      expect(
        db.docs['$characterizationStore/sales/plan']!['totalPaidAmount'],
        100,
      );
      expect(cashRows().length, 2);
    },
  );
  test('S06 current overpayment aborts sale and cash updates', () async {
    final original = legacyDebt();
    db.docs['$characterizationStore/sales/legacy'] = original;
    await expectLater(
      sales.receiveCustomerDebtPayment(
        customerId: 'customer',
        customerName: 'Atual',
        amountToPay: 101,
      ),
      throwsException,
    );
    expect(db.docs['$characterizationStore/sales/legacy'], original);
    expect(cashRows(), isEmpty);
  });
  test(
    'S06 CURRENT DEFECT repeating same payment debits again because no payment identity',
    () async {
      db.docs['$characterizationStore/sales/legacy'] = legacyDebt();
      for (var i = 0; i < 2; i++) {
        await sales.receiveCustomerDebtPayment(
          customerId: 'customer',
          customerName: 'Atual',
          amountToPay: 30,
        );
      }
      expect(db.docs['$characterizationStore/sales/legacy']!['paidAmount'], 60);
      expect(cashRows().length, 2);
    },
  );
  test(
    'S07 CURRENT DEFECT cash failure leaves paid sale; repeated invocation can duplicate cash',
    () async {
      db.docs['$characterizationStore/sales/legacy'] = legacyDebt();
      final cash = CashFlowProvider();
      db.failCash = true;
      await expectLater(
        sales.markOrderAsPaid('legacy', 100, cash),
        throwsStateError,
      );
      expect(db.docs['$characterizationStore/sales/legacy']!['isPaid'], true);
      expect(db.docs['$characterizationStore/sales/legacy']!['paidAmount'], 0);
      expect(cashRows(), isEmpty);
      db.failCash = false;
      await sales.markOrderAsPaid('legacy', 100, cash);
      await sales.markOrderAsPaid('legacy', 100, cash);
      expect(cashRows().length, 2);
      expect(cashRows().map((r) => r['amount']), [100, 100]);
      cash.dispose();
    },
  );
}
