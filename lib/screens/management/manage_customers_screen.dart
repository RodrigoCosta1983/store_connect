import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:intl/intl.dart';

import '../../widgets/dynamic_background.dart';


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

// --- Tela Principal de Gerenciamento de Clientes com Novo Design ---
class ManageCustomersScreen extends StatefulWidget {
  final String storeId;
  final bool isSelectionMode;
  const ManageCustomersScreen({super.key, required this.storeId, this.isSelectionMode = false});

  @override
  State<ManageCustomersScreen> createState() => _ManageCustomersScreenState();
}

class _ManageCustomersScreenState extends State<ManageCustomersScreen> {
  final _searchController = TextEditingController();

  void _showCustomerDialog({DocumentSnapshot? customer}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _CustomerDialog(storeId: widget.storeId, customer: customer),
    );
  }

  void _deleteCustomer(String customerId) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirmar Exclusão'),
        content: const Text('Tem certeza que deseja excluir este cliente?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              FirebaseFirestore.instance.collection('stores').doc(widget.storeId).collection('customers').doc(customerId).delete();
              Navigator.of(ctx).pop();
            },
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      extendBodyBehindAppBar: true,
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCustomerDialog(),
        child: const Icon(Icons.add),
        tooltip: 'Adicionar Cliente',
      ),
      body: Stack(
        children: [
          const DynamicBackground(),
          // Usamos um Column para empilhar o cabeçalho e a lista
          Column(
            children: [
              // --- CABEÇALHO CUSTOMIZADO ---
              _buildCustomHeader(isDarkMode),

              // --- LISTA DE CLIENTES ---
              Expanded(
                child: StreamBuilder<QuerySnapshot>(
                  stream: FirebaseFirestore.instance
                      .collection('stores')
                      .doc(widget.storeId)
                      .collection('customers')
                      .orderBy('name_lowercase')
                      .snapshots(),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (snapshot.hasError) {
                      return const Center(child: Text('Ocorreu um erro.'));
                    }
                    final allCustomers = snapshot.data?.docs ?? [];

                    final filteredCustomers = allCustomers.where((doc) {
                      final data = doc.data() as Map<String, dynamic>;
                      final name = (data['name_lowercase'] as String? ?? '').toLowerCase();
                      final query = _searchController.text.toLowerCase();
                      return name.contains(query);
                    }).toList();

                    if (filteredCustomers.isEmpty) {
                      return Center(
                        child: Text(
                          _searchController.text.isEmpty
                              ? 'Nenhum cliente cadastrado.'
                              : 'Nenhum cliente encontrado.',
                          style: TextStyle(color: isDarkMode ? Colors.grey.shade400 : Colors.grey.shade700, fontSize: 16),
                        ),
                      );
                    }

                    return ListView.builder(
                      padding: const EdgeInsets.fromLTRB(8, 0, 8, 80), // Padding inferior para o FAB
                      itemCount: filteredCustomers.length,
                      itemBuilder: (ctx, index) {
                        final customerDoc = filteredCustomers[index];
                        final customer = Customer.fromFirestore(customerDoc);
                        return _buildCustomerCard(customer, customerDoc);
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // Widget para o cabeçalho customizado
  Widget _buildCustomHeader(bool isDarkMode) {
    return Padding(
      padding: EdgeInsets.only(top: MediaQuery.of(context).padding.top, left: 8, right: 8, bottom: 16),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                icon: Icon(Icons.arrow_back, color: isDarkMode ? Colors.white : Colors.black),
                onPressed: () => Navigator.of(context).pop(),
              ),
              Expanded(
                child: Text(
                  'Gerenciar Clientes',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: isDarkMode ? Colors.white : Colors.black),
                ),
              ),
              const SizedBox(width: 48), // Espaço para alinhar com o FAB
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _searchController,
            onChanged: (value) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Buscar por nome...',
              prefixIcon: const Icon(Icons.search),
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

  // Widget para o card de cada cliente
  Widget _buildCustomerCard(Customer customer, DocumentSnapshot customerDoc) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        leading: CircleAvatar(
          child: Text(customer.name.isNotEmpty ? customer.name[0].toUpperCase() : '?'),
        ),
        title: Text(customer.name, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(customer.phone ?? 'Sem telefone'),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: Icon(Icons.edit, color: Theme.of(context).primaryColor),
              onPressed: () => _showCustomerDialog(customer: customerDoc),
            ),
            IconButton(
              icon: Icon(Icons.delete, color: Theme.of(context).colorScheme.error),
              onPressed: () => _deleteCustomer(customer.id),
            ),
          ],
        ),
      ),
    );
  }
}