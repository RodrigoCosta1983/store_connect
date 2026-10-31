import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_variants_form_draft.dart';
import 'package:store_connect/widgets/product_variants_form.dart';

void main() {
  Future<void> tap(WidgetTester tester, Finder finder) async {
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    await Scrollable.ensureVisible(tester.element(finder), alignment: 0.5);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  for (final size in [const Size(390, 844), const Size(1440, 900)]) {
    testWidgets('draft add/edit/duplicate/error/toggle at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final d = ProductVariantsFormDraft();
      addTearDown(d.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: MediaQuery(
                data: MediaQueryData(
                  size: size,
                  textScaler: const TextScaler.linear(1.5),
                ),
                child: ProductVariantsForm(draft: d, parentCod: () => 'BASE'),
              ),
            ),
          ),
        ),
      );
      await tap(tester, find.byKey(const ValueKey('product-variants-toggle')));
      await tester.enterText(
        find.byKey(const ValueKey('attribute-label')),
        'Cor',
      );
      await tester.enterText(
        find.byKey(const ValueKey('attribute-options')),
        'Azul, Verde',
      );
      await tap(tester, find.text('Adicionar atributo'));
      await tester.enterText(
        find.byKey(const ValueKey('variant-form-name')),
        'Camiseta azul',
      );
      await tester.enterText(
        find.byKey(const ValueKey('variant-form-cod')),
        'AZ',
      );
      await tap(tester, find.text('Adicionar variante ao rascunho'));
      expect(
        find.text('Selecione todos os atributos explicitamente.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('variant-form-name')))
            .controller!
            .text,
        'Camiseta azul',
      );
      await tap(tester, find.byType(DropdownButtonFormField<String>));
      await tap(tester, find.text('Azul').last);
      await tap(tester, find.text('Adicionar variante ao rascunho'));
      expect(d.entries.length, 1);
      await tap(tester, find.text('Editar rascunho'));
      await tester.enterText(
        find.byKey(const ValueKey('variant-form-name')),
        'Nome alterado',
      );
      await tap(tester, find.text('Aplicar alteração no rascunho'));
      expect(d.entries.single.fields['name'], 'Nome alterado');
      await tap(tester, find.byType(DropdownButtonFormField<String>));
      await tap(tester, find.text('Azul').last);
      await tap(tester, find.text('Adicionar variante ao rascunho'));
      expect(find.text('Essa combinação já está no rascunho.'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('variant-form-cod')),
        'AINDA DIGITANDO',
      );
      await tap(tester, find.byKey(const ValueKey('product-variants-toggle')));
      await tap(tester, find.byKey(const ValueKey('product-variants-toggle')));
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('variant-form-cod')))
            .controller!
            .text,
        'AINDA DIGITANDO',
      );
      expect(d.entries.length, 1);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('persisted variants displayed without claiming edit or save', (
    tester,
  ) async {
    final d = ProductVariantsFormDraft(
      existingProduct: true,
      existingVariantParent: true,
      definitions: [
        {
          'attributeId': 'color',
          'label': 'Cor',
          'values': [
            {'valueId': 'blue', 'label': 'Azul'},
          ],
        },
      ],
      existingVariants: [
        {
          'variantId': 'v',
          'name': 'Variante gravada',
          'cod': 'V1',
          'attributes': [
            {'attributeId': 'color', 'valueId': 'blue'},
          ],
          'quantidade': 3,
          'isArchived': true,
        },
      ],
    );
    addTearDown(d.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ProductVariantsForm(draft: d, parentCod: () => ''),
          ),
        ),
      ),
    );
    expect(find.text('Variante gravada'), findsOneWidget);
    expect(find.textContaining('Estoque individual: 3'), findsOneWidget);
    expect(find.textContaining('Arquivada'), findsOneWidget);
    expect(find.text('Editar rascunho'), findsNothing);
    expect(d.blocksLegacySave, true);
  });
}
