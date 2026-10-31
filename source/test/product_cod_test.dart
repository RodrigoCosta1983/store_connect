// SDK interfaces are implemented only by isolated test doubles; no SDK subtype
// is used in production or connected to a Firebase application.
// ignore_for_file: subtype_of_sealed_class

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/services/product_cod_service.dart';

class _Firestore extends Fake implements FirebaseFirestore {
  final Map<String, Map<String, dynamic>> documents = {};
  String? queriedPath;
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) =>
      _Collection(this, path);
}

class _Collection extends Fake
    implements CollectionReference<Map<String, dynamic>> {
  final _Firestore db;
  final String pathValue;
  _Collection(this.db, this.pathValue);
  @override
  DocumentReference<Map<String, dynamic>> doc([String? path]) =>
      _Document(db, '$pathValue/$path');
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.memberName == #where) {
      expect(invocation.positionalArguments.single, 'cod');
      db.queriedPath = pathValue;
      return _Query(
        db,
        pathValue,
        invocation.namedArguments[#isEqualTo] as String,
      );
    }
    return super.noSuchMethod(invocation);
  }
}

class _Document extends Fake
    implements DocumentReference<Map<String, dynamic>> {
  final _Firestore db;
  final String pathValue;
  _Document(this.db, this.pathValue);
  @override
  CollectionReference<Map<String, dynamic>> collection(String path) =>
      _Collection(db, '$pathValue/$path');
}

class _Query extends Fake implements Query<Map<String, dynamic>> {
  final _Firestore db;
  final String pathValue;
  final String cod;
  _Query(this.db, this.pathValue, this.cod);
  @override
  Future<QuerySnapshot<Map<String, dynamic>>> get([
    GetOptions? options,
  ]) async => _Snapshot(
    db.documents.entries
        .where(
          (entry) =>
              entry.key.startsWith('$pathValue/') && entry.value['cod'] == cod,
        )
        .map((entry) => _QueryDoc(entry.key.split('/').last))
        .toList(),
  );
}

class _Snapshot extends Fake implements QuerySnapshot<Map<String, dynamic>> {
  @override
  final List<QueryDocumentSnapshot<Map<String, dynamic>>> docs;
  _Snapshot(this.docs);
}

class _QueryDoc extends Fake
    implements QueryDocumentSnapshot<Map<String, dynamic>> {
  @override
  final String id;
  _QueryDoc(this.id);
}

void main() {
  test('legacy product without COD and optional empty COD', () {
    expect(
      Product.fromMap('old', {'name': 'Algodão', 'price': 10}).cod,
      isNull,
    );
    expect(normalizeProductCod(null), '');
    expect(normalizeProductCod('  '), '');
    expect(validateProductCod(''), isNull);
  });
  test('COD trim, uppercase and maximum length without format restriction', () {
    expect(normalizeProductCod(' ca-0001-p-pt '), 'CA-0001-P-PT');
    expect(validateProductCod('a' * 40), isNull);
    expect(
      validateProductCod('a' * 41),
      'O COD deve ter no máximo 40 caracteres.',
    );
    expect(validateProductCod('loja / item 01'), isNull);
    expect(
      Product.fromMap('new', {'price': 1, 'cod': 'LC-0001'}).cod,
      'LC-0001',
    );
  });
  test('duplicate in same store, own document and separate stores', () async {
    final db = _Firestore();
    db.documents['stores/a/products/p1'] = {'cod': 'LC-0001'};
    final service = ProductCodService(db);
    expect(await service.isInUse('a', ' lc-0001 '), isTrue);
    expect(db.queriedPath, 'stores/a/products');
    expect(await service.isInUse('a', 'lc-0001', excludingId: 'p1'), isFalse);
    expect(await service.isInUse('b', 'LC-0001'), isFalse);
    expect(db.queriedPath, 'stores/b/products');
    db.documents['stores/a/products/p2'] = {'cod': 'LC-0001'};
    expect(await service.isInUse('a', 'LC-0001', excludingId: 'p1'), isTrue);
  });
  test('empty COD skips uniqueness query', () async {
    final db = _Firestore();
    expect(await ProductCodService(db).isInUse('a', '  '), isFalse);
    expect(db.queriedPath, isNull);
  });
  test('search by name, legacy name and COD ignores case', () {
    final product = {
      'name': 'Algodão',
      'name_lowercase': 'algodão',
      'cod': 'ALG-0001',
    };
    expect(matchesProductSearch(product, ' ALG-0001 '), isTrue);
    expect(matchesProductSearch(product, 'alg-'), isTrue);
    expect(matchesProductSearch(product, 'GODÃO'), isTrue);
    expect(matchesProductSearch({'name': 'Legado'}, 'lega'), isTrue);
    expect(matchesProductSearch(product, 'outro'), isFalse);
    expect(matchesProductSearch(product, ''), isTrue);
  });
}
