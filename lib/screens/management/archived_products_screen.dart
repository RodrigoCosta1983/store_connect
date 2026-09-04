// ============================================================================
// STORE CONNECT - PRODUTOS ARQUIVADOS
// ============================================================================
//
// Arquivo:
//   lib/screens/management/archived_products_screen.dart
//
// OBJETIVO:
//
// Exibir os produtos arquivados da loja e permitir que o administrador
// restaure um produto através da Cloud Function restoreProduct.
//
// SEGURANÇA:
//
// • A tela será acessível pela interface somente para Admin.
// • O Flutter NÃO altera diretamente isArchived.
// • A restauração é executada pela Cloud Function restoreProduct.
// • O backend valida novamente:
//     - Firebase Auth;
//     - accessStatus;
//     - role == admin;
//     - vínculo com a mesma loja.
// • Firestore Rules continuam protegendo os campos administrativos.
//
// RESTAURAÇÃO:
//
// Produto arquivado:
//
//   isArchived = true
//
// Produto restaurado:
//
//   isArchived = false
//
// archivedAt e archivedBy permanecem preservados como informação do último
// arquivamento.
//
// Estoque, lotes, preço, imagem, categoria e dados fiscais NÃO são alterados
// pela restauração.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:store_connect/widgets/dynamic_background.dart';

class ArchivedProductsScreen extends StatefulWidget {
  final String storeId;

  const ArchivedProductsScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<ArchivedProductsScreen> createState() =>
      _ArchivedProductsScreenState();
}

