// ============================================================================
// ARQUIVO: manage_customers_screen.dart
// ============================================================================
//
// RESPONSABILIDADE DESTE ARQUIVO:
//
// Gerencia os clientes cadastrados da loja.
//
// PRINCIPAIS RESPONSABILIDADES:
//
// • Listar clientes cadastrados
// • Buscar clientes por nome
// • Criar novos clientes
// • Editar clientes existentes
// • Arquivar clientes com autorização administrativa
// • Buscar dados de contato diretamente da agenda do dispositivo
// • Acessar a conta / saldo devedor do cliente
// • Permitir seleção de cliente durante uma venda
// • Permitir vender sem cliente quando utilizado em modo de seleção
//
// FIRESTORE:
//
// stores/{storeId}/customers/{customerId}
//
// CAMPOS PRINCIPAIS:
//
// {
//   name,
//   name_lowercase,
//   phone,
//   createdAt
// }
//
// MODOS DE USO:
//
// 1. MODO GERENCIAMENTO:
//
//    ManageCustomersScreen(
//      storeId: "...",
//    )
//
//    Permite:
//    • adicionar
//    • editar
//    • arquivar
//    • abrir conta do cliente
//
// 2. MODO SELEÇÃO:
//
//    ManageCustomersScreen(
//      storeId: "...",
//      isSelectionMode: true,
//    )
//
//    Permite selecionar um cliente durante a venda.
//    Também permite continuar a venda sem cliente.
//
// RESPONSIVIDADE:
//
// • Mobile:
//   Utiliza normalmente a largura disponível da tela.
//
// • Web / Desktop:
//   Cabeçalho, busca e lista ficam centralizados com largura máxima
//   de 1100px.
//
// COMPATIBILIDADE:
//
// • Android / Mobile
// • Web
//
// OBSERVAÇÃO SOBRE CONTATOS:
//
// O acesso à agenda depende do suporte da plataforma e das permissões
// disponibilizadas pelo plugin flutter_native_contact_picker.
//
// CUIDADOS EM FUTURAS ALTERAÇÕES:
//
// • Não quebrar o modo seleção utilizado pela tela de vendas.
// • Não remover o retorno Navigator.pop(customer) no modo seleção.
// • Não remover a opção de venda sem cliente.
// • Manter name_lowercase para preservar a busca atual.
// • O arquivamento de cliente nunca deve apagar vendas já realizadas.
// • Clientes arquivados permanecem no Firestore para recuperação pelo suporte.
// • Somente admin pode executar a ação crítica de arquivamento.
// • Manter o acesso à conta do cliente separado da edição.
// • O FloatingActionButton só aparece no modo gerenciamento.
//
// ============================================================================

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:provider/provider.dart';

import 'package:flutter_native_contact_picker/flutter_native_contact_picker.dart';
import 'package:flutter_native_contact_picker/model/contact.dart';

import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/user_role_provider.dart';
import 'package:store_connect/widgets/dynamic_background.dart';

import 'package:store_connect/screens/management/customer_receivables_screen.dart';

// ============================================================================
// DIÁLOGO DE ADICIONAR / EDITAR CLIENTE
// ============================================================================
//
// Utilizado tanto para criação quanto edição.
//
// Se "customer" for null:
// cria um novo cliente.
//
// Se "customer" possuir documento:
// carrega e edita o cliente existente.
//
// ============================================================================

class _CustomerDialog extends StatefulWidget {
  final String storeId;
  final DocumentSnapshot? customer;

  const _CustomerDialog({required this.storeId, this.customer});

  @override
  State<_CustomerDialog> createState() => _CustomerDialogState();
}

class _CustomerDialogState extends State<_CustomerDialog> {
  // ==========================================================================
  // FORMULÁRIO
  // ==========================================================================

  final _formKey = GlobalKey<FormState>();

  final _nameController = TextEditingController();

  final _phoneController = TextEditingController();

  // ==========================================================================
  // ESTADO
  // ==========================================================================

  bool _isLoading = false;

  // ==========================================================================
  // PICKER NATIVO DE CONTATOS
  // ==========================================================================

