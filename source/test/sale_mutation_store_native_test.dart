import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_native.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'support/sale_ledger_cases.dart';
import 'support/sale_product_preservation.dart';

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07c-sqlite-');
  saleLedgerCases(
    (name) async => SqliteSaleMutationStore(
      '${directory.path}${Platform.pathSeparator}$name.sqlite',
    ),
  );
  test(
    'sale SQLite operations preserve product pending records byte for byte',
    () async {
      await verifySaleProductPreservation(
        SqliteProductMutationStore(
          '${directory.path}${Platform.pathSeparator}products.sqlite',
        ),
        SqliteSaleMutationStore(
          '${directory.path}${Platform.pathSeparator}sales.sqlite',
        ),
      );
    },
  );
}
