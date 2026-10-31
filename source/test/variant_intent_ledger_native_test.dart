import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/variant_intent_store_native.dart';
import 'support/variant_ledger_cases.dart';

void main() {
  final directory = Directory.systemTemp.createTempSync('f10-c4-b1-');
  variantLedgerCases(
    (name) async => SqliteVariantIntentStore(
      '${directory.path}${Platform.pathSeparator}$name.sqlite',
    ),
  );
  test(
    'SQLite close/reopen preserves durable bytes and remains separate from F9',
    () async {
      final path = '${directory.path}${Platform.pathSeparator}restart.sqlite';
      final a = SqliteVariantIntentStore(path);
      await a.compareAndSet('variant-intents-v1:synthetic', null, 'immutable');
      await a.close();
      final b = SqliteVariantIntentStore(path);
      expect(await b.read('variant-intents-v1:synthetic'), 'immutable');
      await b.close();
    },
  );
}
