import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:intl/intl.dart';

// O _CustomerDialog não precisa de alterações, mas precisa receber o storeId
class _CustomerDialog extends StatefulWidget {
  final DocumentSnapshot? customer;
  final String storeId;

  const _CustomerDialog({this.customer, required this.storeId});

  @override
  _CustomerDialogState createState() => _CustomerDialogState();
}

class _CustomerDialogState extends State<_CustomerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  var _isLoading = false;

  bool get _isEditing => widget.customer != null;

  @override
  void initState() {
    super.initState();
    if (_isEditing) {
      final customerData = widget.customer!.data() as Map<String, dynamic>;
      _nameController.text = customerData['name'];
      _phoneController.text = customerData['phone'] ?? '';
    }
  }


  // Dentro da classe _CustomerDialogState, em manage_customers_screen.dart

  Future<void> _saveCustomer() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    final collectionRef = FirebaseFirestore.instance
        .collection('stores').doc(widget.storeId)
        .collection('customers');

    // --- CORREÇÃO: Adicionado o bloco try...catch...finally ---
    try {
      if (_isEditing) {
        await collectionRef.doc(widget.customer!.id).update({
          'name': _nameController.text,
          'name_lowercase': _nameController.text.toLowerCase(),
          'phone': _phoneController.text,
        });
      } else {
        await collectionRef.add({
          'name': _nameController.text,
          'name_lowercase': _nameController.text.toLowerCase(),
          'phone': _phoneController.text,
          'createdAt': Timestamp.now(),
        });
      }

      // Se chegou aqui, a operação foi um sucesso
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cliente salvo com sucesso!'), backgroundColor: Colors.green),
        );
      }
    } catch (error) {
      // Se ocorrer um erro, ele será capturado aqui e exibido
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao salvar: ${error.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      // Isso executa sempre, com ou sem erro
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }


  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isEditing ? 'Editar Cliente' : 'Adicionar Cliente'),
      content: Form(
        key: _formKey,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextFormField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: 'Nome'),
            validator: (value) => value!.trim().isEmpty ? 'Insira um nome.' : null,
          ),
          TextFormField(
            controller: _phoneController,
            decoration: const InputDecoration(labelText: 'Telefone (opcional)'),
            keyboardType: TextInputType.phone,
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        ElevatedButton(onPressed: _isLoading ? null : _saveCustomer, child: _isLoading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Salvar')),
      ],
    );
  }
}

class ManageCustomersScreen extends StatefulWidget {
  final String storeId;
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
  final _searchController = TextEditingController();
  // NOVO: Variáveis de estado para controlar a UI da busca
  final _searchFocusNode = FocusNode();
  bool _isSearching = false;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      setState(() {
        _searchQuery = _searchController.text;
      });
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _searchFocusNode.dispose();
    super.dispose();
  }

  void _showCustomerDialog({DocumentSnapshot? customer}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _CustomerDialog(customer: customer, storeId: widget.storeId),
    );
  }

  void _deleteCustomer(BuildContext context, String customerId, String customerName) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirmar Exclusão'),
        content: Text('Tem certeza que deseja excluir "$customerName"?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(
            onPressed: () {
              FirebaseFirestore.instance
                  .collection('stores').doc(widget.storeId)
                  .collection('customers').doc(customerId).delete();
              Navigator.of(ctx).pop();
            },
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
  }

  // NOVO: Função para construir a AppBar dinamicamente
  AppBar _buildAppBar() {
    if (_isSearching) {
      // AppBar no modo de busca
      return AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            setState(() {
              _isSearching = false;
              _searchController.clear();
            });
          },
        ),
        title: TextField(
          controller: _searchController,
          focusNode: _searchFocusNode,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Buscar cliente...',
            border: InputBorder.none,
          ),
          style: const TextStyle(fontSize: 18),
        ),
      );
    } else {
      // AppBar no modo normal
      return AppBar(
        title: Text(widget.isSelectionMode ? 'Selecionar Cliente' : 'Gerenciar Clientes'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {
              setState(() {
                _isSearching = true;
              });
            },
          ),
        ],
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    Query query = FirebaseFirestore.instance
        .collection('stores').doc(widget.storeId)
        .collection('customers');

    if (_searchQuery.isNotEmpty) {
      final searchQueryLower = _searchQuery.toLowerCase();
      query = query
          .where('name_lowercase', isGreaterThanOrEqualTo: searchQueryLower)
          .where('name_lowercase', isLessThanOrEqualTo: '$searchQueryLower\uf8ff')
          .orderBy('name_lowercase');
    } else {
      query = query.orderBy('name');
    }

    return Scaffold(
      appBar: _buildAppBar(), // MODIFICADO: A AppBar agora é construída dinamicamente
      // MODIFICADO: Adicionado o FloatingActionButton
      floatingActionButton: widget.isSelectionMode
          ? null // Oculta o botão de adicionar em modo de seleção
          : FloatingActionButton(
        onPressed: _showCustomerDialog,
        tooltip: 'Adicionar Cliente',
        child: const Icon(Icons.add),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: query.snapshots(),
        builder: (ctx, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final docs = snapshot.data?.docs ?? [];
          if (docs.isEmpty) {
            return Center(
              child: Text(_searchQuery.isEmpty
                  ? 'Nenhum cliente cadastrado.'
                  : 'Nenhum cliente encontrado.'),
            );
          }
          return ListView.builder(
            itemCount: docs.length,
            itemBuilder: (ctx, index) {
              final customer = Customer.fromFirestore(docs[index]);
              // --- LÓGICA PARA CONSTRUIR O SUBTÍTULO DINÂMICO ---
              String subtitleText = customer.phone ?? 'Sem telefone';
              if (customer.createdAt != null) {
                // Formata a data para o padrão dd/MM/yyyy
                final formattedDate = DateFormat('dd/MM/yyyy').format(customer.createdAt!);
                if (subtitleText != 'Sem telefone') {
                  subtitleText += ' - Cadastrado em: $formattedDate';
                } else {
                  subtitleText = 'Cadastrado em: $formattedDate';
                }
              }
              return ListTile(
                title: Text(customer.name),
                subtitle: Text(subtitleText),
                onTap: widget.isSelectionMode
                    ? () => Navigator.of(context).pop(customer)
                    : null,
                trailing: widget.isSelectionMode
                    ? null
                    : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit),
                      onPressed: () => _showCustomerDialog(customer: docs[index]),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () => _deleteCustomer(context, customer.id, customer.name),
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}