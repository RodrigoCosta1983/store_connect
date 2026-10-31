import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_mutation_api.dart';

Map<String, dynamic> dto() => {
  'schemaVersion': 1,
  'productId': 'p',
  'uid': 'u',
  'storeId': 's',
  'expectedUpdateTime': {'seconds': '1791970000', 'nanoseconds': 123456000},
  'product': {
    'name': 'Original',
    'barcode': null,
    'lotes': [
      {
        'index': 0,
        'quantidade': 0,
        'validade': {'seconds': '1893456000', 'nanoseconds': 123456000},
      },
    ],
  },
  'unavailable': <String>[],
};
void main() {
  test(
    'DTO token is required and baseline/lot precision are detached from UI',
    () {
      final raw = dto();
      final state = ProductEditState.fromJson(raw);
      raw['product']['name'] = 'Changed';
      state.product['lotes'][0]['index'] = 9;
      state.expectedUpdateTime['nanoseconds'] = 0;
      expect(state.product['name'], 'Original');
      expect(state.product['lotes'][0]['index'], 0);
      expect(state.product['lotes'][0]['validade']['nanoseconds'], 123456000);
      expect(state.expectedUpdateTime['nanoseconds'], 123456000);
      expect(state.product.containsKey('costPrice'), false);
      expect(state.product['barcode'], null);
    },
  );
  test('null/missing token cannot use updatedAt or local DateTime', () {
    for (final value in [null, <String, dynamic>{}, DateTime.now()]) {
      final raw = dto();
      raw['expectedUpdateTime'] = value;
      raw['product']['updatedAt'] = 1791970000000;
      expect(() => ProductEditState.fromJson(raw), throwsFormatException);
    }
    final raw = dto()..remove('expectedUpdateTime');
    expect(() => ProductEditState.fromJson(raw), throwsFormatException);
  });
}
