import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_variants_form_draft.dart';
import 'package:store_connect/services/variant_preview_state.dart';

ProductVariantsFormDraft draft() => ProductVariantsFormDraft()
  ..setEnabled(true)
  ..addAttribute('Cor', 'Azul, Verde');
Map<String, String> selection(ProductVariantsFormDraft d, [int index = 0]) => {
  d.definitions.first['attributeId'] as String:
      (d.definitions.first['values'] as List)[index]['valueId'] as String,
};
void main() {
  test('partial structural markers cannot fall through to a simple writer', () {
    for (final marker in ['productId', 'variantId', 'attributes', 'attributeDefinitions']) {
      for (final value in [null, '', false, 0, <Object>[], <String, Object>{}]) {
        for (final base in [<String, dynamic>{}, <String, dynamic>{'productKind': 'simple', 'variantSchemaVersion': 1}]) {
          expect(hasVariantProductMetadata({...base, marker: value}), true, reason: marker);
        }
      }
    }
    expect(hasVariantProductMetadata({'name': 'Legacy', 'quantidade': 2}), false);
    expect(hasVariantProductMetadata({'productKind': 'simple', 'variantSchemaVersion': 1}), false);
  });
  test('simple remains optional; mode switch preserves local entries', () {
    final d = ProductVariantsFormDraft();
    expect(d.blocksLegacySave, false);
    d.setEnabled(true);
    d.addAttribute('Modelo', 'Adulto, Infantil');
    d.apply(selection(d), '', '');
    d.setEnabled(false);
    expect(d.blocksLegacySave, false);
    expect(d.entries.single.fields.containsKey('cod'), false);
    d.setEnabled(true);
    expect(d.entries.length, 1);
    expect(d.blocksLegacySave, true);
  });
  test(
    'explicit complete combinations; editing preserves key and validates duplicates',
    () {
      final d = draft();
      expect(() => d.apply({}, '', ''), throwsFormatException);
      d.apply(selection(d), 'Azul', ' A ');
      final key = d.entries.single.key;
      expect(() => d.apply(selection(d), '', ''), throwsFormatException);
      d.apply(selection(d, 1), 'Verde', 'B');
      expect(
        () => d.apply(selection(d, 1), 'Troca', 'C', editingKey: key),
        throwsFormatException,
      );
      d.apply(selection(d), 'Alterada', 'C', editingKey: key);
      expect(d.entries.first.key, key);
      expect(d.entries.first.fields['name'], 'Alterada');
      expect(d.entries.first.fields.containsKey('quantidade'), false);
    },
  );
  test(
    'COD canonical conflicts, base conflict and invalid name use existing rules',
    () {
      final d = draft();
      d.apply(selection(d), '', ' abc ');
      expect(() => d.apply(selection(d, 1), '', 'ABC'), throwsFormatException);
      expect(
        () => d.apply(selection(d, 1), '', 'BASE', parentCod: ' base '),
        throwsFormatException,
      );
      expect(() => d.apply(selection(d, 1), '   ', ''), throwsFormatException);
      expect(
        () => d.apply(selection(d, 1), '', 'x' * 41),
        throwsFormatException,
      );
      expect(d.entries.length, 1);
      VariantPreviewIntent.validateCreationFields(d.entries.single.fields);
    },
  );
  test(
    'legacy conversion and persisted cadastral edits remain unavailable',
    () {
      final legacy = ProductVariantsFormDraft(existingProduct: true);
      expect(() => legacy.setEnabled(true), throwsStateError);
      expect(legacy.blocksLegacySave, false);
      final parent = ProductVariantsFormDraft(
        existingProduct: true,
        existingVariantParent: true,
      );
      expect(parent.blocksLegacySave, true);
      expect(parent.dataError, isNotNull);
      expect(() => parent.apply({}, '', ''), throwsStateError);
      expect(hasVariantProductMetadata({}), false);
      expect(
        hasVariantProductMetadata({
          'productKind': 'simple',
          'variantSchemaVersion': 1,
        }),
        false,
      );
      expect(hasVariantProductMetadata({'productKind': 'variantParent'}), true);
      expect(hasVariantProductMetadata({'variantSchemaVersion': null}), true);
    },
  );
  test(
    'definitions and entries cannot mutate; failed edits leave input state intact',
    () {
      final d = draft();
      d.apply(selection(d), 'Original', 'COD');
      expect(() => d.addAttribute('Tamanho', 'P'), throwsStateError);
      expect(
        () => d.entries.first.fields['name'] = 'forged',
        throwsUnsupportedError,
      );
      expect(
        () => d.definitions.first['label'] = 'forged',
        throwsUnsupportedError,
      );
      d.remove(d.entries.first.key);
      d.addAttribute('Tamanho', 'P, M');
      expect(d.definitions.length, 2);
      expect(() => d.apply(selection(d), '', ''), throwsFormatException);
    },
  );
}
