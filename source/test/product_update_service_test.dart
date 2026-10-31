import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_update_service.dart';

void main() {
  test(
    'update wire payload retains COD, converts dates and excludes derived fields',
    () {
      final date = DateTime.utc(2030);
      final data = <String, dynamic>{
        'name': 'Produto',
        'name_lowercase': 'produto',
        'cod': 'CA-0001',
        'price': 10.0,
        'quantidade': 2,
        'minimumStock': 0,
        'imageUrl': '',
        'lotes': [
          {'quantidade': 2, 'validade': Timestamp.fromDate(date)},
        ],
        'fiscal': {'ncm': '12345678', 'updatedAt': Timestamp.fromDate(date)},
      };
      final payload = buildProductUpdatePayload(
        productId: 'p1',
        requestId: 'r1',
        data: data,
      );
      expect(payload['productId'], 'p1');
      expect(payload['requestId'], 'r1');
      final product = payload['product'] as Map;
      expect(product['cod'], 'CA-0001');
      expect(product.containsKey('name_lowercase'), isFalse);
      expect(product['lotes'], [
        {'quantidade': 2, 'validadeMs': date.millisecondsSinceEpoch},
      ]);
      expect(product['fiscal'], {'ncm': '12345678'});
      expect((data['fiscal'] as Map).containsKey('updatedAt'), isTrue);
      expect(data.containsKey('name_lowercase'), isTrue);
    },
  );
  test('explicit empty COD survives wire payload to release reservation', () {
    final payload = buildProductUpdatePayload(
      productId: 'p',
      requestId: 'r',
      data: {'cod': '', 'lotes': []},
    );
    expect((payload['product'] as Map)['cod'], '');
  });
  test('DateTime lots supported and omitted COD stays omitted', () {
    final date = DateTime.utc(2030);
    final payload = buildProductUpdatePayload(
      productId: 'p',
      requestId: 'r',
      data: {
        'lotes': [
          {'quantidade': 1, 'validade': date},
        ],
      },
    );
    final product = payload['product'] as Map;
    expect(product.containsKey('cod'), isFalse);
    expect(
      (product['lotes'] as List).single['validadeMs'],
      date.millisecondsSinceEpoch,
    );
  });
}
