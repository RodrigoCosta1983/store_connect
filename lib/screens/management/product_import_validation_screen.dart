// ============================================================================
// ARQUIVO: product_import_validation_screen.dart
// ============================================================================
//
// OBJETIVO:
//
// Terceira etapa do assistente de importação de produtos.
//
// Esta tela recebe:
//
// • As linhas originais da planilha
// • O mapeamento das colunas
// • O ID da loja
// • O plano da loja
// • O nome do arquivo
//
// E transforma cada linha da planilha em um produto provisório,
// validando os dados ANTES de qualquer gravação no Firestore.
//
// FLUXO:
//
// product_import_screen.dart
//        ↓
// product_import_mapping_screen.dart
//        ↓
// product_import_validation_screen.dart
//        ↓
// product_import_confirmation_screen.dart
//        ↓
// ProductImportService
//        ↓
// Firestore
//
// IMPORTANTE:
//
// ESTA TELA NÃO GRAVA NADA NO FIRESTORE.
//
// Somente após:
// 1. leitura
// 2. mapeamento
// 3. validação
// 4. confirmação explícita
//
// o ProductImportService poderá efetivamente salvar os produtos.
//
// VALIDAÇÕES:
//
// • Nome obrigatório
// • Preço de venda obrigatório
// • Preço precisa ser numérico
// • Preço não pode ser negativo
// • Quantidade precisa ser numérica, quando informada
// • Quantidade negativa gera atenção
// • Quantidade decimal gera atenção porque o estoque atual é inteiro
// • Categoria vazia gera atenção quando a coluna foi mapeada
// • Preço de custo precisa ser numérico, quando informado
// • NCM precisa possuir 8 dígitos, quando informado
//
// STATUS:
//
// ✓ PRONTO
//   Produto pode seguir normalmente.
//
// ⚠ ATENÇÃO
//   Produto pode seguir, mas possui algum dado que merece conferência.
//
// ✕ ERRO
//   Produto não pode seguir para a confirmação.
//
// RESPONSIVIDADE:
//
// • Mobile:
//   utiliza a largura disponível.
//
// • Web / Desktop:
//   conteúdo centralizado com largura máxima de 1100px.
//
// MANUTENÇÃO:
//
// • NÃO adicionar gravação Firestore diretamente nesta tela.
// • O objeto ProductImportItem é o contrato entre esta tela,
//   a confirmação e o ProductImportService.
// • Manter sourceRow para identificar a linha original da planilha.
// • Não corrigir silenciosamente dados inválidos.
//
// ============================================================================

import 'package:flutter/material.dart';

import 'package:store_connect/models/product_import_item.dart';
import 'package:store_connect/screens/management/product_import_confirmation_screen.dart';

// ============================================================================
// STATUS DE VALIDAÇÃO
// ============================================================================

enum _ImportValidationStatus {
  ready,
  warning,
  error,
}

// ============================================================================
// PRODUTO VALIDADO TEMPORÁRIO
//
// Este modelo existe somente dentro desta tela.
//
// Quando o usuário continuar, produtos sem erro serão convertidos em:
//
// ProductImportItem
//
// que será utilizado pelas próximas etapas.
// ============================================================================

class _ValidatedImportProduct {
  final int sourceRow;

  final String name;

  final double? price;

  final double? quantity;

  final String category;

  final String barcode;

  final double? costPrice;

  final String ncm;

  final _ImportValidationStatus status;

  final List<String> errors;

  final List<String> warnings;

  const _ValidatedImportProduct({
    required this.sourceRow,
    required this.name,
    required this.price,
    required this.quantity,
    required this.category,
    required this.barcode,
    required this.costPrice,
    required this.ncm,
    required this.status,
    required this.errors,
    required this.warnings,
  });

  // ==========================================================================
  // CONVERTE PARA O MODELO COMPARTILHADO DA IMPORTAÇÃO
  //
  // Este método só deve ser chamado quando o produto não possui erros.
  // ==========================================================================

