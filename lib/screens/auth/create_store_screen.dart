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

  // Controladores
  final _storeNameController = TextEditingController();
  final _phoneController = TextEditingController();

  // Variável para armazenar o CPF
  String _enteredDocument = '';

  bool _isLoading = false;

  @override
  void dispose() {
    _storeNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  // --- O GUARDIÃO DE CPF (Transferido para cá!) ---
  Future<bool> _documentAlreadyExists(String docNumber) async {
    final cleanDoc = docNumber.replaceAll(RegExp(r'[^0-9]'), '');
    final docSnap = await FirebaseFirestore.instance
        .collection('cpfs_cadastrados')
        .doc(cleanDoc)
        .get();
    return docSnap.exists;
  }

  // --- FUNÇÃO PRINCIPAL: SALVAR A LOJA ---
  Future<void> _submitCreateStore() async {
    if (!_formKey.currentState!.validate()) return;
    _formKey.currentState!.save(); // Salva o valor do CPF na variável

    setState(() => _isLoading = true);

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (ctx) => const AuthGate()));
      return;
    }

    try {
      final cleanDoc = _enteredDocument.replaceAll(RegExp(r'[^0-9]'), '');

      // 1. Verifica se o CPF já usou os dias de teste em outra loja
      final docExists = await _documentAlreadyExists(cleanDoc);
      if (docExists) {
        _showError('Este CPF/CNPJ já possui uma loja cadastrada no sistema.');
        setState(() => _isLoading = false);
        return; // Barra a criação da loja!
      }

      final firestore = FirebaseFirestore.instance;
      final now = DateTime.now();
      final trialEnd = now.add(const Duration(days: 7));

      final batch = firestore.batch();

      final storeRef = firestore.collection('stores').doc();
      final userRef = firestore.collection('users').doc(user.uid);
      final cpfRef = firestore.collection('cpfs_cadastrados').doc(cleanDoc);

      // -> PASSO A: Gravar os dados da Loja (Já com o CPF para o Asaas)
      batch.set(storeRef, {
        'name': _storeNameController.text.trim(),
        'phone': UtilBrasilFields.removeCaracteres(_phoneController.text),
        'document': cleanDoc,
        'ownerId': user.uid,
        'createdAt': FieldValue.serverTimestamp(),
        'subscriptionStatus': 'active', // Liberado para os 7 dias grátis
        'trialEndDate': trialEnd.toIso8601String(),
      });

      // -> PASSO B: Atualizar o Utilizador
      batch.set(userRef, {
        'storeId': storeRef.id,
        'phone': UtilBrasilFields.removeCaracteres(_phoneController.text),
      }, SetOptions(merge: true));

      // -> PASSO C: Trancar o CPF na lista de controle
      batch.set(cpfRef, {
        'storeId': storeRef.id,
        'uid': user.uid,
        'cadastradoEm': FieldValue.serverTimestamp(),
      });

      // Executa tudo de uma vez!
      await batch.commit();

      if (mounted) {
        Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeRef.id);
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
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sair',
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
                    'Precisamos de alguns dados para configurar sua loja e liberar seus 7 dias de acesso grátis.',
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

                  // --- CAMPO: CPF/CNPJ (Novo local!) ---
                  TextFormField(
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: 'CPF ou CNPJ do Proprietário',
                      prefixIcon: const Icon(Icons.badge_outlined),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    textInputAction: TextInputAction.next,
                    validator: (value) {
                      if (value == null || value.isEmpty) return 'Campo obrigatório.';
                      final clean = value.replaceAll(RegExp(r'[^0-9]'), '');
                      if (clean.length < 11) return 'Documento inválido.';
                      return null;
                    },
                    onSaved: (value) => _enteredDocument = value!,
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
                      TelefoneInputFormatter(),
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