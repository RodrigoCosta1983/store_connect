import 'dart:io';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/variant_intent_store.dart';
import 'package:store_connect/data/local/variant_intent_store_native.dart';
import 'package:store_connect/services/variant_product_registration.dart';
import 'package:store_connect/services/product_variants_form_draft.dart';

class FailedWrite implements VariantIntentStore {
  final VariantIntentStore delegate;
  FailedWrite(this.delegate);
  @override Future<String?> read(String key) => delegate.read(key);
  @override Future<List<String>> keys(String prefix) => delegate.keys(prefix);
  @override Future<bool> compareAndSet(String key, String? expected, String value) async =>
    throw const FileSystemException('Injected durable write failure');
  @override Future<void> close() => delegate.close();
}
void main() {
  const scope = {'projectId': 'demo-f10', 'uid': 'u', 'storeId': 's'};
  Map<String, dynamic> command() => {'scope': scope, 'requestId': 'r', 'productId': 'p',
    'product': {'name': 'Camiseta'}, 'variants': [{'variantId': 'v'}]};
  test('durable write failure prevents network and leaves no prepared command', () async {
    final directory = Directory.systemTemp.createTempSync('f10-disk-failure-');
    final store = FailedWrite(SqliteVariantIntentStore('${directory.path}/intent.sqlite'));
    var calls = 0;
    final access = VariantProductRegistration(store: store, scope: scope, currentScope: () async => scope,
      call: (endpoint, data) async { calls++; return {}; });
    try {
      await expectLater(access.prepare(command()), throwsA(isA<FileSystemException>()));
      await expectLater(access.synchronize(), throwsStateError);
      expect(calls, 0); expect(await access.pending(), null);
    } finally { await access.close(); directory.deleteSync(recursive: true); }
  });
  test('invalid receipt query cannot be discarded as a rejected create', () async {
    final directory = Directory.systemTemp.createTempSync('f10-query-');
    final access = VariantProductRegistration(store: SqliteVariantIntentStore('${directory.path}/intent.sqlite'),
      scope: scope, currentScope: () async => scope, call: (endpoint, data) async =>
        throw FirebaseFunctionsException(code: 'failed-precondition', message: 'invalid receipt'));
    try {
      await access.prepare(command());
      await expectLater(access.synchronize(), throwsA(isA<FirebaseFunctionsException>()));
      expect((await access.pending())!['status'], 'unknown');
      await expectLater(access.abandonRejected(), throwsStateError);
    } finally { await access.close(); directory.deleteSync(recursive: true); }
  });
  test('base/variant cents are exact and commercial drafts cannot mutate', () {
    expect(variantMoneyCents('39,90'), 3990);
    expect(() => variantMoneyCents('1.005'), throwsFormatException);
    final draft = ProductVariantsFormDraft()..setEnabled(true)..addAttribute('Cor', 'Azul');
    draft.apply({'attribute-1': 'attribute-1-value-1'}, '', 'AZ', quantity: 4, priceCents: 4990);
    final entry = draft.entries.single;
    expect(entry.initialStock['quantity'], 4);
    expect(() => (entry.commercial['priceCents'] as Map)['value'] = 1, throwsUnsupportedError);
    expect(() => draft.apply({'attribute-1': 'attribute-1-value-1'}, '', '', quantity: -1), throwsFormatException);
    draft.dispose();
  });
}
