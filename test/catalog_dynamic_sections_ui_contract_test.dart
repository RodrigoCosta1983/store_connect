import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  const sourcePath =
      'lib/screens/management/manage_products_screen.dart';

  final source = File(sourcePath).readAsStringSync();
  test('create and edit include dynamicSections in their callable payloads', () {
    expect(source, contains("'createCatalog'"));
    expect(source, contains("'updateCatalog'"));
    expect(RegExp("'dynamicSections': dynamicSections").allMatches(source).length, 2);
  });
  test('new catalog defaults all three sections to disabled', () {
    expect(source, contains("'enabled': false"));
    expect(source, contains('for (final sectionId in _catalogDynamicSectionIds)'));
    expect(source, contains("'categoryIds': <String>[]"));
  });
  test('selector uses document IDs and exact multiple selection', () {
    expect(source, contains("'id': root.id"));
    expect(source, contains("'id': candidate.id"));
    expect(source, contains('selectedCategoryIds.add('));
    expect(source, contains('selectedCategoryIds.remove('));
    expect(source, contains('final orderedSelectedIds = selectedCategoryIds'));
    expect(source, isNot(contains('.where(validCategoryIds.contains)')));
  });
  test('hierarchy uses stored parent and never expands selected parent', () {
    expect(source, contains("candidateData['parentCategoryId'] != root.id"));
    expect(source, contains("'Subcategoria de \$parentName'"));
    expect(source, contains('left: isSubcategory ? 24 : 0'));
  });
  test('save rejects enabled section with empty categories', () {
    expect(source, contains("rawSection['enabled'] != true"));
    expect(source, contains('if (categoryIds.isEmpty)'));
    expect(source, contains('if (invalidSectionTitle != null)'));
    expect(source, contains('enabled && categoryIds.isEmpty'));
  });
  test('edit loads persisted sections and changes only addressed section', () {
    final edit = File('lib/screens/management/catalogs_screen.dart').readAsStringSync();
    expect(edit, contains("editCatalog['dynamicSections']"));
    expect(edit, contains('initialCatalogDynamicSections:'));
    expect(source, contains('widget.initialCatalogDynamicSections'));
    expect(source, contains('draftDynamicSections[sectionId] ='));
    expect(source, contains('_catalogDynamicSectionsPayload()'));
  });

  test(
    'catalog dynamic sections UI contract remains wired',
    () {
      final source =
          File(sourcePath).readAsStringSync();

      expect(
        source,
        contains(
          'Future<List<String>?> '
          '_showDynamicCatalogCategorySelector(',
        ),
      );

      expect(
        source,
        contains("'suggestions': 'Sugestões para você'"),
      );

      expect(
        source,
        contains("'offers': 'Ofertas'"),
      );

      expect(
        source,
        contains(
          "'completeOrder': 'Complete seu pedido'",
        ),
      );

      expect(
        source,
        contains("'Seções inteligentes'"),
      );

      expect(
        source,
        contains("return CatalogDynamicSectionCard("),
      );

      expect(
        source,
        contains(
          '_normalizeCatalogDynamicSections('
          '\n                        draftDynamicSections,',
        ),
      );

      expect(
        source,
        contains(
          "config['dynamicSections']",
        ),
      );

      expect(
        source,
        contains(
          "'dynamicSections': dynamicSections",
        ),
      );

      final categoryCollectionCalls =
          RegExp(
            r"\.collection\('categories'\)",
          ).allMatches(source).length;

      expect(
        categoryCollectionCalls,
        greaterThanOrEqualTo(3),
      );

      expect(
        source,
        isNot(
          contains(
            'final dynamicSections =\n'
            '        _catalogDynamicSectionsPayload();',
          ),
        ),
      );
    },
  );
}
