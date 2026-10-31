import 'dart:io';
import 'package:sqlite3/sqlite3.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'support/checkout_intention_reader_cases.dart';

void main() {
  final directory = Directory.systemTemp.createTempSync('f9-b07dcc-c-b2-');
  String path(String name) =>
      '${directory.path}${Platform.pathSeparator}$name.sqlite';
  checkoutIntentionReaderCases(
    (name) async => SqliteSaleMutationStore(path(name)),
    deleteTemporaryEvidence: (name, key) async {
      final db = sqlite3.open(path(name));
      try {
        db.execute('DELETE FROM attempts WHERE key = ?', [key]);
      } finally {
        db.dispose();
      }
    },
  );
}
