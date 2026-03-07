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

  final _storeNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _cpfCnpjController = TextEditingController();

  bool _isLoading = false;

  @override
  void dispose() {
    _storeNameController.dispose();
    _phoneController.dispose();
    _cpfCnpjController.dispose();
    super.dispose();
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  // --- O GUARDIÃO: Verifica se o CPF/CNPJ já foi usado ---
  Future<bool> _documentAlreadyExists(String cleanDoc) async {
    final docSnap = await FirebaseFirestore.instance
        .collection('cpfs_cadastrados')
        .doc(cleanDoc)
        .get();
    return docSnap.exists;
  }

  Future<void> _submitCreateStore() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (ctx) => const AuthGate()));
      return;
    }

    try {
      final firestore = FirebaseFirestore.instance;
      final cleanDoc = UtilBrasilFields.removeCaracteres(_cpfCnpjController.text);

      // 1. Validação de Segurança (Evitar duplo trial)
      final docExists = await _documentAlreadyExists(cleanDoc);
      if (docExists) {
        _showError('Este CPF/CNPJ já utilizou o período de teste. Faça login com a conta original ou assine o plano Pro.');
        setState(() => _isLoading = false);
        return;
      }

      // 2. Prepara as datas (7 dias de teste grátis a partir de AGORA)
      final now = DateTime.now();
      final trialEnd = now.add(const Duration(days: 7));

      // 3. Inicia a gravação em Lote (Batch) para garantir consistência
      final batch = firestore.batch();
      final storeRef = firestore.collection('stores').doc();
      final userRef = firestore.collection('users').doc(user.uid);
      final cpfRef = firestore.collection('cpfs_cadastrados').doc(cleanDoc);

      // -> Cria a Loja (Já liberada para o AuthGate)
      batch.set(storeRef, {
        'name': _storeNameController.text.trim(),
        'phone': UtilBrasilFields.removeCaracteres(_phoneController.text),
        'document': cleanDoc,
        'ownerId': user.uid,
        'createdAt': FieldValue.serverTimestamp(),
        'subscriptionStatus': 'active', // Abre a porta no AuthGate
        'trialEndDate': trialEnd.toIso8601String(), // Limite de 7 dias
      });

      // -> Atualiza o Usuário
      batch.set(userRef, {
        'storeId': storeRef.id,
        'documentNumber': cleanDoc,
        'phone': UtilBrasilFields.removeCaracteres(_phoneController.text),
      }, SetOptions(merge: true));

      // -> Queima o CPF na coleção de controle
      batch.set(cpfRef, {
        'uid': user.uid,
        'cadastradoEm': FieldValue.serverTimestamp(),
      });

      // 4. Executa todas as gravações ao mesmo tempo
      await batch.commit();

      if (mounted) {
        // Atualiza o provider
        Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeRef.id);

        // Manda pro AuthGate! Ele vai ler 'active' e jogar direto pra Home
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

                  // CAMPO: Nome da Loja
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

                  // CAMPO: WhatsApp
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
                    textInputAction: TextInputAction.next,
                    validator: (value) => (value == null || value.isEmpty) ? 'O WhatsApp é obrigatório.' : null,
                  ),
                  const SizedBox(height: 16),

                  // CAMPO: CPF ou CNPJ
                  TextFormField(
                    controller: _cpfCnpjController,
                    decoration: InputDecoration(
                      labelText: 'CPF ou CNPJ',
                      hintText: 'Somente números',
                      prefixIcon: const Icon(Icons.badge_outlined),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      CpfOuCnpjFormatter(),
                    ],
                    textInputAction: TextInputAction.done,
                    validator: (value) {
                      if (value == null || value.isEmpty) return 'O documento é obrigatório.';
                      if (!UtilBrasilFields.isCPFValido(value) && !UtilBrasilFields.isCNPJValido(value)) {
                        return 'CPF ou CNPJ inválido.';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 32),

                  // BOTÃO DE SUBMIT
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