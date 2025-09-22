// lib/screens/auth/create_store_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class CreateStoreScreen extends StatefulWidget {
  const CreateStoreScreen({super.key});

  @override
  State<CreateStoreScreen> createState() => _CreateStoreScreenState();
}

class _CreateStoreScreenState extends State<CreateStoreScreen> {
  final _formKey = GlobalKey<FormState>();
  final _storeNameController = TextEditingController();
  bool _isLoading = false;

  Future<void> _submitCreateStore() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _isLoading = true);

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      // Se por algum motivo o usuário não estiver logado, volta para a tela de login
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (ctx) => const AuthGate()));
      return;
    }

    try {
      final firestore = FirebaseFirestore.instance;
      // Usamos um batch para garantir que as duas operações ocorram juntas
      final batch = firestore.batch();

      // 1. Cria o documento da loja na coleção 'stores'
      final storeRef = firestore.collection('stores').doc();
      batch.set(storeRef, {
        'name': _storeNameController.text.trim(),
        'ownerId': user.uid,
        'createdAt': Timestamp.now(),
        'subscriptionStatus': 'inactive', // Começa como inativo
      });

      // 2. Cria o documento do usuário na coleção 'users', ligando-o à loja
      final userRef = firestore.collection('users').doc(user.uid);
      batch.set(userRef, {
        'email': user.email,
        'storeId': storeRef.id,
      });

      // Executa as duas operações
      await batch.commit();

      // Se tudo deu certo, vai para o AuthGate, que vai ler os novos dados
      // e direcionar para a tela de assinatura.
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (ctx) => const AuthGate()),
                (route) => false
        );
      }

    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao criar loja: $e'), backgroundColor: Colors.red),
      );
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Crie Sua Loja')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text(
                  'Estamos quase lá! Qual o nome do seu negócio?',
                  style: TextStyle(fontSize: 18),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                TextFormField(
                  controller: _storeNameController,
                  decoration: const InputDecoration(labelText: 'Nome da Loja'),
                  validator: (value) => (value == null || value.trim().isEmpty) ? 'O nome da loja é obrigatório.' : null,
                ),
                const SizedBox(height: 30),
                if (_isLoading)
                  const CircularProgressIndicator()
                else
                  ElevatedButton(
                    onPressed: _submitCreateStore,
                    child: const Text('Concluir Cadastro'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}