import 'dart:async';

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
  var catalogCalls = 0;
  late Future<List<Object?>> Function() loadCatalog;
  List<Object?> fixture() => [
    {
      'success': true,
      'store': {'name': 'Loja teste'},
      'catalog': {'title': 'Catálogo teste'},
      'products': [
        {'productId': 'p1', 'name': 'Produto', 'price': 10.0, 'quantidade': 5},
      ],
    },
  ];

  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });
  setUp(() {
    catalogCalls = 0;
    loadCatalog = () async => fixture();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
          final args = (message as List).single as Map;
          expect(args['functionName'], 'getPublicCatalog');
          catalogCalls++;
          return loadCatalog();
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null);
  });

  Future<void> open(WidgetTester tester, double width) async {
    tester.view.physicalSize = Size(width, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      const MaterialApp(
        home: PublicCatalogScreen(
          publicSlug: 'fixture-slug',
          publicToken: 'fixture-token',
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final width in [320.0, 390.0, 590.0]) {
    testWidgets('mobile $width: dica e fechamento sem seleção', (
      tester,
    ) async {
      await open(tester, width);
      expect(find.descendant(
        of: find.byTooltip('Selecionar produtos'),
        matching: find.byIcon(Icons.check_circle_outline),
      ), findsOneWidget);
      expect(find.text('Selecionar produtos'), findsOneWidget);
      if (width < 590) {
        expect(find.text('Atualizar'), findsNothing);
      } else {
        expect(find.text('Atualizar'), findsOneWidget);
      }
      expect(find.byTooltip('Aumentar quantidade'), findsNothing);
      expect(tester.takeException(), isNull);
      expect(find.byType(BottomSheet), findsNothing);
      for (final text in [
        'Selecionar produtos',
        'Entendi',
      ]) {
        expect(find.text(text), findsOneWidget);
      }
      expect(catalogCalls, 1);
      expect(tester.takeException(), isNull);
      final button = tester.getRect(find.byTooltip('Selecionar produtos'));
      final hint = tester.getRect(find.text('Selecionar produtos'));
      expect(hint.top, greaterThanOrEqualTo(button.bottom));
      expect(hint.top - button.bottom, lessThan(60));
      await tester.tap(find.text('Entendi'));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.byTooltip('Aumentar quantidade'), findsNothing);
      expect(catalogCalls, 1);
      await tester.tap(width == 590
          ? find.text('Atualizar')
          : find.byTooltip('Atualizar catálogo'));
      await tester.pumpAndSettle();
      expect(find.text('Entendi'), findsNothing);
      expect(catalogCalls, 2);
    });
  }

  testWidgets('botão fecha dica e inicia seleção diretamente', (
    tester,
  ) async {
    await open(tester, 390);
    final pending = Completer<List<Object?>>();
    loadCatalog = () => pending.future;
    await tester.tap(find.byTooltip('Selecionar produtos'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('Entendi'), findsNothing);
    expect(catalogCalls, 2);
    expect(find.byTooltip('Aumentar quantidade'), findsNothing);
    pending.complete(fixture());
    await tester.pumpAndSettle();
    expect(find.byTooltip('Aumentar quantidade'), findsOneWidget);
    expect(find.byTooltip('Selecionar produtos'), findsNothing);
    await tester.tap(find.byTooltip('Cancelar seleção'));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('Entendi'), findsNothing);
    expect(find.byTooltip('Aumentar quantidade'), findsNothing);
    expect(catalogCalls, 2);
  });

  testWidgets('dica aguarda carga e reaparece em nova abertura', (tester) async {
    final pending = Completer<List<Object?>>();
    loadCatalog = () => pending.future;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(
      home: PublicCatalogScreen(
        publicSlug: 'fixture-slug', publicToken: 'fixture-token',
      ),
    ));
    await tester.pump();
    expect(find.text('Entendi'), findsNothing);
    pending.complete(fixture());
    await tester.pumpAndSettle();
    expect(find.text('Entendi'), findsOneWidget);
    await tester.tap(find.text('Entendi'));
    await tester.pumpAndSettle();
    await tester.pumpWidget(const SizedBox.shrink());
    loadCatalog = () async => fixture();
    await open(tester, 390);
    expect(find.text('Entendi'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('desktop mantém texto e inicia seleção diretamente', (
    tester,
  ) async {
    await open(tester, 1200);
    expect(find.text('Entendi'), findsNothing);
    expect(find.text('Selecionar produtos'), findsOneWidget);
    expect(find.byIcon(Icons.checklist_rounded), findsNothing);
    await tester.tap(find.text('Selecionar produtos'));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.byTooltip('Aumentar quantidade'), findsOneWidget);
    expect(catalogCalls, 2);
    expect(tester.takeException(), isNull);
  });
}
