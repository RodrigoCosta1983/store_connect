import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/management/widgets/catalog_configuration_dialog.dart';
import 'package:store_connect/screens/management/widgets/catalog_dynamic_section_card.dart';
import 'package:store_connect/screens/management/widgets/catalog_preview_button.dart';

void main() {
  Future<void> mount(WidgetTester tester, double width,
      {bool original = false}) async {
    tester.view.physicalSize = Size(width, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final content = SizedBox(
      width: 460,
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        const TextField(decoration: InputDecoration(labelText: 'Título')),
        const SizedBox(height: 16),
        const Text('Validade do catálogo'),
        const SizedBox(height: 20),
        const Text('Seções inteligentes'),
        for (final title in ['Sugestões para você', 'Ofertas', 'Complete seu pedido']) ...[
          CatalogDynamicSectionCard(
            title: title,
            description: 'Escolha categorias para preencher esta seção.',
            enabled: true,
            categoryLabels: const ['Cuidados com a Pele └ Hidratantes'],
            onEnabledChanged: (_) {},
            onSelectCategories: () {},
          ),
          const SizedBox(height: 12),
        ],
        const Text('1 produto selecionado'),
      ]),
    );
    final actions = <Widget>[
      CatalogPreviewButton(isEditing: false, draft: () => null,
          onLoadingChanged: (_) {}),
      TextButton(onPressed: () {}, child: const Text('Cancelar')),
      FilledButton.icon(onPressed: () {}, icon: const Icon(Icons.menu_book_outlined),
          label: const Text('Criar catálogo')),
    ];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: original
        ? AlertDialog(scrollable: true, title: const Text('Configurar catálogo'),
            content: content, actions: actions)
        : CatalogConfigurationDialog(title: const Text('Configurar catálogo'),
            content: content, actions: actions))));
    await tester.pumpAndSettle();
  }

  for (final width in [320.0, 390.0]) {
    testWidgets('mobile $width fits, keeps actions accessible and scrolls to end', (tester) async {
      await mount(tester, width);
      expect(tester.takeException(), isNull);
      final buttons = [for (final label in
          ['Visualizar catálogo', 'Cancelar', 'Criar catálogo'])
        find.ancestor(of: find.text(label),
            matching: find.byWidgetPredicate((widget) => widget is ButtonStyleButton))];
      final rects = buttons.map(tester.getRect).toList();
      for (var index = 0; index < buttons.length; index++) {
        expect(buttons[index].hitTestable(), findsOneWidget);
        expect(rects[index].height, greaterThanOrEqualTo(48));
        expect(rects[index].left, greaterThanOrEqualTo(0));
        expect(rects[index].right, lessThanOrEqualTo(width));
        expect(rects[index].bottom, lessThanOrEqualTo(640));
        if (index > 0) {
          expect(rects[index].top - rects[index - 1].bottom, closeTo(4, 0.01));
          expect(rects[index].width, rects.first.width);
        }
      }
      expect(rects.last.bottom - rects.first.top, closeTo(152, 0.01));
      await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -2400));
      await tester.pumpAndSettle();
      final lastSelector = find.text('Selecionar categorias').last;
      expect(lastSelector.hitTestable(), findsOneWidget);
      expect(find.text('1 produto selecionado').hitTestable(), findsOneWidget);
      expect(tester.getRect(lastSelector).bottom, lessThan(rects.first.top));
      expect(rects.first.top - tester.getRect(find.text('1 produto selecionado')).bottom,
          greaterThanOrEqualTo(24));
      await tester.tap(lastSelector);
      for (final label in ['Visualizar catálogo', 'Cancelar', 'Criar catálogo']) {
        await tester.tap(find.text(label));
      }
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('desktop retains original dialog geometry', (tester) async {
    await mount(tester, 1200, original: true);
    final before = [find.byType(AlertDialog), find.byType(SingleChildScrollView),
      find.text('Visualizar catálogo'), find.text('Cancelar'), find.text('Criar catálogo')]
        .map(tester.getRect).toList();
    await mount(tester, 1200);
    final after = [find.byType(AlertDialog), find.byType(SingleChildScrollView),
      find.text('Visualizar catálogo'), find.text('Cancelar'), find.text('Criar catálogo')]
        .map(tester.getRect).toList();
    expect(after, before);
    expect(tester.takeException(), isNull);
  });

  test('administrative modal uses the tested layout', () {
    final source = File('lib/screens/management/manage_products_screen.dart').readAsStringSync();
    expect(source, contains('return CatalogConfigurationDialog('));
  });
}
