import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_variants_form_draft.dart';
import 'package:store_connect/services/product_variants_read_state.dart';
import 'package:store_connect/services/variant_authoritative_contract.dart';
import 'package:store_connect/services/variant_intent_ledger.dart';
import 'package:store_connect/services/variant_preview_state.dart';
import 'package:store_connect/widgets/product_variants_form.dart';

// Synthetic port only. No Node/Firebase transport or persistence is exercised.
class ReadPort implements VariantB2ReadTransport {
  Future<VariantAuthoritativeResponse> Function() answer;
  int calls = 0;
  ReadPort(this.answer);
  @override
  Future<VariantAuthoritativeResponse> readState(
    VariantLocalAccess access,
    VariantIdentity identity,
  ) {
    calls++;
    return answer();
  }

  @override
  Future<VariantAuthoritativeResponse> queryReceipt(
    VariantLocalAccess access,
    VariantPreviewIntent original,
  ) => throw StateError('No receipt queries from the form');
}

const scope = {'projectId': 'demo-read', 'uid': 'actor', 'storeId': 'store'};
VariantLocalAccess access({String session = 'epoch', bool revoked = false}) =>
    VariantLocalAccess(scope, sessionToken: session, revoked: revoked);

Map<String, dynamic> snapshot({String product = 'p', String? variant = 'v'}) =>
    {
      'status': 'available',
      'scope': {...scope},
      'identity': {'productId': product, 'variantId': variant},
      'parent': {
        'isSellable': false,
        'updateTime': {'seconds': '123', 'nanoseconds': 999999000},
        'data': {
          'variantSchemaVersion': 1,
          'productKind': 'variantParent',
          'isArchived': false,
          'cod': 'P',
          'future': null,
          'attributeDefinitions': [
            {
              'attributeId': 'color',
              'label': 'Cor',
              'values': [
                {'valueId': 'blue', 'label': 'Azul'},
              ],
            },
          ],
        },
      },
      if (variant != null)
        'variant': {
          'updateTime': {'seconds': '124', 'nanoseconds': 123456000},
          'data': {
            'productId': product,
            'variantSchemaVersion': 1,
            'isArchived': true,
            'attributes': [
              {'attributeId': 'color', 'valueId': 'blue'},
            ],
            'cod': 'V',
            'quantidade': 3,
            'lotes': [],
            'future': {'kept': true},
          },
        },
    };

