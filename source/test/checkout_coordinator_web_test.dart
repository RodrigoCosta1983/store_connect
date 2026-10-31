@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'support/checkout_coordinator_store_cases.dart';

void main() {
  checkoutCoordinatorStoreCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_dc_c_c_b1_$name'),
  );
}
