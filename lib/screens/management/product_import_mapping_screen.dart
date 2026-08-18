// ============================================================================
// ARQUIVO: product_import_mapping_screen.dart
// ============================================================================
//
// OBJETIVO:
//
// Segunda etapa da importação de produtos.
//
// Esta tela recebe a planilha já lida por product_import_screen.dart e permite
// relacionar as colunas existentes no arquivo com os campos utilizados pelo
// Store Connect.
//
// EXEMPLO:
//
// Planilha do cliente:
//
// Descrição | Valor Venda | Qtd | Grupo
//
// Pode ser relacionada automaticamente como:
//
// Descrição   → Nome do produto
// Valor Venda → Preço de venda
// Qtd         → Quantidade / Estoque
// Grupo       → Categoria
//
// PRINCIPAIS RESPONSABILIDADES:
//
// • Identificar a primeira linha como cabeçalho da planilha.
// • Exibir os campos disponíveis no Store Connect.
// • Sugerir automaticamente o mapeamento das colunas.
// • Permitir ao usuário corrigir o mapeamento manualmente.
// • Impedir que uma mesma coluna seja usada em dois campos diferentes.
// • Validar os campos obrigatórios antes de continuar.
// • Mostrar exemplos reais da planilha para facilitar o mapeamento.
//
// IMPORTANTE:
//
// ESTA TELA AINDA NÃO GRAVA PRODUTOS NO FIRESTORE.
//
// O objetivo desta etapa é somente definir:
//
// CAMPO STORE CONNECT → COLUNA DA PLANILHA
//
// FLUXO:
//
// product_import_screen.dart
//        ↓
// product_import_mapping_screen.dart
//        ↓
// validação dos produtos
//        ↓
// revisão
//        ↓
// confirmação
//        ↓
// Firestore
//
// CAMPOS INICIAIS SUPORTADOS:
//
// Obrigatórios:
// • Nome do produto
// • Preço de venda
//
// Opcionais:
// • Quantidade / Estoque
// • Categoria
// • Código de barras
// • Preço de custo
// • NCM
//
// RESPONSIVIDADE:
//
// • Mobile:
//   utiliza normalmente a largura disponível.
//
// • Web / Desktop:
//   conteúdo centralizado com largura máxima de 1100px.
//
// MANUTENÇÃO:
//
// • Não adicionar gravação Firestore nesta tela.
// • Novos campos de produto devem ser adicionados em _fields.
// • Novos sinônimos devem ser adicionados em aliases.
// • Manter o mapeamento automático conservador.
// • Não assumir que todas as planilhas possuem os mesmos nomes de colunas.
//
// ============================================================================

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:store_connect/screens/management/product_import_validation_screen.dart';

// ============================================================================
// MODELO INTERNO DE CAMPO
// ============================================================================

class _ImportField {
  final String key;
  final String label;
  final String description;
  final IconData icon;
  final bool required;
  final List<String> aliases;

  const _ImportField({
    required this.key,
    required this.label,
    required this.description,
    required this.icon,
    required this.aliases,
    this.required = false,
  });
}

// ============================================================================
// TELA
// ============================================================================

class ProductImportMappingScreen extends StatefulWidget {
  final String storeId;
  final bool isBusiness;
  final String fileName;

  // Primeira linha = cabeçalho.
  // Demais linhas = produtos.
  final List<List<String>> rows;

  const ProductImportMappingScreen({
    super.key,
    required this.storeId,
    required this.isBusiness,
    required this.fileName,
    required this.rows,
  });

  @override
  State<ProductImportMappingScreen> createState() =>
      _ProductImportMappingScreenState();
}

