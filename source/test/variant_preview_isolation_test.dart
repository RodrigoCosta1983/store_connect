import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'preview import graph has no Firebase, transport, storage or old writer adapter',
    () {
      final visited = <String>{};
      void inspect(Uri uri) {
        if (!visited.add(uri.toFilePath())) return;
        final source = File.fromUri(uri).readAsStringSync();
        for (final match in RegExp(r"import\s+'([^']+)';").allMatches(source)) {
          final target = match.group(1)!;
          if (target.startsWith('dart:')) {
            expect({
              'dart:convert',
              'dart:math',
              'dart:async',
            }, contains(target));
          } else if (target.startsWith('package:')) {
            expect(
              target.startsWith('package:flutter/') ||
                  target == 'package:crypto/crypto.dart',
              isTrue,
              reason: 'Forbidden preview dependency: $target',
            );
          } else {
            inspect(uri.resolve(target));
          }
        }
      }

      inspect(File('lib/previews/variant_preview_main.dart').absolute.uri);
      expect(
        visited.any((p) => p.endsWith('product_stock_lots_editor.dart')),
        true,
      );
      expect(
        visited.any((p) => p.endsWith('product_mutation_api.dart')),
        false,
      );
      expect(
        File('lib/main.dart').readAsStringSync(),
        isNot(contains('variant_preview')),
      );
      expect(
        File(
          'lib/screens/management/manage_products_screen.dart',
        ).readAsStringSync(),
        isNot(contains('variant_preview')),
      );
    },
  );
}
