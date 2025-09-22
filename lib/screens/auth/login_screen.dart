// lib/screens/auth/login_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:store_connect/screens/auth/signup_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _isPasswordVisible = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submitLogin() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: _passwordController.text.trim(),
      );
      // O AuthGate cuidará da navegação após o login bem-sucedido
    } on FirebaseAuthException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.message ?? 'Falha na autenticação.'),
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // 1. Logo da StoreConnect
                  Image.asset(
                    'assets/images/logo.png', // CERTIFIQUE-SE QUE ESTE É O NOME CORRETO DO SEU ARQUIVO DE LOGO
                    height: 100, // Ajuste a altura conforme necessário
                  ),
                  const SizedBox(height: 24),

                  // 2. Título e Subtítulo
                  const Text(
                    'Bem-vindo de volta!',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Faça login para continuar gerenciando seu negócio.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.grey.shade600),
                  ),
                  const SizedBox(height: 40),

                  // 3. Campos de Texto
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: InputDecoration(
                      labelText: 'E-mail',
                      prefixIcon: const Icon(Icons.email_outlined),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    validator: (value) => (value == null || !value.contains('@')) ? 'E-mail inválido.' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _passwordController,
                    obscureText: !_isPasswordVisible,
                    decoration: InputDecoration(
                      labelText: 'Senha',
                      prefixIcon: const Icon(Icons.lock_outline),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      suffixIcon: IconButton(
                        icon: Icon(_isPasswordVisible ? Icons.visibility_off : Icons.visibility),
                        onPressed: () => setState(() => _isPasswordVisible = !_isPasswordVisible),
                      ),
                    ),
                    validator: (value) => (value == null || value.isEmpty) ? 'Por favor, insira sua senha.' : null,
                  ),
                  const SizedBox(height: 24),

                  // 4. Botão de Login
                  if (_isLoading)
                    const Center(child: CircularProgressIndicator())
                  else
                    ElevatedButton(
                      onPressed: _submitLogin,
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: const Text('ENTRAR', style: TextStyle(fontSize: 16)),
                    ),

                  // 5. Link para Cadastro
                  const SizedBox(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text('Ainda não tem uma conta?'),
                      TextButton(
                        onPressed: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(builder: (ctx) => const SignupScreen()),
                          );
                        },
                        child: const Text('Cadastre-se'),
                      ),
                    ],
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