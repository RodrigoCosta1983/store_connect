// ============================================================================
// ARQUIVO: employees_screen.dart
// ============================================================================
//
// OBJETIVO:
//
// Gerenciar os usuários operacionais vinculados à loja.
//
// RESPONSABILIDADES:
//
// - listar usuários vinculados ao storeId;
// - convidar novos funcionários através da Cloud Function;
// - apresentar papéis de forma padronizada;
// - manter compatibilidade visual com usuários antigos;
// - impedir pela interface a remoção de usuários administrativos;
// - preparar a tela para futura revogação segura de acesso.
//
/// PAPÉIS CANÔNICOS:
//
// - admin
// - gerente
// - operador
//
// "Operador de Loja" substitui os antigos:
//
// - caixa
// - vendedor
//
// COMPATIBILIDADE COM DADOS LEGADOS:
//
// Usuários antigos armazenados como "caixa" ou "vendedor" são apresentados
// pela interface como "operador".
//
// Novos funcionários são gravados pelo backend diretamente como:
//
// - operador
// - gerente
//
// O papel admin não pode ser atribuído através da tela de convite.
//
// REVOGAÇÃO DE ACESSO:
//
// Funcionários não são mais excluídos fisicamente.
//
// A remoção de acesso utiliza a Cloud Function:
//
// revogarAcessoFuncionario
//
// O backend:
//
// - valida que o solicitante é admin da mesma loja;
// - impede revogação do próprio administrador;
// - impede revogação de outro admin;
// - desabilita o usuário no Firebase Authentication;
// - preserva users/{uid};
// - grava accessStatus = "revoked";
// - grava revokedAt e revokedBy;
// - registra auditLogs.
//
// Usuários revogados são filtrados da lista ativa, mas permanecem no banco
// para histórico, auditoria e eventual recuperação administrativa.
//
// "Operador de Loja" substitui os antigos:
//
// - caixa
// - vendedor
//
// COMPATIBILIDADE TEMPORÁRIA COM O BACKEND:
//
// A Cloud Function atual "convidarFuncionario" ainda não foi examinada nesta
// etapa para confirmar se aceita o novo valor "operador".
//
// Por segurança, enquanto fazemos essa transição:
//
//   UI:      operador
//   Flutter: operador
//   Backend: vendedor
//
// Ou seja, ao convidar um Operador de Loja, esta tela temporariamente envia
// "vendedor" para a função antiga.
//
// O UserRoleProvider converte automaticamente:
//
//   vendedor -> operador
//   caixa    -> operador
//
// Depois que functions/usuarios/convidarFuncionario.js for atualizado,
// removeremos essa ponte e o Firestore passará a armazenar "operador".
//
// REMOÇÃO DE FUNCIONÁRIO:
//
// ATENÇÃO:
//
// A implementação atual ainda possui exclusão física de users/{uid}.
//
// Isso é TEMPORÁRIO.
//
// Antes de endurecer definitivamente as Firestore Rules, essa operação será
// substituída por uma Cloud Function de revogação segura, preservando:
//
// - histórico;
// - usuário;
// - role anterior;
// - storeId;
// - auditoria;
// - revokedAt;
// - revokedBy.
//
// Não transformar a exclusão direta atual em política definitiva.
//
// PROTEÇÃO VISUAL:
//
// Usuários com papel administrativo não podem ser removidos por gesto nesta
// tela.
//
// Isso é apenas proteção de UX. A barreira definitiva será feita no backend
// e nas Firestore Rules.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

class EmployeesScreen extends StatefulWidget {
  final String storeId;

  const EmployeesScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<EmployeesScreen> createState() =>
      _EmployeesScreenState();
}

