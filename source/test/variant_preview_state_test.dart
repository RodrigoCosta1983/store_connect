import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/fixtures/variant_preview_fixture.dart';
import 'package:store_connect/services/variant_preview_state.dart';

Map<String, dynamic> copy(VariantPreviewData fixture) =>
    jsonDecode(jsonEncode(fixture.data)) as Map<String, dynamic>;
VariantPreviewSession session({String role = 'admin'}) {
  var id = 0;
  return VariantPreviewSession(
    syntheticVariantPreview(),
    newId: () => 'synthetic-id-${++id}',
    role: role,
  )..open();
}

void target(VariantPreviewSession s, {int index = 0}) => s.select(
  VariantIdentity(
    s.fixture.productId,
    s.fixture.variants[index]['variantId'] as String,
  ),
);
void creation(VariantPreviewSession s) {
  s.selections.addAll({'color': 'blue', 'size': 'l'});
}

void main() {
  test('stable tuple distinguishes products and survives rename/reorder', () {
    final s = session();
    target(s);
    final identity = s.selected!;
    expect(identity, VariantIdentity(s.fixture.productId, 'synthetic-blue-m'));
    expect(identity, isNot(VariantIdentity('another', identity.variantId)));
    final raw = copy(s.fixture);
    raw['variants'] = (raw['variants'] as List).reversed.toList();
    (raw['variants'] as List).last['name'] = 'Renamed';
    s.acceptSyntheticRead(VariantPreviewData(raw));
    expect(s.selected, identity);
    expect(s.fixture.variant(identity)['name'], 'Renamed');
    expect(() => VariantIdentity('p', 'bad/id'), throwsFormatException);
    expect(() => VariantIdentity('p', '\uD800'), throwsFormatException);
    expect(VariantIdentity('p', 'opção-😀').variantId, 'opção-😀');
  });
  test(
    'only complete explicit combinations, including archived duplicates',
    () {
      final s = session();
      expect(() => s.prepareCreation(), throwsFormatException);
      s.selections['color'] = 'blue';
      expect(() => s.prepareCreation(), throwsFormatException);
      s.selections['size'] = 'm';
      expect(() => s.prepareCreation(), throwsFormatException);
      s.selections.addAll({'color': 'red', 'size': 'm'});
      expect(() => s.prepareCreation(), throwsFormatException);
      creation(s);
      final intent = s.prepareCreation();
      expect(intent.command['variant'], {
        'attributes': [
          {'attributeId': 'color', 'valueId': 'blue'},
          {'attributeId': 'size', 'valueId': 'l'},
        ],
      });
      expect(s.fixture.variants, hasLength(3));
    },
  );
  test('cadastral draft has no effect on sibling stock or lots', () {
    final s = session();
    final before = jsonEncode(s.fixture.data);
    s.draftName = 'New visual label';
    s.codSupplied = true;
    s.draftCod = ' new ';
    creation(s);
    final intent = s.prepareCreation();
    expect((intent.command['variant'] as Map).containsKey('quantidade'), false);
    expect((intent.command['variant'] as Map).containsKey('lotes'), false);
    expect(jsonEncode(s.fixture.data), before);
    expect(s.fixture.variants.map((v) => v['quantidade']), [5, 3, 2]);
  });
  test('COD omission, explicit empty and whitespace remain distinct', () {
    for (final cod in [null, '', '   ']) {
      final s = session();
      creation(s);
      s.codSupplied = cod != null;
      s.draftCod = cod ?? '';
      final body = s.prepareCreation().command['variant'] as Map;
      expect(body.containsKey('cod'), cod != null);
      if (cod != null) expect(body['cod'], cod);
    }
    final s = session();
    creation(s);
    s.codSupplied = true;
    s.draftCod = 'a' * 41;
    expect(() => s.prepareCreation(), throwsFormatException);
  });
  test(
    'stock intent uses pair and exact baselines, never a cadastral snapshot',
    () {
      final s = session();
      target(s);
      final intent = s.prepareStock({
        'kind': 'setManualQuantity',
        'quantity': 7,
      }, ' reason ');
      expect(intent.command['expectedProductUpdateTime'], {
        'seconds': '1792152000',
        'nanoseconds': 123456000,
      });
      expect(intent.command['expectedVariantUpdateTime'], {
        'seconds': '1792152001',
        'nanoseconds': 654321000,
      });
      expect(intent.command['variantId'], s.selected!.variantId);
      expect(intent.command['reason'], 'reason');
      expect(intent.command.containsKey('product'), false);
      expect(intent.command.containsKey('changes'), false);
      expect(s.fixture.variants[0]['quantidade'], 5);
      expect(
        () => VariantBaseline({
          'seconds': '1792152000',
          'nanoseconds': 123456789,
        }),
        throwsFormatException,
      );
    },
  );
  test(
    'conflict, error, replay and success never mutate tokens or regenerate IDs',
    () {
      final s = session();
      target(s);
      final intent = s.prepareStock({
        'kind': 'setManualQuantity',
        'quantity': 7,
      }, 'reason');
      final before = intent.encoded;
      for (final phase in [
        VariantPreviewPhase.conflict,
        VariantPreviewPhase.error,
        VariantPreviewPhase.replay,
        VariantPreviewPhase.success,
      ]) {
        s.simulate(phase);
        expect(s.retry(), same(intent));
        expect(s.pending!.encoded, before);
        expect(
          () => s.prepareStock({
            'kind': 'setManualQuantity',
            'quantity': 8,
          }, 'different'),
          throwsStateError,
        );
      }
      final raw = copy(s.fixture);
      raw['baseline'] = {'seconds': '1792159999', 'nanoseconds': 0};
      s.acceptSyntheticRead(VariantPreviewData(raw));
      expect(s.pending!.encoded, before);
      final other = session();
      other.resume(intent);
      expect(other.pending!.encoded, before);
      expect(other.retry().requestId, intent.requestId);
    },
  );
  test(
    'nested immutable payload cannot be edited and does not alias drafts',
    () {
      final s = session();
      creation(s);
      final intent = s.prepareCreation();
      s.selections['color'] = 'red';
      s.draftName = 'mutated';
      expect((intent.command['variant'] as Map)['attributes'], [
        {'attributeId': 'color', 'valueId': 'blue'},
        {'attributeId': 'size', 'valueId': 'l'},
      ]);
      expect(() => intent.command['requestId'] = 'new', throwsUnsupportedError);
      expect(
        () => (intent.command['variant'] as Map)['name'] = 'new',
        throwsUnsupportedError,
      );
      expect(
        () =>
            ((intent.command['variant'] as Map)['attributes'] as List).clear(),
        throwsUnsupportedError,
      );
    },
  );
  test(
    'lot patch retains original index and validity precision, preserves fixture metadata',
    () {
      final s = session();
      target(s, index: 1);
      final before = jsonEncode(s.fixture.data);
      final intent = s.prepareStock({
        'kind': 'editLots',
        'operations': [
          {
            'op': 'update',
            'index': 0,
            'set': {'quantidade': 0},
          },
        ],
      }, 'count');
      final stock = intent.command['stockChange'] as Map;
      expect(stock, {
        'kind': 'editLots',
        'operations': [
          {
            'op': 'update',
            'index': 0,
            'set': {'quantidade': 0},
          },
        ],
      });
      expect(jsonEncode(s.fixture.data), before);
      expect(
        ((s.fixture.variants[1]['lotes'] as List).first['validade']
            as Map)['nanoseconds'],
        123456789,
      );
    },
  );
  test(
    'F9 lot modes, integrity, indexes, overflow and conversion confirmation',
    () {
      for (final change in [
        {'kind': 'setManualQuantity', 'quantity': -1},
        {'kind': 'setManualQuantity', 'quantity': '2'},
        {'kind': 'setManualQuantity', 'quantity': 1, 'changes': {}},
        {'kind': 'convertToManual', 'quantity': 2},
        {
          'kind': 'convertToLots',
          'lots': [
            {'quantidade': 0, 'validadeMs': 1},
          ],
        },
        {
          'kind': 'convertToLots',
          'lots': [
            {'quantidade': 9007199254740991, 'validadeMs': 1},
            {'quantidade': 1, 'validadeMs': 1},
          ],
        },
      ]) {
        final s = session();
        target(s);
        expect(() => s.prepareStock(change, 'reason'), throwsFormatException);
      }
      for (final operations in [
        [
          {'op': 'remove', 'index': 0},
        ],
        [
          {'op': 'remove', 'index': 9},
        ],
        [
          {
            'op': 'update',
            'index': 0,
            'set': {'quantidade': 1},
          },
          {'op': 'remove', 'index': 0},
        ],
      ]) {
        final s = session();
        target(s, index: 1);
        expect(
          () => s.prepareStock({
            'kind': 'editLots',
            'operations': operations,
          }, 'reason'),
          throwsFormatException,
        );
      }
      final raw = copy(syntheticVariantPreview());
      (raw['variants'] as List)[1]['quantidade'] = 9;
      expect(() => VariantPreviewData(raw), throwsFormatException);
    },
  );
  test(
    'archive requires explicit confirmation/admin and retains fixture stock/COD/history',
    () {
      final s = session();
      target(s);
      final before = jsonEncode(s.fixture.data);
      expect(
        () => s.prepareArchive('reason', confirmed: false),
        throwsFormatException,
      );
      expect(s.pending, isNull);
      final intent = s.prepareArchive('reason', confirmed: true);
      expect(intent.operation, 'archiveVariantC3');
      expect(intent.command.containsKey('stockChange'), false);
      s.simulate(VariantPreviewPhase.success);
      expect(jsonEncode(s.fixture.data), before);
      final denied = session(role: 'vendedor');
      target(denied);
      expect(
        () => denied.prepareArchive('reason', confirmed: true),
        throwsStateError,
      );
    },
  );
  test(
    'simulated revocation blocks retry, archived parent/leaf blocks effects',
    () {
      final s = session();
      target(s);
      final old = s.prepareStock({
        'kind': 'setManualQuantity',
        'quantity': 1,
      }, 'reason');
      s.revoked = true;
      expect(() => s.retry(), throwsStateError);
      expect(s.pending, same(old));
      final archived = session();
      target(archived, index: 2);
      expect(
        () => archived.prepareStock({
          'kind': 'setManualQuantity',
          'quantity': 1,
        }, 'reason'),
        throwsFormatException,
      );
      final raw = copy(syntheticVariantPreview());
      raw['isArchived'] = true;
      final parent = VariantPreviewSession(VariantPreviewData(raw))..open();
      creation(parent);
      expect(() => parent.prepareCreation(), throwsStateError);
    },
  );
  test('fixture and intent scope isolation, no production snapshots', () {
    final a = session(), b = session();
    creation(a);
    final intent = a.prepareCreation();
    expect(b.pending, isNull);
    expect(b.selections, isEmpty);
    expect(
      () => a.fixture.variants[0]['quantidade'] = 99,
      throwsUnsupportedError,
    );
    final raw = copy(b.fixture);
    (raw['scope'] as Map)['storeId'] = 'other-store';
    final other = VariantPreviewSession(VariantPreviewData(raw))..open();
    expect(() => other.resume(intent), throwsFormatException);
    expect(() => a.acceptSyntheticRead(other.fixture), throwsFormatException);
    (raw['scope'] as Map)['projectId'] = 'production';
    expect(() => VariantPreviewData(raw), throwsFormatException);
  });
}
