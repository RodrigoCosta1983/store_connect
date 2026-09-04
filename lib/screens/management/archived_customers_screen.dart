// ============================================================================
// STORE CONNECT - CLIENTES ARQUIVADOS
// ============================================================================
//
// Arquivo:
//   lib/screens/management/archived_customers_screen.dart
//
// OBJETIVO:
//
// Exibir clientes que foram arquivados por um administrador da loja e
// permitir sua restauração segura.
//
// SEGURANÇA:
//
// • Esta tela será disponibilizada somente para o Admin da loja.
// • A interface NÃO altera diretamente os campos de arquivamento.
// • A restauração é solicitada à Cloud Function restoreCustomer.
// • O backend valida novamente:
//     - Firebase Auth;
//     - role == admin;
//     - vínculo do usuário com a loja.
// • Firestore Rules continuam impedindo alteração direta de isArchived,
//   archivedAt e archivedBy pelo Flutter.
//
// RESTAURAÇÃO:
//
// Cliente arquivado:
//
//   isArchived = true
//
// Após restauração:
//
//   isArchived = false
//
// archivedAt e archivedBy permanecem preservados como informação do último
// arquivamento.
//
// A cronologia completa é preservada em:
//
//   stores/{storeId}/auditLogs
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import 'package:store_connect/widgets/dynamic_background.dart';

class ArchivedCustomersScreen extends StatefulWidget {
  final String storeId;

  const ArchivedCustomersScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<ArchivedCustomersScreen> createState() =>
      _ArchivedCustomersScreenState();
}

