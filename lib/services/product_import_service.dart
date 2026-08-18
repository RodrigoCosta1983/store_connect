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

  ProductImportService({
    FirebaseFirestore? firestore,
  }) : _firestore =
      firestore ??
          FirebaseFirestore.instance;

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
    // ========================================================================
    // ANALISA NOVAMENTE
    //
    // Mesmo que a tela já tenha analisado antes, repetimos aqui para evitar
    // que algum produto tenha sido criado entre a confirmação e a importação.
    // ========================================================================

    final analysis =
    await analyze(
      storeId: storeId,
      products: products,
    );

    final storeRef =
    _firestore
        .collection('stores')
        .doc(storeId);

    final productsRef =
    storeRef.collection(
      'products',
    );

    final categoriesRef =
    storeRef.collection(
      'categories',
    );

    // ========================================================================
    // MAPA FINAL DE CATEGORIAS
    //
    // chave = nome normalizado
    // valor = DocumentReference
    // ========================================================================

    final categoryRefs =
    <String,
        DocumentReference<
            Map<String, dynamic>>>{};

    // Categorias existentes.

    for (final entry
    in analysis
        .existingCategoryIds
        .entries) {
      categoryRefs[entry.key] =
          categoriesRef.doc(
            entry.value,
          );
    }

    // ========================================================================
    // PREPARAR CATEGORIAS NOVAS
    // ========================================================================

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
    // CRIAR OPERAÇÕES
    //
    // Firestore possui limite de operações por batch.
    // Usamos blocos menores por segurança.
    // ========================================================================

    final operations =
    <void Function(
        WriteBatch batch,
        )>[];

    // ------------------------------------------------------------------------
    // CATEGORIAS
    // ------------------------------------------------------------------------

    for (final entry
    in newCategoryRefs.entries) {
      final categoryName =
      analysis.newCategories
          .firstWhere(
            (name) =>
        _normalize(name) ==
            entry.key,
      );

      operations.add(
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

    // ------------------------------------------------------------------------
    // PRODUTOS
    // ------------------------------------------------------------------------

    for (final product
    in analysis.newProducts) {
      operations.add(
            (batch) {
          final productRef =
          productsRef.doc();

          final categoryName =
          product.category
              .trim();

          String categoryId = '';

          if (categoryName
              .isNotEmpty) {
            final categoryRef =
            categoryRefs[
            _normalize(
              categoryName,
            )];

            categoryId =
                categoryRef?.id ??
                    '';
          }

          final productData =
          <String, dynamic>{
            // ================================================================
            // CAMPOS PADRÃO DO STORE CONNECT
            // ================================================================

            'name':
            product.name.trim(),

            'name_lowercase':
            product.name
                .trim()
                .toLowerCase(),

            'price':
            product.price,

            // Importação inicial não cria lotes.
            'lotes':
            <Map<String, dynamic>>[],

            'quantidade':
            product.integerQuantity,

            // Sem informação na planilha = padrão 0.
            'minimumStock':
            0,

            // Sem imagem durante importação.
            'imageUrl':
            '',

            'categoryId':
            categoryId,

            'categoryName':
            categoryName,

            'createdAt':
            FieldValue
                .serverTimestamp(),
          };

          // ================================================================
          // CAMPOS ADICIONAIS DA IMPORTAÇÃO
          //
          // Não interferem no cadastro antigo.
          // ================================================================

          if (product.barcode
              .trim()
              .isNotEmpty) {
            productData['barcode'] =
                product.barcode
                    .trim();
          }

          if (product.costPrice !=
              null) {
            productData[
            'costPrice'] =
                product.costPrice;
          }

          // ================================================================
          // FISCAL - BUSINESS
          //
          // Só criamos o mapa fiscal se houver NCM.
          //
          // Não inventamos CFOP, origem ou unidade.
          // Esses dados poderão ser completados depois pelo lojista.
          // ================================================================

          if (isBusiness &&
              product.ncm
                  .trim()
                  .isNotEmpty) {
            productData['fiscal'] = {
              'ncm':
              product.ncm.trim(),

              'updatedAt':
              FieldValue
                  .serverTimestamp(),
            };
          }

          batch.set(
            productRef,
            productData,
          );
        },
      );
    }

    // ========================================================================
    // EXECUTAR EM LOTES
    // ========================================================================

    const operationsPerBatch =
    400;

    for (
    int start = 0;
    start < operations.length;
    start += operationsPerBatch
    ) {
      final end =
      (start +
          operationsPerBatch <
          operations.length)
          ? start +
          operationsPerBatch
          : operations.length;

      final batch =
      _firestore.batch();

      for (
      int i = start;
      i < end;
      i++
      ) {
        operations[i](
          batch,
        );
      }

      await batch.commit();
    }

    return ProductImportResult(
      importedProducts:
      analysis.newProducts.length,

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