@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_web.dart';
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'support/sale_ledger_cases.dart';
import 'support/sale_product_preservation.dart';

void main() {
  saleLedgerCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_b07c_$name'),
  );
  test(
    'sale IndexedDB operations preserve product pending records byte for byte',
    () async {
      final suffix = DateTime.now().microsecondsSinceEpoch;
      await verifySaleProductPreservation(
        await IndexedDbProductMutationStore.open(
          name: 'f9_b07c_products_$suffix',
        ),
        await IndexedDbSaleMutationStore.open(name: 'f9_b07c_sales_$suffix'),
      );
    },
  );
}