  ProductImportItem toImportItem() {
    if (name.trim().isEmpty) {
      throw StateError(
        'Não é possível converter um produto sem nome.',
      );
    }

    if (price == null) {
      throw StateError(
        'Não é possível converter um produto sem preço.',
      );
    }

    return ProductImportItem(
      sourceRow: sourceRow,

      name: name.trim(),

      price: price!,

      // Quantidade não informada assume zero.
      quantity: quantity ?? 0,

      category: category.trim(),

      barcode: barcode.trim(),

      costPrice: costPrice,

      ncm: ncm.trim(),
    );
  }
}

// ============================================================================
// TELA
// ============================================================================

class ProductImportValidationScreen extends StatefulWidget {
  final String storeId;

  final bool isBusiness;

  final String fileName;

  // Primeira linha:
  // cabeçalho.
  //
  // Demais linhas:
  // produtos.
  final List<List<String>> rows;

  // Campo Store Connect → índice da coluna da planilha.
  //
  // Exemplo:
  //
  // {
  //   'name': 0,
  //   'price': 1,
  //   'quantity': 2,
  //   'category': 3,
  // }
  final Map<String, int?> mapping;

  const ProductImportValidationScreen({
    super.key,
    required this.storeId,
    required this.isBusiness,
    required this.fileName,
    required this.rows,
    required this.mapping,
  });

  @override
  State<ProductImportValidationScreen> createState() =>
      _ProductImportValidationScreenState();
}

// ============================================================================
// STATE
// ============================================================================