  final FlutterNativeContactPicker _contactPicker =
      FlutterNativeContactPicker();

  // ==========================================================================
  // INDICA SE ESTAMOS EDITANDO
  // ==========================================================================

  bool get _isEditing => widget.customer != null;

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    if (_isEditing) {
      final customerData = widget.customer!.data() as Map<String, dynamic>;

      _nameController.text = customerData['name']?.toString() ?? '';

      _phoneController.text = customerData['phone']?.toString() ?? '';
    }
  }

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // LIMPA TELEFONE DA AGENDA
  //
  // Remove:
  // • espaços
  // • parênteses
  // • traços
  // • símbolos
  //
  // Também remove o código internacional 55 quando presente.
  // ==========================================================================

  String _limparNumeroTelefone(String numeroBruto) {
    String numeroLimpo = numeroBruto.replaceAll(RegExp(r'\D'), '');

    if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 12) {
      numeroLimpo = numeroLimpo.substring(2);
    }

    return numeroLimpo;
  }

  // ==========================================================================
  // BUSCAR CONTATO NA AGENDA
  // ==========================================================================

  Future<void> _buscarContatoNaAgenda() async {
    try {
      final Contact? contatoSelecionado = await _contactPicker.selectContact();

      if (contatoSelecionado == null) {
        return;
      }

      setState(() {
        // --------------------------------------------------------------------
        // NOME
        //
        // Só preenche automaticamente se o campo estiver vazio.
        // --------------------------------------------------------------------

        if (_nameController.text.isEmpty) {
          _nameController.text = contatoSelecionado.fullName ?? '';
        }

        // --------------------------------------------------------------------
        // TELEFONE
        // --------------------------------------------------------------------

        if (contatoSelecionado.phoneNumbers != null &&
            contatoSelecionado.phoneNumbers!.isNotEmpty) {
          final numeroOriginal = contatoSelecionado.phoneNumbers!.first;

          _phoneController.text = _limparNumeroTelefone(numeroOriginal);
        }
      });
    } catch (e) {
      debugPrint('Erro ao buscar contato: $e');

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Não foi possível acessar a agenda: $e')),
      );
    }
  }

  // ==========================================================================
  // SALVAR CLIENTE
  // ==========================================================================

  Future<void> _saveCustomer() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    final collectionRef = FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .collection('customers');

    final name = _nameController.text.trim();

    final customerData = {
      'name': name,

      // Mantido para a busca atual.
      'name_lowercase': name.toLowerCase(),

      'phone': _phoneController.text.trim(),
    };

    try {
      // ======================================================================
      // EDIÇÃO
      // ======================================================================

      if (_isEditing) {
        await collectionRef.doc(widget.customer!.id).update(customerData);
      }
      // ======================================================================
      // NOVO CLIENTE
      // ======================================================================
      else {
        await collectionRef.add({
          ...customerData,
          'createdAt': Timestamp.now(),
        });
      }

      if (!mounted) {
        return;
      }

      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Erro ao salvar: $e')));
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ==========================================================================
  // BUILD DO DIÁLOGO
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isEditing ? 'Editar Cliente' : 'Adicionar Cliente'),

      content: Form(
        key: _formKey,

        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,

            children: [
              // ==============================================================
              // NOME
              // ==============================================================
              TextFormField(
                controller: _nameController,

                decoration: const InputDecoration(labelText: 'Nome do Cliente'),

                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Insira um nome.';
                  }

                  return null;
                },
              ),

              // ==============================================================
              // TELEFONE
              // ==============================================================
              TextFormField(
                controller: _phoneController,

                decoration: InputDecoration(
                  labelText: 'Telefone (opcional)',

                  suffixIcon: IconButton(
                    icon: Icon(
                      Icons.perm_contact_calendar_rounded,
                      color: Theme.of(context).primaryColor,
                    ),

                    tooltip: 'Buscar na agenda',

                    onPressed: _buscarContatoNaAgenda,
                  ),
                ),

                keyboardType: TextInputType.phone,
              ),
            ],
          ),
        ),
      ),

      // ======================================================================
      // AÇÕES
      // ======================================================================
      actions: [
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.of(context).pop(),

          child: const Text('Cancelar'),
        ),

        ElevatedButton(
          onPressed: _isLoading ? null : _saveCustomer,

          child: _isLoading
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Salvar'),
        ),
      ],
    );
  }
}

