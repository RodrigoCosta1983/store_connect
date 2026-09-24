// ============================================================================
// ARQUIVO: product_import_service.dart
// ============================================================================
//
// OBJETIVO:
//
// Centralizar toda a lógica de persistência da importação de produtos.
//
// RESPONSABILIDADES:
//
// • Consultar produtos existentes.
// • Detectar possíveis duplicidades.
// • Consultar categorias existentes.
// • Identificar categorias que precisam ser criadas.
// • Criar categorias automaticamente.
// • Importar produtos em lotes.
// • Manter compatibilidade com o schema atual do Store Connect.
// • Adicionar dados fiscais somente para lojas Business.
//
// IMPORTANTE:
//
// A interface NÃO deve gravar produtos diretamente no Firestore.
// Toda gravação da importação deve passar por este serviço.
//
// SCHEMA ATUAL DO PRODUTO:
//
// stores/{storeId}/products/{productId}
//
// {
//   name,
//   name_lowercase,
//   price,
//   lotes,
//   quantidade,
//   minimumStock,
//   imageUrl,
//   categoryId,
//   categoryName,
//   createdAt,
//   fiscal?,
//   barcode?,
//   costPrice?
// }
//
// CATEGORIAS:
//
// stores/{storeId}/categories/{categoryId}
//
// {
//   name,
//   imageUrl,
//   createdAt
// }
//
// DUPLICIDADE:
//
// 1. Código de barras, quando existir.
// 2. Nome normalizado.
//
// Nesta primeira versão produtos existentes serão IGNORADOS.
// Não atualizamos estoque ou preço silenciosamente.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'package:store_connect/models/product_import_item.dart';

// ============================================================================
// RESULTADO DA ANÁLISE
// ============================================================================

class ProductImportCategoryResolution {
  final String categoryName;
  final String? categoryId;

  final String subcategoryName;
  final String? subcategoryId;

  const ProductImportCategoryResolution({
    required this.categoryName,
    required this.categoryId,
    required this.subcategoryName,
    required this.subcategoryId,
  });

  bool get categoryExists => (categoryId ?? '').trim().isNotEmpty;

  bool get subcategoryExists => (subcategoryId ?? '').trim().isNotEmpty;
}

class ProductImportAnalysis {
  final List<ProductImportItem> newProducts;

  final List<ProductImportItem> duplicateProducts;

  final List<String> newCategories;

  final Map<String, String> existingCategoryIds;

  final Map<ProductImportItem, ProductImportCategoryResolution>
  categoryResolutions;

  const ProductImportAnalysis({
    required this.newProducts,
    required this.duplicateProducts,
    required this.newCategories,
    required this.existingCategoryIds,
    this.categoryResolutions =
        const <ProductImportItem, ProductImportCategoryResolution>{},
  });

  int get totalProducts => newProducts.length + duplicateProducts.length;
}

// ============================================================================
// RESULTADO DA IMPORTAÇÃO
// ============================================================================

class ProductImportResult {
  final int importedProducts;
  final int skippedDuplicates;
  final int createdCategories;

  const ProductImportResult({
    required this.importedProducts,
    required this.skippedDuplicates,
    required this.createdCategories,
  });
}

class ProductImportException implements Exception {
  final int importedProducts;
  final int createdCategories;
  final int skippedDuplicates;
  final Object cause;

  const ProductImportException({
    required this.importedProducts,
    required this.createdCategories,
    required this.skippedDuplicates,
    required this.cause,
  });

  @override
  String toString() =>
      'Importação interrompida: '
      '$importedProducts produto(s) importado(s), '
      '$createdCategories categoria(s) criada(s), '
      '$skippedDuplicates duplicado(s) ignorado(s).';
}

// ============================================================================
// SERVIÇO
// ============================================================================

class ProductImportService {
  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;
  final Map<ProductImportItem, String> _createProductRequestIds =
      <ProductImportItem, String>{};

  ProductImportService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _firestore = firestore ?? FirebaseFirestore.instance,
       _functions = functions ?? FirebaseFunctions.instance;

  // ==========================================================================
  // NORMALIZAR
  // ==========================================================================

  String _normalize(String value) {
    return value.trim().toLowerCase();
  }

  // ==========================================================================
  // ANALISAR IMPORTAÇÃO
  //
  // NÃO grava nada.
  //
  // ==========================================================================

