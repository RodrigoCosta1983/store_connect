// lib/screens/auth/register_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();

  // Variáveis de estado
  var _isLoading = false;
  var _enteredEmail = '';
  var _enteredPassword = '';

  // Variável para capturar o CPF/CNPJ digitado
  var _enteredDocument = '';

  final _firebaseAuth = FirebaseAuth.instance;

  // --- FUNÇÃO DE SEGURANÇA (CORRIGIDA) ---
  // Verifica se o CPF já existe na coleção de controle 'cpfs_cadastrados'.
  // Usamos .doc().get() porque é mais rápido e não exige permissão de listar coleções.
  Future<bool> _documentAlreadyExists(String docNumber) async {
    // 1. Limpa o CPF (deixa só números) para usar como ID
    final cleanDoc = docNumber.replaceAll(RegExp(r'[^0-9]'), '');

    // 2. Tenta pegar o documento direto pelo ID na coleção de controle
    final docSnap = await FirebaseFirestore.instance
        .collection('cpfs_cadastrados')
        .doc(cleanDoc)
        .get();

    // 3. Se o documento existe, retorna TRUE (bloqueia o cadastro)
    return docSnap.exists;
  }

  void _submit() async {
    final isValid = _formKey.currentState!.validate();
    if (!isValid) return;
    _formKey.currentState!.save();

    setState(() => _isLoading = true);

    try {
      // --- PASSO 1: O GUARDIÃO ---
      // Antes de criar qualquer coisa, verifica se esse CPF já está "queimado"
      final docExists = await _documentAlreadyExists(_enteredDocument);

      if (docExists) {
        // Se já existe, lançamos erro manual para cair no catch abaixo
        throw FirebaseAuthException(
            code: 'document-already-in-use',
            message: 'Este CPF/CNPJ já possui cadastro. Faça login para reativar.'
        );
      }
      // -----------------------------

      // --- PASSO 2: CRIAR NO AUTH ---
      // Se passou pelo guardião, podemos criar o login
      final userCredential = await _firebaseAuth.createUserWithEmailAndPassword(
        email: _enteredEmail,
        password: _enteredPassword,
      );

      // Prepara os dados
      final generatedName = _enteredEmail.split('@')[0];
      final cleanDoc = _enteredDocument.replaceAll(RegExp(r'[^0-9]'), '');

      // --- PASSO 3: SALVAR DADOS DO USUÁRIO ---
      // Salva na coleção 'users' (Privada, só o dono lê)
      await FirebaseFirestore.instance
          .collection('users')
          .doc(userCredential.user!.uid)
          .set({
        'username': generatedName,
        'email': _enteredEmail,
        'storeId': '',
        'documentNumber': cleanDoc,
        'createdAt': FieldValue.serverTimestamp(),
        'subscriptionStatus': 'trial', // Inicia no teste grátis
      });

      // --- PASSO 4: BLINDAR O CPF (IMPORTANTE) ---
      // Salva na coleção 'cpfs_cadastrados' para ninguém mais usar esse número.
      await FirebaseFirestore.instance
          .collection('cpfs_cadastrados')
          .doc(cleanDoc) // O ID é o próprio CPF
          .set({
        'uid': userCredential.user!.uid,
        'cadastradoEm': FieldValue.serverTimestamp(),
      });

      if (context.mounted) {
        // Sucesso total!
        Navigator.of(context).pop();
      }

    } on FirebaseAuthException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.message ?? 'Falha no cadastro.'),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    } catch (e) {
      // Catch genérico para outros erros
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro inesperado: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  // Widget auxiliar para Labels
  Widget _buildLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6, left: 4),
      child: Text(
        text,
        style: TextStyle(
          color: Colors.grey[700],
          fontSize: 14,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final Color primaryPurple = const Color(0xFF5D38BF);

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Card(
              elevation: 8,
              surfaceTintColor: Colors.white,
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Botão Fechar
                      Align(
                        alignment: Alignment.topRight,
                        child: IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(Icons.close, color: Colors.grey, size: 28),
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                      ),

                      // Logo
                      Image.asset(
                        'assets/images/logo.png',
                        height: 100,
                        errorBuilder: (context, error, stackTrace) {
                          return Icon(Icons.storefront, size: 60, color: primaryPurple);
                        },
                      ),
                      const SizedBox(height: 16),

                      const Text(
                        'Crie sua conta Agora',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.bold,
                          color: Colors.black87,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Comece a gerenciar seu negócio hoje.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                      ),
                      const SizedBox(height: 30),

                      // --- CAMPO CPF/CNPJ ---
                      Align(alignment: Alignment.centerLeft, child: _buildLabel("CPF ou CNPJ")),
                      TextFormField(
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          hintText: 'Somente números',
                          contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 14),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide(color: Colors.grey[300]!),
                          ),
                          prefixIcon: const Icon(Icons.badge_outlined, color: Colors.grey),
                        ),
                        textInputAction: TextInputAction.next,
                        validator: (value) {
                          if (value == null || value.isEmpty) return 'Campo obrigatório.';
                          final clean = value.replaceAll(RegExp(r'[^0-9]'), '');
                          if (clean.length < 11) return 'CPF/CNPJ inválido.';
                          return null;
                        },
                        onSaved: (value) => _enteredDocument = value!,
                      ),
                      const SizedBox(height: 16),

                      // --- CAMPO E-MAIL ---
                      Align(alignment: Alignment.centerLeft, child: _buildLabel("E-mail")),
                      TextFormField(
                        keyboardType: TextInputType.emailAddress,
                        decoration: InputDecoration(
                          hintText: 'seu@email.com',
                          contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 14),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide(color: Colors.grey[300]!),
                          ),
                          prefixIcon: const Icon(Icons.mail_outline, color: Colors.grey),
                        ),
                        textInputAction: TextInputAction.next,
                        validator: (value) => (value == null || !value.contains('@')) ? 'E-mail inválido.' : null,
                        onSaved: (value) => _enteredEmail = value!,
                      ),
                      const SizedBox(height: 16),

                      // --- CAMPO SENHA ---
                      Align(alignment: Alignment.centerLeft, child: _buildLabel("Senha")),
                      TextFormField(
                        obscureText: true,
                        decoration: InputDecoration(
                          hintText: 'Crie uma senha forte',
                          contentPadding: const EdgeInsets.symmetric(vertical: 14, horizontal: 14),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide(color: Colors.grey[300]!),
                          ),
                          prefixIcon: const Icon(Icons.lock_outline, color: Colors.grey),
                        ),
                        textInputAction: TextInputAction.done,
                        validator: (value) => (value == null || value.trim().length < 6) ? 'Mínimo de 6 caracteres.' : null,
                        onSaved: (value) => _enteredPassword = value!,
                      ),
                      const SizedBox(height: 30),

                      // Botão Criar Conta
                      if (_isLoading)
                        const Center(child: CircularProgressIndicator())
                      else
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: _submit,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: primaryPurple,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                              elevation: 0,
                            ),
                            child: const Text(
                              'CRIAR CONTA',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ),

                      const SizedBox(height: 20),

                      // Rodapé
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('Já tem uma conta? ', style: TextStyle(color: Colors.grey[600])),
                          GestureDetector(
                            onTap: () => Navigator.of(context).pop(),
                            child: Text(
                              'Fazer Login',
                              style: TextStyle(
                                color: primaryPurple,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}