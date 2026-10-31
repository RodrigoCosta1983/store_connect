// ignore_for_file: depend_on_referenced_packages
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'support/sales_characterization_firestore.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late SalesCharacterizationFirestore db;
  setUpAll(() async { setupFirebaseCoreMocks(); await Firebase.initializeApp(); });
  setUp(() { db = SalesCharacterizationFirestore(); FirebaseFirestorePlatform.instance = db; });
  test('ABC keeps two variants, simple history of same parent and another store distinct without writes', () async {
    Map<String, dynamic> item(String id, String name, double price, int quantity, [String? variant]) => {
      'productId': id, 'name': name, 'price': price, 'quantity': quantity,
      'variantId': ?variant,
    };
    final rows = [item('p', 'Camiseta Azul/M', 42.90, 2, 'blue-m'),
      item('p', 'Camiseta Preto/G', 39.90, 1, 'black-g'), item('p', 'Antigo simples', 10, 1)];
    db.docs['stores/a/sales/first'] = {'createdAt': Timestamp.fromMillisecondsSinceEpoch(2000000000000), 'products': rows};
    db.docs['stores/a/sales/second'] = {'products': [item('p', 'Renomeada depois', 42.90, 1, 'blue-m'),
      item('q', 'Simples', 5, 2)]};
    db.docs['stores/b/sales/foreign'] = {'products': [item('p', 'Outra loja', 999, 5, 'blue-m')]};
    final provider = SalesProvider()..updateStoreId('a');
    final result = await provider.calculateAbcAnalysis();
    expect(result, hasLength(4));
    final blue = result.singleWhere((r) => r.variantId == 'blue-m');
    expect(blue.productId, 'p'); expect(blue.productName, 'Camiseta Azul/M');
    expect(blue.totalQuantity, 3); expect(blue.totalRevenue, closeTo(128.7, 0.000001));
    expect(result.singleWhere((r) => r.variantId == 'black-g').totalRevenue, 39.9);
    expect(result.singleWhere((r) => r.productId == 'p' && r.variantId == null).totalRevenue, 10);
    expect(result.map((r) => r.totalRevenue).reduce((a, b) => a + b), closeTo(188.6, 0.000001));
    expect(result.map((r) => r.percentageOfTotal).reduce((a, b) => a + b), closeTo(100, 0.000001));
    expect(db.commits, isEmpty);
    provider.updateStoreId('b'); expect((await provider.calculateAbcAnalysis()).single.totalRevenue, 4995);
    provider.dispose();
  });
}
