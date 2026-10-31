import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'package:store_connect/widgets/product_cadastral_edit_dialog.dart';
import 'package:store_connect/widgets/product_category_groups.dart';
import 'support/product_cadastral_harness.dart';

void main() {
  late CadastralHarness h;
  setUp(() {
    h = CadastralHarness();
  });
  tearDown(() async {
    await h.close();
  });
  Future<void> mount(
    WidgetTester tester, {
    bool business = false,
    String project = 'demo-b04',
  }) async {
    tester.view.physicalSize = const Size(1200, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final access = h.access(projectId: project);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showDialog<void>(
                context: context,
                barrierDismissible: false,
                builder: (_) => ProductCadastralEditDialog(
                  access: access,
                  productId: 'p',
                  storeId: 's',
                  isBusiness: business,
                  categories: Stream.value(const [
                    ProductCategoryOption('c1', 'Categoria 1'),
                    ProductCategoryOption('c2', 'Categoria 2'),
                  ]),
                ),
              ),
              child: const Text('Abrir editor'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir editor'));
    await tester.pumpAndSettle();
  }

  Finder field(String name) => find.byKey(ValueKey('cadastral-$name'));
  Future<void> enter(WidgetTester tester, String name, String value) async {
    await tester.ensureVisible(field(name));
    await tester.enterText(field(name), value);
    await tester.pump();
  }

  Future<void> tap(WidgetTester tester, String text) async {
    final finder = find.text(text);
    await tester.ensureVisible(finder);
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  testWidgets(
    'name only builds a partial command and never shows stock editing',
    (tester) async {
      await mount(tester);
      expect(find.text('Quantidade Manual'), findsNothing);
      expect(find.text('Gerenciar Lotes'), findsNothing);
      await enter(tester, 'name', 'Novo nome');
      await tap(tester, 'Salvar cadastro');
      expect(h.remote.commands.single['changes']['set'], {'name': 'Novo nome'});
      expect(find.textContaining('Operação confirmada.'), findsOneWidget);
      expect(h.product['fiscal']['internalTax'], 'keep');
      expect(h.product['quantidade'], 5);
      expect(find.text('Salvar cadastro'), findsNothing);
    },
  );
  testWidgets(
    'COD and category selection are submitted atomically through one V2 command',
    (tester) async {
      await mount(tester);
      await enter(tester, 'cod', 'Novo');
      await tester.ensureVisible(find.text('Categoria 2'));
      await tester.tap(find.text('Categoria 2'));
      await tester.pump();
      await tap(tester, 'Salvar cadastro');
      expect(h.remote.commands.single['changes']['set'], {'cod': 'NOVO'});
      expect(h.remote.commands.single['changes']['categories']['ids'], [
        'c1',
        'c2',
      ]);
      expect(h.remote.writes, 1);
    },
  );
  testWidgets('empty patch displays no changes and sends nothing', (
    tester,
  ) async {
    await mount(tester);
    await tap(tester, 'Salvar cadastro');
    expect(find.textContaining('Nenhuma alteração cadastral'), findsOneWidget);
    expect(h.remote.commands, isEmpty);
    expect(h.store.values, isEmpty);
  });
  testWidgets(
    'unknown locks draft, survives closing, queries B02 and retries original command',
    (tester) async {
      await mount(tester);
      await enter(tester, 'price', '15');
      h.remote.unknown = true;
      await tap(tester, 'Salvar cadastro');
      final original = h.remote.commands.single;
      expect(
        find.textContaining('Resultado ainda desconhecido.'),
        findsOneWidget,
      );
      expect(tester.widget<TextField>(field('price')).enabled, false);
      expect(find.text('Salvar cadastro'), findsNothing);
      await tap(tester, 'Fechar');
      await tap(tester, 'Abrir editor');
      expect(
        find.textContaining('Uma tentativa anterior foi retomada'),
        findsOneWidget,
      );
      expect(h.reads, 1);
      expect(h.remote.commands.length, 1);
      h.remote.unknown = false;
      await tap(tester, 'Repetir mesma tentativa');
      expect(h.remote.commands.last, original);
      expect(h.remote.writes, 1);
      expect(find.textContaining('Operação confirmada.'), findsOneWidget);
    },
  );
  testWidgets(
    'timeout after commit shows checking until definitive B02 confirmation',
    (tester) async {
      await mount(tester);
      await enter(tester, 'name', 'Nome');
      h.remote.loseResponse = true;
      h.remote.recovery = Completer<Map<String, dynamic>>();
      await tester.tap(find.text('Salvar cadastro'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(find.textContaining('Consultando o resultado'), findsOneWidget);
      expect(find.textContaining('Operação confirmada.'), findsNothing);
      expect(h.remote.writes, 1);
      h.remote.recovery!.complete({});
      await tester.pumpAndSettle();
      expect(find.textContaining('Operação confirmada.'), findsOneWidget);
      expect(h.remote.commands.length, 1);
    },
  );
  testWidgets(
    'version conflict requires explicit review and never reapplies old changes',
    (tester) async {
      await mount(tester);
      await enter(tester, 'name', 'Stale');
      h.product['quantidade'] = 4;
      h.revision++;
      await tap(tester, 'Salvar cadastro');
      expect(find.textContaining('Conflito de versão:'), findsOneWidget);
      expect(find.text('Repetir mesma tentativa'), findsNothing);
      expect(h.product['name'], 'Original');
      await tap(tester, 'Revisar dados atuais');
      expect(h.reads, 1);
      await tap(tester, 'Carregar para revisão');
      expect(h.reads, 2);
      expect(
        tester.widget<TextField>(field('name')).controller!.text,
        'Original',
      );
      await tap(tester, 'Salvar cadastro');
      expect(h.remote.commands.length, 1);
      expect(h.product['quantidade'], 4);
    },
  );
  testWidgets(
    'definitive rejection differs from version conflict and unknown',
    (tester) async {
      await mount(tester);
      await enter(tester, 'cod', 'DUP');
      h.remote.rejectReason = 'duplicate-product-cod';
      await tap(tester, 'Salvar cadastro');
      expect(find.textContaining('rejeitada definitivamente'), findsOneWidget);
      expect(find.textContaining('Conflito de versão:'), findsNothing);
      expect(find.text('Repetir mesma tentativa'), findsNothing);
      expect(h.remote.writes, 0);
    },
  );
  testWidgets(
    'persistence failure is distinct and never falls back to another writer',
    (tester) async {
      await mount(tester);
      await enter(tester, 'name', 'Nome');
      h.store.fail = true;
      await tap(tester, 'Salvar cadastro');
      expect(
        find.textContaining('Falha no armazenamento local'),
        findsOneWidget,
      );
      expect(h.remote.commands, isEmpty);
      expect(find.text('Salvar cadastro'), findsNothing);
      h.store.fail = false;
      await tap(tester, 'Consultar tentativa');
      await tap(tester, 'Repetir mesma tentativa');
      expect(h.remote.writes, 1);
    },
  );
  testWidgets('account switch immediately hides form and blocks send', (
    tester,
  ) async {
    await mount(tester);
    await enter(tester, 'name', 'Secret draft');
    h.move(
      const ProductMutationScope(
        projectId: 'demo-b04',
        uid: 'other',
        storeId: 's',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Edição suspensa:'), findsOneWidget);
    expect(field('name'), findsNothing);
    expect(find.text('Salvar cadastro'), findsNothing);
    expect(h.remote.commands, isEmpty);
  });
  testWidgets(
    'remote HML access remains disabled even with explicit injected enabled access',
    (tester) async {
      await mount(tester, project: 'store-connect-hml');
      expect(find.textContaining('desabilitada'), findsOneWidget);
      expect(h.reads, 0);
      expect(find.text('Salvar cadastro'), findsNothing);
      expect(h.remote.commands, isEmpty);
    },
  );
  testWidgets(
    'fiscal null action changes just one leaf and preserves internal fields',
    (tester) async {
      await mount(tester, business: true);
      final action = find.byKey(const ValueKey('actions-fiscal.ncm'));
      await tester.ensureVisible(action);
      await tester.tap(action);
      await tester.pumpAndSettle();
      await tap(tester, 'Definir null');
      await tap(tester, 'Salvar cadastro');
      expect(h.remote.commands.single['changes']['fiscal'], {
        'set': {'ncm': null},
        'remove': [],
      });
      expect(h.product['fiscal']['internalTax'], 'keep');
    },
  );
}
