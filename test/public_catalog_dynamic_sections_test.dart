import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/public/public_catalog_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );
  const titles = ['Sugestões para você', 'Ofertas', 'Complete seu pedido'];
  const ids = ['suggestions', 'offers', 'completeOrder'];
  Map<String, dynamic> product(String id, String name) => {
    'productId': id, 'name': name, 'price': 10.0, 'quantidade': 5,
  };
  late List<Map<String, dynamic>> sections;
  final submissions = <Map>[];
  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });
  setUp(() {
    sections = [];
    submissions.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
      final args = (message as List).single as Map;
      if (args['functionName'] == 'getPublicCatalog') {
        return [{
          'success': true,
          'store': {'name': 'Loja'},
          'catalog': {'title': 'Catálogo'},
          'products': [product('main', 'Principal')],
          'dynamicSections': sections,
        }];
      }
      expect(args['functionName'], 'submitPublicCatalogSelection');
      final payload = args['parameters'] as Map;
      submissions.add(payload);
      final items = payload['items'] as List;
      final units = items.fold<int>(
        0, (total, item) => total + (item['quantity'] as int),
      );
      return [{
        'success': true, 'requestId': 'request-test',
        'validatedItemCount': items.length,
        'totalUnits': units, 'totalAmount': units * 10.0,
      }];
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null);
  });
  Future<void> open(WidgetTester tester, double width) async {
    tester.view.physicalSize = Size(width, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: PublicCatalogScreen(
      publicSlug: 'fixture-slug', publicToken: 'fixture-token',
    )));
    await tester.pumpAndSettle();
  }

  testWidgets('sem seções mantém apenas os produtos principais', (tester) async {
    await open(tester, 1200);
    expect(find.text('Principal'), findsOneWidget);
    for (final title in titles) {
      expect(find.text(title), findsNothing);
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('uma seção preenchida e duas vazias', (tester) async {
    sections = [
      {'id': ids[0], 'products': [product('dynamic', 'Dinâmico')]},
      {'id': ids[1], 'products': []},
      {'id': ids[2], 'products': []},
    ];
    await open(tester, 1200);
    expect(find.text(titles[0]), findsOneWidget);
    expect(find.text('Dinâmico'), findsOneWidget);
    expect(find.text(titles[1]), findsNothing);
    expect(find.text(titles[2]), findsNothing);
  });

  testWidgets('três seções seguem ordem fixa mesmo com payload invertido', (tester) async {
    sections = [for (var i = 2; i >= 0; i--)
      {'id': ids[i], 'products': [product('p$i', 'Produto $i')]},
    ];
    await open(tester, 1200);
    var previous = tester.getTopLeft(find.text('Principal')).dy;
    for (var i = 0; i < 3; i++) {
      final top = tester.getTopLeft(find.text(titles[i])).dy;
      expect(top, greaterThan(previous));
      expect(find.text('Produto $i'), findsOneWidget);
      previous = top;
    }
  });

  for (final width in [390.0, 1200.0]) {
    for (var emptyIndex = 0; emptyIndex < ids.length; emptyIndex++) {
      testWidgets('seção ${ids[emptyIndex]} vazia não reserva espaço em $width',
          (tester) async {
        sections = [
          for (var i = 0; i < ids.length; i++)
            {'id': ids[i], 'products': i == emptyIndex
                ? [] : [product('p$i', 'Produto $i')]},
        ];
        await open(tester, width);
        tester.view.physicalSize = Size(width, 600);
        await tester.pumpAndSettle();
        final scroll = find.byType(CustomScrollView);
        final scrollable = find.descendant(
          of: scroll, matching: find.byType(Scrollable),
        );
        final position = tester.state<ScrollableState>(scrollable).position;
        position.jumpTo(position.maxScrollExtent);
        await tester.pumpAndSettle();
        final emptyExtent = position.maxScrollExtent;
        expect(emptyExtent, greaterThan(0));
        final emptySlivers = tester.widget<CustomScrollView>(scroll).slivers
            .map((widget) => widget.runtimeType).toList();
        // Compare the entire mounted subtree: an extra placeholder, container
        // or spacer must change this structure even if it has zero height.
        final emptyStructure = find.descendant(of: scroll,
            matching: find.byWidgetPredicate((_) => true)).evaluate()
            .map((element) => element.widget.runtimeType).toList();
        final anchor = find.text('Produto ${(emptyIndex + 2) % 3}');
        final emptyRect = tester.getRect(anchor);
        expect(find.text(titles[emptyIndex]), findsNothing);
        expect(find.text('Nenhum produto disponível neste catálogo.'), findsNothing);
        expect(tester.takeException(), isNull);

        sections.removeAt(emptyIndex);
        await tester.pumpWidget(const SizedBox.shrink());
        await open(tester, width);
        tester.view.physicalSize = Size(width, 600);
        await tester.pumpAndSettle();
        final omittedPosition = tester.state<ScrollableState>(scrollable).position;
        omittedPosition.jumpTo(omittedPosition.maxScrollExtent);
        await tester.pumpAndSettle();
        expect(find.text(titles[emptyIndex]), findsNothing);
        expect(find.text('Nenhum produto disponível neste catálogo.'), findsNothing);
        expect(tester.widget<CustomScrollView>(scroll).slivers
            .map((widget) => widget.runtimeType).toList(), emptySlivers);
        expect(find.descendant(of: scroll,
            matching: find.byWidgetPredicate((_) => true)).evaluate()
            .map((element) => element.widget.runtimeType).toList(), emptyStructure);
        expect(omittedPosition.maxScrollExtent, closeTo(emptyExtent, 0.5));
        final omittedRect = tester.getRect(anchor);
        expect(omittedRect.top, closeTo(emptyRect.top, 0.5));
        expect(omittedRect.height, closeTo(emptyRect.height, 0.5));
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('pedido misto consolida duplicado e faz um único submit', (tester) async {
    sections = [
      {'id': ids[0], 'products': [product('dynamic', 'Dinâmico')]},
      {'id': ids[1], 'products': [product('dynamic', 'Dinâmico')]},
      {'id': ids[2], 'products': [product('other', 'Complemento')]},
    ];
    await open(tester, 1200);
    await tester.tap(find.text('Selecionar produtos'));
    await tester.pumpAndSettle();
    final increase = find.byTooltip('Aumentar quantidade');
    // Main, Suggestions, duplicated Offers product, then Complete your order.
    for (final index in [0, 1, 2, 3, 3]) {
      await tester.ensureVisible(increase.at(index));
      await tester.tap(increase.at(index));
      await tester.pumpAndSettle();
    }
    expect(submissions, isEmpty);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, 1600));
    await tester.pumpAndSettle();
    final review = find.text('Revisar seleção (3)');
    await tester.ensureVisible(review);
    await tester.tap(review);
    await tester.pumpAndSettle();
    final summary = find.byType(AlertDialog);
    expect(find.descendant(of: summary,
        matching: find.text('3 produto(s) • 5 unidade(s)')), findsOneWidget);
    expect(find.descendant(of: summary, matching: find.text('Dinâmico')),
        findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('customer-name')), 'Maria Silva');
    await tester.enterText(find.byKey(const ValueKey('customer-phone')), '(21) 98505-0120');
    await tester.tap(find.text('Enviar'));
    await tester.pumpAndSettle();
    expect(submissions, hasLength(1));
    expect(submissions.single['items'], unorderedEquals([
      {'productId': 'main', 'quantity': 1},
      {'productId': 'dynamic', 'quantity': 2},
      {'productId': 'other', 'quantity': 2},
    ]));
    expect(tester.takeException(), isNull);
  });

  for (final width in [320.0, 390.0, 590.0, 1200.0]) {
    testWidgets('seleção compartilhada, resumo e envio único em $width', (tester) async {
      sections = [
        {'id': ids[0], 'products': [product('dynamic', 'Dinâmico')]},
        {'id': ids[1], 'products': [product('dynamic', 'Dinâmico')]},
        {'id': ids[2], 'products': [product('other', 'Complemento')]},
      ];
      await open(tester, width);
      if (width < 600) {
        expect(find.text('Selecionar produtos'), findsOneWidget);
        expect(find.text('Entendi'), findsOneWidget);
        await tester.tap(find.text('Entendi'));
        await tester.pumpAndSettle();
        expect(find.text('Entendi'), findsNothing);
        expect(find.text('Selecionar produtos'), findsNothing);
        await tester.tap(find.byTooltip('Selecionar produtos'));
      } else {
        await tester.tap(find.text('Selecionar produtos'));
      }
      await tester.pumpAndSettle();
      if (width < 600) {
        expect(find.text('Entendi'), findsNothing);
        expect(find.text('Selecionar produtos'), findsNothing);
      }
      final increase = find.byTooltip('Aumentar quantidade');
      await tester.ensureVisible(increase.at(1));
      await tester.tap(increase.at(1));
      await tester.pumpAndSettle();
      // Both visual occurrences read the same productId quantity.
      expect(find.text('1'), findsNWidgets(2));
      await tester.ensureVisible(increase.at(2));
      await tester.tap(increase.at(2));
      await tester.pumpAndSettle();
      expect(find.text('2'), findsNWidgets(2));
      final decrease = find.byTooltip('Diminuir quantidade');
      await tester.ensureVisible(decrease.at(1));
      await tester.tap(decrease.at(1));
      await tester.pumpAndSettle();
      expect(find.text('1'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
      if (width >= 600) {
        await tester.drag(find.byType(CustomScrollView), const Offset(0, 1600));
        await tester.pumpAndSettle();
      }
      final review = find.text('Revisar seleção (1)');
      await tester.ensureVisible(review);
      await tester.tap(review);
      await tester.pumpAndSettle();
      expect(find.text('Resumo da seleção'), findsOneWidget);
      final summary = find.byType(AlertDialog);
      expect(find.descendant(of: summary, matching: find.text('Dinâmico')),
          findsOneWidget);
      expect(find.descendant(of: summary,
          matching: find.text('1 × R\$ 10,00')), findsOneWidget);
      expect(find.descendant(of: summary,
          matching: find.text('1 produto(s) • 1 unidade(s)')), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('customer-name')), 'Maria Silva');
      await tester.enterText(find.byKey(const ValueKey('customer-phone')), '(21) 98505-0120');
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect(submissions, hasLength(1));
      expect(submissions.single['items'], [
        {'productId': 'dynamic', 'quantity': 1},
      ]);
      expect(tester.takeException(), isNull);
    });
  }
}