// ============================================================================
// TELA PRINCIPAL - GERENCIAR / SELECIONAR CLIENTES
// ============================================================================

class ManageCustomersScreen extends StatefulWidget {
  final String storeId;

  // Quando true:
  // a tela passa a funcionar como seletor para a venda.
  final bool isSelectionMode;

  const ManageCustomersScreen({
    super.key,
    required this.storeId,
    this.isSelectionMode = false,
  });

  @override
  State<ManageCustomersScreen> createState() => _ManageCustomersScreenState();
}

class _ManageCustomersScreenState extends State<ManageCustomersScreen> {
  // ==========================================================================
  // BUSCA
  // ==========================================================================

  final _searchController = TextEditingController();

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _searchController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // ABRIR DIÁLOGO
  // ==========================================================================

  void _showCustomerDialog({DocumentSnapshot? customer}) {
    showDialog(
      context: context,

      barrierDismissible: false,

      builder: (ctx) =>
          _CustomerDialog(storeId: widget.storeId, customer: customer),
    );
  }

  // ==========================================================================
  // ARQUIVAR CLIENTE
  // ==========================================================================
  //
  // A operação não executa delete físico.
  //
  // Segurança em camadas:
  // - UI: somente admin visualiza esta ação;
  // - Backend: callable archiveCustomer valida Auth, role e storeId;
  // - Auditoria: a Cloud Function registra before/after em auditLogs.
  //
  // A restauração não fica disponível nesta tela. Ela será uma operação
  // administrativa da equipe de suporte.
  // ==========================================================================

