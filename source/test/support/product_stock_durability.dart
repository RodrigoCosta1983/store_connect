import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store.dart';
import 'package:store_connect/services/product_stock_edit.dart';
import '../product_mutation_ledger_test.dart' show FakeTransport;
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

Future<void> verifyStockDurability(
  Future<ProductMutationStore> Function() open,
) async {
  final h = CadastralHarness();
  final remote = FakeTransport();
  ProductMutationStore store = _FailBeforeLedgerPrepare(await open());
  ProductStockEditSession create() {
    final access = ProductStockEditAccess(
      enabled: true,
      projectId: 'demo-b04',
      ledger: ProductMutationLedger(
        store: store,
        transport: remote,
        activeScope: () async => h.active,
      ),
      readState: h.access().readState,
      scopeChanges: h.changes.stream,
    );
    return ProductStockEditSession(
      access: access,
      productId: 'p',
      storeId: 's',
    );
  }

  var session = create();
  try {
    await session.open();
    session.manual('entry', 2, 'Reposição durável');
    await session.confirm();
    expect(session.status, StockEditStatus.persistenceFailure);
    final frozen = session.frozenCommand!;
    expect(remote.sent, isEmpty);
    session.dispose();
    await store.close();
    store = await open();
    session = create();
    await session.open();
    expect(session.frozenCommand, frozen);
    expect(h.reads, 1);
    expect(session.status, StockEditStatus.unknown);
    await session.retrySameCommand();
    expect(remote.sent.single, frozen);
    expect(remote.sent.length, 1);
    session.dispose();
    await store.close();
    store = await open();
    session = create();
    await session.open();
    expect(session.status, StockEditStatus.confirmed);
    expect(session.frozenCommand, frozen);
    expect(remote.sent.length, 1);
    await session.reviewCurrentState();
    expect(session.draft!.change, null);
    expect(h.reads, 2);
    expect(remote.sent.length, 1);
  } finally {
    session.dispose();
    await store.close();
    await h.close();
  }
}
