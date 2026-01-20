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

  final _firebaseAuth = FirebaseAuth.instance;

  void _submit() async {
    final isValid = _formKey.currentState!.validate();
    if (!isValid) return;
    _formKey.currentState!.save();

    setState(() => _isLoading = true);
    try {
      // 1. Criar usuário no Auth
      final userCredential = await _firebaseAuth.createUserWithEmailAndPassword(
        email: _enteredEmail,
        password: _enteredPassword,
      );

      // 2. Salvar dados no Firestore
      // Usa o início do e-mail como nome provisório
      final generatedName = _enteredEmail.split('@')[0];

      await FirebaseFirestore.instance
          .collection('users')
          .doc(userCredential.user!.uid)
          .set({
        'username': generatedName,
        'email': _enteredEmail,
        'storeId': '',
      });

      if (context.mounted) {
        // Sucesso: fecha a tela de cadastro
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
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  // Widget auxiliar para os Labels
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
    // Definimos a cor roxa apenas para os botões/detalhes
    final Color primaryPurple = const Color(0xFF5D38BF);

    return Scaffold(
      // Fundo padrão (branco/tema) para um visual Clean
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Card(
              elevation: 8,
              // Garante que o card seja BRANCO puro, sem tintura do Material 3
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
                      // --- Botão de Fechar (X) ---
                      Align(
                        alignment: Alignment.topRight,
                        child: IconButton(
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(),
                          icon: const Icon(Icons.close, color: Colors.grey, size: 28),
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                      ),

                      // --- Logo ---
                      Image.asset(
                        'assets/images/logo.png',
                        height: 100,
                        errorBuilder: (context, error, stackTrace) {
                          return Icon(Icons.storefront, size: 60, color: primaryPurple);
                        },
                      ),
                      const SizedBox(height: 16),

                      // --- Títulos ---
                      const Text(
                        'Crie sua conta',
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
                        style: TextStyle(
                          fontSize: 14,
                          color: Colors.grey[600],
                        ),
                      ),
                      const SizedBox(height: 30),

                      // --- Campo E-mail ---
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

                      // --- Campo Senha ---
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

                      // --- Botão Criar Conta ---
                      if (_isLoading)
                        const Center(child: CircularProgressIndicator())
                      else
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton(
                            onPressed: _submit,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: primaryPurple, // Roxo mantido no botão
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                              elevation: 0,
                            ),
                            child: const Text(
                              'CRIAR CONTA',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),

                      const SizedBox(height: 20),

                      // --- Rodapé (Login) ---
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