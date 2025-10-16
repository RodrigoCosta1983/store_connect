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
  var _isLoading = false;
  var _enteredEmail = '';
  var _enteredPassword = '';
  var _enteredName = '';
  final _firebaseAuth = FirebaseAuth.instance;

  void _submit() async {
    final isValid = _formKey.currentState!.validate();
    if (!isValid) return;
    _formKey.currentState!.save();

    setState(() => _isLoading = true);
    try {
      final userCredential = await _firebaseAuth.createUserWithEmailAndPassword(
        email: _enteredEmail,
        password: _enteredPassword,
      );

      await FirebaseFirestore.instance
          .collection('users')
          .doc(userCredential.user!.uid)
          .set({
        'username': _enteredName,
        'email': _enteredEmail,
        'storeId': '',
      });

      if (context.mounted) Navigator.of(context).pop();

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

  @override
  Widget build(BuildContext context) {
    final isSmallScreen = MediaQuery.of(context).size.width < 800;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      // Usamos um AppBar invisível para ter o botão de voltar automaticamente
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        // Cor do ícone de voltar se adapta ao tema
        iconTheme: IconThemeData(color: Theme.of(context).colorScheme.onBackground),
      ),
      // Garante que o conteúdo possa ficar atrás do AppBar
      extendBodyBehindAppBar: true,
      body: isSmallScreen
          ? _buildMobileLayout()
          : _buildWebLayout(),
    );
  }

  // MÉTODO PARA O LAYOUT WEB (DUAS COLUNAS)
  Widget _buildWebLayout() {
    return Row(
      children: [
        // COLUNA ESQUERDA (Branding) - IGUAL À TELA DE LOGIN
        Expanded(
          child: Container(
            color: Theme.of(context).brightness == Brightness.dark
                ? Colors.black26
                : Colors.blue.shade50,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Image.asset(
                    'assets/images/logo_web.png',
                    width: 150, // Ajuste a largura conforme necessário
                  ),
                  // --- FIM DA ALTERAÇÃO ---
                  const SizedBox(height: 24),
                  const Text(
                    'Store & Connect',
                    style: TextStyle(fontSize: 42, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Gerencie seu negócio de forma inteligente.',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ],
              ),
            ),
          ),
        ),

        // COLUNA DIREITA (Formulário de Cadastro)
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: _buildRegisterForm(),
            ),
          ),
        ),
      ],
    );
  }

  // MÉTODO PARA O LAYOUT MOBILE (CENTRALIZADO)
  Widget _buildMobileLayout() {
    return Center(
      child: _buildRegisterForm(),
    );
  }

  // WIDGET DO FORMULÁRIO DE CADASTRO
  Widget _buildRegisterForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24.0),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Crie sua conta',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Text(
              'Comece a gerenciar seu negócio.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 48),
            TextFormField(
              decoration: const InputDecoration(labelText: 'Nome Completo', border: OutlineInputBorder()),
              enableSuggestions: false,
              validator: (value) => (value == null || value.trim().isEmpty) ? 'Nome inválido.' : null,
              onSaved: (value) => _enteredName = value!,
            ),
            const SizedBox(height: 16),
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
                child: const Text('CADASTRAR'),
              ),
          ],
        ),
      ),
    );
  }
}