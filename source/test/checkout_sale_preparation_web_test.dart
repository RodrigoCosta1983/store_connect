@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'support/checkout_sale_preparation_cases.dart';

void main() {
  checkoutPreparationCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_b07d_a_$name'),
  );
}
