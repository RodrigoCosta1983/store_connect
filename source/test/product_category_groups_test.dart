import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/widgets/product_category_groups.dart';

const options = [
  ProductCategoryOption('skin', 'Cuidados com a Pele'),
  ProductCategoryOption('body', 'Cuidados Corporais', parentId: 'skin'),
  ProductCategoryOption('solar', 'Protetor Solar', parentId: 'skin'),
  ProductCategoryOption('hygiene', 'Higiene Pessoal'),
  ProductCategoryOption('hair', 'Cabelos', parentId: 'hygiene'),
];

Widget harness(
  List<String> selected, {
  void Function(String, bool)? onChanged,
}) {
  return MaterialApp(
    home: Scaffold(
      body: StatefulBuilder(
        builder: (context, setState) {
          return SingleChildScrollView(
            child: ProductCategoryGroups(
              options: options,
              selectedIds: selected,
              onChanged:
                  onChanged ??
                  (id, value) => setState(() {
                    if (value) {
                      selected.add(id);
                    } else {
                      selected.remove(id);
                    }
                  }),
            ),
          );
        },
      ),
    ),
  );
}

void main() {
  testWidgets('mobile label fits one line with bounded font reduction', (
    tester,
  ) async {
    // Widget tests use Ahem, whose wide glyphs need more room than Roboto.
    tester.view.physicalSize = const Size(400, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(harness([]));
    final label = find.text('Cuidados com a Pele');
    final text = tester.widget<Text>(label);
    expect(text.style!.fontSize, inInclusiveRange(14, 15));
    final paragraph = tester.renderObject<RenderParagraph>(label);
    expect(
      paragraph
          .getBoxesForSelection(
            const TextSelection(baseOffset: 0, extentOffset: 18),
          )
          .map((box) => box.top)
          .toSet(),
      hasLength(1),
    );
    await tester.tap(find.byTooltip('Expandir subcategorias').first);
    await tester.pump();
    expect(
      tester.widget<Text>(find.text('Cuidados Corporais')).style!.fontSize,
      inInclusiveRange(14, 15),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('long labels wrap and accessibility scaling is preserved', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final scale in [1.0, 2.0]) {
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: const Size(320, 640),
              textScaler: TextScaler.linear(scale),
            ),
            child: Scaffold(
              body: SingleChildScrollView(
                child: ProductCategoryGroups(
                  options: const [
                    ProductCategoryOption(
                      'long',
                      'Cuidados especiais com a pele e proteção diária',
                    ),
                  ],
                  selectedIds: const [],
                  onChanged: (_, _) {},
                ),
              ),
            ),
          ),
        ),
      );
      final label = find.text(
        'Cuidados especiais com a pele e proteção diária',
      );
      final text = tester.widget<Text>(label);
      final paragraph = tester.renderObject<RenderParagraph>(label);
      expect(
        paragraph
            .getBoxesForSelection(
              TextSelection(baseOffset: 0, extentOffset: text.data!.length),
            )
            .map((box) => box.top)
            .toSet()
            .length,
        greaterThan(1),
      );
      expect(paragraph.didExceedMaxLines, isFalse);
      if (scale > 1) expect(text.style!.fontSize, 15);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('small dialog scrolls long labels and keeps footer accessible', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 480);
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
                builder: (context) => AlertDialog(
                  title: const Text('Adicionar Produto'),
                  content: SizedBox(
                    width: 520,
                    child: SingleChildScrollView(
                      child: ProductCategoryGroups(
                        options: List.generate(
                          20,
                          (i) => ProductCategoryOption(
                            '$i',
                            'Categoria com nome completo e bastante longo número $i',
                          ),
                        ),
                        selectedIds: const [],
                        onChanged: (_, _) {},
                      ),
                    ),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancelar'),
                    ),
                    TextButton(onPressed: () {}, child: const Text('Salvar')),
                  ],
                ),
              ),
              child: const Text('Abrir'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(tester.getBottomLeft(find.text('Salvar')).dy, lessThan(480));
    await tester.drag(
      find.byType(SingleChildScrollView),
      const Offset(0, -500),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(find.text('Adicionar Produto'), findsNothing);
  });
  testWidgets(
    'mobile groups one column, expands and preserves independent selection',
    (tester) async {
      tester.view.physicalSize = const Size(360, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final selected = <String>[];
      await tester.pumpWidget(harness(selected));
      expect(find.text('Cuidados Corporais'), findsNothing);
      await tester.tap(find.byTooltip('Expandir subcategorias').first);
      await tester.pump();
      await tester.tap(find.text('Cuidados Corporais'));
      await tester.pump();
      expect(selected, ['body']);
      expect(find.textContaining('Subcategoria de'), findsNothing);
      expect(
        tester.getTopLeft(find.text('Higiene Pessoal')).dy,
        greaterThan(tester.getTopLeft(find.text('Protetor Solar')).dy),
      );
      await tester.tap(find.text('Cuidados com a Pele'));
      await tester.pump();
      expect(selected, ['body', 'skin']);
      await tester.tap(find.text('Cuidados com a Pele'));
      await tester.pump();
      expect(selected, ['body']);
      expect(find.text('Cuidados Corporais'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'selected child opens group, desktop retains two groups side by side',
    (tester) async {
      tester.view.physicalSize = const Size(1100, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(harness(['body', 'hair']));
      expect(find.text('Cuidados Corporais'), findsOneWidget);
      expect(find.text('Cabelos'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('Cuidados com a Pele')).dy,
        tester.getTopLeft(find.text('Higiene Pessoal')).dy,
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('limit 10 blocks addition but allows removal', (tester) async {
    final selected = ['body', ...List.generate(9, (i) => 'existing-$i')];
    await tester.pumpWidget(harness(selected));
    await tester.tap(find.text('Protetor Solar'));
    await tester.pump();
    expect(selected.length, 10);
    expect(selected.contains('solar'), isFalse);
    await tester.tap(find.text('Cuidados Corporais'));
    await tester.pump();
    expect(selected.length, 9);
  });
  testWidgets('unselected group can expand and collapse', (tester) async {
    await tester.pumpWidget(harness([]));
    await tester.tap(find.byTooltip('Expandir subcategorias').first);
    await tester.pump();
    expect(find.text('Protetor Solar'), findsOneWidget);
    await tester.tap(find.byTooltip('Recolher subcategorias'));
    await tester.pump();
    expect(find.text('Protetor Solar'), findsNothing);
  });
}
