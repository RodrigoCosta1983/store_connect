// Official Firebase channel fakes only; no network or real persistence.
// ignore_for_file: depend_on_referenced_packages
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/management/manage_products_screen.dart';
import 'support/sales_characterization_firestore.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );
  late SalesCharacterizationFirestore firestore;
  final calls = <Map<String, dynamic>>[];
  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
    firestore = SalesCharacterizationFirestore();
    FirebaseFirestorePlatform.instance = firestore;
  });
  setUp(() {
    firestore.docs.clear();
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
          calls.add(Map<String, dynamic>.from((message as List).single as Map));
          return [
            {'success': true, 'productId': 'created-in-test'},
          ];
        });
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null),
  );
  Finder field(String label) => find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label,
  );
  Future<void> open(
    WidgetTester tester, {
    DocumentSnapshot? product,
    Size size = const Size(1200, 1800),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => ProductRegistrationDialog(
                  storeId: 'fixture',
                  isBusiness: false,
                  product: product,
                ),
              ),
              child: const Text('Abrir cadastro'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir cadastro'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'real registration keeps simple payload and save path without variants',
    (tester) async {
      await open(tester);
      await tester.enterText(field('Nome do Produto'), 'Simples');
      await tester.ensureVisible(field('Preço'));
      await tester.enterText(field('Preço'), '10');
      await tester.ensureVisible(field('Quantidade Manual'));
      await tester.enterText(field('Quantidade Manual'), '2');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Salvar'));
      await tester.pumpAndSettle();
      expect(calls.single['functionName'], 'createProduct');
      final product = (calls.single['parameters'] as Map)['product'] as Map;
      expect(product['name'], 'Simples');
      expect(product['quantidade'], 2);
      expect(product.containsKey('productKind'), false);
      expect(product.containsKey('variants'), false);
    },
  );
  testWidgets(
    'registered form toggle blocks old writer and preserves ordinary typed fields',
    (tester) async {
      await open(tester);
      await tester.enterText(field('Nome do Produto'), 'Nome preservado');
      final toggle = find.byKey(const ValueKey('product-variants-toggle'));
      await tester.ensureVisible(toggle);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Salvar'),
            )
            .onPressed,
        isNull,
      );
      expect(field('Quantidade Manual'), findsNothing);
      expect(find.text('Adicionar atributo'), findsOneWidget);
      expect(calls, isEmpty);
      await tester.ensureVisible(toggle);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(
        tester.widget<TextField>(field('Nome do Produto')).controller!.text,
        'Nome preservado',
      );
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Salvar'),
            )
            .onPressed,
        isNotNull,
      );
    },
  );
  testWidgets(
    'actual registration dialog also fits mobile with a local error',
    (tester) async {
      await open(tester, size: const Size(390, 844));
      await tester.enterText(field('Nome do Produto'), 'Preservado no celular');
      tester.testTextInput.hide();
      final toggle = find.byKey(const ValueKey('product-variants-toggle'));
      await Scrollable.ensureVisible(tester.element(toggle), alignment: 0.5);
      await tester.pumpAndSettle();
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      final add = find.text('Adicionar variante ao rascunho');
      await Scrollable.ensureVisible(tester.element(add), alignment: 0.5);
      await tester.pumpAndSettle();
      await tester.tap(add);
      await tester.pumpAndSettle();
      expect(
        find.text('Selecione todos os atributos explicitamente.'),
        findsOneWidget,
      );
      expect(
        tester.widget<TextField>(field('Nome do Produto')).controller!.text,
        'Preservado no celular',
      );
      expect(calls, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'existing parent cannot fall through to legacy save or implicit conversion',
    (tester) async {
      firestore.docs['stores/fixture/products/p'] = {
        'name': 'Pai',
        'productKind': 'variantParent',
        'variantSchemaVersion': 1,
        'attributeDefinitions': [
          {
            'attributeId': 'color',
            'label': 'Cor',
            'values': [
              {'valueId': 'blue', 'label': 'Azul'},
            ],
          },
        ],
      };
      final product = await FirebaseFirestore.instance
          .doc('stores/fixture/products/p')
          .get();
      await open(tester, product: product);
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const ValueKey('product-variants-toggle')),
            )
            .onChanged,
        isNull,
      );
      expect(
        tester
            .widget<ElevatedButton>(
              find.widgetWithText(ElevatedButton, 'Salvar'),
            )
            .onPressed,
        isNull,
      );
      expect(
        find.textContaining('Não foi possível confirmar o cadastro F10'),
        findsOneWidget,
      );
      expect(calls, isEmpty);
    },
  );
  for (final markers in <Map<String, dynamic>>[
    {'attributeDefinitions': []},
    {'attributeDefinitions': null},
    {'attributes': null},
    {'productId': 'parent'},
    {'variantId': null},
    {'productKind': 'simple', 'variantSchemaVersion': 1, 'attributes': []},
  ]) {
    testWidgets('partial stored structure blocks real dialog legacy save: $markers', (tester) async {
      firestore.docs['stores/fixture/products/p'] = {'name': 'Preservado', ...markers};
      final product = await FirebaseFirestore.instance.doc('stores/fixture/products/p').get();
      await open(tester, product: product);
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Salvar')).onPressed, isNull);
      expect(tester.widget<SwitchListTile>(find.byKey(const ValueKey('product-variants-toggle'))).onChanged, isNull);
      expect(tester.widget<TextField>(field('Nome do Produto')).controller!.text, 'Preservado');
      expect(calls, isEmpty);
      expect(tester.takeException(), isNull);
    });
  }
}
