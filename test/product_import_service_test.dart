import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

// Dependencia transitiva oficial do cloud_firestore usada apenas no harness.
// ignore: depend_on_referenced_packages
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';

// Tipo interno necessario apenas para fabricar snapshots no fake local.
// ignore: depend_on_referenced_packages, implementation_imports
import 'package:cloud_firestore_platform_interface/src/pigeon/messages.pigeon.dart'
    show InternalSnapshotMetadata;

import 'package:firebase_core/firebase_core.dart';

// Helper oficial de teste do Firebase Core ja presente no projeto.
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/models/product_import_item.dart';
import 'package:store_connect/services/product_import_service.dart';

class _FakeFirebaseFirestorePlatform extends FirebaseFirestorePlatform {
  _FakeFirebaseFirestorePlatform({
    FirebaseApp? app,
    String databaseId = '(default)',
  }) : super(appInstance: app, databaseChoice: databaseId);

  final Map<String, Map<String, Object?>> _documents =
      <String, Map<String, Object?>>{};

  int _generatedId = 0;

  void reset() {
    _documents.clear();
    _generatedId = 0;
  }

  void seedDocument(String path, Map<String, Object?> data) {
    _documents[path] = Map<String, Object?>.from(data);
  }

  String nextGeneratedId() {
    _generatedId++;
    return 'generated-request-id-$_generatedId';
  }

  List<DocumentSnapshotPlatform> documentsForCollection(String collectionPath) {
    final prefix = '$collectionPath/';

    final docs = <DocumentSnapshotPlatform>[];

    for (final entry in _documents.entries) {
      if (!entry.key.startsWith(prefix)) {
        continue;
      }

      final remainder = entry.key.substring(prefix.length);

      if (remainder.isEmpty || remainder.contains('/')) {
        continue;
      }

      docs.add(
        DocumentSnapshotPlatform(
          this,
          entry.key,
          Map<String?, Object?>.from(entry.value),
          InternalSnapshotMetadata(hasPendingWrites: false, isFromCache: false),
        ),
      );
    }

    return docs;
  }

  @override
  FirebaseFirestorePlatform delegateFor({
    required FirebaseApp app,
    required String databaseId,
  }) {
    return this;
  }

  @override
  CollectionReferencePlatform collection(String collectionPath) {
    return _FakeCollectionReferencePlatform(this, collectionPath);
  }

  @override
  DocumentReferencePlatform doc(String documentPath) {
    return _FakeDocumentReferencePlatform(this, documentPath);
  }
}

class _FakeCollectionReferencePlatform extends CollectionReferencePlatform {
  _FakeCollectionReferencePlatform(this.fakeFirestore, String path)
    : super(fakeFirestore, path);

  final _FakeFirebaseFirestorePlatform fakeFirestore;

  @override
  DocumentReferencePlatform doc([String? path]) {
    final documentId = path ?? fakeFirestore.nextGeneratedId();

    return _FakeDocumentReferencePlatform(
      firestore,
      '${this.path}/$documentId',
    );
  }

  @override
  Future<QuerySnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async {
    return QuerySnapshotPlatform(
      fakeFirestore.documentsForCollection(path),
      <DocumentChangePlatform>[],
      SnapshotMetadataPlatform(false, false),
    );
  }
}

