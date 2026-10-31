import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/widgets/product_stock_edit_dialog.dart';
import 'package:store_connect/widgets/product_stock_lots_editor.dart';
import 'support/product_cadastral_harness.dart';

void main() {
  testWidgets(
    'new lot dates reject implicit normalization and submillisecond loss',
    (tester) async {
      final key = GlobalKey<ProductStockLotsEditorState>();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductStockLotsEditor(
              key: key,
              lots: const [],
              conversion: true,
              enabled: true,
            ),
          ),
        ),
      );
      await tester.tap(find.text('Adicionar lote'));
      await tester.pump();
      await tester.enterText(find.byKey(const ValueKey('new-0-quantity')), '2');
      for (final date in [
        '2027-02-31T00:00:00.000Z',
        '2027-02-28T00:00:00.000001Z',
        '2027-02-28T00:00:00.000',
      ]) {
        await tester.enterText(find.byKey(const ValueKey('new-0-date')), date);
        expect(() => key.currentState!.command(), throwsFormatException);
      }
      await tester.enterText(
        find.byKey(const ValueKey('new-0-date')),
        '2027-02-28T00:00:00.000Z',
      );
      expect(key.currentState!.command(), [
        {
          'quantidade': 2,
          'validadeMs': DateTime.utc(2027, 2, 28).millisecondsSinceEpoch,
        },
      ]);
    },
  );
  testWidgets(
    'mobile review requires confirmation, unknown locks and safe retry reuses payload',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final h = CadastralHarness();
      h.remote.unknown = true;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductStockEditDialog(
              access: h.access(),
              productId: 'p',
              storeId: 's',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Quantidade atual: 5'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextField, 'Quantidade solicitada'),
        '2',
      );
      await tester.enterText(
        find.widgetWithText(TextField, 'Motivo obrigatório'),
        'Reposição',
      );
      await tester.tap(find.text('Revisar ajuste'));
      await tester.pumpAndSettle();
      expect(h.remote.commands, isEmpty);
      expect(find.textContaining('Solicitado: 7'), findsOneWidget);
      await tester.tap(find.text('Confirmar ajuste'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Resultado desconhecido.'), findsOneWidget);
      expect(find.text('Revisar ajuste'), findsNothing);
      final command = h.remote.commands.single;
      await tester.tap(find.text('Retry seguro'));
      await tester.pumpAndSettle();
      expect(h.remote.commands.last, command);
      expect(tester.takeException(), null);
      await tester.pumpWidget(const SizedBox());
      await h.close();
    },
  );
  testWidgets(
    'desktop lot quantity patch never resends original validity or metadata',
    (tester) async {
      final key = GlobalKey<ProductStockLotsEditorState>();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ProductStockLotsEditor(
              key: key,
              lots: const [
                {
                  'index': 0,
                  'quantidade': 5,
                  'validade': {
                    'seconds': '1791970000',
                    'nanoseconds': 123456789,
                  },
                },
              ],
              conversion: false,
              enabled: true,
            ),
          ),
        ),
      );
      await tester.enterText(
        find.byKey(const ValueKey('original-0-quantity')),
        '3',
      );
      expect(key.currentState!.command(), [
        {
          'op': 'update',
          'index': 0,
          'set': {'quantidade': 3},
        },
      ]);
      await tester.tap(find.text('Remover lote 0'));
      await tester.pump();
      expect(key.currentState!.command(), [
        {'op': 'remove', 'index': 0},
      ]);
      expect(tester.takeException(), null);
    },
  );
}
