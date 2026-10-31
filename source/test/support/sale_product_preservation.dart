import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import '../product_mutation_ledger_test.dart' as product;
import 'sale_ledger_cases.dart';

Future<void> verifySaleProductPreservation(
  ProductMutationStore products,
  SaleMutationStore sales,
) async {
  try {
    final productLedger = ProductMutationLedger(
      store: products,
      transport: product.FakeTransport(),
      activeScope: () async => product.scope,
    );
    final pending = await productLedger.prepare(
      product.scope,
      product.operation,
      product.command(),
    );
    final keys = await products.keys('');
    final before = {for (final key in keys) key: await products.read(key)};
    final saleLedger = SaleMutationLedger(
      store: sales,
      transport: SaleTestTransport(),
      activeScope: () async => saleScope,
    );
    await saleLedger.reserve(saleScope, 'intent', saleIntent());
    await saleLedger.prepare(saleScope, 'intent');
    await saleLedger.send(saleScope, 'intent');
    await saleLedger.reopen(saleScope);
    expect(await products.keys(''), keys);
    expect({for (final key in keys) key: await products.read(key)}, before);
    expect(
      (await productLedger.load(
        product.scope,
        product.operation,
        pending.requestId,
      )).state,
      ProductAttemptState.persisted,
    );
  } finally {
    await sales.close();
    await products.close();
  }
}
