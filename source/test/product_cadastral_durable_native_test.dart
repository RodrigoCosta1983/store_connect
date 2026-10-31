import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/product_mutation_store_native.dart';
import 'support/product_cadastral_durability.dart';

void main() {
  test(
    'SQLite restores the same B04 intent after crash between slot and ledger commits',
    () async {
      final directory = await Directory.systemTemp.createTemp('f9-b04-ledger-');
      final path = '${directory.path}${Platform.pathSeparator}b04.sqlite';
      await verifyCadastralDurability(
        () async => SqliteProductMutationStore(path),
      );
    },
  );
}
