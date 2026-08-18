import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart'; // 📦 NOVO PACOTE IMPORTADO

class EmployeesScreen extends StatefulWidget {
  final String storeId;

  const EmployeesScreen({Key? key, required this.storeId}) : super(key: key);

  @override
  _EmployeesScreenState createState() => _EmployeesScreenState();
}

class _EmployeesScreenState extends State<EmployeesScreen> {
  bool _isLoading = false;

  // Função para chamar o Cloud Function de Convite
  Future<void> _convidarFuncionario(String nome, String email, String role) async {
    setState(() => _isLoading = true);

    try {
      final HttpsCallable callable = FirebaseFunctions.instance.httpsCallable('convidarFuncionario');

      final response = await callable.call({
        'storeId': widget.storeId,
        'email': email,
        'nome': nome,
        'role': role,
      });

      final tempLink = response.data['tempResetLink'];

      if (mounted) {
        if (Navigator.canPop(context)) {
          Navigator.pop(context);
        }

        // 📱 NOVO MODAL COM BOTÃO DE COMPARTILHAR
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (ctx) => AlertDialog(
            title: const Row(
              children: [
                Icon(Icons.check_circle, color: Colors.green),
                SizedBox(width: 8),
                Text('Convite Gerado!'),
              ],
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('A conta de $nome foi criada com sucesso.'),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                  ),
                  icon: const Icon(Icons.share),
                  label: const Text('Compartilhar Acesso'),
                  onPressed: () {
                    // Chama a gaveta nativa do Android/iOS
                    Share.share(
                      'Olá, $nome! Você foi convidado para acessar o sistema da loja.\n\n'
                          'Clique no link abaixo para criar sua senha de acesso e entrar no app:\n'
                          '$tempLink',
                    );
                  },
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Fechar'),
              ),
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao convidar: ${e.toString()}'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _mostrarModalConvite() {
    final nameController = TextEditingController();
    final emailController = TextEditingController();
    String selectedRole = 'caixa';

    showDialog(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) => AlertDialog(
          title: const Text('Convidar Funcionário'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameController,
                  decoration: const InputDecoration(labelText: 'Nome do Funcionário'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: emailController,
                  decoration: const InputDecoration(labelText: 'E-mail de Acesso'),
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: selectedRole,
                  decoration: const InputDecoration(labelText: 'Cargo / Permissão'),
                  items: const [
                    DropdownMenuItem(value: 'caixa', child: Text('Caixa / PDV')),
                    DropdownMenuItem(value: 'vendedor', child: Text('Vendedor')),
                    DropdownMenuItem(value: 'gerente', child: Text('Gerente')),
                  ],
                  onChanged: (value) {
                    if (value != null) setModalState(() => selectedRole = value);
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancelar'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(context);
                _convidarFuncionario(
                  nameController.text.trim(),
                  emailController.text.trim(),
                  selectedRole,
                );
              },
              child: const Text('Enviar Convite'),
            ),
          ],
        ),
      ),
    );
  }

  // Função para remover o acesso do funcionário à loja
  Future<void> _removerAcesso(String docId, String nome) async {
    try {
      await FirebaseFirestore.instance.collection('users').doc(docId).delete();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$nome foi removido da loja.'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao remover funcionário.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gerenciar Funcionários'),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('users')
            .where('storeId', isEqualTo: widget.storeId)
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(child: Text('Nenhum funcionário cadastrado.'));
          }

          final docs = snapshot.data!.docs;

          return ListView.builder(
            itemCount: docs.length,
            itemBuilder: (context, index) {
              final doc = docs[index];
              final data = doc.data() as Map<String, dynamic>;
              final nome = data['name'] ?? 'Sem Nome';
              final email = data['email'] ?? '';
              final role = data['role'] ?? 'vendedor';

              // 🗑️ NOVO: DISMISSIBLE PARA ARRASTAR E APAGAR
              return Dismissible(
                key: Key(doc.id),
                direction: DismissDirection.endToStart, // Arrasta da direita pra esquerda
                background: Container(
                  color: Colors.red,
                  alignment: Alignment.centerRight,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: const Icon(Icons.delete, color: Colors.white),
                ),
                confirmDismiss: (direction) async {
                  // Pede confirmação antes de apagar
                  return await showDialog(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Remover Acesso?'),
                      content: Text('Tem certeza que deseja remover o acesso de $nome à sua loja?'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.of(ctx).pop(false),
                          child: const Text('Cancelar'),
                        ),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
                          onPressed: () => Navigator.of(ctx).pop(true),
                          child: const Text('Remover', style: TextStyle(color: Colors.white)),
                        ),
                      ],
                    ),
                  );
                },
                onDismissed: (direction) {
                  _removerAcesso(doc.id, nome);
                },
                child: ListTile(
                  leading: CircleAvatar(
                    child: Text(nome.isNotEmpty ? nome[0].toUpperCase() : 'U'),
                  ),
                  title: Text(nome),
                  subtitle: Text('$email • Cargo: ${role.toUpperCase()}'),
                  trailing: Chip(
                    label: Text(role, style: const TextStyle(fontSize: 12)),
                    backgroundColor: role == 'gerente' ? Colors.orange.shade100 : Colors.blue.shade100,
                  ),
                ),
              );
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _isLoading ? null : _mostrarModalConvite,
        tooltip: 'Adicionar Funcionário',
        child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Icon(Icons.person_add),
      ),
    );
  }
}