void main() {
  testWidgets(
    'same form renders loading, denied, error and unknown without clearing drafts',
    (tester) async {
      final pending = Completer<VariantAuthoritativeResponse>();
      final port = ReadPort(() => pending.future);
      final state = ProductVariantsReadState(transport: port);
      final draft = ProductVariantsFormDraft(
        existingProduct: true,
        existingVariantParent: true,
        definitions: List<Map<String, dynamic>>.from(
          ((snapshot()['parent'] as Map)['data'] as Map)['attributeDefinitions']
              as List,
        ),
      );
      addTearDown(state.dispose);
      addTearDown(draft.dispose);
      final name = TextEditingController(text: 'Nome preservado');
      addTearDown(name.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: Column(
                children: [
                  TextField(controller: name),
                  ProductVariantsForm(
                    draft: draft,
                    parentCod: () => 'P',
                    readState: state,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      expect(
        find.textContaining('não estão disponíveis para leitura'),
        findsOneWidget,
      );
      final future = state.read(
        access: access(),
        identity: VariantIdentity('p', 'v'),
        currentAccess: () async => access(),
      );
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.text('Consultando a variante…'), findsOneWidget);
      pending.complete(
        VariantAuthoritativeResponse.decode({
          'status': 'access-denied',
          'reason': 'test',
        }),
      );
      await future;
      await tester.pump();
      expect(find.textContaining('Acesso à leitura negado'), findsOneWidget);
      port.answer = () async => throw StateError('private error not displayed');
      await state.read(
        access: access(),
        identity: VariantIdentity('p', 'v'),
        currentAccess: () async => access(),
      );
      await tester.pump();
      expect(
        find.textContaining('Erro na leitura das variantes'),
        findsOneWidget,
      );
      port.answer = () async => VariantAuthoritativeResponse.decode({
        'status': 'unknown',
        'reason': 'entity-absent',
      });
      await state.read(
        access: access(),
        identity: VariantIdentity('p', 'v'),
        currentAccess: () async => access(),
      );
      await tester.pump();
      expect(
        find.textContaining('Não foi comprovada a ausência'),
        findsOneWidget,
      );
      port.answer = () async => VariantAuthoritativeResponse.decode(snapshot());
      await state.read(
        access: access(),
        identity: VariantIdentity('p', 'v'),
        currentAccess: () async => access(),
      );
      await tester.pump();
      expect(find.textContaining('sem origem autenticada'), findsOneWidget);
      expect(find.textContaining('Estoque individual: 3'), findsNothing);
      expect(name.text, 'Nome preservado');
      expect(draft.definitions.single['attributeId'], 'color');
      expect(draft.blocksLegacySave, true);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unverified responses do not populate or overwrite editable local entries',
    (tester) async {
      final state = ProductVariantsReadState(
        transport: ReadPort(
          () async => VariantAuthoritativeResponse.decode(snapshot()),
        ),
      );
      final draft = ProductVariantsFormDraft();
      addTearDown(state.dispose);
      addTearDown(draft.dispose);
      draft.setEnabled(true);
      draft.addAttribute('Cor', 'Azul');
      draft.apply(
        {'attribute-1': 'attribute-1-value-1'},
        'Meu rascunho',
        'LOCAL',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: ProductVariantsForm(
                draft: draft,
                parentCod: () => '',
                readState: state,
              ),
            ),
          ),
        ),
      );
      await tester.enterText(
        find.byKey(const ValueKey('variant-form-name')),
        'Em edição',
      );
      await state.read(
        access: access(),
        identity: VariantIdentity('p', 'v'),
        currentAccess: () async => access(),
      );
      await tester.pump();
      expect(draft.entries.single.fields['cod'], 'LOCAL');
      expect(draft.entries.single.fields['name'], 'Meu rascunho');
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('variant-form-name')))
            .controller!
            .text,
        'Em edição',
      );
      expect(draft.blocksLegacySave, true);
      expect(state.canSave, false);
    },
  );

  final identity = VariantIdentity('p', 'v');
  Future<void> read(ProductVariantsReadState state) => state.read(
    access: access(),
    identity: identity,
    currentAccess: () async => access(),
  );
  test('missing adapter stays unavailable, never empty or writable', () async {
    final state = ProductVariantsReadState();
    addTearDown(state.dispose);
    await read(state);
    expect(state.status, ProductVariantsReadStatus.unavailable);
    expect(state.hasProvenEmptyList, false);
    expect(state.canSave, false);
    expect(state.response, isNull);
  });
  test(
    'loading then immutable unverified DTO preserves all identity and data',
    () async {
      final pending = Completer<VariantAuthoritativeResponse>();
      final state = ProductVariantsReadState(
        transport: ReadPort(() => pending.future),
      );
      addTearDown(state.dispose);
      final future = read(state);
      expect(state.status, ProductVariantsReadStatus.loading);
      pending.complete(VariantAuthoritativeResponse.decode(snapshot()));
      await future;
      expect(state.status, ProductVariantsReadStatus.unverified);
      final response = state.response!;
      expect(response.productId, 'p');
      expect(response.variantId, 'v');
      expect(response.parent!.updateTime['nanoseconds'], 999999000);
      expect(response.variant!.updateTime['nanoseconds'], 123456000);
      expect(response.variant!.data['cod'], 'V');
      expect(response.variant!.data['quantidade'], 3);
      expect(response.variant!.data['isArchived'], true);
      expect(response.variant!.data['future'], {'kept': true});
      expect(
        () => response.variant!.data['cod'] = 'changed',
        throwsUnsupportedError,
      );
      expect(state.canSave, false);
      expect(state.hasProvenEmptyList, false);
    },
  );
  for (final entry in {
    'access-denied': ProductVariantsReadStatus.denied,
    'unknown': ProductVariantsReadStatus.unknown,
    'inconsistent-state': ProductVariantsReadStatus.error,
    'identity-conflict': ProductVariantsReadStatus.identityConflict,
  }.entries) {
    test('${entry.key} is distinct and never an empty list', () async {
      final state = ProductVariantsReadState(
        transport: ReadPort(
          () async => VariantAuthoritativeResponse.decode({
            'status': entry.key,
            'reason': 'test',
          }),
        ),
      );
      addTearDown(state.dispose);
      await read(state);
      expect(state.status, entry.value);
      expect(state.response, isNull);
      expect(state.hasProvenEmptyList, false);
    });
  }
  for (final field in ['product', 'variant', 'scope', 'parent-only']) {
    test('rejects mismatching $field without leaking snapshot', () async {
      final raw = snapshot(
        product: field == 'product' ? 'other' : 'p',
        variant: field == 'variant'
            ? 'other'
            : field == 'parent-only'
            ? null
            : 'v',
      );
      if (field == 'scope') (raw['scope'] as Map)['storeId'] = 'other';
      final state = ProductVariantsReadState(
        transport: ReadPort(
          () async => VariantAuthoritativeResponse.decode(raw),
        ),
      );
      addTearDown(state.dispose);
      await read(state);
      expect(state.status, ProductVariantsReadStatus.identityConflict);
      expect(state.response, isNull);
      expect(state.hasProvenEmptyList, false);
    });
  }
  for (final change in ['logout', 'session', 'revoked', 'role', 'store']) {
    test('$change during await discards response', () async {
      VariantLocalAccess? current = access();
      final port = ReadPort(() async {
        current = switch (change) {
          'logout' => null,
          'session' => access(session: 'next'),
          'revoked' => access(revoked: true),
          'role' => VariantLocalAccess(
            scope,
            sessionToken: 'epoch',
            role: 'caixa',
          ),
          _ => VariantLocalAccess({
            ...scope,
            'storeId': 'other',
          }, sessionToken: 'epoch'),
        };
        return VariantAuthoritativeResponse.decode(snapshot());
      });
      final state = ProductVariantsReadState(transport: port);
      addTearDown(state.dispose);
      await state.read(
        access: access(),
        identity: identity,
        currentAccess: () async => current,
      );
      expect(state.status, ProductVariantsReadStatus.denied);
      expect(state.response, isNull);
    });
  }
  test(
    'denied before transport, missing scope, decoding errors and I/O errors',
    () async {
      final port = ReadPort(() async => throw StateError('I/O'));
      final state = ProductVariantsReadState(transport: port);
      addTearDown(state.dispose);
      await state.read(
        access: access(),
        identity: identity,
        currentAccess: () async => null,
      );
      expect(state.status, ProductVariantsReadStatus.denied);
      expect(port.calls, 0);
      await state.read(
        access: VariantLocalAccess({}, sessionToken: 'epoch'),
        identity: identity,
        currentAccess: () async => access(),
      );
      expect(state.status, ProductVariantsReadStatus.error);
      expect(port.calls, 0);
      await read(state);
      expect(state.status, ProductVariantsReadStatus.error);
      port.answer = () async =>
          VariantAuthoritativeResponse.decode({'status': 'available'});
      await read(state);
      expect(state.status, ProductVariantsReadStatus.error);
    },
  );
  test(
    'new read and invalidation suppress stale completions; dispose is safe',
    () async {
      final pending = Completer<VariantAuthoritativeResponse>();
      final port = ReadPort(() => pending.future);
      final state = ProductVariantsReadState(transport: port);
      final first = read(state);
      await Future<void>.delayed(Duration.zero);
      port.answer = () async => VariantAuthoritativeResponse.decode({
        'status': 'unknown',
        'reason': 'absent',
      });
      await read(state);
      pending.complete(VariantAuthoritativeResponse.decode(snapshot()));
      await first;
      expect(state.status, ProductVariantsReadStatus.unknown);
      state.invalidate();
      expect(state.status, ProductVariantsReadStatus.unavailable);
      final later = Completer<VariantAuthoritativeResponse>();
      port.answer = () => later.future;
      final future = read(state);
      await Future<void>.delayed(Duration.zero);
      state.dispose();
      later.complete(VariantAuthoritativeResponse.decode(snapshot()));
      await future;
      expect(state.response, isNull);
    },
  );
}
