import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
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
      await _firebaseAuth.signInWithEmailAndPassword(
        email: _enteredEmail,
        password: _enteredPassword,
      );
      // O AuthGate cuidará da navegação, não precisamos fazer nada aqui.
    } on FirebaseAuthException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
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
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24.0),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('StoreConnect', textAlign: TextAlign.center, style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold)),
                const SizedBox(height: 48),
                TextFormField(
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'E-mail', border: OutlineInputBorder()),
                  validator: (value) => (value == null || !value.contains('@')) ? 'E-mail inválido.' : null,
                  onSaved: (value) => _enteredEmail = value!,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Senha', border: OutlineInputBorder()),
                  validator: (value) => (value == null || value.trim().length < 6) ? 'Senha deve ter no mínimo 6 caracteres.' : null,
                  onSaved: (value) => _enteredPassword = value!,
                ),
                const SizedBox(height: 24),
                if (_isLoading)
                  const Center(child: CircularProgressIndicator())
                else
                  ElevatedButton(
                    onPressed: _submit,
                    style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                    child: const Text('ENTRAR'),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}