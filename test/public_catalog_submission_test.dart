import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
// Helper oficial do Firebase ja presente nas dependencias transitivas.
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
  final calls = <Map<String, dynamic>>[];
  late Future<List<Object?>> Function(Map<String, dynamic>) submit;
  late Future<List<Object?>> Function() getCatalog;

  Map<String, dynamic> catalog({int stock = 5}) => {
    'success': true,
    'store': {'name': 'Loja teste'},
    'catalog': {'title': 'Catalogo teste'},
    'products': [
      {
        'productId': 'p1', 'name': 'Produto Um', 'price': 10.0,
        'quantidade': stock,
      },
      {
        'productId': 'p2', 'name': 'Produto Dois', 'price': 20.0,
        'quantidade': 8,
      },
    ],
  };
  List<Object?> success() => [
    {
      'success': true, 'requestId': 'request-test',
      'validatedItemCount': 1, 'totalUnits': 2, 'totalAmount': 20.0,
    },
  ];
  List<Object?> failure(String code, [Map<String, dynamic>? details]) => [
    code, 'RAW_TECHNICAL_ERROR',
    {'code': code, 'message': 'RAW_TECHNICAL_ERROR', 'additionalData': details},
  ];

  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });
  setUp(() {
    calls.clear();
    getCatalog = () async => [catalog()];
    submit = (_) async => success();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
      final args = Map<String, dynamic>.from((message as List).single as Map);
      calls.add(args);
      if (args['functionName'] == 'getPublicCatalog') {
        return getCatalog();
      }
      expect(args['functionName'], 'submitPublicCatalogSelection');
      return submit(Map<String, dynamic>.from(args['parameters'] as Map));
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null);
  });

  Future<void> openSummary(WidgetTester tester, {bool mobile = false}) async {
    tester.view.physicalSize = mobile ? const Size(390, 844) : const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(
      home: PublicCatalogScreen(publicSlug: 'loja-teste', publicToken: 'fixture-token'),
    ));
    await tester.pumpAndSettle();
    final start = find.text('Selecionar produtos');
    await tester.tap(start.evaluate().isNotEmpty
        ? start : find.byTooltip('Selecionar produtos'));
    await tester.pumpAndSettle();
    final increase = find.byTooltip('Aumentar quantidade').first;
    await tester.ensureVisible(increase);
    await tester.tap(increase);
    await tester.pump();
    await tester.tap(find.byTooltip('Aumentar quantidade').first);
    await tester.pump();
    final review = find.text('Revisar sele\u00e7\u00e3o (1)');
    await tester.ensureVisible(review);
    await tester.tap(review);
    await tester.pumpAndSettle();
    expect(find.text('Resumo da sele\u00e7\u00e3o'), findsOneWidget);
    expect(find.text('2 \u00d7 R\$ 10,00'), findsOneWidget);
  }

  Iterable<Map<String, dynamic>> submits() =>
      calls.where((call) => call['functionName'] == 'submitPublicCatalogSelection');

  for (final mobile in [false, true]) {
    testWidgets('payload, clique duplo e sucesso; mobile=$mobile', (tester) async {
      final pending = Completer<List<Object?>>();
      submit = (_) => pending.future;
      await openSummary(tester, mobile: mobile);
      final send = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Enviar'),
      ).onPressed!;
      send();
      send();
      await tester.pump();
      expect(submits().length, 1);
      expect(submits().single['parameters'], {
        'publicSlug': 'loja-teste',
        'publicToken': 'fixture-token',
        'items': [{'productId': 'p1', 'quantity': 2}],
      });
      expect(tester.widget<TextButton>(
        find.widgetWithText(TextButton, 'Voltar'),
      ).onPressed, isNull);
      expect(find.text('Enviando...'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(find.text('Resumo da sele\u00e7\u00e3o'), findsOneWidget);
      final callCount = calls.length;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(calls.length, callCount);
      pending.complete(success());
      await tester.pumpAndSettle();
      expect(find.text('Solicita\u00e7\u00e3o enviada \u00e0 loja com sucesso.'), findsOneWidget);
      expect(find.text('Resumo da sele\u00e7\u00e3o'), findsNothing);
      expect(find.text('Revisar sele\u00e7\u00e3o (1)'), findsNothing);
      expect(find.text('Dispon\u00edvel: 5'), findsOneWidget);
      expect(submits().length, 1);
    });
  }

  for (final code in ['unavailable', 'deadline-exceeded', 'internal']) {
    testWidgets('erro $code preserva selecao e permite retry', (tester) async {
      submit = (_) async => failure(code);
      await openSummary(tester);
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Sua sele\u00e7\u00e3o foi mantida'), findsOneWidget);
      expect(find.text('RAW_TECHNICAL_ERROR'), findsNothing);
      expect(find.text('2 \u00d7 R\$ 10,00'), findsOneWidget);
      expect(tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Enviar'),
      ).onPressed, isNotNull);
      submit = (_) async => success();
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect(submits().length, 2);
      expect(submits().first['parameters'], submits().last['parameters']);
      expect(find.text('Solicita\u00e7\u00e3o enviada \u00e0 loja com sucesso.'), findsOneWidget);
    });
  }

  testWidgets('resposta sem confirmacao preserva selecao', (tester) async {
    submit = (_) async => [{'success': true}];
    await openSummary(tester);
    await tester.tap(find.text('Enviar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sua sele\u00e7\u00e3o foi mantida'), findsOneWidget);
    expect(find.text('2 \u00d7 R\$ 10,00'), findsOneWidget);
    expect(find.text('Enviar'), findsOneWidget);
  });

  for (final refreshFails in [false, true]) {
    testWidgets('estoque reconciliado; refresh falha=$refreshFails', (tester) async {
      await openSummary(tester);
      getCatalog = () async => refreshFails ? failure('unavailable') : [catalog(stock: 1)];
      submit = (_) async => failure('failed-precondition', {
        'reason': 'insufficient-stock', 'productId': 'p1', 'availableQuantity': 1,
      });
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect(find.text('Resumo da sele\u00e7\u00e3o'), findsNothing);
      expect(find.textContaining('Revise a sele\u00e7\u00e3o antes'), findsOneWidget);
      expect(find.text('Dispon\u00edvel: 1'), findsOneWidget);
      await tester.tap(find.text('Revisar sele\u00e7\u00e3o (1)'));
      await tester.pumpAndSettle();
      expect(find.text('1 \u00d7 R\$ 10,00'), findsOneWidget);
      submit = (_) async => success();
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect((submits().last['parameters'] as Map)['items'],
          [{'productId': 'p1', 'quantity': 1}]);
    });
  }

  for (final reason in [
    'product-not-in-catalog', 'product-unavailable',
    'product-archived', 'invalid-product-data',
  ]) {
    testWidgets('$reason remove item inelegivel sem depender do refresh', (tester) async {
      await openSummary(tester);
      getCatalog = () async => failure('unavailable');
      submit = (_) async => failure('failed-precondition', {
        'reason': reason, 'productId': 'p1',
      });
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect(find.text('Revisar sele\u00e7\u00e3o (1)'), findsNothing);
      expect(find.text('Produto Um'), findsNothing);
      expect(find.textContaining('Revise a sele\u00e7\u00e3o antes'), findsOneWidget);
    });
  }

  for (final code in ['failed-precondition', 'not-found']) {
    testWidgets('catalogo indisponivel usa estado existente: $code', (tester) async {
      await openSummary(tester);
      submit = (_) async => failure(code);
      getCatalog = () async => failure(code);
      await tester.tap(find.text('Enviar'));
      await tester.pumpAndSettle();
      expect(find.text('Resumo da sele\u00e7\u00e3o'), findsNothing);
      expect(find.text('Tentar novamente'), findsOneWidget);
      expect(find.text('Produto Um'), findsNothing);
      expect(find.text('RAW_TECHNICAL_ERROR'), findsNothing);
    });
  }

  testWidgets('dispose durante envio nao atualiza widget desmontado', (tester) async {
    final pending = Completer<List<Object?>>();
    submit = (_) => pending.future;
    await openSummary(tester);
    await tester.tap(find.text('Enviar'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    pending.complete(success());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
