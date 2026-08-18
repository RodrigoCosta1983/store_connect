// ============================================================================
// ARQUIVO: product_import_screen.dart
// ============================================================================
//
// OBJETIVO:
// Iniciar o processo de importação de produtos por planilha.
//
// PRINCIPAIS RESPONSABILIDADES:
// - Permitir selecionar arquivos .xlsx ou .csv.
// - Ler o arquivo localmente, sem gravar no Firestore.
// - Identificar o nome do arquivo selecionado.
// - Identificar o formato do arquivo.
// - Contar linhas e colunas básicas.
// - Mostrar uma prévia inicial ao usuário.
// - Preparar os dados para a próxima etapa de mapeamento.
//
// FLUXO:
//
// Gerenciar Produtos
//        ↓
// Importar Produtos
//        ↓
// Selecionar XLSX / CSV
//        ↓
// Ler arquivo localmente
//        ↓
// Mostrar resumo
//        ↓
// [ CONTINUAR ]
//        ↓
// product_import_mapping_screen.dart
//
// SEGURANÇA / INTEGRIDADE:
// - Nenhum produto é salvo nesta tela.
// - Nenhum dado é enviado ao Firestore nesta etapa.
// - O usuário sempre verá uma prévia antes da importação definitiva.
//
// FORMATOS SUPORTADOS:
// - .xlsx
// - .csv
//
// DEPENDÊNCIAS:
// - file_picker
// - excel
//
// MANUTENÇÃO:
// - Não colocar lógica de gravação Firestore neste arquivo.
// - Não colocar lógica de mapeamento de campos aqui.
// - Esta tela deve continuar sendo somente a etapa de seleção/leitura inicial.
//
// ============================================================================

import 'dart:convert';
import 'dart:typed_data';

import 'package:excel/excel.dart' as excel;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:store_connect/screens/management/product_import_mapping_screen.dart';



class ProductImportScreen extends StatefulWidget {
  final String storeId;
  final bool isBusiness;

  const ProductImportScreen({
    super.key,
    required this.storeId,
    required this.isBusiness,
  });

  @override
  State<ProductImportScreen> createState() =>
      _ProductImportScreenState();
}

class _ProductImportScreenState extends State<ProductImportScreen> {
  // ==========================================================================
  // ESTADO
  // ==========================================================================

  bool _isLoading = false;

  String? _fileName;
  String? _fileExtension;

  Uint8List? _fileBytes;

  List<List<String>> _rows = [];

  int _columnCount = 0;

  String? _errorMessage;

  // ==========================================================================
  // SELECIONAR ARQUIVO
  // ==========================================================================

  Future<void> _pickFile() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final result = await FilePicker.pickFiles(
        type: FileType.custom,
        allowedExtensions: [
          'xlsx',
          'csv',
        ],

        // Importante:
        // precisamos dos bytes para funcionar bem também no Web.
        withData: true,
      );

      if (result == null) {
        return;
      }

      final file = result.files.single;

      final bytes = file.bytes;

      if (bytes == null) {
        throw Exception(
          'Não foi possível ler o conteúdo do arquivo.',
        );
      }

      final extension =
      (file.extension ?? '')
          .trim()
          .toLowerCase();

      if (extension != 'xlsx' &&
          extension != 'csv') {
        throw Exception(
          'Formato não suportado. Selecione um arquivo XLSX ou CSV.',
        );
      }

      List<List<String>> parsedRows;

      if (extension == 'xlsx') {
        parsedRows =
            _parseXlsx(bytes);
      } else {
        parsedRows =
            _parseCsv(bytes);
      }

      if (parsedRows.isEmpty) {
        throw Exception(
          'A planilha está vazia.',
        );
      }

      final columnCount =
      parsedRows.fold<int>(
        0,
            (maxValue, row) =>
        row.length > maxValue
            ? row.length
            : maxValue,
      );

