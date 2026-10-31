@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_web.dart';
import 'support/product_stock_durability.dart';

void main() {
  test(
    'IndexedDB restores the same B05 intent after closing between slot and ledger commits',
    () async {
      final name = 'f9_b05_${DateTime.now().microsecondsSinceEpoch}';
      await verifyStockDurability(
        () => IndexedDbProductMutationStore.open(name: name),
      );
    },
  );
}
