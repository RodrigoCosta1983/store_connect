import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_native.dart';
import 'support/product_stock_durability.dart';

void main() {
  test(
    'SQLite restores the same B05 intent after crash between slot and ledger commits',
    () async {
      final directory = await Directory.systemTemp.createTemp('f9-b05-ledger-');
      final path = '${directory.path}${Platform.pathSeparator}b05.sqlite';
      await verifyStockDurability(() async => SqliteProductMutationStore(path));
    },
  );
}