class _ArchivedProductsScreenState
    extends State<ArchivedProductsScreen> {
  // ==========================================================================
  // BUSCA
  // ==========================================================================

  final TextEditingController _searchController =
  TextEditingController();

  // ==========================================================================
  // PRODUTOS EM RESTAURAÇÃO
  //
  // Evita duplo clique enquanto a Cloud Function está executando.
  // ==========================================================================

  final Set<String> _restoringProductIds = {};

  // ==========================================================================
  // FORMATAÇÃO
  // ==========================================================================

  final NumberFormat _currencyFormat =
  NumberFormat.currency(
    locale: 'pt_BR',
    symbol: 'R\$',
  );

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _searchController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // DATA DO ARQUIVAMENTO
  // ==========================================================================

  String _formatArchivedAt(dynamic value) {
    if (value is! Timestamp) {
      return 'Data de arquivamento não disponível';
    }

    final date = value.toDate();

    final day =
    date.day.toString().padLeft(2, '0');

    final month =
    date.month.toString().padLeft(2, '0');

    final year =
    date.year.toString();

    final hour =
    date.hour.toString().padLeft(2, '0');

    final minute =
    date.minute.toString().padLeft(2, '0');

    return 'Arquivado em $day/$month/$year às $hour:$minute';
  }

  // ==========================================================================
  // RESTAURAR PRODUTO
  // ==========================================================================
  //
  // IMPORTANTE:
  //
  // Nenhuma alteração é feita diretamente no documento pelo Flutter.
  //
  // Toda operação administrativa passa pela callable restoreProduct.
  // ==========================================================================

  Future<void> _restoreProduct(
      DocumentSnapshot productDoc,
      ) async {
    final data =
    productDoc.data() as Map<String, dynamic>;

    final rawName =
        data['name']?.toString().trim() ?? '';

    final productName =
    rawName.isNotEmpty
        ? rawName
        : 'Produto';

    String reason = '';

    final confirmed =
    await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text(
            'Restaurar produto',
          ),

          content: SingleChildScrollView(
            child: Column(
              mainAxisSize:
              MainAxisSize.min,

              crossAxisAlignment:
              CrossAxisAlignment.start,

              children: [
                Text(
                  'Deseja restaurar o produto "$productName"?',
                ),

                const SizedBox(
                  height: 12,
                ),

                const Text(
                  'O produto voltará a aparecer nas listas operacionais '
                      'e poderá ser utilizado novamente em novas vendas.',
                ),

                const SizedBox(
                  height: 12,
                ),

                const Text(
                  'Estoque, lotes, preço, imagem e dados fiscais '
                      'serão preservados.',
                  style: TextStyle(
                    fontWeight:
                    FontWeight.w500,
                  ),
                ),

                const SizedBox(
                  height: 16,
                ),

                TextField(
                  maxLines: 3,

                  onChanged: (value) {
                    reason = value.trim();
                  },

                  decoration:
                  const InputDecoration(
                    labelText:
                    'Motivo (opcional)',

                    hintText:
                    'Ex.: produto voltou ao catálogo',

                    border:
                    OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),

          actions: [
            TextButton(
              onPressed: () =>
                  Navigator.of(
                    dialogContext,
                  ).pop(false),

              child:
              const Text(
                'Cancelar',
              ),
            ),

            ElevatedButton.icon(
              onPressed: () =>
                  Navigator.of(
                    dialogContext,
                  ).pop(true),

              icon:
              const Icon(
                Icons.restore,
              ),

              label:
              const Text(
                'Restaurar',
              ),
            ),
          ],
        );
      },
    );



    if (confirmed != true) {
      return;
    }

    // ========================================================================
    // EVITA DUPLA EXECUÇÃO
    // ========================================================================

    if (_restoringProductIds.contains(
      productDoc.id,
    )) {
      return;
    }

    setState(() {
      _restoringProductIds.add(
        productDoc.id,
      );
    });

    try {
      // ======================================================================
      // CLOUD FUNCTION
      // ======================================================================

      final callable =
      FirebaseFunctions.instance
          .httpsCallable(
        'restoreProduct',
      );

      final response =
      await callable.call({
        'storeId':
        widget.storeId,

        'productId':
        productDoc.id,

        'reason':
        reason.isEmpty
            ? null
            : reason,
      });

      // ======================================================================
      // IDEMPOTÊNCIA
      // ======================================================================

      final responseData =
          response.data;

      final alreadyActive =
          responseData is Map &&
              responseData[
              'alreadyActive'] ==
                  true;

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            content: Text(
              alreadyActive
                  ? 'Este produto já estava ativo.'
                  : '$productName foi restaurado com sucesso.',
            ),

            backgroundColor:
            Colors.green,
          ),
        );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            content: Text(
              e.message ??
                  'Não foi possível restaurar o produto.',
            ),

            backgroundColor:
            Theme.of(context)
                .colorScheme
                .error,
          ),
        );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          const SnackBar(
            content: Text(
              'Não foi possível restaurar o produto.',
            ),
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          _restoringProductIds.remove(
            productDoc.id,
          );
        });
      }
    }
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    final isDarkMode =
        Theme.of(context).brightness ==
            Brightness.dark;

    final headerColor =
    isDarkMode
        ? Colors.white
        : Colors.black;

    return Scaffold(
      extendBodyBehindAppBar: true,

      body: Stack(
        children: [
          // ================================================================
          // FUNDO
          // ================================================================

          const DynamicBackground(),

          // ================================================================
          // CONTEÚDO
          // ================================================================

          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints:
                const BoxConstraints(
                  maxWidth: 1100,
                ),

                child: Column(
                  children: [
                    // ========================================================
                    // CABEÇALHO
                    // ========================================================

                    Padding(
                      padding:
                      const EdgeInsets
                          .fromLTRB(
                        8,
                        8,
                        8,
                        16,
                      ),

                      child: Column(
                        children: [
                          Row(
                            children: [
                              // ==============================================
                              // VOLTAR
                              // ==============================================

                              IconButton(
                                icon: Icon(
                                  Icons.arrow_back,
                                  color:
                                  headerColor,
                                ),

                                onPressed: () =>
                                    Navigator.of(
                                      context,
                                    ).pop(),
                              ),

                              // ==============================================
                              // TÍTULO
                              // ==============================================

                              Expanded(
                                child: Text(
                                  'Produtos Arquivados',

                                  style:
                                  TextStyle(
                                    fontSize:
                                    22,

                                    fontWeight:
                                    FontWeight
                                        .bold,

                                    color:
                                    headerColor,
                                  ),
                                ),
                              ),

                              const SizedBox(
                                width: 48,
                              ),
                            ],
                          ),

                          const SizedBox(
                            height: 8,
                          ),

                          // ==================================================
                          // BUSCA
                          // ==================================================

                          TextField(
                            controller:
                            _searchController,

                            onChanged:
                                (value) {
                              setState(() {});
                            },

                            style:
                            TextStyle(
                              color:
                              headerColor,
                            ),

                            decoration:
                            InputDecoration(
                              hintText:
                              'Buscar produtos arquivados...',

                              hintStyle:
                              TextStyle(
                                color:
                                isDarkMode
                                    ? Colors
                                    .white70
                                    : Colors
                                    .black54,
                              ),

                              prefixIcon:
                              Icon(
                                Icons.search,

                                color:
                                isDarkMode
                                    ? Colors
                                    .white70
                                    : Colors
                                    .black54,
                              ),

                              filled:
                              true,

                              fillColor:
                              Theme.of(
                                context,
                              )
                                  .cardColor
                                  .withOpacity(
                                isDarkMode
                                    ? 0.1
                                    : 0.5,
                              ),

                              border:
                              OutlineInputBorder(
                                borderRadius:
                                BorderRadius
                                    .circular(
                                  12,
                                ),

                                borderSide:
                                BorderSide
                                    .none,
                              ),

                              contentPadding:
                              const EdgeInsets
                                  .symmetric(
                                vertical:
                                0,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    // ========================================================
                    // LISTA
                    // ========================================================

                    Expanded(
                      child:
                      StreamBuilder<
                          QuerySnapshot>(
                        stream:
                        FirebaseFirestore
                            .instance
                            .collection(
                          'stores',
                        )
                            .doc(
                          widget
                              .storeId,
                        )
                            .collection(
                          'products',
                        )
                            .orderBy(
                          'name_lowercase',
                        )
                            .snapshots(),

                        builder:
                            (
                            context,
                            snapshot,
                            ) {
                          // ================================================
                          // CARREGANDO
                          // ================================================

                          if (snapshot
                              .connectionState ==
                              ConnectionState
                                  .waiting) {
                            return const Center(
                              child:
                              CircularProgressIndicator(),
                            );
                          }

                          // ================================================
                          // ERRO
                          // ================================================

                          if (snapshot
                              .hasError) {
                            return const Center(
                              child: Text(
                                'Não foi possível carregar os produtos arquivados.',
                              ),
                            );
                          }

                          final allProducts =
                              snapshot.data
                                  ?.docs ??
                                  [];

                          final query =
                          _searchController
                              .text
                              .trim()
                              .toLowerCase();

                          // ================================================
                          // SOMENTE PRODUTOS ARQUIVADOS
                          // ================================================

                          final archivedProducts =
                          allProducts
                              .where(
                                (doc) {
                              final data =
                              doc.data()
                              as Map<
                                  String,
                                  dynamic>;

                              if (data[
                              'isArchived'] !=
                                  true) {
                                return false;
                              }

                              final name =
                              (data['name_lowercase']
                              as String? ??
                                  data['name']
                                      ?.toString() ??
                                  '')
                                  .toLowerCase();

                              return name
                                  .contains(
                                query,
                              );
                            },
                          ).toList();

                          // ================================================
                          // LISTA VAZIA
                          // ================================================

                          if (archivedProducts
                              .isEmpty) {
                            return Center(
                              child: Text(
                                query.isEmpty
                                    ? 'Nenhum produto arquivado.'
                                    : 'Nenhum produto arquivado encontrado.',

                                style:
                                TextStyle(
                                  color:
                                  isDarkMode
                                      ? Colors
                                      .white70
                                      : Colors
                                      .black54,

                                  fontSize:
                                  16,
                                ),
                              ),
                            );
                          }

                          // ================================================
                          // PRODUTOS
                          // ================================================

                          return ListView
                              .builder(
                            padding:
                            const EdgeInsets
                                .fromLTRB(
                              8,
                              0,
                              8,
                              30,
                            ),

                            itemCount:
                            archivedProducts
                                .length,

                            itemBuilder:
                                (
                                context,
                                index,
                                ) {
                              final productDoc =
                              archivedProducts[
                              index];

                              final data =
                              productDoc
                                  .data()
                              as Map<
                                  String,
                                  dynamic>;

                              final rawName =
                                  data['name']
                                      ?.toString()
                                      .trim() ??
                                      '';

                              final name =
                              rawName.isEmpty
                                  ? 'Produto'
                                  : rawName;

                              final price =
                              (data['price']
                              as num? ??
                                  0)
                                  .toDouble();

                              final quantity =
                              (data['quantidade']
                              as num? ??
                                  0)
                                  .toInt();

                              final minimumStock =
                              (data['minimumStock']
                              as num? ??
                                  0)
                                  .toInt();

                              final categoryName =
                              data['categoryName']
                                  ?.toString()
                                  .trim();

                              final isRestoring =
                              _restoringProductIds
                                  .contains(
                                productDoc.id,
                              );

                              return Card(
                                color:
                                isDarkMode
                                    ? Colors
                                    .black
                                    .withOpacity(
                                  0.6,
                                )
                                    : Colors
                                    .white
                                    .withOpacity(
                                  0.8,
                                ),

                                shape:
                                RoundedRectangleBorder(
                                  borderRadius:
                                  BorderRadius
                                      .circular(
                                    15,
                                  ),
                                ),

                                margin:
                                const EdgeInsets
                                    .symmetric(
                                  horizontal:
                                  8,

                                  vertical:
                                  5,
                                ),

                                child:
                                ListTile(
                                  // ==========================================
                                  // ÍCONE
                                  // ==========================================

                                  leading:
                                  CircleAvatar(
                                    backgroundColor:
                                    Colors.grey
                                        .shade600,

                                    foregroundColor:
                                    Colors.white,

                                    child:
                                    const Icon(
                                      Icons.inventory_2_outlined,
                                    ),
                                  ),

                                  // ==========================================
                                  // NOME
                                  // ==========================================

                                  title: Text(
                                    name,

                                    style:
                                    const TextStyle(
                                      fontWeight:
                                      FontWeight
                                          .bold,
                                    ),
                                  ),

                                  // ==========================================
                                  // INFORMAÇÕES
                                  // ==========================================

                                  subtitle:
                                  Column(
                                    crossAxisAlignment:
                                    CrossAxisAlignment
                                        .start,

                                    children: [
                                      const SizedBox(
                                        height:
                                        2,
                                      ),

                                      Text(
                                        '${_currencyFormat.format(price)} • Estoque: $quantity',
                                      ),

                                      if (categoryName !=
                                          null &&
                                          categoryName
                                              .isNotEmpty)
                                        Text(
                                          'Categoria: $categoryName',
                                        ),

                                      Text(
                                        'Estoque mínimo: $minimumStock',
                                      ),

                                      const SizedBox(
                                        height:
                                        3,
                                      ),

                                      Text(
                                        _formatArchivedAt(
                                          data[
                                          'archivedAt'],
                                        ),

                                        style:
                                        TextStyle(
                                          fontSize:
                                          12,

                                          color:
                                          isDarkMode
                                              ? Colors
                                              .white60
                                              : Colors
                                              .black54,
                                        ),
                                      ),
                                    ],
                                  ),

                                  // ==========================================
                                  // RESTAURAR
                                  // ==========================================

                                  trailing:
                                  isRestoring
                                      ? const SizedBox(
                                    width:
                                    24,

                                    height:
                                    24,

                                    child:
                                    CircularProgressIndicator(
                                      strokeWidth:
                                      2,
                                    ),
                                  )
                                      : IconButton(
                                    tooltip:
                                    'Restaurar produto',

                                    icon:
                                    const Icon(
                                      Icons.restore,
                                    ),

                                    onPressed:
                                        () =>
                                        _restoreProduct(
                                          productDoc,
                                        ),
                                  ),
                                ),
                              );
                            },
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}