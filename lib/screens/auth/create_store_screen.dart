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
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (ctx) => const AuthGate()));
      return;
    }

    try {
      final firestore = FirebaseFirestore.instance;
      final batch = firestore.batch();

      // 1. Cria o documento da loja na coleção 'stores'
      final storeRef = firestore.collection('stores').doc();
      batch.set(storeRef, {
        'name': _storeNameController.text.trim(),
        'ownerId': user.uid,
        'createdAt': Timestamp.now(),
        'subscriptionStatus': 'inactive',
      });

      // 2. Cria o documento do usuário na coleção 'users', ligando-o à loja
      final userRef = firestore.collection('users').doc(user.uid);
      batch.set(userRef, {
        'email': user.email,
        'storeId': storeRef.id,
      });

      await batch.commit();

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
      // --- APPBAR ATUALIZADA ---
      appBar: AppBar(
        title: const Text('Crie Sua Loja'),
        // Remove a seta de "voltar" padrão para evitar confusão
        automaticallyImplyLeading: false,
        actions: [
          // Adiciona um botão de "Sair" no canto superior direito
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sair e voltar para o Login',
            onPressed: () {
              // 1. Desloga o usuário da conta recém-criada no Firebase Auth
              FirebaseAuth.instance.signOut();

              // 2. Garante que o usuário volte para a tela inicial de login/autenticação
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