      setState(() {
        _fileName = file.name;
        _fileExtension = extension;
        _fileBytes = bytes;

        _rows = parsedRows;

        _columnCount =
            columnCount;
      });
    } catch (e) {
      setState(() {
        _errorMessage =
            e.toString();
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ==========================================================================
  // LEITURA XLSX
  // ==========================================================================

  List<List<String>> _parseXlsx(
      Uint8List bytes,
      ) {
    final workbook =
    excel.Excel.decodeBytes(bytes);

    if (workbook.tables.isEmpty) {
      return [];
    }

    final firstSheetName =
        workbook.tables.keys.first;

    final sheet =
    workbook.tables[firstSheetName];

    if (sheet == null) {
      return [];
    }

    final rows =
    <List<String>>[];

    for (final row in sheet.rows) {
      final parsedRow =
      row.map(
            (cell) {
          final value =
              cell?.value;

          if (value == null) {
            return '';
          }

          return value
              .toString()
              .trim();
        },
      ).toList();

      // Ignora linhas totalmente vazias.

      final hasContent =
      parsedRow.any(
            (value) =>
        value.trim().isNotEmpty,
      );

      if (hasContent) {
        rows.add(parsedRow);
      }
    }

    return rows;
  }

  // ==========================================================================
  // LEITURA CSV
  // ==========================================================================

  List<List<String>> _parseCsv(
      Uint8List bytes,
      ) {
    // UTF-8 como padrão.
    //
    // allowMalformed ajuda com alguns arquivos exportados
    // por sistemas mais antigos.

    final content =
    utf8.decode(
      bytes,
      allowMalformed: true,
    );

    final lines =
    const LineSplitter()
        .convert(content);

    if (lines.isEmpty) {
      return [];
    }

    // ------------------------------------------------------------------------
    // DETECÇÃO BÁSICA DE DELIMITADOR
    //
    // Excel brasileiro normalmente exporta CSV com ";"
    // enquanto alguns sistemas usam ",".
    // ------------------------------------------------------------------------

    final firstLine =
        lines.first;

    final semicolonCount =
        ';'.allMatches(firstLine).length;

    final commaCount =
        ','.allMatches(firstLine).length;

    final delimiter =
    semicolonCount >= commaCount
        ? ';'
        : ',';

    final rows =
    <List<String>>[];

    for (final line in lines) {
      if (line.trim().isEmpty) {
        continue;
      }

      final cells =
      _splitCsvLine(
        line,
        delimiter,
      );

      rows.add(cells);
    }

    return rows;
  }

  // ==========================================================================
  // PARSER CSV SIMPLES
  //
  // Trata:
  //
  // Produto;"Camiseta, Preta";59,90
  //
  // sem dividir a vírgula que estiver dentro de aspas.
  //
  // ==========================================================================

  List<String> _splitCsvLine(
      String line,
      String delimiter,
      ) {
    final result =
    <String>[];

    final buffer =
    StringBuffer();

    bool insideQuotes = false;

    for (
    int i = 0;
    i < line.length;
    i++
    ) {
      final char =
      line[i];

      if (char == '"') {
        // Duas aspas dentro de campo representam uma aspa literal.
        if (insideQuotes &&
            i + 1 < line.length &&
            line[i + 1] == '"') {
          buffer.write('"');

          i++;

          continue;
        }

        insideQuotes =
        !insideQuotes;

        continue;
      }

      if (char == delimiter &&
          !insideQuotes) {
        result.add(
          buffer
              .toString()
              .trim(),
        );

        buffer.clear();

        continue;
      }

      buffer.write(char);
    }

    result.add(
      buffer
          .toString()
          .trim(),
    );

    return result;
  }

  // ==========================================================================
  // REMOVE ARQUIVO SELECIONADO
  // ==========================================================================

  void _clearFile() {
    setState(() {
      _fileName = null;
      _fileExtension = null;
      _fileBytes = null;

      _rows = [];

      _columnCount = 0;

      _errorMessage = null;
    });
  }

  // ============================================================================
  // CONTINUAR PARA O MAPEAMENTO
  // ============================================================================

  void _continueImport() {
    if (_rows.isEmpty) {
      return;
    }

    // ========================================================================
    // PRÓXIMA ETAPA
    //
    // Aqui vamos abrir:
    //
    // product_import_mapping_screen.dart
    //
    // passando:
    // - storeId
    // - isBusiness
    // - nome do arquivo
    // - linhas já lidas
    //
    // Ainda não fazemos isso porque primeiro estamos validando esta tela.
    // ========================================================================

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) =>
            ProductImportMappingScreen(
              storeId: widget.storeId,
              isBusiness: widget.isBusiness,
              fileName:
              _fileName ?? 'Planilha',
              rows: _rows,
            ),
      ),
    );
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    final hasFile =
        _rows.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Importar Produtos',
        ),
      ),

      body:
      _isLoading
          ? const Center(
        child:
        CircularProgressIndicator(),
      )
          : SafeArea(
        child:
        ListView(
          padding:
          const EdgeInsets.all(
            16,
          ),
          children: [
            // ======================================================
            // INTRODUÇÃO
            // ======================================================

            Container(
              padding:
              const EdgeInsets.all(
                16,
              ),
              decoration:
              BoxDecoration(
                color: Colors.blue
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
                        .upload_file_outlined,
                  ),

                  SizedBox(
                    width: 12,
                  ),

                  Expanded(
                    child:
                    Text(
                      'Importe seus produtos por uma planilha Excel ou CSV. '
                          'Antes de salvar qualquer informação, você poderá revisar '
                          'e relacionar as colunas da planilha com os campos do Store Connect.',
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(
              height: 24,
            ),

            // ======================================================
            // SELEÇÃO DO ARQUIVO
            // ======================================================

            Text(
              'Arquivo da importação',
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

            if (!hasFile)
              _buildEmptyFileCard(),

            if (hasFile)
              _buildSelectedFileCard(),

            // ======================================================
            // ERRO
            // ======================================================

            if (_errorMessage != null) ...[
              const SizedBox(
                height: 16,
              ),

              Container(
                padding:
                const EdgeInsets.all(
                  12,
                ),
                decoration:
                BoxDecoration(
                  color: Colors.red
                      .withOpacity(
                    0.08,
                  ),
                  borderRadius:
                  BorderRadius.circular(
                    10,
                  ),
                  border:
                  Border.all(
                    color: Colors.red
                        .withOpacity(
                      0.25,
                    ),
                  ),
                ),
                child:
                Row(
                  crossAxisAlignment:
                  CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons
                          .error_outline,
                      color:
                      Colors.red,
                    ),

                    const SizedBox(
                      width: 8,
                    ),

                    Expanded(
                      child:
                      Text(
                        _errorMessage!,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // ======================================================
            // RESUMO DO ARQUIVO
            // ======================================================

            if (hasFile) ...[
              const SizedBox(
                height: 24,
              ),

              _buildImportSummary(),

              const SizedBox(
                height: 24,
              ),

              _buildPreview(),
            ],

            const SizedBox(
              height: 32,
            ),

            // ======================================================
            // CONTINUAR
            // ======================================================

            SizedBox(
              height: 52,
              child:
              ElevatedButton.icon(
                onPressed:
                hasFile
                    ? _continueImport
                    : null,
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
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // CARD SEM ARQUIVO
  // ==========================================================================

  Widget _buildEmptyFileCard() {
    return InkWell(
      onTap: _pickFile,
      borderRadius:
      BorderRadius.circular(
        14,
      ),
      child:
      Container(
        padding:
        const EdgeInsets.symmetric(
          horizontal: 20,
          vertical: 28,
        ),
        decoration:
        BoxDecoration(
          border:
          Border.all(
            color: Colors.grey
                .withOpacity(
              0.4,
            ),
          ),
          borderRadius:
          BorderRadius.circular(
            14,
          ),
        ),
        child:
        Column(
          children: [
            Icon(
              Icons
                  .table_view_outlined,
              size: 48,
              color: Colors
                  .green
                  .shade700,
            ),

            const SizedBox(
              height: 12,
            ),

            const Text(
              'Selecionar planilha',
              style:
              TextStyle(
                fontSize: 16,
                fontWeight:
                FontWeight.bold,
              ),
            ),

            const SizedBox(
              height: 6,
            ),

            Text(
              'Formatos aceitos: XLSX e CSV',
              style:
              TextStyle(
                color: Colors
                    .grey
                    .shade600,
              ),
            ),

            const SizedBox(
              height: 14,
            ),

            OutlinedButton.icon(
              onPressed:
              _pickFile,
              icon:
              const Icon(
                Icons
                    .folder_open_outlined,
              ),
              label:
              const Text(
                'ESCOLHER ARQUIVO',
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // CARD DO ARQUIVO SELECIONADO
  // ==========================================================================

  Widget _buildSelectedFileCard() {
    return Card(
      child:
      Padding(
        padding:
        const EdgeInsets.all(
          16,
        ),
        child:
        Row(
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
              child:
              Column(
                crossAxisAlignment:
                CrossAxisAlignment.start,
                children: [
                  Text(
                    _fileName ??
                        'Arquivo',
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
                    '${_fileExtension?.toUpperCase() ?? ''} • ${_rows.length} linhas',
                    style:
                    TextStyle(
                      color: Colors
                          .grey
                          .shade600,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),

            IconButton(
              tooltip:
              'Selecionar outro arquivo',
              onPressed:
              _pickFile,
              icon:
              const Icon(
                Icons
                    .folder_open_outlined,
              ),
            ),

            IconButton(
              tooltip:
              'Remover arquivo',
              onPressed:
              _clearFile,
              icon:
              const Icon(
                Icons.delete_outline,
                color:
                Colors.red,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ==========================================================================
  // RESUMO
  // ==========================================================================

  Widget _buildImportSummary() {
    final possibleProducts =
    _rows.length > 1
        ? _rows.length - 1
        : 0;

    return Column(
      crossAxisAlignment:
      CrossAxisAlignment.start,
      children: [
        Text(
          'Resumo',
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

        Row(
          children: [
            Expanded(
              child:
              _summaryCard(
                icon:
                Icons.table_rows_outlined,
                title:
                'Linhas',
                value:
                _rows.length.toString(),
              ),
            ),

            const SizedBox(
              width: 12,
            ),

            Expanded(
              child:
              _summaryCard(
                icon:
                Icons.view_column_outlined,
                title:
                'Colunas',
                value:
                _columnCount.toString(),
              ),
            ),

            const SizedBox(
              width: 12,
            ),

            Expanded(
              child:
              _summaryCard(
                icon:
                Icons.inventory_2_outlined,
                title:
                'Produtos',
                value:
                possibleProducts.toString(),
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ==========================================================================
  // CARD RESUMO
  // ==========================================================================

  Widget _summaryCard({
    required IconData icon,
    required String title,
    required String value,
  }) {
    return Container(
      padding:
      const EdgeInsets.all(
        12,
      ),
      decoration:
      BoxDecoration(
        color: Theme.of(context)
            .cardColor
            .withOpacity(
          0.75,
        ),
        borderRadius:
        BorderRadius.circular(
          12,
        ),
        border:
        Border.all(
          color: Colors.grey
              .withOpacity(
            0.15,
          ),
        ),
      ),
      child:
      Column(
        children: [
          Icon(
            icon,
            size: 22,
          ),

          const SizedBox(
            height: 6,
          ),

          Text(
            value,
            style:
            const TextStyle(
              fontSize: 18,
              fontWeight:
              FontWeight.bold,
            ),
          ),

          Text(
            title,
            style:
            TextStyle(
              fontSize: 11,
              color: Colors
                  .grey
                  .shade600,
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // PRÉVIA DAS PRIMEIRAS LINHAS
  // ==========================================================================

  Widget _buildPreview() {
    final previewRows =
    _rows.take(5).toList();

    return Column(
      crossAxisAlignment:
      CrossAxisAlignment.start,
      children: [
        Text(
          'Prévia',
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

        Text(
          'Mostrando as primeiras linhas do arquivo.',
          style:
          TextStyle(
            color: Colors
                .grey
                .shade600,
            fontSize: 12,
          ),
        ),

        const SizedBox(
          height: 12,
        ),

        Card(
          child:
          SingleChildScrollView(
            scrollDirection:
            Axis.horizontal,
            child:
            DataTable(
              columns:
              List.generate(
                _columnCount,
                    (index) =>
                    DataColumn(
                      label:
                      Text(
                        'Coluna ${index + 1}',
                      ),
                    ),
              ),

              rows:
              previewRows
                  .map(
                    (row) {
                  return DataRow(
                    cells:
                    List.generate(
                      _columnCount,
                          (index) {
                        final value =
                        index <
                            row.length
                            ? row[index]
                            : '';

                        return DataCell(
                          ConstrainedBox(
                            constraints:
                            const BoxConstraints(
                              maxWidth:
                              180,
                            ),
                            child:
                            Text(
                              value,
                              overflow:
                              TextOverflow.ellipsis,
                            ),
                          ),
                        );
                      },
                    ),
                  );
                },
              ).toList(),
            ),
          ),
        ),

        const SizedBox(
          height: 10,
        ),

        Container(
          padding:
          const EdgeInsets.all(
            10,
          ),
          decoration:
          BoxDecoration(
            color: Colors.amber
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
                size: 18,
                color:
                Colors.amber,
              ),

              SizedBox(
                width: 8,
              ),

              Expanded(
                child:
                Text(
                  'Na próxima etapa você poderá indicar qual coluna representa '
                      'Nome, Preço, Quantidade, Categoria e os demais campos.',
                  style:
                  TextStyle(
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}