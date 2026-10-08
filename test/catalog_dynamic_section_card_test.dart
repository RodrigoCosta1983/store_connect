import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/management/widgets/catalog_dynamic_section_card.dart';

void main() {
  Future<void> mount(WidgetTester tester, {
    bool enabled = false,
    bool error = false,
    List<String> labels = const [],
    ValueChanged<bool>? onToggle,
    VoidCallback? onSelect,
  }) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: SingleChildScrollView(child: CatalogDynamicSectionCard(
        title: 'Sugestões para você',
        description: 'Mostre outros produtos que podem interessar ao cliente.',
        enabled: enabled,
        categoryLabels: labels,
        showError: error,
        onEnabledChanged: onToggle ?? (_) {},
        onSelectCategories: onSelect ?? () {},
      )),
    )));
  }

  testWidgets('disabled section hides selector and does not require categories', (tester) async {
    await mount(tester, error: true);
    expect(find.text('Selecionar categorias'), findsNothing);
    expect(find.text('Selecione pelo menos uma categoria para esta seção.'), findsNothing);
    expect(tester.widget<Switch>(find.byType(Switch)).value, isFalse);
  });
  testWidgets('toggle activates section and selector', (tester) async {
    var enabled = false;
    await mount(tester, onToggle: (value) => enabled = value);
    await tester.tap(find.byType(Switch));
    expect(enabled, isTrue);
    await mount(tester, enabled: enabled);
    expect(find.text('Selecionar categorias'), findsOneWidget);
  });
  testWidgets('selected categories display hierarchy and category count', (tester) async {
    await mount(tester, enabled: true, labels: ['Cuidados com a Pele', 'Cuidados com a Pele └ Hidratantes']);
    expect(find.text('2 categorias selecionadas'), findsOneWidget);
    expect(find.text('Cuidados com a Pele └ Hidratantes'), findsOneWidget);
  });
  testWidgets('enabled section displays validation beside selector', (tester) async {
    await mount(tester, enabled: true, error: true);
    expect(find.text('Selecione pelo menos uma categoria para esta seção.'), findsOneWidget);
  });
  testWidgets('selector invokes selection action', (tester) async {
    var selected = false;
    await mount(tester, enabled: true, onSelect: () => selected = true);
    await tester.tap(find.text('Selecionar categorias'));
    expect(selected, isTrue);
  });
  for (final size in [const Size(320, 640), const Size(768, 1024), const Size(1440, 900)]) {
    testWidgets('card fits ${size.width} viewport', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await mount(tester, enabled: true, error: true, labels: [
        'Cuidados com a Pele └ Hidratantes e produtos para cuidados diários',
        'Higiene Pessoal └ Higiene Bucal',
      ]);
      expect(tester.takeException(), isNull);
    });
  }
}