class _ProductImportValidationScreenState
    extends State<ProductImportValidationScreen> {
  // ==========================================================================
  // PRODUTOS VALIDADO
  // ==========================================================================

  late final List<_ValidatedImportProduct> _products;

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    _products = _validateProducts();
  }

  // ==========================================================================
  // CONTADORES
  // ==========================================================================

  int get _readyCount {
    return _products
        .where(
          (product) =>
      product.status ==
          _ImportValidationStatus.ready,
    )
        .length;
  }

  int get _warningCount {
    return _products
        .where(
          (product) =>
      product.status ==
          _ImportValidationStatus.warning,
    )
        .length;
  }

  int get _errorCount {
    return _products
        .where(
          (product) =>
      product.status ==
          _ImportValidationStatus.error,
    )
        .length;
  }

  // ==========================================================================
  // LER CAMPO DA LINHA
  //
  // Exemplo:
  //
  // _readField(row, 'name')
  //
  // consulta o mapeamento e descobre em qual coluna está o nome.
  // ==========================================================================

  String _readField(
      List<String> row,
      String fieldKey,
      ) {
    final columnIndex =
    widget.mapping[fieldKey];

    if (columnIndex == null) {
      return '';
    }

    if (columnIndex < 0 ||
        columnIndex >= row.length) {
      return '';
    }

    return row[columnIndex].trim();
  }

  // ==========================================================================
  // CONVERTER NÚMERO
  //
  // Aceita formatos como:
  //
  // 59.90
  // 59,90
  // R$ 59,90
  // 1.299,90
  // 1299.90
  // 1,299.90
  //
  // ==========================================================================

  double? _parseNumber(
      String value,
      ) {
    var text =
    value.trim();

    if (text.isEmpty) {
      return null;
    }

    // ------------------------------------------------------------------------
    // REMOVE MOEDA / ESPAÇOS
    // ------------------------------------------------------------------------

    text = text
        .replaceAll(
      'R\$',
      '',
    )
        .replaceAll(
      ' ',
      '',
    );

    // ------------------------------------------------------------------------
    // POSSUI PONTO E VÍRGULA
    //
    // Precisamos descobrir qual deles representa os centavos.
    // ------------------------------------------------------------------------

    if (text.contains(',') &&
        text.contains('.')) {
      final lastComma =
      text.lastIndexOf(',');

      final lastDot =
      text.lastIndexOf('.');

      // ----------------------------------------------------------------------
      // PADRÃO BRASILEIRO
      //
      // 1.299,90
      // ----------------------------------------------------------------------

      if (lastComma > lastDot) {
        text = text
            .replaceAll(
          '.',
          '',
        )
            .replaceAll(
          ',',
          '.',
        );
      }

      // ----------------------------------------------------------------------
      // PADRÃO INTERNACIONAL
      //
      // 1,299.90
      // ----------------------------------------------------------------------

      else {
        text =
            text.replaceAll(
              ',',
              '',
            );
      }
    }

    // ------------------------------------------------------------------------
    // SOMENTE VÍRGULA
    //
    // 59,90
    // ------------------------------------------------------------------------

    else if (text.contains(',')) {
      text =
          text.replaceAll(
            ',',
            '.',
          );
    }

    // ------------------------------------------------------------------------
    // REMOVE CARACTERES RESIDUAIS
    // ------------------------------------------------------------------------

    text =
        text.replaceAll(
          RegExp(
            r'[^0-9.\-]',
          ),
          '',
        );

    return double.tryParse(
      text,
    );
  }

  // ==========================================================================
  // SOMENTE DÍGITOS
  // ==========================================================================

  String _onlyDigits(
      String value,
      ) {
    return value.replaceAll(
      RegExp(
        r'\D',
      ),
      '',
    );
  }

  // ==========================================================================
  // VALIDAR TODOS OS PRODUTOS
  // ==========================================================================

  List<_ValidatedImportProduct>
  _validateProducts() {
    // Precisamos pelo menos de:
    //
    // linha 1 = cabeçalho
    // linha 2 = produto

    if (widget.rows.length <= 1) {
      return [];
    }

    final result =
    <_ValidatedImportProduct>[];

    // Começa em 1 porque:
    //
    // rows[0] = cabeçalho.

    for (
    int index = 1;
    index < widget.rows.length;
    index++
    ) {
      final row =
      widget.rows[index];

      result.add(
        _validateRow(
          row,

          // Excel começa a contar em 1.
          //
          // index 1 do nosso array corresponde à linha 2 da planilha.
          index + 1,
        ),
      );
    }

    return result;
  }

  // ==========================================================================
  // VALIDAR UMA LINHA
  // ==========================================================================

  _ValidatedImportProduct _validateRow(
      List<String> row,
      int spreadsheetRow,
      ) {
    final errors =
    <String>[];

    final warnings =
    <String>[];

    // =========================================================================
    // 1. NOME
    // =========================================================================

    final name =
    _readField(
      row,
      'name',
    );

    if (name.isEmpty) {
      errors.add(
        'Nome do produto não informado.',
      );
    }

    // =========================================================================
    // 2. PREÇO DE VENDA
    // =========================================================================

    final rawPrice =
    _readField(
      row,
      'price',
    );

    final price =
    _parseNumber(
      rawPrice,
    );

    if (rawPrice.isEmpty) {
      errors.add(
        'Preço de venda não informado.',
      );
    } else if (price == null) {
      errors.add(
        'Preço de venda inválido: "$rawPrice".',
      );
    } else if (price < 0) {
      errors.add(
        'Preço de venda não pode ser negativo.',
      );
    }

    // =========================================================================
    // 3. QUANTIDADE
    // =========================================================================

    final rawQuantity =
    _readField(
      row,
      'quantity',
    );

    final quantity =
    _parseNumber(
      rawQuantity,
    );

    // -------------------------------------------------------------------------
    // Valor preenchido, mas inválido.
    // -------------------------------------------------------------------------

    if (rawQuantity.isNotEmpty &&
        quantity == null) {
      errors.add(
        'Quantidade inválida: "$rawQuantity".',
      );
    }

    // -------------------------------------------------------------------------
    // Estoque negativo.
    //
    // Não bloqueamos a importação, mas avisamos.
    // -------------------------------------------------------------------------

    if (quantity != null &&
        quantity < 0) {
      warnings.add(
        'Quantidade negativa. Confira o estoque informado.',
      );
    }

    // -------------------------------------------------------------------------
    // Quantidade decimal.
    //
    // Atualmente o estoque do Store Connect trabalha com inteiro.
    // ProductImportItem.integerQuantity fará a conversão posteriormente.
    //
    // Por isso avisamos o usuário em vez de alterar silenciosamente.
    // -------------------------------------------------------------------------

    if (quantity != null &&
        quantity >= 0 &&
        quantity % 1 != 0) {
      warnings.add(
        'Quantidade decimal informada ($rawQuantity). '
            'O estoque será convertido para um número inteiro na importação.',
      );
    }

    // =========================================================================
    // 4. CATEGORIA
    // =========================================================================

    final category =
    _readField(
      row,
      'category',
    );

    // Só avisa categoria vazia se o usuário realmente mapeou
    // uma coluna de categoria.

    if (widget.mapping['category'] !=
        null &&
        category.isEmpty) {
      warnings.add(
        'Categoria não informada.',
      );
    }

    // =========================================================================
    // 5. CÓDIGO DE BARRAS
    // =========================================================================

    final barcode =
    _readField(
      row,
      'barcode',
    );

    // -------------------------------------------------------------------------
    // Nesta primeira versão:
    //
    // NÃO invalidamos tamanho do código.
    //
    // Motivo:
    // além de EAN/GTIN, clientes podem trabalhar com códigos internos.
    // -------------------------------------------------------------------------

    // =========================================================================
    // 6. PREÇO DE CUSTO
    // =========================================================================

    final rawCostPrice =
    _readField(
      row,
      'costPrice',
    );

    final costPrice =
    _parseNumber(
      rawCostPrice,
    );

    if (rawCostPrice.isNotEmpty &&
        costPrice == null) {
      errors.add(
        'Preço de custo inválido: "$rawCostPrice".',
      );
    }

    if (costPrice != null &&
        costPrice < 0) {
      errors.add(
        'Preço de custo não pode ser negativo.',
      );
    }

    // =========================================================================
    // 7. NCM
    // =========================================================================

    final rawNcm =
    _readField(
      row,
      'ncm',
    );

    final ncm =
    _onlyDigits(
      rawNcm,
    );

    if (rawNcm.isNotEmpty &&
        ncm.length != 8) {
      errors.add(
        'NCM deve possuir 8 dígitos.',
      );
    }

    // =========================================================================
    // 8. STATUS FINAL
    // =========================================================================

    final _ImportValidationStatus
    status;

    if (errors.isNotEmpty) {
      status =
          _ImportValidationStatus.error;
    } else if (warnings.isNotEmpty) {
      status =
          _ImportValidationStatus.warning;
    } else {
      status =
          _ImportValidationStatus.ready;
    }

    // =========================================================================
    // PRODUTO VALIDADO
    // =========================================================================

    return _ValidatedImportProduct(
      sourceRow:
      spreadsheetRow,

      name:
      name,

      price:
      price,

      quantity:
      quantity,

      category:
      category,

      barcode:
      barcode,

      costPrice:
      costPrice,

      ncm:
      ncm,

      status:
      status,

      errors:
      errors,

      warnings:
      warnings,
    );
  }

  // ==========================================================================
  // CONVERTER PRODUTOS PARA O MODELO COMPARTILHADO
  // ==========================================================================

  List<ProductImportItem>
  _buildImportItems() {
    // Este método só deve ser chamado quando não houver erros.

    return _products
        .map(
          (product) =>
          product.toImportItem(),
    )
        .toList();
  }

  // ==========================================================================
  // CONTINUAR PARA A CONFIRMAÇÃO
  // ==========================================================================

  void _continueImport() {
    // =========================================================================
    // NÃO PERMITE CONTINUAR COM ERROS
    // =========================================================================

    if (_errorCount > 0) {
      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            'Existem $_errorCount produto(s) com erro. '
                'Corrija a planilha ou volte ao mapeamento antes de continuar.',
          ),
          backgroundColor:
          Colors.red,
        ),
      );

      return;
    }

    // =========================================================================
    // NÃO HÁ PRODUTOS
    // =========================================================================

    if (_products.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(
        const SnackBar(
          content: Text(
            'Nenhum produto válido foi encontrado.',
          ),
        ),
      );

      return;
    }

    // =========================================================================
    // CONVERTE PARA ProductImportItem
    // =========================================================================

    final importItems =
    _buildImportItems();

    // =========================================================================
    // ABRE A ETAPA DE CONFIRMAÇÃO
    //
    // A confirmação fará:
    //
    // • consulta ao Firestore
    // • análise de duplicidade
    // • análise das categorias
    // • resumo final
    //
    // MAS AINDA NÃO GRAVA AUTOMATICAMENTE.
    //
    // A escrita acontece somente após o usuário tocar em IMPORTAR.
    // =========================================================================

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) =>
            ProductImportConfirmationScreen(
              storeId:
              widget.storeId,

              isBusiness:
              widget.isBusiness,

              fileName:
              widget.fileName,

              products:
              importItems,
            ),
      ),
    );
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(
      BuildContext context,
      ) {
    return Scaffold(
      // ======================================================================
      // APP BAR
      // ======================================================================

      appBar: AppBar(
        title:
        const Text(
          'Validar Produtos',
        ),
      ),

      // ======================================================================
      // CONTEÚDO
      // ======================================================================

      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
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
                // ============================================================
                // INTRODUÇÃO
                // ============================================================

                Container(
                  padding:
                  const EdgeInsets.all(
                    16,
                  ),

                  decoration:
                  BoxDecoration(
                    color:
                    Colors.blue
                        .withOpacity(
                      0.08,
                    ),

                    borderRadius:
                    BorderRadius.circular(
                      14,
                    ),
                  ),

                  child:
                  const Row(
                    crossAxisAlignment:
                    CrossAxisAlignment.start,

                    children: [
                      Icon(
                        Icons
                            .fact_check_outlined,
                      ),

                      SizedBox(
                        width: 12,
                      ),

                      Expanded(
                        child:
                        Text(
                          'Confira os produtos encontrados na planilha. '
                              'O Store Connect verificou os campos obrigatórios '
                              'e possíveis problemas antes da importação.',
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(
                  height: 20,
                ),

                // ============================================================
                // ARQUIVO
                // ============================================================

                _buildFileSummary(),

                const SizedBox(
                  height: 24,
                ),

                // ============================================================
                // TÍTULO RESUMO
                // ============================================================

                Text(
                  'Resultado da validação',

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
                  height: 12,
                ),

                // ============================================================
                // CONTADORES
                // ============================================================

                _buildValidationSummary(),

                const SizedBox(
                  height: 24,
                ),

                // ============================================================
                // PRODUTOS
                // ============================================================

                Text(
                  'Produtos encontrados',

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
                  height: 12,
                ),

                ..._products.map(
                  _buildProductCard,
                ),

                const SizedBox(
                  height: 20,
                ),

                // ============================================================
                // AVISO
                // ============================================================

                Container(
                  padding:
                  const EdgeInsets.all(
                    12,
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
                      10,
                    ),
                  ),

                  child:
                  const Row(
                    crossAxisAlignment:
                    CrossAxisAlignment.start,

                    children: [
                      Icon(
                        Icons.info_outline,
                        size: 20,
                        color:
                        Colors.amber,
                      ),

                      SizedBox(
                        width: 8,
                      ),

                      Expanded(
                        child:
                        Text(
                          'Nenhum dado foi salvo ainda. '
                              'Na próxima etapa o Store Connect verificará '
                              'produtos duplicados e categorias antes de pedir '
                              'a confirmação definitiva.',
                          style:
                          TextStyle(
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(
                  height: 24,
                ),

                // ============================================================
                // CONTINUAR
                // ============================================================

                SizedBox(
                  height: 52,

                  child:
                  ElevatedButton.icon(
                    onPressed:
                    _errorCount > 0
                        ? null
                        : _continueImport,

                    icon:
                    const Icon(
                      Icons
                          .arrow_forward,
                    ),

                    label:
                    const Text(
                      'CONTINUAR',
                    ),
                  ),
                ),

                const SizedBox(
                  height: 16,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ==========================================================================
  // RESUMO DO ARQUIVO
  // ==========================================================================

  Widget _buildFileSummary() {
    return Card(
      child: Padding(
        padding:
        const EdgeInsets.all(
          14,
        ),

        child: Row(
          children: [
            CircleAvatar(
              backgroundColor:
              Colors.green
                  .withOpacity(
                0.12,
              ),

              child:
              const Icon(
                Icons
                    .description_outlined,
                color:
                Colors.green,
              ),
            ),

            const SizedBox(
              width: 12,
            ),

            Expanded(
              child: Column(
                crossAxisAlignment:
                CrossAxisAlignment.start,

                children: [
                  Text(
                    widget.fileName,

                    maxLines: 1,

                    overflow:
                    TextOverflow.ellipsis,

                    style:
                    const TextStyle(
                      fontWeight:
                      FontWeight.bold,
                    ),
                  ),

                  const SizedBox(
                    height: 3,
                  ),

                  Text(
                    '${_products.length} produto(s) encontrado(s)',

                    style:
                    TextStyle(
                      fontSize: 12,

                      color:
                      Colors.grey
                          .shade600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // RESUMO DA VALIDAÇÃO
  // ==========================================================================

  Widget _buildValidationSummary() {
    return Row(
      children: [
        // --------------------------------------------------------------------
        // PRONTOS
        // --------------------------------------------------------------------

        Expanded(
          child:
          _summaryCard(
            icon:
            Icons
                .check_circle_outline,

            label:
            'Prontos',

            value:
            _readyCount,

            color:
            Colors.green,
          ),
        ),

        const SizedBox(
          width: 10,
        ),

        // --------------------------------------------------------------------
        // ATENÇÃO
        // --------------------------------------------------------------------

        Expanded(
          child:
          _summaryCard(
            icon:
            Icons
                .warning_amber_outlined,

            label:
            'Atenção',

            value:
            _warningCount,

            color:
            Colors.orange,
          ),
        ),

        const SizedBox(
          width: 10,
        ),

        // --------------------------------------------------------------------
        // ERROS
        // --------------------------------------------------------------------

        Expanded(
          child:
          _summaryCard(
            icon:
            Icons.error_outline,

            label:
            'Erros',

            value:
            _errorCount,

            color:
            Colors.red,
          ),
        ),
      ],
    );
  }

  // ==========================================================================
  // CARD DE RESUMO
  // ==========================================================================

  Widget _summaryCard({
    required IconData icon,
    required String label,
    required int value,
    required Color color,
  }) {
    return Container(
      padding:
      const EdgeInsets.symmetric(
        vertical: 14,
        horizontal: 8,
      ),

      decoration:
      BoxDecoration(
        borderRadius:
        BorderRadius.circular(
          12,
        ),

        border:
        Border.all(
          color:
          color.withOpacity(
            0.25,
          ),
        ),

        color:
        color.withOpacity(
          0.06,
        ),
      ),

      child: Column(
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
            TextStyle(
              fontSize: 11,

              color:
              Colors.grey
                  .shade600,
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // CARD DO PRODUTO
  // ==========================================================================

  Widget _buildProductCard(
      _ValidatedImportProduct product,
      ) {
    Color statusColor;

    IconData statusIcon;

    String statusText;

    // =========================================================================
    // STATUS VISUAL
    // =========================================================================

    switch (product.status) {
      case _ImportValidationStatus.ready:
        statusColor =
            Colors.green;

        statusIcon =
            Icons.check_circle;

        statusText =
        'Pronto';

        break;

      case _ImportValidationStatus.warning:
        statusColor =
            Colors.orange;

        statusIcon =
            Icons.warning_amber;

        statusText =
        'Atenção';

        break;

      case _ImportValidationStatus.error:
        statusColor =
            Colors.red;

        statusIcon =
            Icons.error;

        statusText =
        'Erro';

        break;
    }

    return Card(
      margin:
      const EdgeInsets.only(
        bottom: 12,
      ),

      child: Padding(
        padding:
        const EdgeInsets.all(
          14,
        ),

        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.start,

          children: [
            // ================================================================
            // CABEÇALHO DO PRODUTO
            // ================================================================

            Row(
              crossAxisAlignment:
              CrossAxisAlignment.start,

              children: [
                // ------------------------------------------------------------
                // STATUS
                // ------------------------------------------------------------

                CircleAvatar(
                  backgroundColor:
                  statusColor
                      .withOpacity(
                    0.10,
                  ),

                  child: Icon(
                    statusIcon,
                    color:
                    statusColor,
                  ),
                ),

                const SizedBox(
                  width: 12,
                ),

                // ------------------------------------------------------------
                // NOME / LINHA
                // ------------------------------------------------------------

                Expanded(
                  child: Column(
                    crossAxisAlignment:
                    CrossAxisAlignment.start,

                    children: [
                      Text(
                        product.name.isEmpty
                            ? 'Produto sem nome'
                            : product.name,

                        style:
                        const TextStyle(
                          fontWeight:
                          FontWeight.bold,

                          fontSize: 15,
                        ),
                      ),

                      const SizedBox(
                        height: 3,
                      ),

                      Text(
                        'Linha ${product.sourceRow} da planilha',

                        style:
                        TextStyle(
                          fontSize: 11,

                          color:
                          Colors.grey
                              .shade600,
                        ),
                      ),
                    ],
                  ),
                ),

                // ------------------------------------------------------------
                // CHIP DO STATUS
                // ------------------------------------------------------------

                Container(
                  padding:
                  const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 4,
                  ),

                  decoration:
                  BoxDecoration(
                    color:
                    statusColor
                        .withOpacity(
                      0.10,
                    ),

                    borderRadius:
                    BorderRadius.circular(
                      20,
                    ),
                  ),

                  child: Text(
                    statusText,

                    style:
                    TextStyle(
                      fontSize: 11,

                      fontWeight:
                      FontWeight.bold,

                      color:
                      statusColor,
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(
              height: 12,
            ),

            // ================================================================
            // DADOS
            // ================================================================

            Wrap(
              spacing: 16,
              runSpacing: 8,

              children: [
                // ------------------------------------------------------------
                // PREÇO
                // ------------------------------------------------------------

                _productInfo(
                  'Preço',

                  product.price != null
                      ? 'R\$ ${product.price!.toStringAsFixed(2)}'
                      : '-',
                ),

                // ------------------------------------------------------------
                // QUANTIDADE
                // ------------------------------------------------------------

                _productInfo(
                  'Quantidade',

                  product.quantity != null
                      ? product.quantity!
                      .toStringAsFixed(
                    product.quantity! %
                        1 ==
                        0
                        ? 0
                        : 2,
                  )
                      : '-',
                ),

                // ------------------------------------------------------------
                // CATEGORIA
                // ------------------------------------------------------------

                if (product.category
                    .isNotEmpty)
                  _productInfo(
                    'Categoria',
                    product.category,
                  ),

                // ------------------------------------------------------------
                // CÓDIGO DE BARRAS
                // ------------------------------------------------------------

                if (product.barcode
                    .isNotEmpty)
                  _productInfo(
                    'Código',
                    product.barcode,
                  ),

                // ------------------------------------------------------------
                // PREÇO DE CUSTO
                // ------------------------------------------------------------

                if (product.costPrice !=
                    null)
                  _productInfo(
                    'Custo',
                    'R\$ ${product.costPrice!.toStringAsFixed(2)}',
                  ),

                // ------------------------------------------------------------
                // NCM
                // ------------------------------------------------------------

                if (product.ncm
                    .isNotEmpty)
                  _productInfo(
                    'NCM',
                    product.ncm,
                  ),
              ],
            ),

            // ================================================================
            // ERROS
            // ================================================================

            if (product
                .errors.isNotEmpty) ...[
              const SizedBox(
                height: 12,
              ),

              ...product.errors.map(
                    (message) =>
                    _messageRow(
                      message,

                      Colors.red,

                      Icons.error_outline,
                    ),
              ),
            ],

            // ================================================================
            // AVISOS
            // ================================================================

            if (product
                .warnings.isNotEmpty) ...[
              const SizedBox(
                height: 12,
              ),

              ...product.warnings.map(
                    (message) =>
                    _messageRow(
                      message,

                      Colors.orange,

                      Icons
                          .warning_amber_outlined,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // ITEM DE INFORMAÇÃO
  // ==========================================================================

  Widget _productInfo(
      String label,
      String value,
      ) {
    return Row(
      mainAxisSize:
      MainAxisSize.min,

      children: [
        Text(
          '$label: ',

          style:
          TextStyle(
            fontSize: 12,

            color:
            Colors.grey
                .shade600,
          ),
        ),

        Text(
          value,

          style:
          const TextStyle(
            fontSize: 12,

            fontWeight:
            FontWeight.w600,
          ),
        ),
      ],
    );
  }

  // ==========================================================================
  // MENSAGEM DE ERRO / AVISO
  // ==========================================================================

  Widget _messageRow(
      String message,
      Color color,
      IconData icon,
      ) {
    return Padding(
      padding:
      const EdgeInsets.only(
        bottom: 4,
      ),

      child: Row(
        crossAxisAlignment:
        CrossAxisAlignment.start,

        children: [
          Icon(
            icon,

            color:
            color,

            size:
            16,
          ),

          const SizedBox(
            width: 6,
          ),

          Expanded(
            child: Text(
              message,

              style:
              TextStyle(
                fontSize: 12,

                color:
                color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}