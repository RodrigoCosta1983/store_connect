import 'dart:io';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'support/checkout_coordinator_store_cases.dart';

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07dcc-c-b1-');
  checkoutCoordinatorStoreCases(
    (name) async => SqliteSaleMutationStore(
      '${directory.path}${Platform.pathSeparator}$name.sqlite',
    ),
  );
}
