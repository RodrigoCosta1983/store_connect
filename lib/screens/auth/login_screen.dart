// lib/screens/auth/login_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
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

  // --- NOVAS VARIÁVEIS ---
  bool _rememberMe = false;
  final _storage = const FlutterSecureStorage();
  final LocalAuthentication _localAuth = LocalAuthentication();
  bool _biometricLoginAvailable = false;

  @override
  void initState() {
    super.initState();
    _checkBiometricAvailability();
    _loadCredentials();
  }

  // Verifica se o login com biometria está disponível e se há credenciais salvas
  Future<void> _checkBiometricAvailability() async {
    final hasBiometrics = await _localAuth.canCheckBiometrics || await _localAuth.isDeviceSupported();

    // --- LÓGICA ATUALIZADA ---
    // Agora verifica também se o usuário PERMITIU o uso da biometria nas configurações
    final biometricsEnabled = await _storage.read(key: 'biometricsEnabled') == 'true';
    final hasCredentials = await _storage.read(key: 'email') != null;

    // O botão só aparece se as 3 condições forem verdadeiras
    if (hasBiometrics && hasCredentials && biometricsEnabled && mounted) {
      setState(() {
        _biometricLoginAvailable = true;
      });
    } else {
      setState(() {
        _biometricLoginAvailable = false;
      });
    }
  }

  // Carrega o e-mail salvo se a opção "Lembrar-me" foi usada
  Future<void> _loadCredentials() async {
    final email = await _storage.read(key: 'email');
    if (email != null && mounted) {
      setState(() {
        _emailController.text = email;
        _rememberMe = true;
      });
    }
  }

  // Função para salvar ou remover as credenciais
  Future<void> _handleCredentialsStorage() async {
    if (_rememberMe) {
      await _storage.write(key: 'email', value: _emailController.text.trim());
      await _storage.write(key: 'password', value: _passwordController.text);
    } else {
      await _storage.deleteAll();
    }
  }

  void _showError(String message) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), backgroundColor: Colors.red),
      );
    }
  }

  Future<void> _submitLogin() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: _emailController.text.trim(),
        password: _passwordController.text.trim(),
      );
      // Salva as credenciais se a opção "Lembrar-me" estiver marcada
      await _handleCredentialsStorage();
      // O AuthGate cuidará do redirecionamento
    } on FirebaseAuthException catch (e) {
      _showError(e.message ?? 'Falha na autenticação.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _googleSignIn() async {
    setState(() => _isLoading = true);
    try {
      final GoogleSignInAccount? googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      await FirebaseAuth.instance.signInWithCredential(credential);
      // O AuthGate cuidará do redirecionamento

    } catch (e) {
      _showError('Erro ao fazer login com Google: $e');
    }
    if (mounted) setState(() => _isLoading = false);
  }

  Future<void> _authenticateWithBiometrics() async {
    try {
      bool authenticated = await _localAuth.authenticate(
        localizedReason: 'Faça login com sua digital para acessar o StoreConnect',
        options: const AuthenticationOptions(
          stickyAuth: true, // Mantém o diálogo aberto
          biometricOnly: true, // Exige biometria (digital ou rosto)
        ),
      );

      if (authenticated && mounted) {
        setState(() => _isLoading = true);
        final email = await _storage.read(key: 'email');
        final password = await _storage.read(key: 'password');

        if (email != null && password != null) {
          // Usa as credenciais salvas para fazer o login
          await FirebaseAuth.instance.signInWithEmailAndPassword(email: email, password: password);
        } else {
          _showError('Credenciais não encontradas. Faça login manualmente.');
        }
      }
    } catch (e) {
      _showError('Erro na autenticação biométrica: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
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
                  Image.asset(
                    'assets/images/logo.png',
                    height: 100,
                  ),
                  const SizedBox(height: 24),
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
                  CheckboxListTile(
                    title: const Text("Lembrar dados"),
                    value: _rememberMe,
                    onChanged: (newValue) {
                      setState(() {
                        _rememberMe = newValue ?? false;
                      });
                    },
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                  ),
                  const SizedBox(height: 24),

                  if (_isLoading)
                    const Center(child: CircularProgressIndicator())
                  else
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // --- BOTÕES DE LOGIN ATUALIZADOS ---
                        Row(
                          children: [
                            Expanded(
                              child: ElevatedButton(
                                onPressed: _submitLogin,
                                style: ElevatedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(vertical: 16),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                ),
                                child: const Text('ENTRAR', style: TextStyle(fontSize: 16)),
                              ),
                            ),
                            // Mostra o botão de digital apenas se disponível
                            if (_biometricLoginAvailable) ...[
                              const SizedBox(width: 16),
                              IconButton(
                                icon: const Icon(Icons.fingerprint, size: 36),
                                onPressed: _authenticateWithBiometrics,
                                tooltip: 'Login com Digital',
                              ),
                            ]
                          ],
                        ),
                        const SizedBox(height: 24),
                        OutlinedButton.icon(
                          icon: Image.asset('assets/images/google-logo.png', height: 20),
                          label: const Text('Continuar com Google', style: TextStyle(fontSize: 16)),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          onPressed: _isLoading ? null : _googleSignIn,
                        ),
                      ],
                    ),
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