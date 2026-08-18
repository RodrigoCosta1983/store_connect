// ============================================================================
// ARQUIVO: product_import_confirmation_screen.dart
// ============================================================================
//
// OBJETIVO:
//
// Última etapa antes da gravação definitiva dos produtos.
//
// RESPONSABILIDADES:
//
// • Analisar possíveis duplicidades.
// • Mostrar produtos novos.
// • Mostrar produtos que serão ignorados.
// • Mostrar categorias novas.
// • Exigir confirmação explícita.
// • Chamar ProductImportService somente após confirmação.
//
// ============================================================================

import 'package:flutter/material.dart';

import 'package:store_connect/models/product_import_item.dart';
import 'package:store_connect/services/product_import_service.dart';

class ProductImportConfirmationScreen
    extends StatefulWidget {
  final String storeId;
  final bool isBusiness;

  final String fileName;

  final List<ProductImportItem> products;

  const ProductImportConfirmationScreen({
    super.key,
    required this.storeId,
    required this.isBusiness,
    required this.fileName,
    required this.products,
  });

  @override
  State<ProductImportConfirmationScreen>
  createState() =>
      _ProductImportConfirmationScreenState();
}

class _ProductImportConfirmationScreenState
    extends State<
        ProductImportConfirmationScreen> {
  final ProductImportService _service =
  ProductImportService();

  ProductImportAnalysis? _analysis;

  bool _isLoading = true;
  bool _isImporting = false;

  String? _error;

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    _loadAnalysis();
  }

  // ==========================================================================
  // ANALISAR
  // ==========================================================================

  Future<void> _loadAnalysis() async {
    try {
      final result =
      await _service.analyze(
        storeId:
        widget.storeId,

        products:
        widget.products,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _analysis = result;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }

      setState(() {
        _error =
            e.toString();

        _isLoading = false;
      });
    }
  }

  // ==========================================================================
  // IMPORTAR
  // ==========================================================================

  Future<void> _importProducts() async {
    final analysis =
        _analysis;

    if (analysis == null ||
        analysis.newProducts.isEmpty) {
      return;
    }

    final confirmed =
    await showDialog<bool>(
      context: context,

      builder: (ctx) =>
          AlertDialog(
            title:
            const Text(
              'Confirmar importação',
            ),

            content:
            Text(
              'Deseja importar ${analysis.newProducts.length} produto(s)?\n\n'
                  'Esta ação gravará os produtos no cadastro da loja.',
            ),

            actions: [
              TextButton(
                onPressed: () =>
                    Navigator.of(ctx)
                        .pop(false),

                child:
                const Text(
                  'Cancelar',
                ),
              ),

              ElevatedButton(
                onPressed: () =>
                    Navigator.of(ctx)
                        .pop(true),

                child:
                const Text(
                  'Importar',
                ),
              ),
            ],
          ),
    );

    if (confirmed != true ||
        !mounted) {
      return;
    }

    setState(() {
      _isImporting = true;
    });

    try {
      final result =
      await _service.importProducts(
        storeId:
        widget.storeId,

        isBusiness:
        widget.isBusiness,

        products:
        widget.products,
      );

      if (!mounted) {
        return;
      }

      await showDialog<void>(
        context: context,

        barrierDismissible:
        false,

        builder: (ctx) =>
            AlertDialog(
              icon:
              const Icon(
                Icons.check_circle,
                color:
                Colors.green,
                size: 48,
              ),

              title:
              const Text(
                'Importação concluída',
              ),

              content:
              Text(
                '${result.importedProducts} produto(s) importado(s).\n'
                    '${result.createdCategories} categoria(s) criada(s).\n'
                    '${result.skippedDuplicates} duplicado(s) ignorado(s).',
              ),

              actions: [
                ElevatedButton(
                  onPressed: () =>
                      Navigator.of(ctx)
                          .pop(),

                  child:
                  const Text(
                    'Concluir',
                  ),
                ),
              ],
            ),
      );

      if (!mounted) {
        return;
      }

      // Volta até a tela de produtos.
      Navigator.of(context).popUntil(
            (route) =>
        route.isFirst ||
            route.settings.name ==
                '/manage-products',
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            'Erro na importação: $e',
          ),
          backgroundColor:
          Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isImporting = false;
        });
      }
    }
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar:
      AppBar(
        title:
        const Text(
          'Confirmar Importação',
        ),
      ),

      body:
      _isLoading
          ? const Center(
        child:
        CircularProgressIndicator(),
      )
          : _error != null
          ? Center(
        child:
        Padding(
          padding:
          const EdgeInsets.all(
            24,
          ),
          child:
          Text(
            'Não foi possível analisar a importação.\n\n$_error',
            textAlign:
            TextAlign.center,
          ),
        ),
      )
          : _buildContent(),
    );
  }

  // ==========================================================================
  // CONTEÚDO
  // ==========================================================================

  Widget _buildContent() {
    final analysis =
    _analysis!;

    return SafeArea(
      child:
      Center(
        child:
        ConstrainedBox(
          constraints:
          const BoxConstraints(
            maxWidth: 1100,
          ),

          child:
          ListView(
            padding:
            const EdgeInsets.all(
              16,
            ),

            children: [
              // ==============================================================
              // ARQUIVO
              // ==============================================================

              Card(
                child:
                ListTile(
                  leading:
                  const CircleAvatar(
                    child:
                    Icon(
                      Icons
                          .description_outlined,
                    ),
                  ),

                  title:
                  Text(
                    widget.fileName,

                    style:
                    const TextStyle(
                      fontWeight:
                      FontWeight.bold,
                    ),
                  ),

                  subtitle:
                  Text(
                    '${widget.products.length} produto(s) analisado(s)',
                  ),
                ),
              ),

              const SizedBox(
                height: 24,
              ),

              // ==============================================================
              // RESUMO
              // ==============================================================

              Text(
                'Resumo da importação',

                style:
                Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(
                  fontWeight:
                  FontWeight.bold,
                ),
              ),

              const SizedBox(
                height: 14,
              ),

              Row(
                children: [
                  Expanded(
                    child:
                    _summary(
                      icon:
                      Icons
                          .add_circle_outline,
                      value:
                      analysis
                          .newProducts
                          .length,
                      label:
                      'Novos',
                      color:
                      Colors.green,
                    ),
                  ),

                  const SizedBox(
                    width: 10,
                  ),

                  Expanded(
                    child:
                    _summary(
                      icon:
                      Icons
                          .content_copy_outlined,
                      value:
                      analysis
                          .duplicateProducts
                          .length,
                      label:
                      'Duplicados',
                      color:
                      Colors.orange,
                    ),
                  ),

                  const SizedBox(
                    width: 10,
                  ),

                  Expanded(
                    child:
                    _summary(
                      icon:
                      Icons
                          .category_outlined,
                      value:
                      analysis
                          .newCategories
                          .length,
                      label:
                      'Categorias',
                      color:
                      Colors.blue,
                    ),
                  ),
                ],
              ),

              // ==============================================================
              // CATEGORIAS NOVAS
              // ==============================================================

              if (analysis
                  .newCategories
                  .isNotEmpty) ...[
                const SizedBox(
                  height: 28,
                ),

                Text(
                  'Categorias que serão criadas',

                  style:
                  Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                    fontWeight:
                    FontWeight.bold,
                  ),
                ),

                const SizedBox(
                  height: 10,
                ),

                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children:
                  analysis
                      .newCategories
                      .map(
                        (category) =>
                        Chip(
                          avatar:
                          const Icon(
                            Icons
                                .category_outlined,
                            size:
                            18,
                          ),
                          label:
                          Text(
                            category,
                          ),
                        ),
                  )
                      .toList(),
                ),
              ],

              // ==============================================================
              // DUPLICADOS
              // ==============================================================

              if (analysis
                  .duplicateProducts
                  .isNotEmpty) ...[
                const SizedBox(
                  height: 28,
                ),

                Text(
                  'Produtos que serão ignorados',

                  style:
                  Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                    fontWeight:
                    FontWeight.bold,
                  ),
                ),

                const SizedBox(
                  height: 6,
                ),

                const Text(
                  'Já existe um produto com o mesmo nome ou código de barras.',
                ),

                const SizedBox(
                  height: 10,
                ),

                ...analysis
                    .duplicateProducts
                    .map(
                      (product) =>
                      Card(
                        child:
                        ListTile(
                          leading:
                          const Icon(
                            Icons
                                .content_copy,
                            color:
                            Colors.orange,
                          ),

                          title:
                          Text(
                            product.name,
                          ),

                          subtitle:
                          Text(
                            'Linha ${product.sourceRow} da planilha',
                          ),
                        ),
                      ),
                ),
              ],

              const SizedBox(
                height: 28,
              ),

              // ==============================================================
              // NOVOS PRODUTOS
              // ==============================================================

              Text(
                'Produtos que serão importados',

                style:
                Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(
                  fontWeight:
                  FontWeight.bold,
                ),
              ),

              const SizedBox(
                height: 10,
              ),

              ...analysis.newProducts.map(
                    (product) =>
                    Card(
                      child:
                      ListTile(
                        leading:
                        const Icon(
                          Icons
                              .inventory_2_outlined,
                          color:
                          Colors.green,
                        ),

                        title:
                        Text(
                          product.name,

                          style:
                          const TextStyle(
                            fontWeight:
                            FontWeight.bold,
                          ),
                        ),

                        subtitle:
                        Text(
                          'R\$ ${product.price.toStringAsFixed(2)}'
                              ' • Estoque: ${product.integerQuantity}'
                              '${product.category.isNotEmpty ? ' • ${product.category}' : ''}',
                        ),
                      ),
                    ),
              ),

              const SizedBox(
                height: 24,
              ),

              Container(
                padding:
                const EdgeInsets.all(
                  14,
                ),

                decoration:
                BoxDecoration(
                  color:
                  Colors.amber
                      .withOpacity(
                    0.08,
                  ),

                  borderRadius:
                  BorderRadius.circular(
                    12,
                  ),
                ),

                child:
                const Row(
                  crossAxisAlignment:
                  CrossAxisAlignment.start,

                  children: [
                    Icon(
                      Icons
                          .info_outline,
                      color:
                      Colors.amber,
                    ),

                    SizedBox(
                      width: 10,
                    ),

                    Expanded(
                      child:
                      Text(
                        'Produtos identificados como duplicados não serão alterados. '
                            'Nesta primeira versão da importação, o Store Connect apenas '
                            'cria produtos novos.',
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(
                height: 24,
              ),

              SizedBox(
                height: 54,

                child:
                ElevatedButton.icon(
                  onPressed:
                  _isImporting ||
                      analysis
                          .newProducts
                          .isEmpty
                      ? null
                      : _importProducts,

                  icon:
                  _isImporting
                      ? const SizedBox(
                    width:
                    20,
                    height:
                    20,
                    child:
                    CircularProgressIndicator(
                      strokeWidth:
                      2,
                    ),
                  )
                      : const Icon(
                    Icons
                        .upload_outlined,
                  ),

                  label:
                  Text(
                    _isImporting
                        ? 'IMPORTANDO...'
                        : 'IMPORTAR ${analysis.newProducts.length} PRODUTO(S)',
                  ),
                ),
              ),

              const SizedBox(
                height: 24,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ==========================================================================
  // CARD RESUMO
  // ==========================================================================

  Widget _summary({
    required IconData icon,
    required int value,
    required String label,
    required Color color,
  }) {
    return Container(
      padding:
      const EdgeInsets.symmetric(
        vertical: 16,
        horizontal: 6,
      ),

      decoration:
      BoxDecoration(
        borderRadius:
        BorderRadius.circular(
          12,
        ),

        color:
        color.withOpacity(
          0.06,
        ),

        border:
        Border.all(
          color:
          color.withOpacity(
            0.25,
          ),
        ),
      ),

      child:
      Column(
        children: [
          Icon(
            icon,
            color: color,
          ),

          const SizedBox(
            height: 6,
          ),

          Text(
            value.toString(),

            style:
            const TextStyle(
              fontSize: 20,
              fontWeight:
              FontWeight.bold,
            ),
          ),

          Text(
            label,
            style:
            const TextStyle(
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}