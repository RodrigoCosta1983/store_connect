import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/management/widgets/catalog_preview_button.dart';
import 'package:store_connect/screens/public/public_catalog_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );
  final calls = <Map>[];
  const ids = ['suggestions', 'offers', 'completeOrder'];
  Map<String, dynamic> product(String id) => {
    'productId': id, 'name': id == 'main' ? 'Principal' : 'Produto $id',
    'price': 15.99, 'quantidade': 5,
  };
  Map<String, dynamic> preview() => {
    'success': true,
    'store': {'name': 'Loja'},
    'catalog': {'title': 'Título preservado'},
    'products': [product('main')],
    'dynamicSections': [for (final id in ids)
      {'id': id, 'products': [product(id)]}],
  };
  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
      final args = (message as List).single as Map;
      calls.add(args);
      return [args['functionName'] == 'previewCatalog' ? preview() : {'success': true}];
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null);
  });

  Future<void> open(WidgetTester tester, {bool edit = false,
      double width = 1200, bool valid = true}) async {
    tester.view.physicalSize = Size(width, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final controller = TextEditingController(text: 'Título preservado');
    addTearDown(controller.dispose);
    final sections = {for (final id in ids)
      id: {'enabled': true, 'categoryIds': [id]}};
    Map<String, dynamic> draft() => {
      'title': controller.text, 'productIds': ['main'],
      'expiresInDays': 14, 'dynamicSections': sections,
    };
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: Builder(
      builder: (context) => TextButton(
        onPressed: () => showDialog<void>(context: context, builder: (context) {
          bool loading = false;
          return StatefulBuilder(builder: (context, setDialogState) => AlertDialog(
            scrollable: true,
            content: TextField(controller: controller),
            actions: [
              CatalogPreviewButton(isEditing: edit,
                draft: () => valid ? draft() : null,
                onLoadingChanged: (value) => setDialogState(() => loading = value)),
              FilledButton(onPressed: loading ? null : () async {
                await FirebaseFunctions.instance.httpsCallable(
                  edit ? 'updateCatalog' : 'createCatalog',
                ).call(draft());
              }, child: Text(edit ? 'Salvar alterações' : 'Criar catálogo')),
            ],
          ));
        }),
        child: const Text('Configurar'),
      ),
    ))));
    await tester.tap(find.text('Configurar'));
    await tester.pumpAndSettle();
  }
  Future<void> showPreview(WidgetTester tester, {bool edit = false}) async {
    await tester.tap(find.text(edit ? 'Visualizar alterações' : 'Visualizar catálogo'));
    await tester.pumpAndSettle();
  }

  for (final edit in [false, true]) {
    testWidgets('${edit ? 'EDIT' : 'CREATE'} button and only preview callable', (tester) async {
      await open(tester, edit: edit);
      expect(find.text(edit ? 'Visualizar alterações' : 'Visualizar catálogo'), findsOneWidget);
      await showPreview(tester, edit: edit);
      expect(calls.map((call) => call['functionName']), ['previewCatalog']);
      expect(find.byType(PublicCatalogScreen), findsOneWidget);
    });
    testWidgets('${edit ? 'EDIT' : 'CREATE'} back preserves draft and normal save works', (tester) async {
      await open(tester, edit: edit);
      await tester.enterText(find.byType(TextField), 'Editado antes da prévia');
      await showPreview(tester, edit: edit);
      final before = calls.single['parameters'];
      await tester.tap(find.text('Voltar e editar'));
      await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'Editado antes da prévia');
      await tester.tap(find.text(edit ? 'Salvar alterações' : 'Criar catálogo'));
      await tester.pumpAndSettle();
      expect(calls.map((call) => call['functionName']),
          ['previewCatalog', edit ? 'updateCatalog' : 'createCatalog']);
      expect(calls.last['parameters'], before);
    });
  }
  testWidgets('required UI validation prevents preview call', (tester) async {
    await open(tester, valid: false);
    await showPreview(tester);
    expect(calls, isEmpty);
    expect(find.byType(PublicCatalogScreen), findsNothing);
  });
  testWidgets('main products, three sections, exact cards and prices', (tester) async {
    await open(tester);
    await showPreview(tester);
    expect(find.text('Principal'), findsOneWidget);
    for (final title in ['Sugestões para você', 'Ofertas', 'Complete seu pedido']) {
      expect(find.text(title), findsOneWidget);
    }
    for (final id in ids) {
      expect(find.text('Produto $id'), findsOneWidget);
    }
    expect(find.textContaining('15,99'), findsNWidgets(4));
  });
  testWidgets('preview warnings and return action', (tester) async {
    await open(tester);
    await showPreview(tester);
    expect(find.text('Modo de pré-visualização'), findsOneWidget);
    expect(find.text('Este catálogo ainda não foi publicado.'), findsOneWidget);
    expect(find.text('Voltar e editar'), findsOneWidget);
    expect(find.text('Selecionar produtos'), findsNothing);
    expect(find.byTooltip('Atualizar catálogo'), findsNothing);
  });
  for (final width in [390.0, 768.0, 1200.0]) {
    testWidgets('preview responsive without overflow at $width', (tester) async {
      await open(tester, width: width);
      await showPreview(tester);
      tester.view.physicalSize = Size(width, 700);
      await tester.pumpAndSettle();
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -1800));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(calls.length, 1);
    });
  }
  testWidgets('preview lifecycle cannot request public catalog', (tester) async {
    await open(tester);
    await showPreview(tester);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(calls.map((call) => call['functionName']), ['previewCatalog']);
  });
  testWidgets('backend error keeps form and permits retry', (tester) async {
    await open(tester);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (_) async => [
      'invalid-argument', 'Invalid categories', null,
    ]);
    await showPreview(tester);
    expect(find.byType(PublicCatalogScreen), findsNothing);
    expect(find.text('Visualizar catálogo'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,
        'Título preservado');
    expect(tester.takeException(), isNull);
  });
  test('administrative form wires shared validation and retains normal create/update', () {
    final source = File('lib/screens/management/manage_products_screen.dart').readAsStringSync();
    expect(source, contains('CatalogPreviewButton('));
    expect(source, contains('isEditing: _isEditingCatalog'));
    expect(source, contains('if (!validateDraft()) return null;'));
    expect(source, contains('if (!validateDraft()) return;'));
    expect(source, contains('return _createCatalog('));
    expect(source, contains('final result = await _updateCatalog('));
  });
}