  Future<void> _archiveCustomer(Customer customer) async {
    final reasonController = TextEditingController();

    final shouldArchive = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Arquivar cliente'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'O cliente "${customer.name}" deixará de aparecer nas listas '
                'e não poderá ser selecionado em novas vendas.',
              ),
              const SizedBox(height: 12),
              const Text(
                'O histórico de vendas e as contas a receber serão '
                'preservados. Para restaurar o cadastro, será necessário '
                'solicitar atendimento ao suporte.',
              ),
              const SizedBox(height: 16),
              TextField(
                controller: reasonController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Motivo (opcional)',
                  hintText: 'Ex.: cadastro duplicado',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              foregroundColor: Theme.of(ctx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            icon: const Icon(Icons.archive_outlined),
            label: const Text('Arquivar'),
          ),
        ],
      ),
    );

    if (shouldArchive != true) {
      reasonController.dispose();
      return;
    }

    final reason = reasonController.text.trim();

    reasonController.dispose();

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'archiveCustomer',
      );

      await callable.call({
        'storeId': widget.storeId,
        'customerId': customer.id,
        'reason': reason.isEmpty ? null : reason,
      });

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${customer.name} foi arquivado com segurança.'),
          backgroundColor: Colors.green,
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.message ?? 'Não foi possível arquivar o cliente.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível arquivar o cliente.')),
      );
    }
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    final roleProvider = Provider.of<UserRoleProvider>(context);

    return Scaffold(
      extendBodyBehindAppBar: true,

      // ======================================================================
      // BOTÃO ADICIONAR
      //
      // Não aparece no modo seleção.
      // ======================================================================
      floatingActionButton: widget.isSelectionMode
          ? null
          : FloatingActionButton(
              onPressed: () => _showCustomerDialog(),

              tooltip: 'Adicionar Cliente',

              child: const Icon(Icons.add),
            ),

      // ======================================================================
      // CONTEÚDO
      // ======================================================================
      body: Stack(
        children: [
          // ================================================================
          // FUNDO
          // ================================================================
          const DynamicBackground(),

          // ================================================================
          // ÁREA SEGURA + CONTEÚDO CENTRALIZADO
          //
          // MOBILE:
          // utiliza toda a largura disponível.
          //
          // WEB/DESKTOP:
          // limita a largura a 1100px.
          // ================================================================
          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1100),

                child: Column(
                  children: [
                    // ========================================================
                    // CABEÇALHO + BUSCA
                    // ========================================================
                    _buildCustomHeader(isDarkMode),

                    // ========================================================
                    // LISTA
                    // ========================================================
                    Expanded(
                      child: StreamBuilder<QuerySnapshot>(
                        stream: FirebaseFirestore.instance
                            .collection('stores')
                            .doc(widget.storeId)
                            .collection('customers')
                            .orderBy('name_lowercase')
                            .snapshots(),

                        builder: (context, snapshot) {
                          // ==================================================
                          // CARREGANDO
                          // ==================================================

                          if (snapshot.connectionState ==
                              ConnectionState.waiting) {
                            return const Center(
                              child: CircularProgressIndicator(),
                            );
                          }

                          // ==================================================
                          // ERRO
                          // ==================================================

                          if (snapshot.hasError) {
                            return const Center(
                              child: Text('Ocorreu um erro.'),
                            );
                          }

                          final allCustomers = snapshot.data?.docs ?? [];

                          // ==================================================
                          // FILTRO LOCAL
                          // ==================================================

                          final query = _searchController.text
                              .trim()
                              .toLowerCase();

                          final filteredCustomers = allCustomers.where((doc) {
                            final data = doc.data() as Map<String, dynamic>;

                            final isArchived = data['isArchived'] == true;

                            if (isArchived) {
                              return false;
                            }

                            final name =
                                (data['name_lowercase'] as String? ?? '')
                                    .toLowerCase();

                            return name.contains(query);
                          }).toList();

                          // ==================================================
                          // LISTA VAZIA
                          // ==================================================

                          if (filteredCustomers.isEmpty) {
                            return Center(
                              child: Text(
                                _searchController.text.isEmpty
                                    ? 'Nenhum cliente cadastrado.'
                                    : 'Nenhum cliente encontrado.',
                                style: TextStyle(
                                  color: isDarkMode
                                      ? Colors.white70
                                      : Colors.black54,
                                  fontSize: 16,
                                ),
                              ),
                            );
                          }

                          // ==================================================
                          // LISTA DE CLIENTES
                          // ==================================================

                          return ListView.builder(
                            padding: const EdgeInsets.fromLTRB(8, 0, 8, 80),

                            itemCount: filteredCustomers.length,

                            itemBuilder: (ctx, index) {
                              final customerDoc = filteredCustomers[index];

                              final customer = Customer.fromFirestore(
                                customerDoc,
                              );

                              return _buildCustomerCard(
                                customer,
                                customerDoc,
                                isDarkMode,
                                roleProvider.canPerformCriticalActions,
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

  // ==========================================================================
  // CABEÇALHO PERSONALIZADO
  // ==========================================================================

  Widget _buildCustomHeader(bool isDarkMode) {
    final headerColor = isDarkMode ? Colors.white : Colors.black;

    return Padding(
      // ----------------------------------------------------------------------
      // SafeArea já trata o topo.
      //
      // Por isso não usamos novamente MediaQuery.padding.top.
      // ----------------------------------------------------------------------
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),

      child: Column(
        children: [
          // ================================================================
          // LINHA SUPERIOR
          // ================================================================
          Row(
            children: [
              // ============================================================
              // VOLTAR
              // ============================================================
              IconButton(
                icon: Icon(Icons.arrow_back, color: headerColor),

                onPressed: () => Navigator.of(context).pop(),
              ),

              // ============================================================
              // TÍTULO
              // ============================================================
              Expanded(
                child: Text(
                  widget.isSelectionMode
                      ? 'Selecionar Cliente'
                      : 'Gerenciar Clientes',

                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: headerColor,
                  ),
                ),
              ),

              // ============================================================
              // MODO GERENCIAMENTO
              //
              // Espaço usado apenas para manter o título visualmente alinhado.
              // ============================================================
              if (!widget.isSelectionMode)
                const SizedBox(width: 48)
              // ============================================================
              // MODO SELEÇÃO
              //
              // Permite continuar venda sem cliente.
              // ============================================================
              else
                IconButton(
                  icon: Icon(Icons.person_off, color: headerColor),

                  tooltip: 'Vender sem cliente',

                  onPressed: () => Navigator.of(context).pop(null),
                ),
            ],
          ),

          const SizedBox(height: 8),

          // ================================================================
          // BUSCA
          // ================================================================
          TextField(
            controller: _searchController,

            onChanged: (value) {
              setState(() {});
            },

            style: TextStyle(color: headerColor),

            decoration: InputDecoration(
              hintText: 'Buscar por nome...',

              hintStyle: TextStyle(
                color: isDarkMode ? Colors.white70 : Colors.black54,
              ),

              prefixIcon: Icon(
                Icons.search,

                color: isDarkMode ? Colors.white70 : Colors.black54,
              ),

              filled: true,

              fillColor: Theme.of(context).cardColor.withOpacity(0.8),

              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),

                borderSide: BorderSide.none,
              ),

              contentPadding: const EdgeInsets.symmetric(vertical: 0),
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // CARD DO CLIENTE
  // ==========================================================================

  Widget _buildCustomerCard(
    Customer customer,
    DocumentSnapshot customerDoc,
    bool isDarkMode,
    bool canPerformCriticalActions,
  ) {
    return Card(
      color: isDarkMode
          ? Colors.black.withOpacity(0.6)
          : Colors.white.withOpacity(0.8),

      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),

      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),

      child: ListTile(
        // ====================================================================
        // AVATAR
        // ====================================================================
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor,

          foregroundColor: Colors.white,

          child: Text(
            customer.name.isNotEmpty ? customer.name[0].toUpperCase() : '?',
          ),
        ),

        // ====================================================================
        // NOME
        // ====================================================================
        title: Text(
          customer.name,

          style: const TextStyle(fontWeight: FontWeight.bold),
        ),

        // ====================================================================
        // TELEFONE
        // ====================================================================
        subtitle: Text(customer.phone ?? 'Sem telefone'),

        // ====================================================================
        // CLIQUE NO CARD
        //
        // MODO SELEÇÃO:
        // retorna o cliente selecionado.
        //
        // MODO NORMAL:
        // abre a conta do cliente.
        // ====================================================================
        onTap: widget.isSelectionMode
            ? () => Navigator.of(context).pop(customer)
            : () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (context) => CustomerReceivablesScreen(
                      storeId: widget.storeId,
                      customerId: customer.id,
                      customerName: customer.name,
                    ),
                  ),
                );
              },

        // ====================================================================
        // AÇÕES
        // ====================================================================
        trailing: widget.isSelectionMode
            ? null
            : Row(
                mainAxisSize: MainAxisSize.min,

                children: [
                  // ======================================================
                  // CONTA DO CLIENTE
                  // ======================================================
                  IconButton(
                    icon: const Icon(Icons.account_balance_wallet_outlined),

                    tooltip: 'Conta do cliente',

                    color: Colors.green,

                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (context) => CustomerReceivablesScreen(
                            storeId: widget.storeId,
                            customerId: customer.id,
                            customerName: customer.name,
                          ),
                        ),
                      );
                    },
                  ),

                  // ======================================================
                  // EDITAR
                  // ======================================================
                  IconButton(
                    icon: Icon(
                      Icons.edit,
                      color: Theme.of(context).primaryColor,
                    ),

                    tooltip: 'Editar cliente',

                    onPressed: () => _showCustomerDialog(customer: customerDoc),
                  ),

                  // ======================================================
                  // ARQUIVAR - SOMENTE ADMIN
                  // ======================================================
                  if (canPerformCriticalActions)
                    IconButton(
                      icon: Icon(
                        Icons.archive_outlined,

                        color: Theme.of(context).colorScheme.error,
                      ),

                      tooltip: 'Arquivar cliente',

                      onPressed: () => _archiveCustomer(customer),
                    ),
                ],
              ),
      ),
    );
  }
}