class _EmployeesScreenState
    extends State<EmployeesScreen> {
  bool _isLoading = false;

  // ==========================================================================
  // NORMALIZA PAPÉIS
  // ==========================================================================
  //
  // Compatibilidade com usuários antigos.
  // ==========================================================================

  String _normalizeRole(dynamic value) {
    final role =
    value?.toString().trim().toLowerCase();

    switch (role) {
      case 'admin':
        return 'admin';

      case 'gerente':
        return 'gerente';

      case 'operador':
      case 'caixa':
      case 'vendedor':
        return 'operador';

      default:
        return 'operador';
    }
  }

  // ==========================================================================
  // LABEL DO PAPEL
  // ==========================================================================

  String _roleLabel(String role) {
    switch (role) {
      case 'admin':
        return 'Administrador';

      case 'gerente':
        return 'Gerente';

      case 'operador':
      default:
        return 'Operador de Loja';
    }
  }

  // ==========================================================================
  // PAPEL ENVIADO AO BACKEND
  // ==========================================================================
  //
  // Ponte temporária.
  //
  // Enquanto convidarFuncionario.js ainda trabalha com a estrutura antiga:
  //
  // operador -> vendedor
  //
  // Depois da atualização da Cloud Function, esta conversão será removida.
  // ==========================================================================

  String _roleForCurrentBackend(
      String selectedRole,
      ) {
    if (selectedRole == 'operador') {
      return 'vendedor';
    }

    return selectedRole;
  }

  // ==========================================================================
  // CONVIDAR FUNCIONÁRIO
  // ==========================================================================

  Future<void> _convidarFuncionario(
      String nome,
      String email,
      String role,
      ) async {
    if (nome.trim().isEmpty) {
      _showError(
        'Informe o nome do funcionário.',
      );

      return;
    }

    if (email.trim().isEmpty ||
        !email.contains('@')) {
      _showError(
        'Informe um e-mail válido.',
      );

      return;
    }

    setState(
          () => _isLoading = true,
    );

    try {
      final callable =
      FirebaseFunctions.instance.httpsCallable(
        'convidarFuncionario',
      );

      final response =
      await callable.call({
        'storeId': widget.storeId,
        'email': email.trim(),
        'nome': nome.trim(),
        'role': role,
      });

      final dynamic responseData =
          response.data;

      String? tempLink;

      if (responseData is Map) {
        tempLink =
            responseData['tempResetLink']
                ?.toString();
      }

      if (!mounted) {
        return;
      }

      // ----------------------------------------------------------------------
      // MODAL DE SUCESSO
      // ----------------------------------------------------------------------

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Row(
            children: [
              Icon(
                Icons.check_circle,
                color: Colors.green,
              ),
              SizedBox(width: 8),
              Text(
                'Convite Gerado!',
              ),
            ],
          ),
          content: Column(
            mainAxisSize:
            MainAxisSize.min,
            crossAxisAlignment:
            CrossAxisAlignment.stretch,
            children: [
              Text(
                'A conta de $nome foi criada com sucesso.',
              ),
              const SizedBox(
                height: 6,
              ),
              Text(
                'Permissão: ${_roleLabel(role)}',
                style: const TextStyle(
                  fontWeight:
                  FontWeight.w600,
                ),
              ),
              if (tempLink != null &&
                  tempLink.isNotEmpty) ...[
                const SizedBox(
                  height: 16,
                ),
                ElevatedButton.icon(
                  style:
                  ElevatedButton.styleFrom(
                    padding:
                    const EdgeInsets.symmetric(
                      vertical: 12,
                    ),
                    backgroundColor:
                    Colors.blue,
                    foregroundColor:
                    Colors.white,
                  ),
                  icon:
                  const Icon(
                    Icons.share,
                  ),
                  label:
                  const Text(
                    'Compartilhar Acesso',
                  ),
                  onPressed: () {
                    Share.share(
                      'Olá, $nome! Você foi convidado para acessar o sistema da loja.\n\n'
                          'Clique no link abaixo para criar sua senha de acesso e entrar no app:\n'
                          '$tempLink',
                    );
                  },
                ),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () =>
                  Navigator.of(ctx).pop(),
              child:
              const Text(
                'Fechar',
              ),
            ),
          ],
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) {
        return;
      }

      _showError(
        e.message ??
            'Não foi possível convidar o funcionário.',
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      _showError(
        'Erro ao convidar: $e',
      );
    } finally {
      if (mounted) {
        setState(
              () => _isLoading = false,
        );
      }
    }
  }

  // ==========================================================================
  // ERRO
  // ==========================================================================

  void _showError(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor:
          Colors.red,
        ),
      );
  }

  // ==========================================================================
  // MODAL DE CONVITE
  // ==========================================================================

  void _mostrarModalConvite() {
    final nameController =
    TextEditingController();

    final emailController =
    TextEditingController();

    String selectedRole = 'operador';

    showDialog<void>(
      context: context,
      builder: (dialogContext) =>
          StatefulBuilder(
            builder: (
                context,
                setModalState,
                ) =>
                AlertDialog(
                  title:
                  const Text(
                    'Convidar Funcionário',
                  ),
                  content:
                  SingleChildScrollView(
                    child: Column(
                      mainAxisSize:
                      MainAxisSize.min,
                      children: [
                        TextField(
                          controller:
                          nameController,
                          textCapitalization:
                          TextCapitalization.words,
                          decoration:
                          const InputDecoration(
                            labelText:
                            'Nome do Funcionário',
                          ),
                        ),
                        const SizedBox(
                          height: 12,
                        ),
                        TextField(
                          controller:
                          emailController,
                          decoration:
                          const InputDecoration(
                            labelText:
                            'E-mail de Acesso',
                          ),
                          keyboardType:
                          TextInputType
                              .emailAddress,
                        ),
                        const SizedBox(
                          height: 12,
                        ),

                        // ============================================================
                        // CARGO
                        //
                        // Não existe mais distinção entre caixa e vendedor.
                        // ============================================================

                        DropdownButtonFormField<
                            String>(
                          value: selectedRole,
                          decoration:
                          const InputDecoration(
                            labelText:
                            'Cargo / Permissão',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'operador',
                              child: Text(
                                'Operador de Loja',
                              ),
                            ),
                            DropdownMenuItem(
                              value: 'gerente',
                              child: Text(
                                'Gerente',
                              ),
                            ),
                          ],
                          onChanged: (value) {
                            if (value == null) {
                              return;
                            }

                            setModalState(
                                  () =>
                              selectedRole =
                                  value,
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () =>
                          Navigator.of(
                            dialogContext,
                          ).pop(),
                      child:
                      const Text(
                        'Cancelar',
                      ),
                    ),
                    ElevatedButton(
                      onPressed: () {
                        final nome =
                        nameController.text
                            .trim();

                        final email =
                        emailController.text
                            .trim();

                        Navigator.of(
                          dialogContext,
                        ).pop();

                        _convidarFuncionario(
                          nome,
                          email,
                          selectedRole,
                        );
                      },
                      child:
                      const Text(
                        'Enviar Convite',
                      ),
                    ),
                  ],
                ),
          ),
    );
  }

  // ==========================================================================
// REVOGAR ACESSO DO FUNCIONÁRIO
// ==========================================================================
//
// Antes de chamar a Cloud Function:
//
// 1. confirma que existe sessão Firebase Auth;
// 2. força renovação do ID Token;
// 3. chama o backend autenticado.
//
// Nenhum token é impresso no log.
// ==========================================================================

  Future<bool> _removerAcesso(
      String employeeUid,
      String nome,
      ) async {
    try {
      // ----------------------------------------------------------------------
      // 1. CONFIRMA USUÁRIO AUTENTICADO
      // ----------------------------------------------------------------------

      final user =
          FirebaseAuth.instance.currentUser;

      if (user == null) {
        _showError(
          'Sua sessão expirou. Entre novamente no aplicativo.',
        );

        return false;
      }

      debugPrint(
        '🔐 Revogação solicitada por uid=${user.uid}',
      );

      // ----------------------------------------------------------------------
      // 2. RENOVA O ID TOKEN
      //
      // Não imprimir o conteúdo do token.
      // ----------------------------------------------------------------------

      await user.getIdToken(true);

      // ----------------------------------------------------------------------
      // 3. CHAMA A CLOUD FUNCTION
      // ----------------------------------------------------------------------

      final callable =
      FirebaseFunctions.instance
          .httpsCallable(
        'revogarAcessoFuncionario',
      );

      await callable.call({
        'storeId':
        widget.storeId,

        'employeeUid':
        employeeUid,
      });

      if (!mounted) {
        return true;
      }

      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            content: Text(
              'O acesso de $nome foi revogado.',
            ),
            backgroundColor:
            Colors.green,
          ),
        );

      return true;
    } on FirebaseFunctionsException catch (e) {
      debugPrint(
        '❌ revogarAcessoFuncionario '
            'code=${e.code} message=${e.message}',
      );

      if (!mounted) {
        return false;
      }

      _showError(
        e.message ??
            'Não foi possível revogar o acesso.',
      );

      return false;
    } on FirebaseAuthException catch (e) {
      debugPrint(
        '❌ Falha ao renovar autenticação '
            'code=${e.code}',
      );

      if (!mounted) {
        return false;
      }

      _showError(
        'Não foi possível validar sua sessão. Entre novamente.',
      );

      return false;
    } catch (e) {
      debugPrint(
        '❌ Erro inesperado na revogação: $e',
      );

      if (!mounted) {
        return false;
      }

      _showError(
        'Erro ao revogar acesso: $e',
      );

      return false;
    }
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title:
        const Text(
          'Gerenciar Funcionários',
        ),
      ),

      // ======================================================================
      // LISTA DE USUÁRIOS DA LOJA
      // ======================================================================

      body:
      StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('users')
            .where(
          'storeId',
          isEqualTo:
          widget.storeId,
        )
            .snapshots(),
        builder: (
            context,
            snapshot,
            ) {
          if (snapshot.connectionState ==
              ConnectionState.waiting) {
            return const Center(
              child:
              CircularProgressIndicator(),
            );
          }

          if (snapshot.hasError) {
            return const Center(
              child: Text(
                'Não foi possível carregar os funcionários.',
              ),
            );
          }

          final allDocs =
          (snapshot.data?.docs ?? [])
              .where(
                (doc) {
              final data =
              doc.data()
              as Map<String, dynamic>;

              final accessStatus =
              data['accessStatus']
                  ?.toString()
                  .trim()
                  .toLowerCase();

              // ------------------------------------------------------------
              // Compatibilidade:
              //
              // documentos antigos não possuem accessStatus.
              //
              // Ausência do campo = usuário ativo.
              // ------------------------------------------------------------

              return accessStatus !=
                  'revoked';
            },
          )
              .toList();

          if (allDocs.isEmpty) {
            return const Center(
              child: Text(
                'Nenhum funcionário cadastrado.',
              ),
            );
          }

          return ListView.builder(
            itemCount:
            allDocs.length,
            itemBuilder: (
                context,
                index,
                ) {
              final doc =
              allDocs[index];

              final data =
              doc.data()
              as Map<
                  String,
                  dynamic>;

              final nome =
                  data['name']
                      ?.toString() ??
                      data['username']
                          ?.toString() ??
                      'Sem Nome';

              final email =
                  data['email']
                      ?.toString() ??
                      '';

              final role =
              _normalizeRole(
                data['role'],
              );

              final roleLabel =
              _roleLabel(role);

              // ==============================================================
              // ADMIN NÃO PODE SER REMOVIDO POR ESTA TELA
              // ==============================================================

              final canRemove =
                  role != 'admin';

              final tile =
              ListTile(
                leading:
                CircleAvatar(
                  child: Text(
                    nome.isNotEmpty
                        ? nome[0]
                        .toUpperCase()
                        : 'U',
                  ),
                ),
                title:
                Text(nome),
                subtitle:
                Text(
                  '$email • Cargo: $roleLabel',
                ),
                trailing:
                Chip(
                  label:
                  Text(
                    roleLabel,
                    style:
                    const TextStyle(
                      fontSize: 12,
                    ),
                  ),
                  backgroundColor:
                  role == 'admin'
                      ? Colors
                      .purple
                      .shade100
                      : role ==
                      'gerente'
                      ? Colors
                      .orange
                      .shade100
                      : Colors
                      .blue
                      .shade100,
                ),
              );

              // ==============================================================
              // ADMIN
              //
              // Não recebe gesto de remoção.
              // ==============================================================

              if (!canRemove) {
                return tile;
              }

              // ==============================================================
              // GERENTE / OPERADOR
              //
              // Remoção ainda usa fluxo legado temporário.
              // ==============================================================

              return Dismissible(
                key: Key(doc.id),
                direction:
                DismissDirection
                    .endToStart,
                background:
                Container(
                  color:
                  Colors.red,
                  alignment:
                  Alignment
                      .centerRight,
                  padding:
                  const EdgeInsets
                      .symmetric(
                    horizontal: 20,
                  ),
                  child:
                  const Icon(
                    Icons
                        .person_off_outlined,
                    color:
                    Colors.white,
                  ),
                ),
                confirmDismiss:
                    (direction) async {
                  final confirmed =
                  await showDialog<bool>(
                    context: context,
                    builder:
                        (ctx) =>
                        AlertDialog(
                          title:
                          const Text(
                            'Remover Acesso?',
                          ),
                          content:
                          Text(
                            'Tem certeza que deseja remover o acesso de $nome à sua loja?\n\n'
                                'O histórico do funcionário será preservado.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () =>
                                  Navigator.of(
                                    ctx,
                                  ).pop(false),
                              child:
                              const Text(
                                'Cancelar',
                              ),
                            ),
                            ElevatedButton(
                              style:
                              ElevatedButton
                                  .styleFrom(
                                backgroundColor:
                                Colors.red,
                                foregroundColor:
                                Colors.white,
                              ),
                              onPressed: () =>
                                  Navigator.of(
                                    ctx,
                                  ).pop(true),
                              child:
                              const Text(
                                'Remover Acesso',
                              ),
                            ),
                          ],
                        ),
                  );

                  if (confirmed != true) {
                    return false;
                  }

                  return await _removerAcesso(
                    doc.id,
                    nome,
                  );
                },

                child: tile,
              );
            },
          );
        },
      ),

      // ======================================================================
      // ADICIONAR FUNCIONÁRIO
      // ======================================================================

      floatingActionButton:
      FloatingActionButton(
        onPressed:
        _isLoading
            ? null
            : _mostrarModalConvite,
        tooltip:
        'Adicionar Funcionário',
        child:
        _isLoading
            ? const SizedBox(
          width: 20,
          height: 20,
          child:
          CircularProgressIndicator(
            strokeWidth: 2,
            color:
            Colors.white,
          ),
        )
            : const Icon(
          Icons.person_add,
        ),
      ),
    );
  }
}