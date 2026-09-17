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

class ProductImportAnalysis {
  final List<ProductImportItem> newProducts;

  final List<ProductImportItem> duplicateProducts;

  final List<String> newCategories;

  final Map<String, String> existingCategoryIds;

  const ProductImportAnalysis({
    required this.newProducts,
    required this.duplicateProducts,
    required this.newCategories,
    required this.existingCategoryIds,
  });

  int get totalProducts =>
      newProducts.length +
          duplicateProducts.length;
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
  }) : _firestore =
      firestore ??
          FirebaseFirestore.instance,
       _functions =
      functions ??
          FirebaseFunctions.instance;

  // ==========================================================================
  // NORMALIZAR
  // ==========================================================================

  String _normalize(
      String value,
      ) {
    return value
        .trim()
        .toLowerCase();
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
    final productsRef =
    _firestore
        .collection('stores')
        .doc(storeId)
        .collection('products');

    final categoriesRef =
    _firestore
        .collection('stores')
        .doc(storeId)
        .collection('categories');

    // ========================================================================
    // PRODUTOS EXISTENTES
    // ========================================================================

    final productSnapshot =
    await productsRef.get();

    final existingNames =
    <String>{};

    final existingBarcodes =
    <String>{};

    for (final doc
    in productSnapshot.docs) {
      final data =
      doc.data();

      final name =
          data['name_lowercase']
              ?.toString()
              .trim()
              .toLowerCase() ??
              data['name']
                  ?.toString()
                  .trim()
                  .toLowerCase() ??
              '';

      if (name.isNotEmpty) {
        existingNames.add(
          name,
        );
      }

      final barcode =
          data['barcode']
              ?.toString()
              .trim() ??
              '';

      if (barcode.isNotEmpty) {
        existingBarcodes.add(
          barcode,
        );
      }
    }

    // ========================================================================
    // CATEGORIAS EXISTENTES
    // ========================================================================

    final categorySnapshot =
    await categoriesRef.get();

    final existingCategoryIds =
    <String, String>{};

    for (final doc
    in categorySnapshot.docs) {
      final data =
      doc.data();

      final name =
          data['name']
              ?.toString()
              .trim() ??
              '';

      if (name.isEmpty) {
        continue;
      }

      existingCategoryIds[
      _normalize(name)] =
          doc.id;
    }

    // ========================================================================
    // CLASSIFICAR PRODUTOS
    // ========================================================================

    final newProducts =
    <ProductImportItem>[];

    final duplicateProducts =
    <ProductImportItem>[];

    // Também evita duplicidade DENTRO da própria planilha.

    final namesSeenInFile =
    <String>{};

    final barcodesSeenInFile =
    <String>{};

    for (final product in products) {
      final normalizedName =
      _normalize(
        product.name,
      );

      final barcode =
      product.barcode.trim();

      bool duplicate = false;

      // ----------------------------------------------------------------------
      // DUPLICIDADE POR CÓDIGO
      // ----------------------------------------------------------------------

      if (barcode.isNotEmpty) {
        if (existingBarcodes.contains(
          barcode,
        ) ||
            barcodesSeenInFile.contains(
              barcode,
            )) {
          duplicate = true;
        }
      }

      // ----------------------------------------------------------------------
      // DUPLICIDADE POR NOME
      // ----------------------------------------------------------------------

      if (!duplicate &&
          normalizedName.isNotEmpty) {
        if (existingNames.contains(
          normalizedName,
        ) ||
            namesSeenInFile.contains(
              normalizedName,
            )) {
          duplicate = true;
        }
      }

      if (duplicate) {
        duplicateProducts.add(
          product,
        );

        continue;
      }

      newProducts.add(
        product,
      );

      namesSeenInFile.add(
        normalizedName,
      );

      if (barcode.isNotEmpty) {
        barcodesSeenInFile.add(
          barcode,
        );
      }
    }

    // ========================================================================
    // DESCOBRIR CATEGORIAS NOVAS
    // ========================================================================

    final newCategoriesMap =
    <String, String>{};

    for (final product
    in newProducts) {
      final category =
      product.category.trim();

      if (category.isEmpty) {
        continue;
      }

      final normalized =
      _normalize(
        category,
      );

      if (existingCategoryIds
          .containsKey(normalized)) {
        continue;
      }

      newCategoriesMap[
      normalized] = category;
    }

    return ProductImportAnalysis(
      newProducts:
      newProducts,

      duplicateProducts:
      duplicateProducts,

      newCategories:
      newCategoriesMap.values
          .toList()
        ..sort(),

      existingCategoryIds:
      existingCategoryIds,
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
    final analysis =
    await analyze(
      storeId: storeId,
      products: products,
    );

    final storeRef =
    _firestore
        .collection('stores')
        .doc(storeId);

    final categoriesRef =
    storeRef.collection(
      'categories',
    );

    // ========================================================================
    // RESOLUCAO DE CATEGORIAS
    // ========================================================================

    final categoryRefs =
    <String,
        DocumentReference<
            Map<String, dynamic>>>{};

    for (final entry
    in analysis
        .existingCategoryIds
        .entries) {
      categoryRefs[entry.key] =
          categoriesRef.doc(
            entry.value,
          );
    }

    final newCategoryRefs =
    <String,
        DocumentReference<
            Map<String, dynamic>>>{};

    for (final categoryName
    in analysis.newCategories) {
      final normalized =
      _normalize(
        categoryName,
      );

      final ref =
      categoriesRef.doc();

      newCategoryRefs[
      normalized] = ref;

      categoryRefs[
      normalized] = ref;
    }

    // ========================================================================
    // CATEGORIAS NOVAS
    //
    // Continuam como write direto neste incremento.
    // ========================================================================

    final categoryOperations =
    <void Function(
        WriteBatch batch,
        )>[];

    for (final entry
    in newCategoryRefs.entries) {
      final categoryName =
      analysis.newCategories
          .firstWhere(
            (name) =>
        _normalize(name) ==
            entry.key,
      );

      categoryOperations.add(
            (batch) {
          batch.set(
            entry.value,
            {
              'name':
              categoryName,

              'imageUrl':
              '',

              'createdAt':
              FieldValue
                  .serverTimestamp(),
            },
          );
        },
      );
    }

    const operationsPerBatch =
    400;

    for (
    int start = 0;
    start < categoryOperations.length;
    start += operationsPerBatch
    ) {
      final end =
      (start +
          operationsPerBatch <
          categoryOperations.length)
          ? start +
          operationsPerBatch
          : categoryOperations.length;

      final batch =
      _firestore.batch();

      for (
      int i = start;
      i < end;
      i++
      ) {
        categoryOperations[i](
          batch,
        );
      }

      await batch.commit();
    }

    // ========================================================================
    // PRODUTOS
    //
    // Nenhum produto e gravado diretamente no Firestore.
    // ========================================================================

    final callable =
    _functions.httpsCallable(
      'createProduct',
      options:
      HttpsCallableOptions(
        timeout:
        const Duration(
          seconds: 30,
        ),
      ),
    );

    int importedProducts = 0;

    for (final product
    in analysis.newProducts) {
      final categoryName =
      product.category.trim();

      final categoryIds =
      <String>[];

      if (categoryName.isNotEmpty) {
        final categoryRef =
        categoryRefs[
        _normalize(
          categoryName,
        )];

        if (
        categoryRef == null ||
            categoryRef.id.trim().isEmpty
        ) {
          throw StateError(
            'Nao foi possivel resolver a categoria do produto "${product.name.trim()}".',
          );
        }

        categoryIds.add(
          categoryRef.id,
        );
      }

      final createProductData =
      <String, dynamic>{
        'name':
        product.name.trim(),

        'price':
        product.price,

        'quantidade':
        product.integerQuantity,

        'lotes':
        <Map<String, dynamic>>[],

        'minimumStock':
        0,

        'imageUrl':
        '',
      };

      final barcode =
      product.barcode.trim();

      if (barcode.isNotEmpty) {
        createProductData[
        'barcode'] = barcode;
      }

      if (product.costPrice != null) {
        createProductData[
        'costPrice'] =
            product.costPrice;
      }

      final ncm =
      product.ncm.trim();

      if (
      isBusiness &&
          ncm.isNotEmpty
      ) {
        createProductData[
        'fiscal'] =
        <String, dynamic>{
          'ncm': ncm,
        };
      }

      // Mantemos o mesmo requestId para este item enquanto o service estiver
      // ativo. Assim, um retry apos resposta ambigua continua idempotente.
      final requestId =
      _createProductRequestIds.putIfAbsent(
        product,
        () => _firestore
            .collection('_clientRequestIds')
            .doc()
            .id,
      );

      final response =
      await callable.call(
        <String, dynamic>{
          'requestId':
          requestId,

          'product':
          createProductData,

          'categoryIds':
          categoryIds,
        },
      );

      final responseRaw =
          response.data;

      if (responseRaw is! Map) {
        throw StateError(
          'Resposta invalida ao criar produto importado.',
        );
      }

      final responseData =
      Map<String, dynamic>.from(
        responseRaw,
      );

      final productId =
      responseData[
      'productId'];

      if (
      responseData['success'] != true ||
          productId is! String ||
          productId.trim().isEmpty
      ) {
        throw StateError(
          'Resposta incompleta ao criar produto importado.',
        );
      }

      importedProducts++;
    }

    return ProductImportResult(
      importedProducts:
      importedProducts,

      skippedDuplicates:
      analysis
          .duplicateProducts
          .length,

      createdCategories:
      analysis
          .newCategories
          .length,
    );
  }
}