class _FakeDocumentReferencePlatform extends DocumentReferencePlatform {
  _FakeDocumentReferencePlatform(
    FirebaseFirestorePlatform firestore,
    String path,
  ) : super(firestore, path);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const functionsChannel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );

  late _FakeFirebaseFirestorePlatform fakeFirestore;

  final functionCalls = <Map<String, dynamic>>[];

  late Future<List<Object?>> Function(Map<String, dynamic>) upsertCategory;
  late Future<List<Object?>> Function(Map<String, dynamic>) createProduct;

  setUpAll(() async {
    setupFirebaseCoreMocks();

    await Firebase.initializeApp();

    fakeFirestore = _FakeFirebaseFirestorePlatform(app: Firebase.app());

    FirebaseFirestorePlatform.instance = fakeFirestore;
  });

  setUp(() {
    fakeFirestore.reset();
    functionCalls.clear();

    upsertCategory = (parameters) async {
      fail('S1-A nao deve chamar upsertCategory para categorias existentes.');
    };

    createProduct = (parameters) async {
      final callNumber = functionCalls
          .where((call) => call['functionName'] == 'createProduct')
          .length;

      return [
        {'success': true, 'productId': 'product-$callNumber'},
      ];
    };

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(functionsChannel, (
          message,
        ) async {
          final args = Map<String, dynamic>.from(
            (message as List).single as Map,
          );

          functionCalls.add(args);

          final functionName = args['functionName'];

          if (functionName == 'createProduct') {
            final parameters = Map<String, dynamic>.from(
              args['parameters'] as Map,
            );

            return createProduct(parameters);
          }

          if (functionName == 'upsertCategory') {
            final parameters = Map<String, dynamic>.from(
              args['parameters'] as Map,
            );

            return upsertCategory(parameters);
          }

          fail('Callable inesperada no S1-A: $functionName');
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(functionsChannel, null);
  });

  test(
    'T6-A4-A1 harness: analyze aceita Firestore fake com colecoes vazias',
    () async {
      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      final analysis = await service.analyze(
        storeId: 'store-t6-a4-a1',
        products: const [],
      );

      expect(analysis.newProducts, isEmpty);
    },
  );

  test(
    'S1-A: categorias existentes geram [], [raiz] e [raiz, filha] sem upsert',
    () async {
      const storeId = 'store-s1-a';

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/root-a',
        <String, Object?>{'name': 'Bebidas', 'parentCategoryId': null},
      );

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/child-a',
        <String, Object?>{
          'name': 'Refrigerantes',
          'parentCategoryId': 'root-a',
        },
      );

      const products = <ProductImportItem>[
        ProductImportItem(
          sourceRow: 2,
          name: 'Produto sem categoria',
          price: 10.50,
          quantity: 2.4,
          category: '',
          subcategory: '',
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
        ProductImportItem(
          sourceRow: 3,
          name: 'Agua Mineral',
          price: 5.00,
          quantity: 3,
          category: ' Bebidas ',
          subcategory: '',
          barcode: '7890001',
          costPrice: 2.50,
          ncm: '22011000',
        ),
        ProductImportItem(
          sourceRow: 4,
          name: 'Refrigerante Cola',
          price: 8.75,
          quantity: 4.6,
          category: 'BEBIDAS',
          subcategory: ' refrigerantes ',
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
      ];

      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      final result = await service.importProducts(
        storeId: storeId,
        isBusiness: true,
        products: products,
      );

      expect(result.importedProducts, 3);
      expect(result.createdCategories, 0);
      expect(result.skippedDuplicates, 0);

      final upsertCalls = functionCalls
          .where((call) => call['functionName'] == 'upsertCategory')
          .toList();

      expect(upsertCalls, isEmpty);

      final createProductCalls = functionCalls
          .where((call) => call['functionName'] == 'createProduct')
          .toList();

      expect(createProductCalls, hasLength(3));

      final firstParameters = Map<String, dynamic>.from(
        createProductCalls[0]['parameters'] as Map,
      );

      final secondParameters = Map<String, dynamic>.from(
        createProductCalls[1]['parameters'] as Map,
      );

      final thirdParameters = Map<String, dynamic>.from(
        createProductCalls[2]['parameters'] as Map,
      );

      expect(firstParameters, {
        'requestId': 'generated-request-id-1',
        'product': {
          'name': 'Produto sem categoria',
          'price': 10.50,
          'quantidade': 2,
          'lotes': <Map<String, dynamic>>[],
          'minimumStock': 0,
          'imageUrl': '',
        },
        'categoryIds': <String>[],
      });

      expect(secondParameters, {
        'requestId': 'generated-request-id-2',
        'product': {
          'name': 'Agua Mineral',
          'price': 5.00,
          'quantidade': 3,
          'lotes': <Map<String, dynamic>>[],
          'minimumStock': 0,
          'imageUrl': '',
          'barcode': '7890001',
          'costPrice': 2.50,
          'fiscal': {'ncm': '22011000'},
        },
        'categoryIds': <String>['root-a'],
      });

      expect(thirdParameters, {
        'requestId': 'generated-request-id-3',
        'product': {
          'name': 'Refrigerante Cola',
          'price': 8.75,
          'quantidade': 5,
          'lotes': <Map<String, dynamic>>[],
          'minimumStock': 0,
          'imageUrl': '',
        },
        'categoryIds': <String>['root-a', 'child-a'],
      });
    },
  );

  test('S2-A: raiz ausente e criada antes do produto', () async {
    const storeId = 'store-s2-root';

    var upsertCount = 0;

    upsertCategory = (parameters) async {
      upsertCount++;

      expect(parameters, {
        'name': 'Bebidas',
        'imageUrl': '',
        'parentCategoryId': null,
      });

      return [
        {
          'success': true,
          'mode': 'create',
          'categoryId': 'root-new',
          'parentCategoryId': null,
          'changed': true,
        },
      ];
    };

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Agua sem gas',
        price: 4.50,
        quantity: 3,
        category: 'Bebidas',
        subcategory: '',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(upsertCount, 1);
    expect(result.importedProducts, 1);
    expect(result.createdCategories, 1);
    expect(result.skippedDuplicates, 0);

    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'upsertCategory',
      'createProduct',
    ]);

    final createCall = functionCalls.singleWhere(
      (call) => call['functionName'] == 'createProduct',
    );

    final parameters = Map<String, dynamic>.from(
      createCall['parameters'] as Map,
    );

    expect(parameters['categoryIds'], ['root-new']);

    expect(parameters['product'], {
      'name': 'Agua sem gas',
      'price': 4.50,
      'quantidade': 3,
      'lotes': <Map<String, dynamic>>[],
      'minimumStock': 0,
      'imageUrl': '',
    });
  });

  test('S2-A: filha ausente e criada sob raiz existente', () async {
    const storeId = 'store-s2-child';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-a',
      <String, Object?>{'name': 'Bebidas', 'parentCategoryId': null},
    );

    var upsertCount = 0;

    upsertCategory = (parameters) async {
      upsertCount++;

      expect(parameters, {
        'name': 'Refrigerantes',
        'imageUrl': '',
        'parentCategoryId': 'root-a',
      });

      return [
        {
          'success': true,
          'mode': 'create',
          'categoryId': 'child-new',
          'parentCategoryId': 'root-a',
          'changed': true,
        },
      ];
    };

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Cola 2L',
        price: 9.90,
        quantity: 2,
        category: 'Bebidas',
        subcategory: 'Refrigerantes',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(upsertCount, 1);
    expect(result.importedProducts, 1);
    expect(result.createdCategories, 1);
    expect(result.skippedDuplicates, 0);

    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'upsertCategory',
      'createProduct',
    ]);

    final createCall = functionCalls.singleWhere(
      (call) => call['functionName'] == 'createProduct',
    );

    final parameters = Map<String, dynamic>.from(
      createCall['parameters'] as Map,
    );

    expect(parameters['categoryIds'], ['root-a', 'child-new']);
  });

  test(
    'S2-A: raiz e filha ausentes sao criadas em ordem hierarquica',
    () async {
      const storeId = 'store-s2-both';

      var upsertCount = 0;

      upsertCategory = (parameters) async {
        upsertCount++;

        if (upsertCount == 1) {
          expect(parameters, {
            'name': 'Alimentos',
            'imageUrl': '',
            'parentCategoryId': null,
          });

          return [
            {
              'success': true,
              'mode': 'create',
              'categoryId': 'root-new',
              'parentCategoryId': null,
              'changed': true,
            },
          ];
        }

        if (upsertCount == 2) {
          expect(parameters, {
            'name': 'Biscoitos',
            'imageUrl': '',
            'parentCategoryId': 'root-new',
          });

          return [
            {
              'success': true,
              'mode': 'create',
              'categoryId': 'child-new',
              'parentCategoryId': 'root-new',
              'changed': true,
            },
          ];
        }

        fail('Quantidade inesperada de chamadas a upsertCategory.');
      };

      const products = <ProductImportItem>[
        ProductImportItem(
          sourceRow: 2,
          name: 'Biscoito Integral',
          price: 7.25,
          quantity: 4,
          category: 'Alimentos',
          subcategory: 'Biscoitos',
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
      ];

      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      final result = await service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      );

      expect(upsertCount, 2);
      expect(result.importedProducts, 1);
      expect(result.createdCategories, 2);
      expect(result.skippedDuplicates, 0);

      expect(functionCalls.map((call) => call['functionName']).toList(), [
        'upsertCategory',
        'upsertCategory',
        'createProduct',
      ]);

      final firstUpsert = Map<String, dynamic>.from(
        functionCalls[0]['parameters'] as Map,
      );

      final secondUpsert = Map<String, dynamic>.from(
        functionCalls[1]['parameters'] as Map,
      );

      expect(firstUpsert, {
        'name': 'Alimentos',
        'imageUrl': '',
        'parentCategoryId': null,
      });

      expect(secondUpsert, {
        'name': 'Biscoitos',
        'imageUrl': '',
        'parentCategoryId': 'root-new',
      });

      final createParameters = Map<String, dynamic>.from(
        functionCalls[2]['parameters'] as Map,
      );

      expect(createParameters['categoryIds'], ['root-new', 'child-new']);

      expect(createParameters['requestId'], 'generated-request-id-1');
    },
  );

  test('S3-A: filhas homonimas respeitam a raiz e trim/case', () async {
    const storeId = 'store-s3-homonimas';

    for (final root in ['feminino', 'masculino']) {
      fakeFirestore.seedDocument(
        'stores/$storeId/categories/root-$root',
        <String, Object?>{'name': root, 'parentCategoryId': null},
      );
      fakeFirestore.seedDocument(
        'stores/$storeId/categories/child-promo-$root',
        <String, Object?>{'name': 'Promoção', 'parentCategoryId': 'root-$root'},
      );
    }

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Vestido promocional',
        price: 30,
        quantity: 1,
        category: ' FEMININO ',
        subcategory: ' promoção ',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
      ProductImportItem(
        sourceRow: 3,
        name: 'Camisa promocional',
        price: 20,
        quantity: 2,
        category: ' Masculino ',
        subcategory: ' PROMOÇÃO ',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.categoryResolutions, hasLength(2));
    expect(functionCalls, isEmpty);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.importedProducts, 2);
    expect(result.createdCategories, 0);
    expect(result.skippedDuplicates, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
      'createProduct',
    ]);

    for (var i = 0; i < products.length; i++) {
      final root = i == 0 ? 'feminino' : 'masculino';
      final resolution = analysis.categoryResolutions[products[i]]!;
      expect(resolution.categoryId, 'root-$root');
      expect(resolution.subcategoryId, 'child-promo-$root');

      final parameters = Map<String, dynamic>.from(
        functionCalls[i]['parameters'] as Map,
      );
      expect(parameters['categoryIds'], ['root-$root', 'child-promo-$root']);
      expect((parameters['product'] as Map)['name'], products[i].name);
    }
  });

  test('S4-A: mesmo par raiz e filha e reaproveitado com trim/case', () async {
    const storeId = 'store-s4-reuso';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-feminino',
      <String, Object?>{'name': 'Feminino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-promo-feminino',
      <String, Object?>{
        'name': 'Promoção',
        'parentCategoryId': 'root-feminino',
      },
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Vestido promocional',
        price: 30,
        quantity: 1,
        category: 'Feminino',
        subcategory: 'Promoção',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
      ProductImportItem(
        sourceRow: 3,
        name: 'Blusa promocional',
        price: 20,
        quantity: 1,
        category: ' FEMININO ',
        subcategory: ' promoção ',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
      ProductImportItem(
        sourceRow: 4,
        name: 'Saia promocional',
        price: 25,
        quantity: 1,
        category: 'feminino',
        subcategory: 'PROMOÇÃO',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
      ProductImportItem(
        sourceRow: 5,
        name: 'Calca sem subcategoria',
        price: 40,
        quantity: 1,
        category: 'Feminino',
        subcategory: '',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.categoryResolutions, hasLength(4));
    expect(functionCalls, isEmpty);
    for (var i = 0; i < products.length; i++) {
      final resolution = analysis.categoryResolutions[products[i]]!;
      expect(resolution.categoryId, 'root-feminino');
      expect(resolution.subcategoryId, i < 3 ? 'child-promo-feminino' : isNull);
    }

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.createdCategories, 0);
    expect(result.importedProducts, 4);
    expect(result.skippedDuplicates, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
      'createProduct',
      'createProduct',
      'createProduct',
    ]);

    for (var i = 0; i < products.length; i++) {
      final parameters = Map<String, dynamic>.from(
        functionCalls[i]['parameters'] as Map,
      );
      expect(parameters['categoryIds'], [
        'root-feminino',
        if (i < 3) 'child-promo-feminino',
      ]);
      expect((parameters['product'] as Map)['name'], products[i].name);
    }
  });

  test('S4-A: filha homonima de outra raiz exige nova filha', () async {
    const storeId = 'store-s4-outra-raiz';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-feminino',
      <String, Object?>{'name': 'Feminino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-masculino',
      <String, Object?>{'name': 'Masculino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-promo-masculino',
      <String, Object?>{
        'name': 'Promoção',
        'parentCategoryId': 'root-masculino',
      },
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Vestido com nova promocao',
        price: 30,
        quantity: 1,
        category: 'Feminino',
        subcategory: 'Promoção',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.categoryResolutions, hasLength(1));
    final resolution = analysis.categoryResolutions[products.single]!;
    expect(resolution.categoryId, 'root-feminino');
    expect(resolution.subcategoryId, isNull);
    expect(resolution.subcategoryId, isNot('child-promo-masculino'));
    expect(functionCalls, isEmpty);

    upsertCategory = (parameters) async {
      expect(parameters, {
        'name': 'Promoção',
        'imageUrl': '',
        'parentCategoryId': 'root-feminino',
      });

      return [
        {
          'success': true,
          'mode': 'create',
          'categoryId': 'child-promo-feminino-new',
          'parentCategoryId': 'root-feminino',
          'changed': true,
        },
      ];
    };

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.createdCategories, 1);
    expect(result.importedProducts, 1);
    expect(result.skippedDuplicates, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'upsertCategory',
      'createProduct',
    ]);

    final parameters = Map<String, dynamic>.from(
      functionCalls[1]['parameters'] as Map,
    );
    expect(parameters['categoryIds'], [
      'root-feminino',
      'child-promo-feminino-new',
    ]);
    expect(parameters.toString(), isNot(contains('child-promo-masculino')));
    expect((parameters['product'] as Map)['name'], products.single.name);
  });

  test('S3-A: raiz legacy omite parentCategoryId', () async {
    const storeId = 'store-s3-legacy';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/id-legacy',
      <String, Object?>{'name': 'Livros'},
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Livro legacy',
        price: 15,
        quantity: 1,
        category: 'Livros',
        subcategory: '',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.newProducts, products);
    expect(analysis.categoryResolutions, hasLength(1));
    final resolution = analysis.categoryResolutions[products.single]!;
    expect(resolution.categoryId, 'id-legacy');
    expect(resolution.subcategoryId, isNull);
    expect(functionCalls, isEmpty);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.importedProducts, 1);
    expect(result.createdCategories, 0);
    expect(result.skippedDuplicates, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
    ]);
    final parameters = Map<String, dynamic>.from(
      functionCalls.single['parameters'] as Map,
    );
    expect(parameters['categoryIds'], ['id-legacy']);
    expect((parameters['product'] as Map)['name'], 'Livro legacy');
  });

  test('S3-A: raizes ambiguas falham antes de qualquer callable', () async {
    const storeId = 'store-s3-raizes-ambiguas';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-a',
      <String, Object?>{'name': 'Feminino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-b',
      <String, Object?>{'name': ' FEMININO ', 'parentCategoryId': null},
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto novo com raiz ambigua',
        price: 10,
        quantity: 1,
        category: 'Feminino',
        subcategory: '',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final ambiguity = allOf(
      isA<StateError>().having(
        (error) => error.message,
        'message',
        'Categoria raiz ambigua na importacao: "Feminino".',
      ),
      isNot(isA<ProductImportException>()),
    );

    await expectLater(
      service.analyze(storeId: storeId, products: products),
      throwsA(ambiguity),
    );
    expect(functionCalls, isEmpty);

    await expectLater(
      service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      ),
      throwsA(ambiguity),
    );
    expect(functionCalls, isEmpty);
  });

  test('S3-A: filhas ambiguas falham antes de qualquer callable', () async {
    const storeId = 'store-s3-filhas-ambiguas';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-feminino',
      <String, Object?>{'name': 'Feminino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-a',
      <String, Object?>{
        'name': 'Promoção',
        'parentCategoryId': 'root-feminino',
      },
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-b',
      <String, Object?>{
        'name': ' PROMOÇÃO ',
        'parentCategoryId': 'root-feminino',
      },
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto novo com filha ambigua',
        price: 12,
        quantity: 1,
        category: 'Feminino',
        subcategory: 'Promoção',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final ambiguity = allOf(
      isA<StateError>().having(
        (error) => error.message,
        'message',
        'Subcategoria ambigua na importacao: "Promoção" em "Feminino".',
      ),
      isNot(isA<ProductImportException>()),
    );

    await expectLater(
      service.analyze(storeId: storeId, products: products),
      throwsA(ambiguity),
    );
    expect(functionCalls, isEmpty);

    await expectLater(
      service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      ),
      throwsA(ambiguity),
    );
    expect(functionCalls, isEmpty);
  });

  test('S5-A2: categorias sem nome sao ignoradas antes do pai', () async {
    const storeId = 'store-s5-sem-nome';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-valid',
      <String, Object?>{'name': 'Alimentos', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-valid',
      <String, Object?>{'name': 'Biscoitos', 'parentCategoryId': 'root-valid'},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/invalid-empty-name',
      <String, Object?>{'name': '', 'parentCategoryId': 'missing-root'},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/invalid-spaces-name',
      <String, Object?>{'name': '   ', 'parentCategoryId': 123},
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Biscoito com categorias sem nome ignoradas',
        price: 10,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Biscoitos',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.categoryResolutions, hasLength(1));
    final resolution = analysis.categoryResolutions[products.single]!;
    expect(resolution.categoryId, 'root-valid');
    expect(resolution.subcategoryId, 'child-valid');
    expect(analysis.existingCategoryIds, {
      'alimentos': 'root-valid',
      'biscoitos': 'child-valid',
    });
    expect(functionCalls, isEmpty);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.importedProducts, 1);
    expect(result.createdCategories, 0);
    expect(result.skippedDuplicates, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
    ]);
    final parameters = Map<String, dynamic>.from(
      functionCalls.single['parameters'] as Map,
    );
    expect(parameters['categoryIds'], ['root-valid', 'child-valid']);
  });

  test('S5-A2: pai sem nome torna a filha nomeada orfa no indice', () async {
    const variants = <String, String>{'empty': '', 'spaces': '   '};

    for (final variant in variants.entries) {
      fakeFirestore.reset();
      functionCalls.clear();
      final storeId = 'store-s5-pai-${variant.key}';
      final parentId = 'parent-${variant.key}';
      final childId = 'child-named-${variant.key}';
      final childName = variant.key == 'empty' ? 'Promoção' : 'Destaques';

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/$parentId',
        <String, Object?>{'name': variant.value, 'parentCategoryId': null},
      );
      fakeFirestore.seedDocument(
        'stores/$storeId/categories/$childId',
        <String, Object?>{'name': childName, 'parentCategoryId': parentId},
      );

      final products = <ProductImportItem>[
        ProductImportItem(
          sourceRow: 2,
          name: 'Produto com pai sem nome ${variant.key}',
          price: 10,
          quantity: 1,
          category: 'Feminino',
          subcategory: childName,
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
      ];

      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );
      final invalidHierarchy = allOf(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          'Categoria "$childId" referencia uma categoria pai inexistente.',
        ),
        isNot(isA<ProductImportException>()),
      );

      await expectLater(
        service.analyze(storeId: storeId, products: products),
        throwsA(invalidHierarchy),
      );
      expect(functionCalls, isEmpty);

      await expectLater(
        service.importProducts(
          storeId: storeId,
          isBusiness: false,
          products: products,
        ),
        throwsA(invalidHierarchy),
      );
      expect(functionCalls, isEmpty);
    }
  });

  test('S5-A2: Flutter aceita whitespace externo no pai apos trim', () async {
    // Caracteriza apenas o Flutter; backend T6-A3 continua estrito.
    // G2 permanece aberta para validacao real em T6-A4-A2/E2.
    const storeId = 'store-s5-pai-trim';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-a',
      <String, Object?>{'name': 'Feminino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-a',
      <String, Object?>{'name': 'Promoção', 'parentCategoryId': ' root-a '},
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Vestido com pai normalizado no Flutter',
        price: 30,
        quantity: 1,
        category: 'Feminino',
        subcategory: 'Promoção',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.categoryResolutions, hasLength(1));
    final resolution = analysis.categoryResolutions[products.single]!;
    expect(resolution.categoryId, 'root-a');
    expect(resolution.subcategoryId, 'child-a');
    expect(functionCalls, isEmpty);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.importedProducts, 1);
    expect(result.createdCategories, 0);
    expect(result.skippedDuplicates, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
    ]);
    final parameters = Map<String, dynamic>.from(
      functionCalls.single['parameters'] as Map,
    );
    expect(parameters['categoryIds'], ['root-a', 'child-a']);
  });

  test('S5-A2: parentCategoryId nao-string bloqueia o indice', () async {
    final variants = <String, Object>{
      'number': 123,
      'boolean': true,
      'list': <String>['root-a'],
      'map': <String, String>{'id': 'root-a'},
    };

    for (final variant in variants.entries) {
      fakeFirestore.reset();
      functionCalls.clear();
      final storeId = 'store-s5-tipo-${variant.key}';
      final categoryId = 'invalid-parent-${variant.key}';

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/$categoryId',
        <String, Object?>{
          'name': 'Categoria nomeada',
          'parentCategoryId': variant.value,
        },
      );

      const products = <ProductImportItem>[
        ProductImportItem(
          sourceRow: 2,
          name: 'Produto com pai nao-string',
          price: 10,
          quantity: 1,
          category: 'Categoria nomeada',
          subcategory: '',
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
      ];

      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );
      final invalidHierarchy = allOf(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          'Categoria "$categoryId" possui parentCategoryId invalido.',
        ),
        isNot(isA<ProductImportException>()),
      );

      await expectLater(
        service.analyze(storeId: storeId, products: products),
        throwsA(invalidHierarchy),
      );
      expect(functionCalls, isEmpty);

      await expectLater(
        service.importProducts(
          storeId: storeId,
          isBusiness: false,
          products: products,
        ),
        throwsA(invalidHierarchy),
      );
      expect(functionCalls, isEmpty);
    }
  });

  test('S5-A2: parentCategoryId vazio ou whitespace nao e raiz', () async {
    const variants = <String, String>{'empty': '', 'spaces': '   '};

    for (final variant in variants.entries) {
      fakeFirestore.reset();
      functionCalls.clear();
      final storeId = 'store-s5-vazio-${variant.key}';
      final categoryId = 'empty-parent-${variant.key}';

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/$categoryId',
        <String, Object?>{
          'name': 'Categoria nomeada',
          'parentCategoryId': variant.value,
        },
      );

      const products = <ProductImportItem>[
        ProductImportItem(
          sourceRow: 2,
          name: 'Produto com pai vazio',
          price: 10,
          quantity: 1,
          category: 'Categoria nomeada',
          subcategory: '',
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
      ];

      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );
      final invalidHierarchy = allOf(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          'Categoria "$categoryId" possui parentCategoryId vazio.',
        ),
        isNot(isA<ProductImportException>()),
      );

      await expectLater(
        service.analyze(storeId: storeId, products: products),
        throwsA(invalidHierarchy),
      );
      expect(functionCalls, isEmpty);

      await expectLater(
        service.importProducts(
          storeId: storeId,
          isBusiness: false,
          products: products,
        ),
        throwsA(invalidHierarchy),
      );
      expect(functionCalls, isEmpty);
    }
  });

  test('S5-A1: dangling parent bloqueia o indice global', () async {
    const storeId = 'store-s5-dangling';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-a',
      <String, Object?>{
        'name': 'Promoção',
        'parentCategoryId': 'root-inexistente',
      },
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto novo com pai inexistente',
        price: 10,
        quantity: 1,
        category: 'Bebidas',
        subcategory: 'Promoção',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final invalidHierarchy = allOf(
      isA<StateError>().having(
        (error) => error.message,
        'message',
        'Categoria "child-a" referencia uma categoria pai inexistente.',
      ),
      isNot(isA<ProductImportException>()),
    );

    await expectLater(
      service.analyze(storeId: storeId, products: products),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);

    await expectLater(
      service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      ),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);
  });

  test('S5-A1: terceiro nivel bloqueia o indice global', () async {
    const storeId = 'store-s5-terceiro-nivel';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-a',
      <String, Object?>{'name': 'Bebidas', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-a',
      <String, Object?>{'name': 'Refrigerantes', 'parentCategoryId': 'root-a'},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/grandchild-a',
      <String, Object?>{'name': 'Colas', 'parentCategoryId': 'child-a'},
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto novo com terceiro nivel',
        price: 10,
        quantity: 1,
        category: 'Bebidas',
        subcategory: 'Refrigerantes',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final invalidHierarchy = allOf(
      isA<StateError>().having(
        (error) => error.message,
        'message',
        'Categoria "grandchild-a" excede os dois niveis permitidos.',
      ),
      isNot(isA<ProductImportException>()),
    );

    await expectLater(
      service.analyze(storeId: storeId, products: products),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);

    await expectLater(
      service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      ),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);
  });

  test('S5-A1: ciclo bloqueia o indice global', () async {
    const storeId = 'store-s5-ciclo';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/cycle-a',
      <String, Object?>{'name': 'Categoria A', 'parentCategoryId': 'cycle-b'},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/cycle-b',
      <String, Object?>{'name': 'Categoria B', 'parentCategoryId': 'cycle-a'},
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto novo com ciclo',
        price: 10,
        quantity: 1,
        category: 'Categoria A',
        subcategory: 'Categoria B',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final invalidHierarchy = allOf(
      isA<StateError>().having(
        (error) => error.message,
        'message',
        allOf(
          contains('excede os dois niveis permitidos'),
          anyOf(contains('"cycle-a"'), contains('"cycle-b"')),
        ),
      ),
      isNot(isA<ProductImportException>()),
    );

    await expectLater(
      service.analyze(storeId: storeId, products: products),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);

    await expectLater(
      service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      ),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);
  });

  test('S6-A1: duplicado do banco por nome nao planeja categorias', () async {
    final variants = <String, Map<String, Object?>>{
      'trim-case': {'name_lowercase': 'arroz branco'},
      'fallback': {'name': 'Arroz Branco'},
      'fallback-null': {'name': 'Arroz Branco', 'name_lowercase': null},
      'preferred': {'name': 'Outro nome', 'name_lowercase': ' ARROZ BRANCO '},
    };

    for (final variant in variants.entries) {
      fakeFirestore.reset();
      functionCalls.clear();
      final storeId = 'store-s6-db-name-${variant.key}';
      fakeFirestore.seedDocument(
        'stores/$storeId/products/existing',
        <String, Object?>{...variant.value, 'barcode': '111'},
      );

      const item = ProductImportItem(
        sourceRow: 2,
        name: '  Arroz Branco  ',
        price: 10,
        quantity: 2,
        category: 'Raiz exclusiva duplicado',
        subcategory: 'Filha exclusiva duplicado',
        barcode: '222',
        costPrice: null,
        ncm: '',
      );
      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );
      final analysis = await service.analyze(
        storeId: storeId,
        products: [item],
      );

      expect(analysis.duplicateProducts, [item]);
      expect(analysis.newProducts, isEmpty);
      expect(analysis.categoryResolutions, isEmpty);
      expect(analysis.newCategories, isEmpty);
      expect(functionCalls, isEmpty);

      final result = await service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: [item],
      );

      expect(result.importedProducts, 0);
      expect(result.skippedDuplicates, 1);
      expect(result.createdCategories, 0);
      expect(functionCalls, isEmpty);
    }
  });

  test('S6-A1: duplicado do banco por barcode ignora categorias', () async {
    const storeId = 'store-s6-db-barcode';
    fakeFirestore
        .seedDocument('stores/$storeId/products/existing', <String, Object?>{
          'name': 'Produto existente',
          'name_lowercase': 'produto existente',
          'barcode': ' 789123 ',
        });

    const item = ProductImportItem(
      sourceRow: 2,
      name: 'Nome totalmente diferente',
      price: 15,
      quantity: 3,
      category: 'Raiz exclusiva duplicado',
      subcategory: 'Filha exclusiva duplicado',
      barcode: ' 789123 ',
      costPrice: null,
      ncm: '',
    );
    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(storeId: storeId, products: [item]);

    expect(analysis.duplicateProducts, [item]);
    expect(analysis.newProducts, isEmpty);
    expect(analysis.categoryResolutions, isEmpty);
    expect(analysis.newCategories, isEmpty);
    expect(functionCalls, isEmpty);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: [item],
    );

    expect(result.importedProducts, 0);
    expect(result.skippedDuplicates, 1);
    expect(result.createdCategories, 0);
    expect(functionCalls, isEmpty);
  });

  test('S6-A1: duplicado do arquivo por nome preserva o primeiro', () async {
    const storeId = 'store-s6-file-name';
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-a',
      <String, Object?>{'name': 'Alimentos', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-a',
      <String, Object?>{'name': 'Graos', 'parentCategoryId': 'root-a'},
    );

    // sourceRow invertido caracteriza a precedencia da ordem da lista.
    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 9,
        name: '  Arroz Branco  ',
        price: 10,
        quantity: 2,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: '111',
        costPrice: 4,
        ncm: '',
      ),
      ProductImportItem(
        sourceRow: 2,
        name: '  arroz branco  ',
        price: 99,
        quantity: 8,
        category: 'Raiz exclusiva duplicado',
        subcategory: 'Filha exclusiva duplicado',
        barcode: '222',
        costPrice: null,
        ncm: '',
      ),
    ];
    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.newProducts, [products.first]);
    expect(analysis.duplicateProducts, [products.last]);
    expect(analysis.categoryResolutions.keys.toList(), [products.first]);
    final resolution = analysis.categoryResolutions[products.first]!;
    expect(resolution.categoryId, 'root-a');
    expect(resolution.subcategoryId, 'child-a');
    expect(analysis.newCategories, isEmpty);
    expect(functionCalls, isEmpty);

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.importedProducts, 1);
    expect(result.skippedDuplicates, 1);
    expect(result.createdCategories, 0);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
    ]);
    final parameters = Map<String, dynamic>.from(
      functionCalls.single['parameters'] as Map,
    );
    expect(parameters['categoryIds'], ['root-a', 'child-a']);
    expect(parameters['product'], {
      'name': 'Arroz Branco',
      'price': 10,
      'quantidade': 2,
      'lotes': <Map<String, dynamic>>[],
      'minimumStock': 0,
      'imageUrl': '',
      'barcode': '111',
      'costPrice': 4,
    });
  });

  test('S6-A1: duplicado do arquivo por barcode preserva o primeiro', () async {
    const storeId = 'store-s6-file-barcode';
    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 9,
        name: 'Produto A',
        price: 10,
        quantity: 2,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: '789001',
        costPrice: null,
        ncm: '',
      ),
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto B totalmente diferente',
        price: 99,
        quantity: 8,
        category: 'Raiz exclusiva duplicado',
        subcategory: 'Filha exclusiva duplicado',
        barcode: ' 789001 ',
        costPrice: null,
        ncm: '',
      ),
    ];
    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(
      storeId: storeId,
      products: products,
    );

    expect(analysis.newProducts, [products.first]);
    expect(analysis.duplicateProducts, [products.last]);
    expect(analysis.categoryResolutions.keys.toList(), [products.first]);
    expect(analysis.newCategories, ['Alimentos']);
    final resolution = analysis.categoryResolutions[products.first]!;
    expect(resolution.categoryName, 'Alimentos');
    expect(resolution.subcategoryName, 'Graos');
    expect(resolution.categoryId, isNull);
    expect(resolution.subcategoryId, isNull);
    expect(functionCalls, isEmpty);

    var upsertCount = 0;
    upsertCategory = (parameters) async {
      upsertCount++;
      expect(upsertCount, lessThanOrEqualTo(2));
      final isRoot = upsertCount == 1;
      expect(parameters, {
        'name': isRoot ? 'Alimentos' : 'Graos',
        'imageUrl': '',
        'parentCategoryId': isRoot ? null : 'root-new',
      });
      return [
        {
          'success': true,
          'mode': 'create',
          'categoryId': isRoot ? 'root-new' : 'child-new',
          'parentCategoryId': isRoot ? null : 'root-new',
          'changed': true,
        },
      ];
    };

    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: products,
    );

    expect(result.importedProducts, 1);
    expect(result.skippedDuplicates, 1);
    expect(result.createdCategories, 2);
    expect(upsertCount, 2);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'upsertCategory',
      'upsertCategory',
      'createProduct',
    ]);
    final parameters = Map<String, dynamic>.from(
      functionCalls.last['parameters'] as Map,
    );
    expect(parameters['categoryIds'], ['root-new', 'child-new']);
    expect(parameters['product'], {
      'name': 'Produto A',
      'price': 10,
      'quantidade': 2,
      'lotes': <Map<String, dynamic>>[],
      'minimumStock': 0,
      'imageUrl': '',
      'barcode': '789001',
    });
  });

  test('S6-A1: descartado pelo banco nao contamina conjuntos', () async {
    for (final duplicateByBarcode in [true, false]) {
      fakeFirestore.reset();
      functionCalls.clear();
      final storeId = 'store-s6-discarded-$duplicateByBarcode';
      fakeFirestore
          .seedDocument('stores/$storeId/products/existing', <String, Object?>{
            'name': 'Produto do banco',
            'name_lowercase': 'produto do banco',
            'barcode': '111',
          });
      fakeFirestore.seedDocument(
        'stores/$storeId/categories/root-a',
        <String, Object?>{'name': 'Alimentos', 'parentCategoryId': null},
      );

      final products = <ProductImportItem>[
        ProductImportItem(
          sourceRow: 2,
          name: duplicateByBarcode ? 'Produto B' : 'Produto do banco',
          price: 99,
          quantity: 8,
          category: 'Raiz exclusiva descartado',
          subcategory: 'Filha exclusiva descartado',
          barcode: duplicateByBarcode ? '111' : '222',
          costPrice: null,
          ncm: '',
        ),
        ProductImportItem(
          sourceRow: 3,
          name: 'Produto B',
          price: 10,
          quantity: 2,
          category: 'Alimentos',
          subcategory: '',
          barcode: '222',
          costPrice: null,
          ncm: '',
        ),
      ];
      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );
      final analysis = await service.analyze(
        storeId: storeId,
        products: products,
      );

      expect(analysis.duplicateProducts, [products.first]);
      expect(analysis.newProducts, [products.last]);
      expect(analysis.categoryResolutions.keys.toList(), [products.last]);
      expect(analysis.categoryResolutions[products.last]!.categoryId, 'root-a');
      expect(analysis.newCategories, isEmpty);
      expect(functionCalls, isEmpty);

      final result = await service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      );

      expect(result.importedProducts, 1);
      expect(result.skippedDuplicates, 1);
      expect(result.createdCategories, 0);
      expect(functionCalls.map((call) => call['functionName']).toList(), [
        'createProduct',
      ]);
      final parameters = Map<String, dynamic>.from(
        functionCalls.single['parameters'] as Map,
      );
      expect(parameters['categoryIds'], ['root-a']);
      expect(parameters['product'], {
        'name': 'Produto B',
        'price': 10,
        'quantidade': 2,
        'lotes': <Map<String, dynamic>>[],
        'minimumStock': 0,
        'imageUrl': '',
        'barcode': '222',
      });
    }
  });

  test('S6-A2: produto aparece entre T0 e T1 por nome ou barcode', () async {
    for (final duplicateByBarcode in [false, true]) {
      fakeFirestore.reset();
      functionCalls.clear();
      final storeId = 'store-s6-temporal-$duplicateByBarcode';
      final item = ProductImportItem(
        sourceRow: 2,
        name: duplicateByBarcode ? 'Produto unico temporal' : 'Arroz Branco',
        price: 10,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: duplicateByBarcode ? '789123' : '111',
        costPrice: null,
        ncm: '',
      );
      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      final analysisT0 = await service.analyze(
        storeId: storeId,
        products: [item],
      );

      expect(analysisT0.newProducts, [item]);
      expect(analysisT0.duplicateProducts, isEmpty);
      expect(analysisT0.categoryResolutions.keys.toList(), [item]);
      final resolution = analysisT0.categoryResolutions[item]!;
      expect(resolution.categoryId, isNull);
      expect(resolution.subcategoryId, isNull);
      expect(resolution.categoryExists, isFalse);
      expect(resolution.subcategoryExists, isFalse);
      expect(analysisT0.newCategories, ['Alimentos']);
      expect(functionCalls, isEmpty);

      fakeFirestore
          .seedDocument('stores/$storeId/products/existing', <String, Object?>{
            'name_lowercase': duplicateByBarcode
                ? 'nome totalmente diferente'
                : ' arroz branco ',
            'barcode': duplicateByBarcode ? ' 789123 ' : '999',
          });

      // T1: o mesmo service reanalisa o mesmo item sem analyze manual.
      final result = await service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: [item],
      );

      expect(result.importedProducts, 0);
      expect(result.skippedDuplicates, 1);
      expect(result.createdCategories, 0);
      expect(functionCalls, isEmpty);
      expect(
        fakeFirestore.documentsForCollection('stores/$storeId/categories'),
        isEmpty,
      );
    }
  });

  test('S6-A2: categorias aparecem entre T0 e T1 e sao reutilizadas', () async {
    const storeId = 'store-s6-temporal-categories';
    const item = ProductImportItem(
      sourceRow: 2,
      name: 'Vestido temporal unico',
      price: 30,
      quantity: 1,
      category: 'Feminino',
      subcategory: 'Promoção',
      barcode: '',
      costPrice: null,
      ncm: '',
    );
    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysisT0 = await service.analyze(
      storeId: storeId,
      products: [item],
    );

    expect(analysisT0.newProducts, [item]);
    expect(analysisT0.duplicateProducts, isEmpty);
    expect(analysisT0.categoryResolutions.keys.toList(), [item]);
    final resolution = analysisT0.categoryResolutions[item]!;
    expect(resolution.categoryId, isNull);
    expect(resolution.subcategoryId, isNull);
    expect(resolution.categoryExists, isFalse);
    expect(resolution.subcategoryExists, isFalse);
    expect(analysisT0.newCategories, ['Feminino']);
    expect(functionCalls, isEmpty);

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-a',
      <String, Object?>{'name': 'Feminino', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-a',
      <String, Object?>{'name': 'Promoção', 'parentCategoryId': 'root-a'},
    );

    // T1: somente importProducts consulta novamente o estado do fake.
    final result = await service.importProducts(
      storeId: storeId,
      isBusiness: false,
      products: [item],
    );

    expect(result.importedProducts, 1);
    expect(result.skippedDuplicates, 0);
    expect(result.createdCategories, 0);
    expect(
      functionCalls.where((call) => call['functionName'] == 'upsertCategory'),
      isEmpty,
    );
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'createProduct',
    ]);
    final parameters = Map<String, dynamic>.from(
      functionCalls.single['parameters'] as Map,
    );
    expect(parameters['categoryIds'], ['root-a', 'child-a']);
    expect(
      fakeFirestore
          .documentsForCollection('stores/$storeId/categories')
          .map((doc) => doc.id)
          .toList(),
      ['root-a', 'child-a'],
    );
  });

  test('S7-A1: falha na raiz interrompe antes da filha e produto', () async {
    final originalCause = Exception('causa anterior');
    final variants = <String, Object>{
      'exception': Exception('falha na raiz'),
      'state': StateError('falha na raiz'),
      'functions': FirebaseFunctionsException(
        code: 'unavailable',
        message: 'falha na raiz',
      ),
      'import': ProductImportException(
        importedProducts: 7,
        createdCategories: 8,
        skippedDuplicates: 9,
        cause: originalCause,
      ),
    };
    const item = ProductImportItem(
      sourceRow: 2,
      name: 'Arroz',
      price: 10,
      quantity: 1,
      category: 'Alimentos',
      subcategory: 'Graos',
      barcode: '',
      costPrice: null,
      ncm: '',
    );

    for (final variant in variants.entries) {
      fakeFirestore.reset();
      functionCalls.clear();
      upsertCategory = (parameters) async => throw variant.value;
      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );
      final storeId = 'store-s7-root-${variant.key}';
      // O segundo item e duplicado na analise; nenhuma categoria existe.
      final analysis = await service.analyze(
        storeId: storeId,
        products: [item, item],
      );
      expect(analysis.newProducts, [item]);
      expect(analysis.duplicateProducts, [item]);
      expect(analysis.categoryResolutions[item]!.categoryId, isNull);
      expect(analysis.categoryResolutions[item]!.subcategoryId, isNull);

      ProductImportResult? result;
      ProductImportException? failure;
      try {
        result = await service.importProducts(
          storeId: storeId,
          isBusiness: false,
          products: [item, item],
        );
      } on ProductImportException catch (error) {
        failure = error;
      }

      expect(result, isNull, reason: variant.key);
      expect(failure, isNotNull, reason: variant.key);
      final error = failure!;
      if (variant.value is ProductImportException) {
        expect(error, same(variant.value));
        expect(error.importedProducts, 7);
        expect(error.createdCategories, 8);
        expect(error.skippedDuplicates, 9);
        expect(error.cause, same(originalCause));
        expect(
          error.toString(),
          'Importação interrompida: 7 produto(s) importado(s), '
          '8 categoria(s) criada(s), 9 duplicado(s) ignorado(s).',
        );
      } else {
        expect(error, isNot(same(variant.value)));
        expect(error.cause, same(variant.value));
        expect(error.importedProducts, 0);
        expect(error.createdCategories, 0);
        expect(error.skippedDuplicates, 1);
        expect(
          error.toString(),
          'Importação interrompida: 0 produto(s) importado(s), '
          '0 categoria(s) criada(s), 1 duplicado(s) ignorado(s).',
        );
      }
      expect(functionCalls.map((call) => call['functionName']).toList(), [
        'upsertCategory',
      ]);
      expect(functionCalls.single['parameters'], {
        'name': 'Alimentos',
        'imageUrl': '',
        'parentCategoryId': null,
      });
    }
  });

  test('S7-A1: falha na filha preserva uma categoria reconhecida', () async {
    final childError = StateError('falha controlada na filha');
    var upsertCount = 0;
    upsertCategory = (parameters) async {
      upsertCount++;
      if (upsertCount == 1) {
        return [
          {
            'success': true,
            'mode': 'create',
            'categoryId': 'root-new',
            'parentCategoryId': null,
            'changed': true,
          },
        ];
      }
      throw childError;
    };
    const item = ProductImportItem(
      sourceRow: 2,
      name: 'Arroz',
      price: 10,
      quantity: 1,
      category: 'Alimentos',
      subcategory: 'Graos',
      barcode: '',
      costPrice: null,
      ncm: '',
    );
    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    ProductImportResult? result;
    ProductImportException? failure;
    try {
      result = await service.importProducts(
        storeId: 'store-s7-child',
        isBusiness: false,
        products: [item],
      );
    } on ProductImportException catch (error) {
      failure = error;
    }

    expect(result, isNull);
    expect(failure, isNotNull);
    final error = failure!;
    expect(error.cause, same(childError));
    expect(error.importedProducts, 0);
    // Sucesso reconhecido pelo service, sem afirmar persistencia no backend.
    expect(error.createdCategories, 1);
    expect(error.skippedDuplicates, 0);
    expect(
      error.toString(),
      'Importação interrompida: 0 produto(s) importado(s), '
      '1 categoria(s) criada(s), 0 duplicado(s) ignorado(s).',
    );
    expect(upsertCount, 2);
    // Lista completa: sem produto, terceira chamada ou compensacao.
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'upsertCategory',
      'upsertCategory',
    ]);
    expect(functionCalls.map((call) => call['parameters']).toList(), [
      {'name': 'Alimentos', 'imageUrl': '', 'parentCategoryId': null},
      {'name': 'Graos', 'imageUrl': '', 'parentCategoryId': 'root-new'},
    ]);
  });

  test(
    'S7-A1: parsing rejeita respostas inconsistentes de categoria',
    () async {
      const validRoot = <String, Object?>{
        'success': true,
        'mode': 'create',
        'categoryId': 'root-new',
        'parentCategoryId': null,
        'changed': true,
      };
      final variants = <String, Object?>{
        'not-map': 'resposta invalida',
        'empty-map': <String, Object?>{},
        for (final field in ['success', 'mode', 'categoryId', 'changed'])
          'missing-$field': Map<String, Object?>.from(validRoot)..remove(field),
        'success-false': {...validRoot, 'success': false},
        'mode-update': {...validRoot, 'mode': 'update'},
        'id-null': {...validRoot, 'categoryId': null},
        'id-number': {...validRoot, 'categoryId': 123},
        'id-empty': {...validRoot, 'categoryId': ''},
        'id-spaces': {...validRoot, 'categoryId': '   '},
        'root-parent-wrong': {...validRoot, 'parentCategoryId': 'other-root'},
        'changed-false': {...validRoot, 'changed': false},
        'child-parent-wrong': {...validRoot, 'parentCategoryId': 'other-root'},
        'child-parent-null': {...validRoot, 'parentCategoryId': null},
        'child-parent-missing': Map<String, Object?>.from(validRoot)
          ..remove('parentCategoryId'),
        // Fronteira aceita: pai omitido na raiz e IDs com whitespace externo.
        'accepted-trim': {
          'success': true,
          'mode': 'create',
          'categoryId': ' root-new ',
          'changed': true,
        },
      };
      const item = ProductImportItem(
        sourceRow: 2,
        name: 'Arroz',
        price: 10,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: '',
        costPrice: null,
        ncm: '',
      );

      for (final variant in variants.entries) {
        fakeFirestore.reset();
        functionCalls.clear();
        final childFailure = variant.key.startsWith('child-');
        final accepted = variant.key == 'accepted-trim';
        var upsertCount = 0;
        upsertCategory = (parameters) async {
          upsertCount++;
          if (childFailure && upsertCount == 1) {
            return [validRoot];
          }
          if (accepted && upsertCount == 2) {
            return [
              {
                ...validRoot,
                'categoryId': ' child-new ',
                'parentCategoryId': 'root-new',
              },
            ];
          }
          return [variant.value];
        };
        final service = ProductImportService(
          firestore: FirebaseFirestore.instance,
        );
        ProductImportResult? result;
        ProductImportException? failure;
        try {
          result = await service.importProducts(
            storeId: 'store-s7-parsing-${variant.key}',
            isBusiness: false,
            products: [item],
          );
        } on ProductImportException catch (error) {
          failure = error;
        }

        if (accepted) {
          expect(failure, isNull);
          expect(result, isNotNull);
          expect(result!.createdCategories, 2);
          expect(result.importedProducts, 1);
          expect(result.skippedDuplicates, 0);
          expect(upsertCount, 2);
          expect(functionCalls.map((call) => call['functionName']).toList(), [
            'upsertCategory',
            'upsertCategory',
            'createProduct',
          ]);
          expect((functionCalls.last['parameters'] as Map)['categoryIds'], [
            'root-new',
            'child-new',
          ]);
        } else {
          expect(result, isNull, reason: variant.key);
          expect(failure, isNotNull, reason: variant.key);
          final error = failure!;
          final recognizedCategories = childFailure ? 1 : 0;
          expect(error.createdCategories, recognizedCategories);
          expect(error.importedProducts, 0);
          expect(error.skippedDuplicates, 0);
          expect(
            error.toString(),
            'Importação interrompida: 0 produto(s) importado(s), '
            '$recognizedCategories categoria(s) criada(s), '
            '0 duplicado(s) ignorado(s).',
          );
          expect(
            error.cause,
            isA<StateError>().having(
              (cause) => cause.message,
              'message',
              variant.key == 'not-map'
                  ? 'Resposta invalida ao criar categoria importada.'
                  : 'Resposta incompleta ao criar categoria importada.',
            ),
            reason: variant.key,
          );
          expect(upsertCount, childFailure ? 2 : 1);
          expect(functionCalls.map((call) => call['functionName']).toList(), [
            'upsertCategory',
            if (childFailure) 'upsertCategory',
          ]);
        }
        expect(functionCalls.first['parameters'], {
          'name': 'Alimentos',
          'imageUrl': '',
          'parentCategoryId': null,
        });
        if (childFailure || accepted) {
          expect(functionCalls[1]['parameters'], {
            'name': 'Graos',
            'imageUrl': '',
            'parentCategoryId': 'root-new',
          });
        }
      }
    },
  );

  test(
    'S7-A2: falha no produto preserva duas categorias reconhecidas',
    () async {
      final productError = StateError('falha controlada no produto');
      const item = ProductImportItem(
        sourceRow: 2,
        name: 'Arroz',
        price: 10,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: '',
        costPrice: null,
        ncm: '',
      );

      for (final variant in ['throw', 'not-map', 'incomplete']) {
        fakeFirestore.reset();
        functionCalls.clear();
        var upsertCount = 0;
        upsertCategory = (parameters) async {
          upsertCount++;
          if (upsertCount > 2) {
            fail('Nenhuma categoria adicional deve ser chamada.');
          }
          return [
            {
              'success': true,
              'mode': 'create',
              'categoryId': upsertCount == 1 ? 'root-new' : 'child-new',
              'parentCategoryId': upsertCount == 1 ? null : 'root-new',
              'changed': true,
            },
          ];
        };
        createProduct = (parameters) async {
          if (variant == 'throw') {
            throw productError;
          }
          return [
            if (variant == 'not-map')
              'resposta invalida'
            else
              {'success': true},
          ];
        };
        final service = ProductImportService(
          firestore: FirebaseFirestore.instance,
        );
        ProductImportResult? result;
        ProductImportException? failure;
        try {
          result = await service.importProducts(
            storeId: 'store-s7-product-$variant',
            isBusiness: false,
            products: [item],
          );
        } on ProductImportException catch (error) {
          failure = error;
        }

        expect(result, isNull, reason: variant);
        expect(failure, isNotNull, reason: variant);
        final error = failure!;
        expect(error.importedProducts, 0);
        expect(error.createdCategories, 2);
        expect(error.skippedDuplicates, 0);
        expect(
          error.toString(),
          'Importação interrompida: 0 produto(s) importado(s), '
          '2 categoria(s) criada(s), 0 duplicado(s) ignorado(s).',
        );
        if (variant == 'throw') {
          expect(error.cause, same(productError));
        } else {
          expect(
            error.cause,
            isA<StateError>().having(
              (cause) => cause.message,
              'message',
              variant == 'not-map'
                  ? 'Resposta invalida ao criar produto importado.'
                  : 'Resposta incompleta ao criar produto importado.',
            ),
          );
        }
        expect(upsertCount, 2);
        // Respostas reconhecidas, sem afirmar persistencia no backend.
        // Lista completa: sem chamadas posteriores, compensacao ou retry.
        expect(functionCalls.map((call) => call['functionName']).toList(), [
          'upsertCategory',
          'upsertCategory',
          'createProduct',
        ]);
        expect(
          functionCalls.take(2).map((call) => call['parameters']).toList(),
          [
            {'name': 'Alimentos', 'imageUrl': '', 'parentCategoryId': null},
            {'name': 'Graos', 'imageUrl': '', 'parentCategoryId': 'root-new'},
          ],
        );
        expect((functionCalls.last['parameters'] as Map)['categoryIds'], [
          'root-new',
          'child-new',
        ]);
      }
    },
  );

  test('S7-A2: segundo produto falha e interrompe antes do terceiro', () async {
    final productError = StateError('falha controlada no segundo produto');
    var upsertCount = 0;
    upsertCategory = (parameters) async {
      upsertCount++;
      if (upsertCount > 2) {
        fail('Raiz e filha devem ser chamadas somente uma vez.');
      }
      return [
        {
          'success': true,
          'mode': 'create',
          'categoryId': upsertCount == 1 ? 'root-new' : 'child-new',
          'parentCategoryId': upsertCount == 1 ? null : 'root-new',
          'changed': true,
        },
      ];
    };
    var productCount = 0;
    createProduct = (parameters) async {
      productCount++;
      if (productCount == 1) {
        return [
          {'success': true, 'productId': 'product-first'},
        ];
      }
      if (productCount == 2) {
        throw productError;
      }
      fail('O terceiro produto nao deve ser chamado.');
    };
    final products = [
      for (var index = 1; index <= 3; index++)
        ProductImportItem(
          sourceRow: index + 1,
          name: 'Produto $index',
          price: 10,
          quantity: 1,
          category: 'Alimentos',
          subcategory: 'Graos',
          barcode: '',
          costPrice: null,
          ncm: '',
        ),
    ];
    final input = [...products, products.first];
    const storeId = 'store-s7-second-product';
    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final analysis = await service.analyze(storeId: storeId, products: input);
    expect(analysis.newProducts, products);
    expect(analysis.duplicateProducts, [products.first]);
    expect(functionCalls, isEmpty);

    ProductImportResult? result;
    ProductImportException? failure;
    try {
      result = await service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: input,
      );
    } on ProductImportException catch (error) {
      failure = error;
    }

    expect(result, isNull);
    expect(failure, isNotNull);
    final error = failure!;
    expect(error.cause, same(productError));
    expect(error.createdCategories, 2);
    expect(error.importedProducts, 1);
    expect(error.skippedDuplicates, 1);
    expect(
      error.toString(),
      'Importação interrompida: 1 produto(s) importado(s), '
      '2 categoria(s) criada(s), 1 duplicado(s) ignorado(s).',
    );
    expect(upsertCount, 2);
    expect(productCount, 2);
    expect(functionCalls.map((call) => call['functionName']).toList(), [
      'upsertCategory',
      'upsertCategory',
      'createProduct',
      'createProduct',
    ]);
    expect(functionCalls.take(2).map((call) => call['parameters']).toList(), [
      {'name': 'Alimentos', 'imageUrl': '', 'parentCategoryId': null},
      {'name': 'Graos', 'imageUrl': '', 'parentCategoryId': 'root-new'},
    ]);
    final productCalls = functionCalls
        .where((call) => call['functionName'] == 'createProduct')
        .toList();
    expect(productCalls, hasLength(2));
    expect(
      productCalls.map(
        (call) => ((call['parameters'] as Map)['product'] as Map)['name'],
      ),
      ['Produto 1', 'Produto 2'],
    );
    for (final call in productCalls) {
      expect((call['parameters'] as Map)['categoryIds'], [
        'root-new',
        'child-new',
      ]);
    }
  });

  test(
    'S8-B: retry parcial reutiliza requestId por objeto e nao por posicao',
    () async {
      const storeId = 'store-s8-retry';

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/root-s8',
        <String, Object?>{'name': 'Alimentos', 'parentCategoryId': null},
      );

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/child-s8',
        <String, Object?>{'name': 'Graos', 'parentCategoryId': 'root-s8'},
      );

      final product1 = ProductImportItem(
        sourceRow: 2,
        name: 'Produto 1',
        price: 10,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: 's8-retry-1',
        costPrice: null,
        ncm: '',
      );

      final product2 = ProductImportItem(
        sourceRow: 3,
        name: 'Produto 2',
        price: 20,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: 's8-retry-2',
        costPrice: null,
        ncm: '',
      );

      final product3 = ProductImportItem(
        sourceRow: 4,
        name: 'Produto 3',
        price: 30,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: 's8-retry-3',
        costPrice: null,
        ncm: '',
      );

      final retryError = StateError('falha controlada no segundo produto');

      var firstAttemptProductCount = 0;

      createProduct = (parameters) async {
        firstAttemptProductCount++;

        if (firstAttemptProductCount == 1) {
          return [
            {'success': true, 'productId': 'product-first-attempt'},
          ];
        }

        if (firstAttemptProductCount == 2) {
          throw retryError;
        }

        fail(
          'A primeira tentativa nao deve chamar '
          'um terceiro produto.',
        );
      };

      final service = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      ProductImportResult? firstResult;
      ProductImportException? firstFailure;

      try {
        firstResult = await service.importProducts(
          storeId: storeId,
          isBusiness: false,
          products: [product1, product2],
        );
      } on ProductImportException catch (error) {
        firstFailure = error;
      }

      expect(firstResult, isNull);
      expect(firstFailure, isNotNull);

      final failure = firstFailure!;

      expect(failure.cause, same(retryError));
      expect(failure.importedProducts, 1);
      expect(failure.createdCategories, 0);
      expect(failure.skippedDuplicates, 0);

      final firstProductCalls = functionCalls
          .where((call) => call['functionName'] == 'createProduct')
          .toList();

      expect(firstProductCalls, hasLength(2));

      expect(
        firstProductCalls.map(
          (call) => ((call['parameters'] as Map)['product'] as Map)['name'],
        ),
        ['Produto 1', 'Produto 2'],
      );

      final firstProduct1RequestId =
          (firstProductCalls[0]['parameters'] as Map)['requestId'] as String;

      final firstProduct2RequestId =
          (firstProductCalls[1]['parameters'] as Map)['requestId'] as String;

      expect(firstProduct1RequestId, isNotEmpty);
      expect(firstProduct2RequestId, isNotEmpty);

      expect(firstProduct2RequestId, isNot(equals(firstProduct1RequestId)));

      functionCalls.clear();

      createProduct = (parameters) async {
        final product = Map<String, dynamic>.from(parameters['product'] as Map);

        return [
          {'success': true, 'productId': 'retry-${product['name']}'},
        ];
      };

      final retryResult = await service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: [product2, product1, product3],
      );

      expect(retryResult.importedProducts, 3);
      expect(retryResult.createdCategories, 0);
      expect(retryResult.skippedDuplicates, 0);

      final retryCalls = functionCalls
          .where((call) => call['functionName'] == 'createProduct')
          .toList();

      expect(retryCalls, hasLength(3));

      expect(
        retryCalls.map(
          (call) => ((call['parameters'] as Map)['product'] as Map)['name'],
        ),
        ['Produto 2', 'Produto 1', 'Produto 3'],
      );

      final retryProduct2RequestId =
          (retryCalls[0]['parameters'] as Map)['requestId'] as String;

      final retryProduct1RequestId =
          (retryCalls[1]['parameters'] as Map)['requestId'] as String;

      final retryProduct3RequestId =
          (retryCalls[2]['parameters'] as Map)['requestId'] as String;

      expect(retryProduct2RequestId, firstProduct2RequestId);

      expect(retryProduct1RequestId, firstProduct1RequestId);

      expect(retryProduct3RequestId, isNotEmpty);

      expect(retryProduct3RequestId, isNot(equals(firstProduct1RequestId)));

      expect(retryProduct3RequestId, isNot(equals(firstProduct2RequestId)));

      for (final call in retryCalls) {
        expect((call['parameters'] as Map)['categoryIds'], [
          'root-s8',
          'child-s8',
        ]);
      }

      expect(functionCalls.map((call) => call['functionName']).toList(), [
        'createProduct',
        'createProduct',
        'createProduct',
      ]);
    },
  );

  test(
    'S8-B: requestId depende da identidade do item e da instancia do service',
    () async {
      const storeId = 'store-s8-identity';

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/root-s8',
        <String, Object?>{'name': 'Alimentos', 'parentCategoryId': null},
      );

      fakeFirestore.seedDocument(
        'stores/$storeId/categories/child-s8',
        <String, Object?>{'name': 'Graos', 'parentCategoryId': 'root-s8'},
      );

      final item1 = ProductImportItem(
        sourceRow: 2,
        name: 'Produto equivalente',
        price: 15,
        quantity: 2,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: 's8-identity',
        costPrice: 5,
        ncm: '',
      );

      final item2 = ProductImportItem(
        sourceRow: 2,
        name: 'Produto equivalente',
        price: 15,
        quantity: 2,
        category: 'Alimentos',
        subcategory: 'Graos',
        barcode: 's8-identity',
        costPrice: 5,
        ncm: '',
      );

      expect(item2, isNot(same(item1)));

      final service1 = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      Future<String> importAndReadRequestId(
        ProductImportService service,
        ProductImportItem item,
      ) async {
        functionCalls.clear();

        final result = await service.importProducts(
          storeId: storeId,
          isBusiness: false,
          products: [item],
        );

        expect(result.importedProducts, 1);
        expect(result.createdCategories, 0);
        expect(result.skippedDuplicates, 0);

        expect(functionCalls.map((call) => call['functionName']).toList(), [
          'createProduct',
        ]);

        final parameters = functionCalls.single['parameters'] as Map;

        expect(parameters['categoryIds'], ['root-s8', 'child-s8']);

        return parameters['requestId'] as String;
      }

      final item1RequestIdService1 = await importAndReadRequestId(
        service1,
        item1,
      );

      final item2RequestIdService1 = await importAndReadRequestId(
        service1,
        item2,
      );

      expect(item1RequestIdService1, isNotEmpty);
      expect(item2RequestIdService1, isNotEmpty);

      expect(item2RequestIdService1, isNot(equals(item1RequestIdService1)));

      final service2 = ProductImportService(
        firestore: FirebaseFirestore.instance,
      );

      final item1RequestIdService2 = await importAndReadRequestId(
        service2,
        item1,
      );

      expect(item1RequestIdService2, isNotEmpty);

      expect(item1RequestIdService2, isNot(equals(item1RequestIdService1)));

      expect(item1RequestIdService2, isNot(equals(item2RequestIdService1)));
    },
  );
  test('S5-A1: corrupcao nao relacionada bloqueia o indice global', () async {
    const storeId = 'store-s5-global';

    fakeFirestore.seedDocument(
      'stores/$storeId/categories/root-valid',
      <String, Object?>{'name': 'Alimentos', 'parentCategoryId': null},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/child-valid',
      <String, Object?>{'name': 'Biscoitos', 'parentCategoryId': 'root-valid'},
    );
    fakeFirestore.seedDocument(
      'stores/$storeId/categories/broken-child',
      <String, Object?>{
        'name': 'Categoria corrompida',
        'parentCategoryId': 'missing-root',
      },
    );

    const products = <ProductImportItem>[
      ProductImportItem(
        sourceRow: 2,
        name: 'Produto novo em arvore valida',
        price: 10,
        quantity: 1,
        category: 'Alimentos',
        subcategory: 'Biscoitos',
        barcode: '',
        costPrice: null,
        ncm: '',
      ),
    ];

    final service = ProductImportService(firestore: FirebaseFirestore.instance);
    final invalidHierarchy = allOf(
      isA<StateError>().having(
        (error) => error.message,
        'message',
        'Categoria "broken-child" referencia uma categoria pai inexistente.',
      ),
      isNot(isA<ProductImportException>()),
    );

    await expectLater(
      service.analyze(storeId: storeId, products: products),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);

    await expectLater(
      service.importProducts(
        storeId: storeId,
        isBusiness: false,
        products: products,
      ),
      throwsA(invalidHierarchy),
    );
    expect(functionCalls, isEmpty);
  });
}
