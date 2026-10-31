@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'support/sale_association_cases.dart';

void main() {
  saleAssociationCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_dc_b_$name'),
  );
}
