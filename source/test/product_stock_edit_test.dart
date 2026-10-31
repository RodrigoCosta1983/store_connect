import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_stock_edit.dart';
import 'package:store_connect/services/product_mutation_api.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'support/product_cadastral_harness.dart';
import 'product_mutation_ledger_test.dart' show FakeTransport;

ProductEditState state(Map<String, dynamic> product) =>
    ProductEditState.fromJson({
      'schemaVersion': 1,
      'productId': 'p',
      'uid': 'u',
      'storeId': 's',
      'expectedUpdateTime': {'seconds': '1791970000', 'nanoseconds': 1000},
      'product': product,
      'unavailable': [],
    });
void main() {
  test('entry, exit, explicit quantity and insufficient stock', () {
    final d = ProductStockDraft(state({'quantidade': 5}));
    d.manual('entry', 3);
    expect(d.requestedQuantity, 8);
    d.manual('exit', 3);
    expect(d.requestedQuantity, 2);
    d.manual('set', 0);
    expect(d.requestedQuantity, 0);
    expect(() => d.manual('exit', 6), throwsFormatException);
  });
  test('legacy invalid stock blocks without repair', () {
    for (final p in [
      <String, dynamic>{},
      {'quantidade': -1},
      {'quantidade': 1.5},
      {'quantidade': 5, 'lotes': null},
      {
        'quantidade': 5,
        'lotes': [
          {'index': 0, 'quantidade': 5},
        ],
      },
    ]) {
      final d = ProductStockDraft(state(p));
      expect(d.valid, false);
      expect(
        () => d.select({'kind': 'setManualQuantity', 'quantity': 0}),
        throwsFormatException,
      );
    }
  });
  test(
    'lot patches preserve original index and exact timestamp without serializing metadata',
    () {
      final p = {
        'quantidade': 5,
        'lotes': [
          {
            'index': 0,
            'quantidade': 2,
            'validade': {'seconds': '1791970000', 'nanoseconds': 123456000},
          },
          {
            'index': 1,
            'quantidade': 3,
            'validade': {'seconds': '1791970000', 'nanoseconds': 999999000},
          },
        ],
      };
      final d = ProductStockDraft(state(p));
      d.select({
        'kind': 'editLots',
        'operations': [
          {'op': 'remove', 'index': 0},
          {
            'op': 'update',
            'index': 1,
            'set': {'quantidade': 4},
          },
        ],
      });
      expect(d.requestedQuantity, 4);
      expect(d.change!['operations'][1]['index'], 1);
      expect(d.change!['operations'][1]['set'], {'quantidade': 4});
      expect(d.baseline.product, p);
      expect(
        () => d.select({
          'kind': 'editLots',
          'operations': [
            {'op': 'remove', 'index': 8},
          ],
        }),
        throwsFormatException,
      );
      expect(
        () => d.select({
          'kind': 'editLots',
          'operations': [
            {'op': 'remove', 'index': 0},
            {'op': 'remove', 'index': 1},
          ],
        }),
        throwsFormatException,
      );
      expect(
        () => d.select({
          'kind': 'convertToManual',
          'quantity': 5,
          'acknowledgement': true,
        }),
        throwsFormatException,
      );
      d.select({
        'kind': 'convertToManual',
        'quantity': 5,
        'acknowledgement': true,
      }, conversionConfirmed: true);
      expect(d.requestedQuantity, 5);
    },
  );
  test(
    'manual to lots conversion requires explicit confirmation and safe total',
    () {
      final d = ProductStockDraft(state({'quantidade': 5}));
      final change = {
        'kind': 'convertToLots',
        'lots': [
          {'quantidade': 5, 'validadeMs': 1791970000000},
        ],
      };
      expect(() => d.select(change), throwsFormatException);
      d.select(change, conversionConfirmed: true);
      expect(d.requestedQuantity, 5);
      expect(
        () => d.select({
          'kind': 'convertToLots',
          'lots': [
            {'quantidade': 9007199254740991, 'validadeMs': 0},
            {'quantidade': 1, 'validadeMs': 0},
          ],
        }, conversionConfirmed: true),
        throwsFormatException,
      );
    },
  );
  late CadastralHarness h;
  final sessions = <ProductStockEditSession>[];
  ProductStockEditSession session() {
    final s = ProductStockEditSession(
      access: h.access(),
      productId: 'p',
      storeId: 's',
    );
    sessions.add(s);
    return s;
  }

  setUp(() => h = CadastralHarness());
  tearDown(() async {
    for (final s in sessions) {
      s.dispose();
    }
    sessions.clear();
    await h.close();
  });
  test(
    'required reason and no mutation before explicit confirmation',
    () async {
      final s = session();
      await s.open();
      s.manual('entry', 2, '');
      expect(h.remote.commands, isEmpty);
      await s.confirm();
      expect(s.status, StockEditStatus.validationError);
      expect(h.remote.commands, isEmpty);
    },
  );
  test(
    'unknown before commit, frozen retry, reopen and incompatible B04 blocked',
    () async {
      h.remote.unknown = true;
      final s = session();
      await s.open();
      s.manual('entry', 2, 'Reposição');
      await s.confirm();
      expect(s.status, StockEditStatus.unknown);
      final command = jsonEncode(s.frozenCommand);
      final id = s.requestId;
      s.manual('set', 100, 'Cannot change');
      expect(jsonEncode(s.frozenCommand), command);
      await s.retrySameCommand();
      expect(s.requestId, id);
      expect(h.remote.commands.length, 2);
      expect(h.remote.commands[0], h.remote.commands[1]);
      final reopened = session();
      await reopened.open();
      expect(reopened.requestId, id);
      expect(reopened.status, StockEditStatus.unknown);
      final b04 = h.session();
      await b04.open();
      expect(b04.canEdit, false);
      b04.dispose();
    },
  );
  test(
    'pending B04 slot prevents stock and preserves cadastral command',
    () async {
      h.remote.unknown = true;
      final b04 = h.session();
      await b04.open();
      b04.setText('name', 'Nome');
      await b04.save();
      final before = Map.of(h.store.values);
      final s = session();
      await s.open();
      expect(s.canEdit, false);
      expect(s.status, StockEditStatus.persistenceFailure);
      expect(h.store.values, before);
      expect(h.remote.commands.single.containsKey('changes'), true);
      b04.dispose();
    },
  );
  test('account, store, project changes suspend pending stock', () async {
    for (final target in [
      const ProductMutationScope(
        projectId: 'demo-b04',
        uid: 'other',
        storeId: 's',
      ),
      const ProductMutationScope(
        projectId: 'demo-b04',
        uid: 'u',
        storeId: 'other',
      ),
      const ProductMutationScope(
        projectId: 'demo-other',
        uid: 'u',
        storeId: 's',
      ),
    ]) {
      h.active = const ProductMutationScope(
        projectId: 'demo-b04',
        uid: 'u',
        storeId: 's',
      );
      final s = session();
      await s.open();
      h.move(target);
      expect(s.status, StockEditStatus.scopeChanged);
      expect(s.frozenCommand, null);
      await s.confirm();
      expect(h.remote.commands, isEmpty);
    }
  });
  test(
    'definitive stock confirmation and lost response recover without repeat',
    () async {
      final transport = FakeTransport();
      var writes = 0;
      transport.sending = (command) async {
        writes++;
        expect(
          h.store.values.keys.any((key) => key.startsWith('b04-active-v1:')),
          true,
        );
        transport.result = {
          'status': 'confirmed',
          'definitive': true,
          'result': {
            'success': true,
            'productId': 'p',
            'requestId': command['requestId'],
            'changed': true,
          },
        };
        throw StateError('Response lost after commit');
      };
      final original = h.access();
      final s = ProductStockEditSession(
        access: ProductStockEditAccess(
          enabled: true,
          projectId: original.projectId,
          scopeChanges: h.changes.stream,
          readState: original.readState,
          ledger: ProductMutationLedger(
            store: h.store,
            transport: transport,
            activeScope: () async => h.active,
          ),
        ),
        productId: 'p',
        storeId: 's',
      );
      sessions.add(s);
      await s.open();
      s.manual('exit', 2, 'Avaria');
      await s.confirm();
      expect(s.status, StockEditStatus.confirmed);
      expect(writes, 1);
      expect(s.frozenCommand!['stockChange'], {
        'kind': 'setManualQuantity',
        'quantity': 3,
      });
      await s.retrySameCommand();
      expect(writes, 1);
      await s.reviewCurrentState();
      expect(s.draft!.change, null);
    },
  );
  test('persistence failure blocks send, corruption blocks reopening', () async {
    final s = session();
    await s.open();
    s.manual('entry', 1, 'Reposição');
    h.store.fail = true;
    await s.confirm();
    expect(s.status, StockEditStatus.persistenceFailure);
    expect(h.remote.commands, isEmpty);
    h.store.fail = false;
    h.store.values['b04-active-v1:${h.active!.prefix}${base64Url.encode(utf8.encode('p'))}'] =
        '{broken';
    final other = session();
    await other.open();
    expect(other.status, StockEditStatus.persistenceFailure);
    expect(other.canEdit, false);
  });
  test('HML, PROD and default access cannot read or send', () async {
    for (final access in [
      h.access(enabled: false),
      h.access(projectId: 'store-connect-app'),
      h.access(projectId: 'store-connect-hml'),
    ]) {
      final s = ProductStockEditSession(
        access: access,
        productId: 'p',
        storeId: 's',
      );
      sessions.add(s);
      await s.open();
      expect(s.status, StockEditStatus.disabled);
    }
    expect(h.reads, 0);
    expect(h.remote.commands, isEmpty);
  });
  test(
    'two stock dialogs reserve one identity; losing draft never overwrites it',
    () async {
      h.remote.unknown = true;
      final a = session();
      final b = session();
      await a.open();
      await b.open();
      a.manual('entry', 2, 'Entrada');
      b.manual('exit', 1, 'Saída');
      await Future.wait([a.confirm(), b.confirm()]);
      expect(a.requestId, b.requestId);
      expect(h.remote.commands.length, 1);
      expect(a.frozenCommand, b.frozenCommand);
    },
  );
  test(
    'version conflict requires review and discards old intent before fresh baseline',
    () async {
      final remote = FakeTransport();
      remote.result = {
        'status': 'rejected',
        'definitive': true,
        'error': {'code': 'aborted', 'reason': 'product-version-conflict'},
      };
      remote.sending = (_) async => throw StateError('Concurrent sale');
      final original = h.access();
      final s = ProductStockEditSession(
        access: ProductStockEditAccess(
          enabled: true,
          projectId: original.projectId,
          scopeChanges: h.changes.stream,
          readState: original.readState,
          ledger: ProductMutationLedger(
            store: h.store,
            transport: remote,
            activeScope: () async => h.active,
          ),
        ),
        productId: 'p',
        storeId: 's',
      );
      sessions.add(s);
      await s.open();
      s.manual('entry', 2, 'Reposição');
      h.product['quantidade'] = 4;
      h.revision++;
      await s.confirm();
      expect(s.status, StockEditStatus.versionConflict);
      await s.retrySameCommand();
      expect(remote.sent.length, 1);
      await s.reviewCurrentState();
      expect(s.draft!.quantity, 4);
      expect(s.draft!.change, null);
      expect(s.draft!.baseline.expectedUpdateTime, h.token);
    },
  );
}
