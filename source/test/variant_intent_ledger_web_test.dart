@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/variant_intent_store_web.dart';
import 'support/variant_ledger_cases.dart';

void main() {
  variantLedgerCases((name) => IndexedDbVariantIntentStore.open(name: name));
  test('IndexedDB close/reopen acknowledges transaction commit', () async {
    final name = 'variant_restart_${DateTime.now().microsecondsSinceEpoch}';
    final a = await IndexedDbVariantIntentStore.open(name: name);
    await a.compareAndSet('variant-intents-v1:synthetic', null, 'immutable');
    await a.close();
    final b = await IndexedDbVariantIntentStore.open(name: name);
    expect(await b.read('variant-intents-v1:synthetic'), 'immutable');
    await b.close();
  });
}
