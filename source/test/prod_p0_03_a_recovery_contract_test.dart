import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'support/sale_ledger_cases.dart' show saleScope, saleIntent, SaleTestTransport;

void main() {
  test('ISOLATED existing ledger recovers committed lost response after SQLite reopen without second send', () async {
    final directory = Directory.systemTemp.createTempSync('p03a-recovery-');
    final path = '${directory.path}${Platform.pathSeparator}sale.sqlite';
    var store = SqliteSaleMutationStore(path);
    final remote = SaleTestTransport();
    var ledger = SaleMutationLedger(store: store, transport: remote, activeScope: () async => saleScope);
    final draft = saleIntent();
    final original = await ledger.reserve(saleScope, 'same-intention', draft);
    (draft['items'] as List).clear();
    await ledger.prepare(saleScope, 'same-intention');
    remote.sending = (command) async {
      final saved = await ledger.load(saleScope, 'same-intention');
      expect(saved.state, SaleAttemptState.sending);
      expect(saved.payload, original.payload);
      remote.receipt = remote.confirmed(command);
      throw TimeoutException('synthetic response loss AFTER commit');
    };
    expect((await ledger.send(saleScope, 'same-intention')).state, SaleAttemptState.unknown);
    await store.close();
    store = SqliteSaleMutationStore(path);
    addTearDown(store.close);
    ledger = SaleMutationLedger(store: store, transport: remote, activeScope: () async => saleScope);
    final reopened = (await ledger.reopen(saleScope)).single;
    expect(reopened.requestId, original.requestId);
    expect(reopened.payload, original.payload);
    expect(reopened.state, SaleAttemptState.unknown);
    expect((await ledger.recover(saleScope, 'same-intention')).state, SaleAttemptState.confirmed);
    expect((await ledger.send(saleScope, 'same-intention')).state, SaleAttemptState.confirmed);
    expect(remote.sent, hasLength(1));
    expect(remote.queried, [original.payload]);
    expect((await ledger.load(saleScope, 'same-intention')).requestId, original.requestId);
    // This transport is synthetic; stock atomicity is tested separately in Emulator.
  });
  test('ISOLATED same-intention command conflict never allocates a replacement or sends', () async {
    final directory = Directory.systemTemp.createTempSync('p03a-conflict-');
    final store = SqliteSaleMutationStore('${directory.path}${Platform.pathSeparator}sale.sqlite');
    addTearDown(store.close);
    final remote = SaleTestTransport();
    final ledger = SaleMutationLedger(store: store, transport: remote, activeScope: () async => saleScope);
    final original = await ledger.reserve(saleScope, 'same-intention', saleIntent());
    final changed = {...saleIntent(), 'paymentMethod': 'Dinheiro'};
    await expectLater(ledger.reserve(saleScope, 'same-intention', changed), throwsStateError);
    expect((await ledger.load(saleScope, 'same-intention')).payload, original.payload);
    expect(remote.sent, isEmpty);
  });
  test('ISOLATED current scope gate blocks foreign user store or project before transport', () async {
    final directory = Directory.systemTemp.createTempSync('p03a-scope-');
    final store = SqliteSaleMutationStore('${directory.path}${Platform.pathSeparator}sale.sqlite');
    addTearDown(store.close);
    final remote = SaleTestTransport();
    var active = saleScope;
    final ledger = SaleMutationLedger(store: store, transport: remote, activeScope: () async => active);
    final original = await ledger.reserve(saleScope, 'same-intention', saleIntent());
    await ledger.prepare(saleScope, 'same-intention');
    for (final foreign in [
      const SaleMutationScope(projectId: 'demo-foreign', uid: 'u', storeId: 's'),
      const SaleMutationScope(projectId: 'demo-f9-b07c', uid: 'foreign', storeId: 's'),
      const SaleMutationScope(projectId: 'demo-f9-b07c', uid: 'u', storeId: 'foreign'),
    ]) {
      active = foreign;
      await expectLater(ledger.send(saleScope, 'same-intention'), throwsStateError);
      await expectLater(ledger.recover(saleScope, 'same-intention'), throwsStateError);
    }
    active = saleScope;
    expect((await ledger.load(saleScope, 'same-intention')).payload, original.payload);
    expect(remote.sent, isEmpty);
    expect(remote.queried, isEmpty);
    // ABA/session and environment/target guards belong to the contextual layers,
    // not to this scope-only ledger. Existing coordinator/reader tests cover them.
  });
}
