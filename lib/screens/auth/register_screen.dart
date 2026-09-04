// ============================================================================
// STORE CONNECT - CADASTRO DE CONTA
// ============================================================================
//
// Arquivo:
//   lib/screens/auth/register_screen.dart
//
// Objetivo:
//   Criar a identidade Firebase Auth e o perfil inicial seguro do usuário.
//
// P6 - AUTORIDADE:
//
// O cadastro inicial em users/{uid} contém somente dados de perfil/bootstrap.
// Ele NÃO define mais subscriptionStatus. O estado financeiro e o trial
// pertencem ao documento da loja e são criados pelo backend `bootstrapStore`.
//
// Fluxo por e-mail:
//   Firebase Auth -> users/{uid} básico -> verificação de e-mail -> AuthGate
//   -> CreateStoreScreen -> bootstrapStore.
//
// Fluxo Google:
//   Firebase Auth -> CreateStoreScreen -> bootstrapStore.
//   O backend consegue criar/mesclar users/{uid} caso o documento ainda não exista.
//
// Manutenção:
//   - não adicionar role = admin aqui;
//   - não adicionar subscriptionStatus aqui;
//   - não vincular storeId real aqui;
//   - o primeiro admin e a primeira loja devem nascer no backend.
// ============================================================================

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'package:store_connect/screens/auth/email_verification_screen.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();

  // Controladores
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  // Variáveis de Estado
  bool _isLoading = false;
  bool _isPasswordVisible = false;
  bool _isConfirmPasswordVisible = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _showError(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context).clearSnackBars();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), backgroundColor: Colors.red),
      );
    }
  }

  // --- CADASTRO COM E-MAIL E SENHA ---
  Future<void> _submitSignup() async {
    if (!_formKey.currentState!.validate()) return;
    _formKey.currentState!.save();

    if (_passwordController.text != _confirmPasswordController.text) {
      _showError('As senhas não coincidem.');
      return;
    }

    setState(() => _isLoading = true);

    try {
      // 1. Cria Usuário no Auth
      final userCredential = await FirebaseAuth.instance
          .createUserWithEmailAndPassword(
            email: _emailController.text.trim(),
            password: _passwordController.text.trim(),
          );

      final generatedName = _emailController.text.split('@')[0];

      // 2. Salva no Firestore apenas dados iniciais (Sem CPF)
      await FirebaseFirestore.instance
          .collection('users')
          .doc(userCredential.user!.uid)
          .set({
            'username': generatedName,
            'email': _emailController.text.trim(),
            'storeId': '',
            'createdAt': FieldValue.serverTimestamp(),
          });

      // 3. ENVIA O E-MAIL E BLOQUEIA A TELA!
      await userCredential.user!.sendEmailVerification();

      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(
            builder: (context) => const EmailVerificationScreen(),
          ),
        );
      }
    } on FirebaseAuthException catch (e) {
      String message = 'Ocorreu um erro no cadastro.';
      if (e.code == 'weak-password')
        message = 'A senha fornecida é muito fraca.';
      else if (e.code == 'email-already-in-use')
        message = 'Este e-mail já está em uso. Faça Login.';
      else if (e.code == 'invalid-email')
        message = 'Formato de e-mail inválido.';
      _showError(message);
    } catch (e) {
      _showError('Erro inesperado: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // --- CADASTRO COM GOOGLE ---
  Future<void> _googleSignIn() async {
    setState(() => _isLoading = true);
    try {
      final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }

      final GoogleSignInAuthentication googleAuth =
          await googleUser.authentication;
      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final userCredential = await FirebaseAuth.instance.signInWithCredential(
        credential,
      );

      // Se for usuário novo pelo Google, manda criar a loja. Senão, vai pro Gate.
      if (userCredential.additionalUserInfo?.isNewUser ?? false) {
        if (mounted) {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (ctx) => const CreateStoreScreen()),
          );
        }
      } else {
        if (mounted) {
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (ctx) => const AuthGate()),
            (route) => false,
          );
        }
      }
    } catch (e) {
      _showError('Erro ao fazer cadastro com Google.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // --- UI DO FORMULÁRIO ---
  Widget _buildSignupForm() {
    return Form(
      key: _formKey,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Image.asset(
              'assets/images/logo_web.png', // Ajuste para sua logo atual
              height: 120,
              errorBuilder: (ctx, err, stack) => const Icon(
                Icons.storefront,
                size: 80,
                color: Colors.deepPurple,
              ),
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Crie sua Conta',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.bold,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Comece a gerenciar seu negócio hoje.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey, fontSize: 15),
          ),
          const SizedBox(height: 24),

          // CAMPO E-MAIL (Primeiro campo agora)
          TextFormField(
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(
              labelText: 'E-mail',
              prefixIcon: const Icon(Icons.email_outlined),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            validator: (value) => (value == null || !value.contains('@'))
                ? 'E-mail inválido.'
                : null,
          ),
          const SizedBox(height: 16),

          // CAMPO SENHA
          TextFormField(
            controller: _passwordController,
            obscureText: !_isPasswordVisible,
            decoration: InputDecoration(
              labelText: 'Senha',
              prefixIcon: const Icon(Icons.lock_outline),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              suffixIcon: IconButton(
                icon: Icon(
                  _isPasswordVisible ? Icons.visibility_off : Icons.visibility,
                ),
                onPressed: () =>
                    setState(() => _isPasswordVisible = !_isPasswordVisible),
              ),
            ),
            validator: (value) => (value == null || value.length < 6)
                ? 'Mínimo de 6 caracteres.'
                : null,
          ),
          const SizedBox(height: 16),

          // CAMPO CONFIRMAR SENHA
          TextFormField(
            controller: _confirmPasswordController,
            obscureText: !_isConfirmPasswordVisible,
            decoration: InputDecoration(
              labelText: 'Confirmar Senha',
              prefixIcon: const Icon(Icons.lock_reset),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              suffixIcon: IconButton(
                icon: Icon(
                  _isConfirmPasswordVisible
                      ? Icons.visibility_off
                      : Icons.visibility,
                ),
                onPressed: () => setState(
                  () => _isConfirmPasswordVisible = !_isConfirmPasswordVisible,
                ),
              ),
            ),
            validator: (value) {
              if (value == null || value.isEmpty) return 'Confirme sua senha.';
              return null;
            },
          ),
          const SizedBox(height: 24),

          // BOTÃO CADASTRAR
          if (_isLoading)
            const Center(child: CircularProgressIndicator())
          else
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 18),
                backgroundColor: Colors.deepPurple,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              onPressed: _submitSignup,
              child: const Text(
                'CADASTRAR',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ),

          const SizedBox(height: 24),

          // DIVISOR
          Row(
            children: [
              Expanded(
                child: Divider(color: Colors.grey.shade300, thickness: 1),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'OU',
                  style: TextStyle(
                    color: Colors.grey.shade500,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              Expanded(
                child: Divider(color: Colors.grey.shade300, thickness: 1),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // BOTÃO GOOGLE
          if (!_isLoading)
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                side: BorderSide(color: Colors.grey.shade300),
              ),
              onPressed: _googleSignIn,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset('assets/images/google_logo.png', height: 24),
                  const SizedBox(width: 12),
                  const Flexible(
                    child: Text(
                      'Continuar com Google',
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.black87,
                        fontWeight: FontWeight.bold,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: 22),

          // RODAPÉ LOGIN
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Já tem uma conta? ', style: TextStyle(fontSize: 15)),
              GestureDetector(
                onTap: () => Navigator.of(context).pop(),
                child: const Text(
                  'Faça Login',
                  style: TextStyle(
                    color: Colors.deepPurple,
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // --- LAYOUTS RESPONSIVOS ---
  Widget _buildWebLayout() {
    return Row(
      children: [
        Expanded(
          child: Container(
            color: const Color(0xFFEAF4FC),
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Image.asset(
                    'assets/images/logo_web.png',
                    width: 180,
                    errorBuilder: (c, e, s) => const SizedBox(),
                  ),
                  const SizedBox(height: 32),
                  const Text(
                    'Store & Connect',
                    style: TextStyle(
                      fontSize: 40,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF1E293B),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'A melhor plataforma para sua loja.',
                    style: TextStyle(fontSize: 18, color: Colors.black54),
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: _buildSignupForm(),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMobileLayout() {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32.0, vertical: 24.0),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 400),
          child: _buildSignupForm(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isWeb = MediaQuery.of(context).size.width > 800;

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(child: isWeb ? _buildWebLayout() : _buildMobileLayout()),
    );
  }
}
