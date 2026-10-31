import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/variant_intent_store.dart';
import 'package:store_connect/fixtures/variant_preview_fixture.dart';
import 'package:store_connect/services/variant_preview_state.dart';
import 'package:store_connect/services/variant_intent_ledger.dart';

VariantPreviewIntent variantIntent({
  String id = 'request-1',
  bool archive = false,
  bool create = false,
}) {
  final s = VariantPreviewSession(syntheticVariantPreview(), newId: () => id)
    ..open();
  if (create) {
    var count = 0;
    final c = VariantPreviewSession(
      syntheticVariantPreview(),
      newId: () => count++ == 0 ? id : 'variant-$id',
    )..open();
    c.selections.addAll({'color': 'blue', 'size': 'l'});
    c.codSupplied = true;
    c.draftCod = '   ';
    return c.prepareCreation();
  }
  s.select(VariantIdentity(s.fixture.productId, 'synthetic-blue-m'));
  return archive
      ? s.prepareArchive('Synthetic archive', confirmed: true)
      : s.prepareStock({
          'kind': 'setManualQuantity',
          'quantity': 7,
        }, 'Synthetic count');
}

class FaultVariantStore implements VariantIntentStore {
  final VariantIntentStore inner;
  bool failBefore = false, failAfter = false;
  void Function()? afterWrite;
  FaultVariantStore(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<void> close() => inner.close();
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    if (failBefore) throw StateError('synthetic-write-failure');
    final result = await inner.compareAndSet(key, expected, value);
    afterWrite?.call();
    if (failAfter) throw StateError('synthetic-lost-local-response');
    return result;
  }
}