  Future<ProductImportAnalysis> analyze({
    required String storeId,
    required List<ProductImportItem> products,
  }) async {
    final productsRef = _firestore
        .collection('stores')
        .doc(storeId)
        .collection('products');

    final categoriesRef = _firestore
        .collection('stores')
        .doc(storeId)
        .collection('categories');

    // ========================================================================
    // PRODUTOS EXISTENTES
    // ========================================================================

    final productSnapshot = await productsRef.get();

    final existingNames = <String>{};

    final existingBarcodes = <String>{};

    for (final doc in productSnapshot.docs) {
      final data = doc.data();

      final name =
          data['name_lowercase']?.toString().trim().toLowerCase() ??
          data['name']?.toString().trim().toLowerCase() ??
          '';

      if (name.isNotEmpty) {
        existingNames.add(name);
      }

      final barcode = data['barcode']?.toString().trim() ?? '';

      if (barcode.isNotEmpty) {
        existingBarcodes.add(barcode);
      }
    }

    // ========================================================================
    // CATEGORIAS EXISTENTES
    // ========================================================================

    final categorySnapshot = await categoriesRef.get();

    final existingCategoryIds = <String, String>{};

    for (final doc in categorySnapshot.docs) {
      final data = doc.data();

      final name = data['name']?.toString().trim() ?? '';

      if (name.isEmpty) {
        continue;
      }

      existingCategoryIds[_normalize(name)] = doc.id;
    }

    final rootCategoryIdsByName = <String, List<String>>{};

    final parentCategoryIdsById = <String, String?>{};

    final categoryNamesById = <String, String>{};

    for (final doc in categorySnapshot.docs) {
      final data = doc.data();

      final name = data['name']?.toString().trim() ?? '';

      if (name.isEmpty) {
        continue;
      }

      final hasParentCategoryId = data.containsKey('parentCategoryId');

      final rawParentCategoryId = hasParentCategoryId
          ? data['parentCategoryId']
          : null;

      if (rawParentCategoryId != null && rawParentCategoryId is! String) {
        throw StateError(
          'Categoria "${doc.id}" possui parentCategoryId invalido.',
        );
      }

      if (rawParentCategoryId is String && rawParentCategoryId.trim().isEmpty) {
        throw StateError(
          'Categoria "${doc.id}" possui parentCategoryId vazio.',
        );
      }

      final parentCategoryId = rawParentCategoryId is String
          ? rawParentCategoryId.trim()
          : null;

      parentCategoryIdsById[doc.id] = parentCategoryId;

      categoryNamesById[doc.id] = name;

      if (parentCategoryId == null) {
        rootCategoryIdsByName
            .putIfAbsent(_normalize(name), () => <String>[])
            .add(doc.id);
      }
    }

    final childCategoryIdsByParent = <String, Map<String, List<String>>>{};

    for (final entry in categoryNamesById.entries) {
      final categoryId = entry.key;

      final categoryName = entry.value;

      final parentCategoryId = parentCategoryIdsById[categoryId];

      if (parentCategoryId == null) {
        continue;
      }

      if (!parentCategoryIdsById.containsKey(parentCategoryId)) {
        throw StateError(
          'Categoria "$categoryId" referencia uma categoria pai inexistente.',
        );
      }

      if (parentCategoryIdsById[parentCategoryId] != null) {
        throw StateError(
          'Categoria "$categoryId" excede os dois niveis permitidos.',
        );
      }

      final childrenByName = childCategoryIdsByParent.putIfAbsent(
        parentCategoryId,
        () => <String, List<String>>{},
      );

      childrenByName
          .putIfAbsent(_normalize(categoryName), () => <String>[])
          .add(categoryId);
    }

    // ========================================================================
    // CLASSIFICAR PRODUTOS
    // ========================================================================

    final newProducts = <ProductImportItem>[];

    final duplicateProducts = <ProductImportItem>[];

    // Também evita duplicidade DENTRO da própria planilha.

    final namesSeenInFile = <String>{};

    final barcodesSeenInFile = <String>{};

    for (final product in products) {
      final normalizedName = _normalize(product.name);

      final barcode = product.barcode.trim();

      bool duplicate = false;

      // ----------------------------------------------------------------------
      // DUPLICIDADE POR CÓDIGO
      // ----------------------------------------------------------------------

      if (barcode.isNotEmpty) {
        if (existingBarcodes.contains(barcode) ||
            barcodesSeenInFile.contains(barcode)) {
          duplicate = true;
        }
      }

      // ----------------------------------------------------------------------
      // DUPLICIDADE POR NOME
      // ----------------------------------------------------------------------

      if (!duplicate && normalizedName.isNotEmpty) {
        if (existingNames.contains(normalizedName) ||
            namesSeenInFile.contains(normalizedName)) {
          duplicate = true;
        }
      }

      if (duplicate) {
        duplicateProducts.add(product);

        continue;
      }

      newProducts.add(product);

      namesSeenInFile.add(normalizedName);

      if (barcode.isNotEmpty) {
        barcodesSeenInFile.add(barcode);
      }
    }

    // ========================================================================
    // RESOLUCAO HIERARQUICA
    //
    // Categoria da planilha representa uma raiz.
    // Subcategoria e resolvida SOMENTE dentro da raiz informada.
    //
    // Nenhuma categoria e criada nesta etapa.
    // ========================================================================

    final categoryResolutions =
        <ProductImportItem, ProductImportCategoryResolution>{};

    for (final product in newProducts) {
      final categoryName = product.category.trim();

      final subcategoryName = product.subcategory.trim();

      if (categoryName.isEmpty) {
        if (subcategoryName.isNotEmpty) {
          throw StateError(
            'Subcategoria informada sem categoria no produto "${product.name.trim()}".',
          );
        }

        categoryResolutions[product] = ProductImportCategoryResolution(
          categoryName: '',
          categoryId: null,
          subcategoryName: '',
          subcategoryId: null,
        );

        continue;
      }

      final rootMatches =
          rootCategoryIdsByName[_normalize(categoryName)] ?? const <String>[];

      if (rootMatches.length > 1) {
        throw StateError(
          'Categoria raiz ambigua na importacao: "$categoryName".',
        );
      }

      final categoryId = rootMatches.isEmpty ? null : rootMatches.single;

      String? subcategoryId;

      if (subcategoryName.isNotEmpty && categoryId != null) {
        final childMatches =
            childCategoryIdsByParent[categoryId]?[_normalize(
              subcategoryName,
            )] ??
            const <String>[];

        if (childMatches.length > 1) {
          throw StateError(
            'Subcategoria ambigua na importacao: "$subcategoryName" em "$categoryName".',
          );
        }

        subcategoryId = childMatches.isEmpty ? null : childMatches.single;
      }

      categoryResolutions[product] = ProductImportCategoryResolution(
        categoryName: categoryName,
        categoryId: categoryId,
        subcategoryName: subcategoryName,
        subcategoryId: subcategoryId,
      );
    }

    // ========================================================================
    // DESCOBRIR CATEGORIAS NOVAS
    // ========================================================================

    final newCategoriesMap = <String, String>{};

    for (final product in newProducts) {
      final category = product.category.trim();

      if (category.isEmpty) {
        continue;
      }

      final normalized = _normalize(category);

      if (existingCategoryIds.containsKey(normalized)) {
        continue;
      }

      newCategoriesMap[normalized] = category;
    }

    return ProductImportAnalysis(
      newProducts: newProducts,

      duplicateProducts: duplicateProducts,

      newCategories: newCategoriesMap.values.toList()..sort(),

      existingCategoryIds: existingCategoryIds,

      categoryResolutions: categoryResolutions,
    );
  }

