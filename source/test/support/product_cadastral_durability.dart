import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store.dart';
import 'package:store_connect/services/product_cadastral_edit.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'product_cadastral_harness.dart';

class _FailBeforeLedgerPrepare implements ProductMutationStore {
  final ProductMutationStore inner;
  int writes = 0;
  _FailBeforeLedgerPrepare(this.inner);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) {
    writes++;
    if (writes == 2) {
      throw StateError('App ended after durable active-slot reservation');
    }
    return inner.compareAndSet(key, expected, value);
  }

  @override
  Future<void> close() => inner.close();
}

Future<void> verifyCadastralDurability(
  Future<ProductMutationStore> Function() open,
) async {
  final h = CadastralHarness();
  ProductMutationStore store = _FailBeforeLedgerPrepare(await open());
  ProductCadastralEditSession create() {
    final access = ProductCadastralEditAccess(
      enabled: true,
      projectId: 'demo-b04',
      ledger: ProductMutationLedger(
        store: store,
        transport: h.remote,
        activeScope: () async => h.active,
      ),
      readState: h.access().readState,
      scopeChanges: h.changes.stream,
    );
    return ProductCadastralEditSession(
      access: access,
      productId: 'p',
      storeId: 's',
      allowFiscal: true,
    );
  }

  var session = create();
  try {
    await session.open();
    session.setText('name', 'Durável');
    await session.save();
    expect(session.status, CadastralEditStatus.persistenceFailure);
    final frozen = session.frozenCommand!;
    expect(h.remote.commands, isEmpty);
    session.dispose();
    await store.close();
    store = await open();
    session = create();
    await session.open();
    expect(session.frozenCommand, frozen);
    expect(h.reads, 1);
    expect(session.status, CadastralEditStatus.unknown);
    await session.retrySameCommand();
    expect(h.remote.commands.single, frozen);
    expect(h.remote.writes, 1);
    session.dispose();
    await store.close();
    store = await open();
    session = create();
    await session.open();
    expect(session.status, CadastralEditStatus.confirmed);
    expect(session.frozenCommand, frozen);
    expect(h.remote.commands.length, 1);
    await session.reviewCurrentState();
    expect(session.draft!.changes, isEmpty);
    expect(h.reads, 2);
    expect(h.remote.writes, 1);
  } finally {
    session.dispose();
    await store.close();
    await h.close();
  }
}