void variantLedgerCases(Future<VariantIntentStore> Function(String) open) {
  var serial = 0;
  Future<List<VariantIntentStore>> stores() async {
    final name =
        'variant_b1_${DateTime.now().microsecondsSinceEpoch}_${serial++}';
    final a = await open(name), b = await open(name);
    addTearDown(a.close);
    addTearDown(b.close);
    return [a, b];
  }

  VariantIntentLedger ledger(
    VariantIntentStore store, {
    Map<String, dynamic>? scope,
    String role = 'admin',
  }) {
    final current = scope ?? syntheticVariantPreview().scope;
    return VariantIntentLedger(
      store: store,
      allowSyntheticReconciliation: true,
      scope: current,
      sessionToken: 'session',
      activeAccess: () async =>
          VariantLocalAccess(current, sessionToken: 'session', role: role),
    );
  }

  test(
    'durable restart preserves full command, COD and exact tokens; bridge restores preview',
    () async {
      final pair = await stores();
      final original = variantIntent(create: true);
      final a = ledger(pair[0]);
      await a.prepare('intent', original);
      final recovered = (await ledger(pair[1]).reopen()).single;
      expect(recovered.intent.encoded, original.encoded);
      expect((recovered.intent.command['variant'] as Map)['cod'], '   ');
      expect(
        recovered.intent.command['expectedProductUpdateTime'],
        original.command['expectedProductUpdateTime'],
      );
      final preview = VariantPreviewSession(syntheticVariantPreview())..open();
      await VariantDurablePreview(preview, ledger(pair[1])).restorePending();
      expect(preview.pending!.encoded, original.encoded);
      preview.simulate(VariantPreviewPhase.conflict);
      expect(preview.retry().encoded, original.encoded);
    },
  );
  test(
    'two instances CAS reserve one original, reject different requestId/content and operation',
    () async {
      final pair = await stores();
      final a = ledger(pair[0]), b = ledger(pair[1]);
      final original = variantIntent();
      final same = await Future.wait([
        a.prepare('intent', original),
        b.prepare('intent', original),
      ]);
      expect(same.every((v) => v.intent.encoded == original.encoded), true);
      await expectLater(
        b.prepare('different', variantIntent(id: 'request-2')),
        throwsStateError,
      );
      await expectLater(
        b.prepare('intent', variantIntent(archive: true)),
        throwsStateError,
      );
      await expectLater(b.prepare('other-key', original), throwsStateError);
      expect((await b.reopen()).length, 1);
    },
  );
  test('competing valid intentions have exactly one atomic winner', () async {
    final pair = await stores();
    final outcomes = await Future.wait([
      ledger(pair[0])
          .prepare('a', variantIntent(id: 'a'))
          .then((_) => true, onError: (_) => false),
      ledger(pair[1])
          .prepare('b', variantIntent(id: 'b', archive: true))
          .then((_) => true, onError: (_) => false),
    ]);
    expect(outcomes.where((v) => v).length, 1);
    expect((await ledger(pair[0]).reopen()).length, 1);
  });
  test(
    'durable unknown claim has one winner; restart never steals or retries unknown',
    () async {
      final pair = await stores();
      final a = ledger(pair[0]), b = ledger(pair[1]);
      final original = variantIntent();
      await a.prepare('intent', original);
      final claims = await Future.wait([
        a
            .claimForFutureTransport(original.requestId)
            .then((_) => true, onError: (_) => false),
        b
            .claimForFutureTransport(original.requestId)
            .then((_) => true, onError: (_) => false),
      ]);
      expect(claims.where((v) => v).length, 1);
      expect(
        (await b.load(original.requestId)).status,
        VariantIntentStatus.unknown,
      );
      await expectLater(
        b.claimForFutureTransport(original.requestId),
        throwsStateError,
      );
      await expectLater(
        b.prepare('new', variantIntent(id: 'new')),
        throwsStateError,
      );
      expect(
        (await b.load(original.requestId)).intent.encoded,
        original.encoded,
      );
    },
  );
  test(
    'write failures never grant transport; crash after commit recovers original',
    () async {
      final pair = await stores();
      final fault = FaultVariantStore(pair[0]);
      final a = ledger(fault);
      final original = variantIntent();
      fault.failBefore = true;
      await expectLater(a.prepare('intent', original), throwsStateError);
      expect(await ledger(pair[1]).reopen(), isEmpty);
      fault.failBefore = false;
      fault.failAfter = true;
      await expectLater(a.prepare('intent', original), throwsStateError);
      final b = ledger(pair[1]);
      expect((await b.reopen()).single.intent.encoded, original.encoded);
      fault.failAfter = false;
      fault.failBefore = true;
      await expectLater(
        a.claimForFutureTransport(original.requestId),
        throwsStateError,
      );
      expect(
        (await b.load(original.requestId)).status,
        VariantIntentStatus.prepared,
      );
      fault.failBefore = false;
      fault.failAfter = true;
      await expectLater(
        a.claimForFutureTransport(original.requestId),
        throwsStateError,
      );
      expect(
        (await b.load(original.requestId)).status,
        VariantIntentStatus.unknown,
      );
    },
  );
  test(
    'local reconciliation/replay immutable; only resolved terminal releases new intention',
    () async {
      final pair = await stores();
      final a = ledger(pair[0]);
      final original = variantIntent();
      await a.prepare('one', original);
      await expectLater(
        a.reconcileLocal(
          VariantLocalResolution(
            original: original,
            status: VariantIntentStatus.committed,
            reason: 'mock receipt',
          ),
        ),
        throwsStateError,
      );
      await a.claimForFutureTransport(original.requestId);
      final resolved = await a.reconcileLocal(
        VariantLocalResolution(
          original: original,
          status: VariantIntentStatus.committed,
          reason: 'mock receipt',
        ),
      );
      expect(resolved.terminal, true);
      final raw = await pair[0].read(a.storageKey);
      await a.reconcileLocal(
        VariantLocalResolution(
          original: original,
          status: VariantIntentStatus.committed,
          reason: 'mock receipt',
          replayed: true,
        ),
      );
      expect(await pair[0].read(a.storageKey), raw);
      await expectLater(
        a.reconcileLocal(
          VariantLocalResolution(
            original: original,
            status: VariantIntentStatus.rejected,
            reason: 'contradiction',
          ),
        ),
        throwsStateError,
      );
      final next = variantIntent(id: 'next', archive: true);
      await a.prepare('next-key', next);
      await a.claimForFutureTransport(next.requestId);
      await a.reconcileLocal(
        VariantLocalResolution(
          original: next,
          status: VariantIntentStatus.rejected,
          reason: 'mock rejection',
        ),
      );
      expect(
        (await ledger(pair[1]).reopen()).map((a) => a.status),
        unorderedEquals([
          VariantIntentStatus.committed,
          VariantIntentStatus.rejected,
        ]),
      );
    },
  );
  test(
    'identity conflict remains quarantined and cannot authorize another command',
    () async {
      final pair = await stores();
      final a = ledger(pair[0]);
      final original = variantIntent();
      await a.prepare('intent', original);
      await a.claimForFutureTransport(original.requestId);
      await a.reconcileLocal(
        VariantLocalResolution(
          original: original,
          status: VariantIntentStatus.conflict,
          reason: 'mock identity conflict',
        ),
      );
      await expectLater(
        a.prepare('new', variantIntent(id: 'new')),
        throwsStateError,
      );
      await expectLater(
        a.reconcileLocal(
          VariantLocalResolution(
            original: original,
            status: VariantIntentStatus.committed,
            reason: 'guess',
          ),
        ),
        throwsStateError,
      );
      expect(
        (await ledger(pair[1]).reopen()).single.status,
        VariantIntentStatus.conflict,
      );
    },
  );
  test(
    'scope/account/session epoch/revocation and archival role checked on resume/replay',
    () async {
      final pair = await stores();
      final scope = syntheticVariantPreview().scope;
      VariantLocalAccess? access = VariantLocalAccess(
        scope,
        sessionToken: 'epoch',
      );
      final a = VariantIntentLedger(
        store: pair[0],
        scope: scope,
        sessionToken: 'epoch',
        activeAccess: () async => access,
      );
      final original = variantIntent(archive: true);
      await a.prepare('intent', original);
      for (final bad in [
        null,
        VariantLocalAccess(scope, sessionToken: 'new-epoch'),
        VariantLocalAccess(scope, sessionToken: 'epoch', revoked: true),
        VariantLocalAccess(scope, sessionToken: 'epoch', role: 'vendedor'),
        VariantLocalAccess({
          ...scope,
          'storeId': 'other',
        }, sessionToken: 'epoch'),
      ]) {
        access = bad;
        await expectLater(a.load(original.requestId), throwsStateError);
      }
      access = VariantLocalAccess(scope, sessionToken: 'epoch');
      expect((await a.reopen()).single.intent.encoded, original.encoded);
    },
  );
  test(
    'same request and intent key isolated per project/user/store; no protocol cross use',
    () async {
      final pair = await stores();
      final original = variantIntent();
      final a = ledger(pair[0]);
      await a.prepare('same', original);
      for (final field in ['projectId', 'uid', 'storeId']) {
        final raw = jsonDecode(original.encoded) as Map<String, dynamic>;
        final scope = Map<String, dynamic>.from(
          (raw['command'] as Map)['scope'] as Map,
        );
        scope[field] = field == 'projectId' ? 'demo-other' : 'other';
        (raw['command'] as Map)['scope'] = scope;
        final other = ledger(pair[1], scope: scope);
        expect(await other.reopen(), isEmpty);
        await other.prepare('same', VariantPreviewIntent.fromJson(raw));
        await expectLater(
          other.prepare('wrong', original),
          throwsFormatException,
        );
      }
      expect((await a.reopen()).length, 1);
      final raw = original.toJson();
      expect(
        () => VariantPreviewIntent.fromJson({
          ...raw,
          'operation': 'confirmSaleV2',
        }),
        throwsFormatException,
      );
    },
  );
  test(
    'corrupt records fail closed, immutable payload never aliases decoded record',
    () async {
      final pair = await stores();
      final a = ledger(pair[0]);
      final original = variantIntent();
      await a.prepare('intent', original);
      final recovered = (await a.reopen()).single;
      expect(
        () => recovered.intent.command['requestId'] = 'changed',
        throwsUnsupportedError,
      );
      final raw = await pair[0].read(a.storageKey);
      final record = jsonDecode(raw!) as Map<String, dynamic>;
      record['protocol'] = 'sale-v2';
      await pair[0].compareAndSet(a.storageKey, raw, jsonEncode(record));
      await expectLater(ledger(pair[1]).reopen(), throwsFormatException);
    },
  );
  test(
    'actual connection close/reopen preserves complete unknown intention',
    () async {
      final name =
          'variant_closed_${DateTime.now().microsecondsSinceEpoch}_${serial++}';
      final aStore = await open(name);
      final a = ledger(aStore);
      final original = variantIntent(create: true);
      await a.prepare('closed', original);
      await a.claimForFutureTransport(original.requestId);
      final bytes = await aStore.read(a.storageKey);
      await aStore.close();
      final bStore = await open(name);
      addTearDown(bStore.close);
      final b = ledger(bStore);
      expect(await bStore.read(b.storageKey), bytes);
      final recovered = (await b.reopen()).single;
      expect(recovered.intent.encoded, original.encoded);
      expect(recovered.status, VariantIntentStatus.unknown);
      await expectLater(
        b.claimForFutureTransport(original.requestId),
        throwsStateError,
      );
    },
  );
  test(
    'revocation during durable claim returns no permission to transport and preserves unknown',
    () async {
      final pair = await stores();
      final fault = FaultVariantStore(pair[0]);
      final scope = syntheticVariantPreview().scope;
      var revoked = false;
      final a = VariantIntentLedger(
        store: fault,
        scope: scope,
        sessionToken: 'epoch',
        activeAccess: () async =>
            VariantLocalAccess(scope, sessionToken: 'epoch', revoked: revoked),
      );
      final original = variantIntent();
      await a.prepare('intent', original);
      fault.afterWrite = () => revoked = true;
      await expectLater(
        a.claimForFutureTransport(original.requestId),
        throwsStateError,
      );
      final recovered = (await ledger(pair[1]).reopen()).single;
      expect(recovered.status, VariantIntentStatus.unknown);
      expect(recovered.intent.encoded, original.encoded);
    },
  );
  test(
    'default B1 cannot unlock unknown using a synthetic outcome or reopen simulated terminal data',
    () async {
      final pair = await stores();
      final scope = syntheticVariantPreview().scope;
      final a = VariantIntentLedger(
        store: pair[0],
        scope: scope,
        sessionToken: 'session',
        activeAccess: () async =>
            VariantLocalAccess(scope, sessionToken: 'session'),
      );
      final original = variantIntent();
      await a.prepare('intent', original);
      await a.claimForFutureTransport(original.requestId);
      final result = VariantLocalResolution(
        original: original,
        status: VariantIntentStatus.committed,
        reason: 'not authoritative',
      );
      await expectLater(a.reconcileLocal(result), throwsUnsupportedError);
      await expectLater(
        a.prepare('new', variantIntent(id: 'new')),
        throwsStateError,
      );
      await ledger(pair[1]).reconcileLocal(result);
      await expectLater(a.reopen(), throwsFormatException);
    },
  );
}