  // ==========================================================================
  // IMPORTAÇÃO DEFINITIVA
  // ==========================================================================

  Future<ProductImportResult> importProducts({
    required String storeId,
    required bool isBusiness,
    required List<ProductImportItem> products,
  }) async {
    final analysis = await analyze(storeId: storeId, products: products);

    final storeRef = _firestore.collection('stores').doc(storeId);

    final categoriesRef = storeRef.collection('categories');

    // ========================================================================
    // RESOLUCAO / CRIACAO HIERARQUICA DE CATEGORIAS
    //
    // T5-A3:
    // - categorias existentes continuam somente leitura;
    // - raiz ausente e criada via upsertCategory;
    // - subcategoria ausente e criada via upsertCategory;
    // - raiz sempre e criada antes da respectiva subcategoria;
    // - nenhum write direto em stores/{storeId}/categories;
    // - categoryIds do createProduct recebe as associacoes explicitas informadas na planilha.
    // ========================================================================

    final categoryRefs = <String, DocumentReference<Map<String, dynamic>>>{};

    final rootNamesByNormalized = <String, String>{};

    final resolvedRootIdsByName = <String, String>{};

    final resolvedChildIdsByParent = <String, Map<String, String>>{};

    // ------------------------------------------------------------------------
    // ESTADO JA RESOLVIDO PELO T5-A2
    // ------------------------------------------------------------------------

    for (final resolution in analysis.categoryResolutions.values) {
      final categoryName = resolution.categoryName.trim();

      if (categoryName.isEmpty) {
        continue;
      }

      final normalizedCategory = _normalize(categoryName);

      rootNamesByNormalized.putIfAbsent(normalizedCategory, () => categoryName);

      final existingCategoryId = resolution.categoryId?.trim();

      if (existingCategoryId != null && existingCategoryId.isNotEmpty) {
        final previousRootId = resolvedRootIdsByName[normalizedCategory];

        if (previousRootId != null && previousRootId != existingCategoryId) {
          throw StateError(
            'Resolucao inconsistente para a categoria raiz "$categoryName".',
          );
        }

        resolvedRootIdsByName[normalizedCategory] = existingCategoryId;
      }

      final subcategoryName = resolution.subcategoryName.trim();

      final existingSubcategoryId = resolution.subcategoryId?.trim();

      if (subcategoryName.isEmpty ||
          existingSubcategoryId == null ||
          existingSubcategoryId.isEmpty) {
        continue;
      }

      if (existingCategoryId == null || existingCategoryId.isEmpty) {
        throw StateError(
          'Subcategoria existente sem categoria raiz resolvida para "$categoryName".',
        );
      }

      final normalizedSubcategory = _normalize(subcategoryName);

      final childrenByName = resolvedChildIdsByParent.putIfAbsent(
        existingCategoryId,
        () => <String, String>{},
      );

      final previousChildId = childrenByName[normalizedSubcategory];

      if (previousChildId != null && previousChildId != existingSubcategoryId) {
        throw StateError(
          'Resolucao inconsistente para a subcategoria "$subcategoryName" em "$categoryName".',
        );
      }

      childrenByName[normalizedSubcategory] = existingSubcategoryId;
    }

    final upsertCategoryCallable = _functions.httpsCallable(
      'upsertCategory',
      options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
    );

    Future<String> createCategoryViaBackend({
      required String name,
      required String? parentCategoryId,
    }) async {
      final response = await upsertCategoryCallable.call(<String, dynamic>{
        'name': name,
        'imageUrl': '',
        'parentCategoryId': parentCategoryId,
      });

      final responseRaw = response.data;

      if (responseRaw is! Map) {
        throw StateError('Resposta invalida ao criar categoria importada.');
      }

      final responseData = Map<String, dynamic>.from(responseRaw);

      final categoryId = responseData['categoryId'];

      final changed = responseData['changed'];

      if (responseData['success'] != true ||
          responseData['mode'] != 'create' ||
          categoryId is! String ||
          categoryId.trim().isEmpty ||
          responseData['parentCategoryId'] != parentCategoryId ||
          changed != true) {
        throw StateError('Resposta incompleta ao criar categoria importada.');
      }

      return categoryId.trim();
    }

    var createdCategories = 0;
    var importedProducts = 0;

    try {
      // ----------------------------------------------------------------------
      // 1. RAIZES AUSENTES
      // ----------------------------------------------------------------------

      for (final entry in rootNamesByNormalized.entries) {
        if (resolvedRootIdsByName.containsKey(entry.key)) {
          continue;
        }

        final categoryId = await createCategoryViaBackend(
          name: entry.value,
          parentCategoryId: null,
        );

        resolvedRootIdsByName[entry.key] = categoryId;

        createdCategories++;
      }

      // ----------------------------------------------------------------------
      // 2. SUBCATEGORIAS AUSENTES
      //
      // A filha e identificada por:
      // ID da raiz + nome normalizado da subcategoria.
      // ----------------------------------------------------------------------

      for (final resolution in analysis.categoryResolutions.values) {
        final categoryName = resolution.categoryName.trim();

        final subcategoryName = resolution.subcategoryName.trim();

        if (categoryName.isEmpty || subcategoryName.isEmpty) {
          continue;
        }

        final normalizedCategory = _normalize(categoryName);

        final rootCategoryId = resolvedRootIdsByName[normalizedCategory];

        if (rootCategoryId == null || rootCategoryId.trim().isEmpty) {
          throw StateError(
            'Nao foi possivel resolver a categoria raiz "$categoryName".',
          );
        }

        final normalizedSubcategory = _normalize(subcategoryName);

        final childrenByName = resolvedChildIdsByParent.putIfAbsent(
          rootCategoryId,
          () => <String, String>{},
        );

        if (childrenByName.containsKey(normalizedSubcategory)) {
          continue;
        }

        final subcategoryId = await createCategoryViaBackend(
          name: subcategoryName,
          parentCategoryId: rootCategoryId,
        );

        childrenByName[normalizedSubcategory] = subcategoryId;

        createdCategories++;
      }

      // ----------------------------------------------------------------------
      // 3. MAPA DE RAIZES PARA O CREATEPRODUCT ATUAL
      //
      // T5-A3 deliberadamente preserva o comportamento anterior:
      // o createProduct recebe a categoria raiz e, quando informada, a subcategoria.
      // A ordem explicita enviada ao createProduct e [raiz, subcategoria].
      // ----------------------------------------------------------------------

      for (final entry in resolvedRootIdsByName.entries) {
        categoryRefs[entry.key] = categoriesRef.doc(entry.value);
      }
      // ========================================================================
      // PRODUTOS
      //
      // Nenhum produto e gravado diretamente no Firestore.
      // ========================================================================

      final callable = _functions.httpsCallable(
        'createProduct',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      );

      for (final product in analysis.newProducts) {
        final categoryName = product.category.trim();
        final subcategoryName = product.subcategory.trim();

        final categoryIds = <String>[];

        if (categoryName.isEmpty) {
          if (subcategoryName.isNotEmpty) {
            throw StateError(
              'Subcategoria informada sem categoria no produto "${product.name.trim()}".',
            );
          }
        } else {
          final normalizedCategory = _normalize(categoryName);

          final categoryRef = categoryRefs[normalizedCategory];

          if (categoryRef == null || categoryRef.id.trim().isEmpty) {
            throw StateError(
              'Nao foi possivel resolver a categoria do produto "${product.name.trim()}".',
            );
          }

          final rootCategoryId = categoryRef.id.trim();

          categoryIds.add(rootCategoryId);

          if (subcategoryName.isNotEmpty) {
            final childrenByName = resolvedChildIdsByParent[rootCategoryId];

            final childCategoryId =
                childrenByName?[_normalize(subcategoryName)];

            if (childCategoryId == null || childCategoryId.trim().isEmpty) {
              throw StateError(
                'Nao foi possivel resolver a subcategoria "$subcategoryName" do produto "${product.name.trim()}".',
              );
            }

            categoryIds.add(childCategoryId.trim());
          }
        }
        final createProductData = <String, dynamic>{
          'name': product.name.trim(),

          'price': product.price,

          'quantidade': product.integerQuantity,

          'lotes': <Map<String, dynamic>>[],

          'minimumStock': 0,

          'imageUrl': '',
        };

        final barcode = product.barcode.trim();

        if (barcode.isNotEmpty) {
          createProductData['barcode'] = barcode;
        }

        if (product.costPrice != null) {
          createProductData['costPrice'] = product.costPrice;
        }

        final ncm = product.ncm.trim();

        if (isBusiness && ncm.isNotEmpty) {
          createProductData['fiscal'] = <String, dynamic>{'ncm': ncm};
        }

        // Mantemos o mesmo requestId para este item enquanto o service estiver
        // ativo. Assim, um retry apos resposta ambigua continua idempotente.
        final requestId = _createProductRequestIds.putIfAbsent(
          product,
          () => _firestore.collection('_clientRequestIds').doc().id,
        );

        final response = await callable.call(<String, dynamic>{
          'requestId': requestId,

          'product': createProductData,

          'categoryIds': categoryIds,
        });

        final responseRaw = response.data;

        if (responseRaw is! Map) {
          throw StateError('Resposta invalida ao criar produto importado.');
        }

        final responseData = Map<String, dynamic>.from(responseRaw);

        final productId = responseData['productId'];

        if (responseData['success'] != true ||
            productId is! String ||
            productId.trim().isEmpty) {
          throw StateError('Resposta incompleta ao criar produto importado.');
        }

        importedProducts++;
      }
    } on ProductImportException {
      rethrow;
    } catch (error, stackTrace) {
      Error.throwWithStackTrace(
        ProductImportException(
          importedProducts: importedProducts,
          createdCategories: createdCategories,
          skippedDuplicates: analysis.duplicateProducts.length,
          cause: error,
        ),
        stackTrace,
      );
    }

    return ProductImportResult(
      importedProducts: importedProducts,

      skippedDuplicates: analysis.duplicateProducts.length,

      createdCategories: createdCategories,
    );
  }
}
