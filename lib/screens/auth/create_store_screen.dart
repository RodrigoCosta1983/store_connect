// lib/screens/auth/create_store_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:brasil_fields/brasil_fields.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class CreateStoreScreen extends StatefulWidget {
  const CreateStoreScreen({super.key});

  @override
  State<CreateStoreScreen> createState() => _CreateStoreScreenState();
}

class _CreateStoreScreenState extends State<CreateStoreScreen> {
  final _formKey = GlobalKey<FormState>();

  // Controladores (Repare que o CPF sumiu daqui)
  final _storeNameController = TextEditingController();
  final _phoneController = TextEditingController();

  bool _isLoading = false;

  @override
  void dispose() {
    _storeNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  // Função para exibir erros na tela
  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  // --- FUNÇÃO PRINCIPAL: SALVAR A LOJA ---
  Future<void> _submitCreateStore() async {
    // 1. Valida se os campos não estão vazios
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    // 2. Verifica se o utilizador está realmente logado
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (ctx) => const AuthGate()));
      return;
    }

    try {
      final firestore = FirebaseFirestore.instance;

      // 3. Prepara as datas (7 dias de teste grátis a partir de AGORA)
      final now = DateTime.now();
      final trialEnd = now.add(const Duration(days: 7));

      // 4. Inicia a gravação em Lote (Batch) para garantir consistência
      // O Batch garante que ou ele salva a loja E o utilizador juntos, ou não salva nenhum.
      final batch = firestore.batch();

      // Cria uma referência vazia para a nova loja para podermos pegar o ID gerado
      final storeRef = firestore.collection('stores').doc();
      final userRef = firestore.collection('users').doc(user.uid);

      // -> PASSO A: Gravar os dados da Loja
      batch.set(storeRef, {
        'name': _storeNameController.text.trim(),
        'phone': UtilBrasilFields.removeCaracteres(_phoneController.text),
        'ownerId': user.uid,
        'createdAt': FieldValue.serverTimestamp(),
        'subscriptionStatus': 'active', // Liberado para os 7 dias grátis
        'trialEndDate': trialEnd.toIso8601String(), // Data limite
      });

      // -> PASSO B: Atualizar o Utilizador
      // Ligamos o utilizador à loja recém-criada e guardamos o WhatsApp de contacto
      batch.set(userRef, {
        'storeId': storeRef.id,
        'phone': UtilBrasilFields.removeCaracteres(_phoneController.text),
      }, SetOptions(merge: true));

      // 5. Executa todas as gravações ao mesmo tempo
      await batch.commit();

      if (mounted) {
        // 6. Atualiza o provider global para o resto da aplicação saber em que loja estamos
        Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeRef.id);

        // 7. Manda pro AuthGate! Como o 'subscriptionStatus' é 'active' e ele tem um 'storeId',
        // o AuthGate vai empurrá-lo direto para o Dashboard.
        Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (ctx) => const AuthGate()),
                (route) => false
        );
      }

    } catch (e) {
      _showError('Erro ao criar loja: $e');
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurar Loja'),
        automaticallyImplyLeading: false, // Remove a setinha de voltar
        actions: [
          // Botão caso o cliente queira desistir e entrar com outra conta
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sair e voltar para o Login',
            onPressed: () {
              FirebaseAuth.instance.signOut();
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (ctx) => const AuthGate()),
                    (route) => false,
              );
            },
          ),
        ],
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.storefront, size: 64, color: Colors.deepPurple),
                  const SizedBox(height: 16),
                  const Text(
                    'Dados do seu Negócio',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Preencha para liberar seus 7 dias de acesso grátis.',
                    style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),

                  // --- CAMPO: Nome da Loja ---
                  TextFormField(
                    controller: _storeNameController,
                    decoration: InputDecoration(
                      labelText: 'Nome da Loja',
                      prefixIcon: const Icon(Icons.shopping_bag_outlined),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    textInputAction: TextInputAction.next,
                    validator: (value) => (value == null || value.trim().isEmpty) ? 'O nome da loja é obrigatório.' : null,
                  ),
                  const SizedBox(height: 16),

                  // --- CAMPO: WhatsApp ---
                  TextFormField(
                    controller: _phoneController,
                    decoration: InputDecoration(
                      labelText: 'WhatsApp',
                      prefixIcon: const Icon(Icons.phone_android),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    keyboardType: TextInputType.phone,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      TelefoneInputFormatter(), // Formata automaticamente para (XX) XXXXX-XXXX
                    ],
                    textInputAction: TextInputAction.done,
                    validator: (value) => (value == null || value.isEmpty) ? 'O WhatsApp é obrigatório.' : null,
                  ),
                  const SizedBox(height: 32),

                  // --- BOTÃO CONCLUIR ---
                  if (_isLoading)
                    const Center(child: CircularProgressIndicator())
                  else
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        backgroundColor: Colors.deepPurple,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: _submitCreateStore,
                      child: const Text('Concluir Cadastro', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}