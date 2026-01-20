// lib/screens/auth/create_store_screen.dart

import 'package:flutter/material.dart';
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

      // 1. Verifica se o usuário já pagou no site para ativar a loja imediatamente
      // Usa Source.server para ignorar o cache antigo do celular
      final userDoc = await firestore.collection('users').doc(user.uid).get(const GetOptions(source: Source.server));
      String initialStatus = 'inactive';

      if (userDoc.exists) {
        final userData = userDoc.data();
        if (userData != null && userData['subscriptionStatus'] == 'active') {
          initialStatus = 'active';
        }
      }

      final batch = firestore.batch();
      final storeRef = firestore.collection('stores').doc();

      // 2. Cria a loja
      batch.set(storeRef, {
        'name': _storeNameController.text.trim(),
        'ownerId': user.uid,
        'createdAt': Timestamp.now(),
        'subscriptionStatus': initialStatus,
      });

      final userRef = firestore.collection('users').doc(user.uid);

      // 3. Atualiza o usuário com o ID da loja (sem apagar o pagamento)
      batch.set(userRef, {
        'email': user.email,
        'storeId': storeRef.id,
      }, SetOptions(merge: true));

      await batch.commit();

      // --- O "PULO DO GATO" (LOADING DE 2 SEGUNDOS) ---
      // Mantém o spinner girando por 2 segundos para dar tempo do Firestore atualizar
      await Future.delayed(const Duration(seconds: 4));

      if (mounted) {
        Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeRef.id);

        // Agora sim, manda para o AuthGate (que vai encontrar a loja 100% pronta)
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
      appBar: AppBar(
        title: const Text('Crie Sua Loja'),
        automaticallyImplyLeading: false,
        actions: [
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
          padding: const EdgeInsets.all(20),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.start,
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