class _ArchivedCustomersScreenState
    extends State<ArchivedCustomersScreen> {
  // ==========================================================================
  // BUSCA
  // ==========================================================================

  final TextEditingController _searchController =
  TextEditingController();

  // ==========================================================================
  // CONTROLE DE RESTAURAÇÃO
  // ==========================================================================

  final Set<String> _restoringCustomerIds = {};

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _searchController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // FORMATA DATA DE ARQUIVAMENTO
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
  // RESTAURAR CLIENTE
  // ==========================================================================
  //
  // Nenhuma alteração administrativa é feita diretamente no Firestore.
  //
  // O Flutter apenas solicita a operação à Cloud Function restoreCustomer.
  // ==========================================================================

  Future<void> _restoreCustomer(
      DocumentSnapshot customerDoc,
      ) async {
    final data =
    customerDoc.data() as Map<String, dynamic>;

    final customerName =
    data['name']?.toString().trim().isNotEmpty == true
        ? data['name'].toString().trim()
        : 'Cliente';

    String reason = '';

    final confirmed =
    await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text(
            'Restaurar cliente',
          ),

          content: SingleChildScrollView(
            child: Column(
              mainAxisSize:
              MainAxisSize.min,

              crossAxisAlignment:
              CrossAxisAlignment.start,

              children: [
                Text(
                  'Deseja restaurar o cliente "$customerName"?',
                ),

                const SizedBox(
                  height: 12,
                ),

                const Text(
                  'O cliente voltará a aparecer nas listas da loja '
                      'e poderá ser selecionado novamente em novas vendas.',
                ),

                const SizedBox(
                  height: 16,
                ),

                TextField(
                  maxLines: 3,
                  onChanged: (value) {
                    reason = value.trim();
                  },
                  decoration: const InputDecoration(
                    labelText: 'Motivo (opcional)',
                    hintText: 'Ex.: cadastro reativado',
                    border: OutlineInputBorder(),
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

              child: const Text(
                'Cancelar',
              ),
            ),

            ElevatedButton.icon(
              onPressed: () =>
                  Navigator.of(
                    dialogContext,
                  ).pop(true),

              icon: const Icon(
                Icons.restore,
              ),

              label: const Text(
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
    // EVITA DUPLO CLIQUE
    // ========================================================================

    if (_restoringCustomerIds.contains(
      customerDoc.id,
    )) {
      return;
    }

    setState(() {
      _restoringCustomerIds.add(
        customerDoc.id,
      );
    });

    try {
      final callable =
      FirebaseFunctions.instance
          .httpsCallable(
        'restoreCustomer',
      );

      await callable.call({
        'storeId': widget.storeId,
        'customerId': customerDoc.id,
        'reason': reason.isEmpty
            ? null
            : reason,
      });

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            content: Text(
              '$customerName foi restaurado com sucesso.',
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
                  'Não foi possível restaurar o cliente.',
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
              'Não foi possível restaurar o cliente.',
            ),
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          _restoringCustomerIds.remove(
            customerDoc.id,
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

                              Expanded(
                                child: Text(
                                  'Clientes Arquivados',

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
                              'Buscar arquivados por nome...',

                              hintStyle:
                              TextStyle(
                                color: isDarkMode
                                    ? Colors.white70
                                    : Colors.black54,
                              ),

                              prefixIcon:
                              Icon(
                                Icons.search,

                                color: isDarkMode
                                    ? Colors.white70
                                    : Colors.black54,
                              ),

                              filled:
                              true,

                              fillColor:
                              Theme.of(
                                context,
                              )
                                  .cardColor
                                  .withOpacity(
                                0.8,
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
                                vertical: 0,
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
                          'customers',
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
                                'Não foi possível carregar os clientes arquivados.',
                              ),
                            );
                          }

                          final allCustomers =
                              snapshot.data
                                  ?.docs ??
                                  [];

                          final query =
                          _searchController
                              .text
                              .trim()
                              .toLowerCase();

                          // ================================================
                          // SOMENTE ARQUIVADOS
                          // ================================================

                          final archivedCustomers =
                          allCustomers
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

                          if (archivedCustomers
                              .isEmpty) {
                            return Center(
                              child: Text(
                                query.isEmpty
                                    ? 'Nenhum cliente arquivado.'
                                    : 'Nenhum cliente arquivado encontrado.',

                                style:
                                TextStyle(
                                  color: isDarkMode
                                      ? Colors.white70
                                      : Colors.black54,

                                  fontSize:
                                  16,
                                ),
                              ),
                            );
                          }

                          // ================================================
                          // CLIENTES
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
                            archivedCustomers
                                .length,

                            itemBuilder:
                                (
                                context,
                                index,
                                ) {
                              final customerDoc =
                              archivedCustomers[
                              index];

                              final data =
                              customerDoc
                                  .data()
                              as Map<
                                  String,
                                  dynamic>;

                              final name =
                                  data['name']
                                      ?.toString() ??
                                      'Cliente';

                              final phone =
                              data['phone']
                                  ?.toString()
                                  .trim();

                              final isRestoring =
                              _restoringCustomerIds
                                  .contains(
                                customerDoc.id,
                              );

                              return Card(
                                color: isDarkMode
                                    ? Colors.black
                                    .withOpacity(
                                    0.6)
                                    : Colors.white
                                    .withOpacity(
                                    0.8),

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
                                  leading:
                                  CircleAvatar(
                                    backgroundColor:
                                    Colors.grey,

                                    foregroundColor:
                                    Colors.white,

                                    child: Text(
                                      name.isNotEmpty
                                          ? name[0]
                                          .toUpperCase()
                                          : '?',
                                    ),
                                  ),

                                  title: Text(
                                    name,

                                    style:
                                    const TextStyle(
                                      fontWeight:
                                      FontWeight
                                          .bold,
                                    ),
                                  ),

                                  subtitle:
                                  Column(
                                    crossAxisAlignment:
                                    CrossAxisAlignment
                                        .start,

                                    children: [
                                      Text(
                                        phone == null ||
                                            phone
                                                .isEmpty
                                            ? 'Sem telefone'
                                            : phone,
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

                                          color: isDarkMode
                                              ? Colors
                                              .white60
                                              : Colors
                                              .black54,
                                        ),
                                      ),
                                    ],
                                  ),

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
                                    icon:
                                    const Icon(
                                      Icons
                                          .restore,
                                    ),

                                    tooltip:
                                    'Restaurar cliente',

                                    onPressed:
                                        () =>
                                        _restoreCustomer(
                                          customerDoc,
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