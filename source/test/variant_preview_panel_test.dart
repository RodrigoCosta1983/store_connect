import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/fixtures/variant_preview_fixture.dart';
import 'package:store_connect/services/variant_preview_state.dart';
import 'package:store_connect/widgets/variant_preview_panel.dart';

Future<VariantPreviewSession> mount(
  WidgetTester tester, {
  String role = 'admin',
  bool opened = true,
}) async {
  var counter = 0;
  final s = VariantPreviewSession(
    syntheticVariantPreview(),
    role: role,
    newId: () => 'id-${++counter}',
  );
  if (opened) s.open();
  await tester.pumpWidget(MaterialApp(home: VariantPreviewPanel(session: s)));
  return s;
}

Future<void> tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'loading, synthetic disclaimer and unsupported fields are explicit',
    (tester) async {
      final s = await mount(tester, opened: false);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      s.open();
      await tester.pump();
      expect(
        find.text('Dados sintéticos · Sem envio ou persistência'),
        findsOneWidget,
      );
      expect(find.textContaining('Não vendável'), findsOneWidget);
      expect(
        find.textContaining('barcode, custo e fiscal: indisponíveis'),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'explicit selection blocks partial/duplicate and prepares only one combination',
    (tester) async {
      final s = await mount(tester);
      await tapVisible(tester, find.text('Preparar criação'));
      expect(s.pending, isNull);
      for (final entry in {'color': 'Azul', 'size': 'M'}.entries) {
        await tapVisible(
          tester,
          find.byKey(ValueKey('attribute-${entry.key}')),
        );
        await tester.tap(find.text(entry.value).last);
        await tester.pumpAndSettle();
      }
      await tapVisible(tester, find.text('Preparar criação'));
      expect(s.pending, isNull);
      await tapVisible(tester, find.byKey(const ValueKey('attribute-size')));
      await tester.tap(find.text('G').last);
      await tester.pumpAndSettle();
      await tapVisible(tester, find.text('Preparar criação'));
      expect(s.pending!.operation, 'createVariantC2');
      expect(s.fixture.variants.length, 3);
      final old = s.pending!.encoded;
      s.simulate(VariantPreviewPhase.conflict);
      await tester.pump();
      await tapVisible(tester, find.text('Retomar a mesma intenção'));
      expect(s.pending!.encoded, old);
    },
  );
  testWidgets(
    'archive confirmation cancel/confirm preserves all displayed fixture data',
    (tester) async {
      final s = await mount(tester);
      await tapVisible(tester, find.text('Azul M'));
      await tester.ensureVisible(find.byKey(const ValueKey('variant-reason')));
      await tester.enterText(
        find.byKey(const ValueKey('variant-reason')),
        'Synthetic archive',
      );
      await tapVisible(tester, find.text('Preparar arquivamento'));
      expect(
        find.textContaining(
          'Estoque, lotes, histórico e COD serão preservados.',
        ),
        findsOneWidget,
      );
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(s.pending, isNull);
      await tapVisible(tester, find.text('Preparar arquivamento'));
      await tester.tap(find.text('Confirmar arquivamento'));
      await tester.pumpAndSettle();
      expect(s.pending!.operation, 'archiveVariantC3');
      expect(s.fixture.variants[0]['isArchived'], false);
      expect(s.fixture.variants[0]['quantidade'], 5);
    },
  );
  testWidgets('manual stock and lots use distinct stable variant identities', (
    tester,
  ) async {
    final s = await mount(tester);
    await tapVisible(tester, find.text('Vermelho G'));
    expect(s.selected!.variantId, 'synthetic-red-l');
    expect(find.textContaining('Lote 0 — validade original'), findsOneWidget);
    await tester.ensureVisible(
      find.byKey(const ValueKey('original-0-quantity')),
    );
    await tester.enterText(
      find.byKey(const ValueKey('original-0-quantity')),
      '2',
    );
    await tester.enterText(
      find.byKey(const ValueKey('variant-reason')),
      'Count',
    );
    await tapVisible(tester, find.text('Preparar ajuste'));
    expect(s.pending!.command['variantId'], 'synthetic-red-l');
    expect((s.pending!.command['stockChange'] as Map)['operations'], [
      {
        'op': 'update',
        'index': 0,
        'set': {'quantidade': 2},
      },
    ]);
    expect(s.fixture.variants.map((v) => v['quantidade']), [5, 3, 2]);
  });
  testWidgets('simulated permission and archived selection disable actions', (
    tester,
  ) async {
    await mount(tester, role: 'viewer');
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Preparar criação'),
          )
          .onPressed,
      isNull,
    );
    await mount(tester, role: 'vendedor');
    await tapVisible(tester, find.text('Azul M'));
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, 'Preparar arquivamento'),
          )
          .onPressed,
      isNull,
    );
    await tapVisible(tester, find.text('Vermelho M'));
    expect(
      tester
          .widget<FilledButton>(
            find.widgetWithText(FilledButton, 'Preparar ajuste'),
          )
          .onPressed,
      isNull,
    );
  });
  for (final size in [const Size(390, 844), const Size(1440, 900)]) {
    testWidgets(
      'Android/Web responsive layout $size with large text, no operational channels',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final calls = <MethodCall>[];
        for (final channel in [
          'plugins.flutter.io/cloud_firestore',
          'plugins.flutter.io/cloud_functions',
          'plugins.flutter.io/firebase_auth',
        ]) {
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
              .setMockMethodCallHandler(MethodChannel(channel), (call) async {
                calls.add(call);
                throw StateError('Operational call forbidden');
              });
          addTearDown(
            () => TestDefaultBinaryMessengerBinding
                .instance
                .defaultBinaryMessenger
                .setMockMethodCallHandler(MethodChannel(channel), null),
          );
        }
        final s = VariantPreviewSession(syntheticVariantPreview())..open();
        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(
              platform: size.width < 500
                  ? TargetPlatform.android
                  : TargetPlatform.windows,
            ),
            home: MediaQuery(
              data: MediaQueryData(
                size: size,
                textScaler: const TextScaler.linear(1.5),
              ),
              child: VariantPreviewPanel(session: s),
            ),
          ),
        );
        await tapVisible(tester, find.text('Vermelho G'));
        await tester.ensureVisible(find.text('Adicionar lote'));
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(calls, isEmpty);
        final semantics = tester.ensureSemantics();
        expect(
          find.byKey(
            ValueKey(
              VariantIdentity(s.fixture.productId, 'synthetic-red-l').key,
            ),
          ),
          findsOneWidget,
        );
        semantics.dispose();
      },
    );
  }
}