class _ProductImportMappingScreenState
    extends State<ProductImportMappingScreen> {
  // ==========================================================================
  // CAMPOS DISPONÍVEIS NO STORE CONNECT
  // ==========================================================================

  static const List<_ImportField> _fields = [
    _ImportField(
      key: 'name',
      label: 'Nome do produto',
      description: 'Nome ou descrição principal do produto.',
      icon: Icons.inventory_2_outlined,
      required: true,
      aliases: [
        'nome',
        'produto',
        'descricao',
        'descrição',
        'nome produto',
        'nome do produto',
        'descricao produto',
        'descrição produto',
        'mercadoria',
        'item',
      ],
    ),

    _ImportField(
      key: 'price',
      label: 'Preço de venda',
      description: 'Valor utilizado para venda do produto.',
      icon: Icons.sell_outlined,
      required: true,
      aliases: [
        'preco',
        'preço',
        'valor',
        'preco venda',
        'preço venda',
        'preco de venda',
        'preço de venda',
        'valor venda',
        'valor de venda',
        'valor unitario',
        'valor unitário',
        'preco unitario',
        'preço unitário',
      ],
    ),

    _ImportField(
      key: 'quantity',
      label: 'Quantidade / Estoque',
      description: 'Quantidade atual disponível em estoque.',
      icon: Icons.warehouse_outlined,
      aliases: [
        'quantidade',
        'qtd',
        'qtde',
        'estoque',
        'estoque atual',
        'saldo',
        'saldo estoque',
        'quantidade estoque',
      ],
    ),

    _ImportField(
      key: 'category',
      label: 'Categoria',
      description: 'Categoria ou grupo ao qual o produto pertence.',
      icon: Icons.category_outlined,
      aliases: [
        'categoria',
        'grupo',
        'departamento',
        'secao',
        'seção',
        'tipo',
        'familia',
        'família',
      ],
    ),

    _ImportField(
      key: 'barcode',
      label: 'Código de barras',
      description: 'EAN, GTIN ou código de barras do produto.',
      icon: Icons.qr_code_2_outlined,
      aliases: [
        'codigo barras',
        'código barras',
        'codigo de barras',
        'código de barras',
        'barcode',
        'ean',
        'ean13',
        'gtin',
      ],
    ),

    _ImportField(
      key: 'costPrice',
      label: 'Preço de custo',
      description: 'Valor de aquisição ou custo do produto.',
      icon: Icons.request_quote_outlined,
      aliases: [
        'custo',
        'preco custo',
        'preço custo',
        'preco de custo',
        'preço de custo',
        'valor custo',
        'valor de custo',
        'custo unitario',
        'custo unitário',
      ],
    ),

    _ImportField(
      key: 'ncm',
      label: 'NCM',
      description: 'Nomenclatura Comum do Mercosul.',
      icon: Icons.receipt_long_outlined,
      aliases: ['ncm', 'codigo ncm', 'código ncm'],
    ),
  ];

  // ==========================================================================
  // MAPEAMENTO
  //
  // key   = campo do Store Connect
  // value = índice da coluna da planilha
  //
  // Exemplo:
  //
  // {
  //   'name': 0,
  //   'price': 3,
  //   'quantity': 5,
  // }
  //
  // ==========================================================================

  final Map<String, int?> _mapping = {};

  // ==========================================================================
  // CABEÇALHO
  // ==========================================================================

  List<String> get _headers {
    if (widget.rows.isEmpty) {
      return [];
    }

    return widget.rows.first;
  }

  // ==========================================================================
  // LINHAS DE PRODUTOS
  // ==========================================================================

  List<List<String>> get _productRows {
    if (widget.rows.length <= 1) {
      return [];
    }

    return widget.rows.skip(1).toList();
  }

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    for (final field in _fields) {
      _mapping[field.key] = null;
    }

    _applyAutomaticMapping();
  }

  // ==========================================================================
  // NORMALIZA TEXTO
  //
  // Usado somente para comparação dos nomes das colunas.
  //
  // ==========================================================================

  String _normalize(String value) {
    var result = value.trim().toLowerCase();

    const replacements = {
      'á': 'a',
      'à': 'a',
      'ã': 'a',
      'â': 'a',
      'ä': 'a',
      'é': 'e',
      'è': 'e',
      'ê': 'e',
      'ë': 'e',
      'í': 'i',
      'ì': 'i',
      'î': 'i',
      'ï': 'i',
      'ó': 'o',
      'ò': 'o',
      'õ': 'o',
      'ô': 'o',
      'ö': 'o',
      'ú': 'u',
      'ù': 'u',
      'û': 'u',
      'ü': 'u',
      'ç': 'c',
    };

    replacements.forEach((key, value) {
      result = result.replaceAll(key, value);
    });

    result = result.replaceAll(RegExp(r'[_\-./]+'), ' ');

    result = result.replaceAll(RegExp(r'\s+'), ' ');

    return result.trim();
  }

  // ==========================================================================
  // MAPEAMENTO AUTOMÁTICO
  // ==========================================================================

  void _applyAutomaticMapping() {
    final usedColumns = <int>{};

    for (final field in _fields) {
      final aliases = field.aliases.map(_normalize).toSet();

      int? selectedColumn;

      // ----------------------------------------------------------------------
      // PRIMEIRA TENTATIVA
      //
      // Correspondência exata.
      // ----------------------------------------------------------------------

      for (int index = 0; index < _headers.length; index++) {
        if (usedColumns.contains(index)) {
          continue;
        }

        final header = _normalize(_headers[index]);

        if (aliases.contains(header)) {
          selectedColumn = index;
          break;
        }
      }

      // ----------------------------------------------------------------------
      // SEGUNDA TENTATIVA
      //
      // Correspondência parcial.
      //
      // Ex:
      // "Preço Venda R$"
      // pode encontrar
      // "preco venda".
      // ----------------------------------------------------------------------

      if (selectedColumn == null) {
        for (int index = 0; index < _headers.length; index++) {
          if (usedColumns.contains(index)) {
            continue;
          }

          final header = _normalize(_headers[index]);

          if (header.isEmpty) {
            continue;
          }

          final found = aliases.any((alias) {
            if (alias.length < 4) {
              return false;
            }

            return header.contains(alias);
          });

          if (found) {
            selectedColumn = index;
            break;
          }
        }
      }

      if (selectedColumn != null) {
        _mapping[field.key] = selectedColumn;

        usedColumns.add(selectedColumn);
      }
    }
  }

  // ==========================================================================
  // VERIFICA SE COLUNA JÁ ESTÁ SENDO UTILIZADA
  // ==========================================================================

  bool _columnIsUsedByAnotherField(int columnIndex, String currentFieldKey) {
    for (final entry in _mapping.entries) {
      if (entry.key == currentFieldKey) {
        continue;
      }

      if (entry.value == columnIndex) {
        return true;
      }
    }

    return false;
  }

  // ==========================================================================
  // EXEMPLO DE VALOR
  //
  // Procura nas primeiras linhas um valor não vazio daquela coluna.
  // ==========================================================================

  String _exampleForColumn(int columnIndex) {
    final limit = math.min(_productRows.length, 10);

    for (int i = 0; i < limit; i++) {
      final row = _productRows[i];

      if (columnIndex >= row.length) {
        continue;
      }

      final value = row[columnIndex].trim();

      if (value.isNotEmpty) {
        return value;
      }
    }

    return 'Sem exemplo';
  }

  // ==========================================================================
  // ALTERAR MAPEAMENTO
  // ==========================================================================

  void _changeMapping(String fieldKey, int? columnIndex) {
    setState(() {
      _mapping[fieldKey] = columnIndex;
    });
  }

  // ============================================================================
  // VALIDAR ANTES DE CONTINUAR
  // ============================================================================

  void _continueImport() {
    final missingFields = _fields
        .where((field) => field.required && _mapping[field.key] == null)
        .toList();

    if (missingFields.isNotEmpty) {
      final names = missingFields.map((field) => field.label).join(', ');

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Relacione os campos obrigatórios: $names.'),
          backgroundColor: Colors.red,
        ),
      );

      return;
    }

    // ==========================================================================
    // ETAPA 3 - VALIDAÇÃO
    // ==========================================================================

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => ProductImportValidationScreen(
          storeId: widget.storeId,

          isBusiness: widget.isBusiness,

          fileName: widget.fileName,

          rows: widget.rows,

          mapping: Map<String, int?>.from(_mapping),
        ),
      ),
    );
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Relacionar Colunas')),

      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1100),

            child: ListView(
              padding: const EdgeInsets.all(16),

              children: [
                // ============================================================
                // INTRODUÇÃO
                // ============================================================
                Container(
                  padding: const EdgeInsets.all(16),

                  decoration: BoxDecoration(
                    color: Colors.blue.withOpacity(0.08),

                    borderRadius: BorderRadius.circular(14),
                  ),

                  child: const Row(
                    crossAxisAlignment: CrossAxisAlignment.start,

                    children: [
                      Icon(Icons.account_tree_outlined),

                      SizedBox(width: 12),

                      Expanded(
                        child: Text(
                          'Agora indique qual coluna da sua planilha corresponde '
                          'a cada informação do produto. Algumas colunas podem '
                          'ter sido identificadas automaticamente.',
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 20),

                // ============================================================
                // ARQUIVO
                // ============================================================
                _buildFileSummary(),

                const SizedBox(height: 24),

                // ============================================================
                // TÍTULO
                // ============================================================
                Text(
                  'Relacionar campos',

                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),

                const SizedBox(height: 6),

                Text(
                  '* Campos obrigatórios',

                  style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                ),

                const SizedBox(height: 16),

                // ============================================================
                // CAMPOS
                // ============================================================
                ..._fields.map(_buildFieldCard),

                const SizedBox(height: 24),

                // ============================================================
                // AVISO
                // ============================================================
                Container(
                  padding: const EdgeInsets.all(12),

                  decoration: BoxDecoration(
                    color: Colors.amber.withOpacity(0.08),

                    borderRadius: BorderRadius.circular(10),
                  ),

                  child: const Row(
                    crossAxisAlignment: CrossAxisAlignment.start,

                    children: [
                      Icon(Icons.info_outline, color: Colors.amber, size: 20),

                      SizedBox(width: 8),

                      Expanded(
                        child: Text(
                          'Nenhum produto será salvo nesta etapa. '
                          'Depois do mapeamento ainda vamos validar os dados '
                          'antes da importação definitiva.',
                          style: TextStyle(fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 24),

                // ============================================================
                // CONTINUAR
                // ============================================================
                SizedBox(
                  height: 52,

                  child: ElevatedButton.icon(
                    onPressed: _continueImport,

                    icon: const Icon(Icons.arrow_forward),

                    label: const Text('VALIDAR PRODUTOS'),
                  ),
                ),

                const SizedBox(height: 16),
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
        padding: const EdgeInsets.all(14),

        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: Colors.green.withOpacity(0.12),

              child: const Icon(
                Icons.description_outlined,
                color: Colors.green,
              ),
            ),

            const SizedBox(width: 12),

            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,

                children: [
                  Text(
                    widget.fileName,

                    maxLines: 1,

                    overflow: TextOverflow.ellipsis,

                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),

                  const SizedBox(height: 3),

                  Text(
                    '${_productRows.length} possíveis produtos • '
                    '${_headers.length} colunas',

                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
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
  // CARD DE MAPEAMENTO
  // ==========================================================================

  Widget _buildFieldCard(_ImportField field) {
    final selectedColumn = _mapping[field.key];

    return Card(
      margin: const EdgeInsets.only(bottom: 12),

      child: Padding(
        padding: const EdgeInsets.all(14),

        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,

          children: [
            // ================================================================
            // IDENTIFICAÇÃO
            // ================================================================
            Row(
              children: [
                Icon(field.icon, size: 22),

                const SizedBox(width: 10),

                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,

                    children: [
                      Text(
                        field.required ? '${field.label} *' : field.label,

                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),

                      const SizedBox(height: 2),

                      Text(
                        field.description,

                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 14),

            // ================================================================
            // DROPDOWN
            // ================================================================
            DropdownButtonFormField<int>(
              value: selectedColumn,

              isExpanded: true,

              decoration: const InputDecoration(
                labelText: 'Coluna da planilha',

                border: OutlineInputBorder(),
              ),

              items: [
                const DropdownMenuItem<int>(
                  value: null,
                  child: Text('Não importar este campo'),
                ),

                ...List.generate(_headers.length, (index) {
                  final used = _columnIsUsedByAnotherField(index, field.key);

                  final header = _headers[index].trim().isEmpty
                      ? 'Coluna ${index + 1}'
                      : _headers[index];

                  return DropdownMenuItem<int>(
                    value: index,

                    enabled: !used,

                    child: Text(
                      used ? '$header (já utilizada)' : header,

                      overflow: TextOverflow.ellipsis,

                      style: TextStyle(color: used ? Colors.grey : null),
                    ),
                  );
                }),
              ],

              onChanged: (value) {
                _changeMapping(field.key, value);
              },
            ),

            // ================================================================
            // EXEMPLO
            // ================================================================
            if (selectedColumn != null) ...[
              const SizedBox(height: 10),

              Row(
                crossAxisAlignment: CrossAxisAlignment.start,

                children: [
                  Icon(
                    Icons.visibility_outlined,
                    size: 16,
                    color: Colors.grey.shade600,
                  ),

                  const SizedBox(width: 6),

                  Expanded(
                    child: Text(
                      'Exemplo: ${_exampleForColumn(selectedColumn)}',

                      maxLines: 2,

                      overflow: TextOverflow.ellipsis,

                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.grey.shade600,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
