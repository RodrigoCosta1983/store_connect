// lib/screens/auth/login_screen.dart

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:store_connect/screens/auth/register_screen.dart';

import 'email_verification_screen.dart';

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

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _checkBiometricAvailability() async {
    if (kIsWeb) return;

    try {
      final hasBiometrics =
          await _localAuth.canCheckBiometrics ||
          await _localAuth.isDeviceSupported();
      final biometricsEnabled =
          await _storage.read(key: 'biometricsEnabled') == 'true';
      final hasCredentials = await _storage.read(key: 'email') != null;

      // --- O ESCUDO ---
      // Se a tela já foi fechada enquanto esperávamos a resposta, paramos tudo aqui!
      if (!mounted) return;

      if (hasBiometrics && hasCredentials && biometricsEnabled) {
        setState(() => _biometricLoginAvailable = true);
      } else {
        setState(() => _biometricLoginAvailable = false);
      }
    } catch (e) {
      debugPrint("Erro na biometria: $e");
    }
  }

  Future<void> _loadCredentials() async {
    final email = await _storage.read(key: 'email');
    if (email != null && mounted) {
      setState(() {
        _emailController.text = email;
        _rememberMe = true;
      });
    }
  }

  Future<void> _handleCredentialsStorage() async {
    if (_rememberMe) {
      await _storage.write(key: 'email', value: _emailController.text.trim());
      await _storage.write(
        key: 'password',
        value: _passwordController.text.trim(),
      );
      await _storage.write(key: 'biometricsEnabled', value: 'true');
    } else {
      await _storage.deleteAll();
      await _storage.write(key: 'biometricsEnabled', value: 'false');
      setState(() => _biometricLoginAvailable = false);
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
    _formKey.currentState!.save();
    setState(() => _isLoading = true);

    try {
      final userCredential = await FirebaseAuth.instance
          .signInWithEmailAndPassword(
            email: _emailController.text.trim(),
            password: _passwordController.text.trim(),
          );

      // --- A NOSSA FECHADURA DE SEGURANÇA ---
      final user = userCredential.user;
      if (user != null && !user.emailVerified) {
        // Se a senha está certa, mas o e-mail não foi validado:
        await _handleCredentialsStorage(); // Salva a biometria/lembrar senha se ele pediu

        if (mounted) {
          // Manda para a sala de castigo (esperar clicar no link)
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (context) => const EmailVerificationScreen(),
            ),
          );
        }
        return; // Interrompe a função para ele não ir para o Dashboard
      }
      // --------------------------------------

      await _handleCredentialsStorage();
      // O fluxo normal vai assumir daqui e mandá-lo pro Dashboard (via AuthGate)
    } on FirebaseAuthException catch (e) {
      String errorMessage = 'Falha na autenticação.';
      switch (e.code) {
        case 'user-not-found':
        case 'invalid-credential':
          errorMessage = 'Conta não encontrada ou dados incorretos.';
          break;
        case 'wrong-password':
          errorMessage = 'Senha incorreta. Tente novamente.';
          break;
        case 'invalid-email':
          errorMessage = 'O formato do e-mail é inválido.';
          break;
        case 'user-disabled':
          errorMessage = 'Esta conta foi desativada.';
          break;
        case 'too-many-requests':
          errorMessage = 'Muitas tentativas. Tente novamente mais tarde.';
          break;
        default:
          errorMessage = 'Erro ao entrar: ${e.message}';
      }
      _showError(errorMessage);
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

      final GoogleSignInAuthentication googleAuth =
          await googleUser.authentication;
      final AuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      await FirebaseAuth.instance.signInWithCredential(credential);
    } catch (e) {
      _showError('Erro ao fazer login com Google.');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _authenticateWithBiometrics() async {
    try {
      bool authenticated = await _localAuth.authenticate(
        localizedReason:
            'Faça login com sua digital para acessar o Store&Connect',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );

      if (authenticated && mounted) {
        setState(() => _isLoading = true);
        final email = await _storage.read(key: 'email');
        final password = await _storage.read(key: 'password');

        if (email != null && password != null) {
          final userCredential = await FirebaseAuth.instance
              .signInWithEmailAndPassword(email: email, password: password);

          // --- SEGURANÇA NO LOGIN BIOMÉTRICO ---
          final user = userCredential.user;
          if (user != null && !user.emailVerified) {
            if (mounted) {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(
                  builder: (context) => const EmailVerificationScreen(),
                ),
              );
            }
            return;
          }
          // -------------------------------------
        } else {
          _showError('Credenciais não encontradas. Faça login manualmente.');
          setState(() => _isLoading = false);
        }
      }
    } catch (e) {
      _showError('Erro na autenticação biométrica.');
      setState(() => _isLoading = false);
    }
  }

  void _showForgotPasswordDialog() {
    final TextEditingController dialogEmailController = TextEditingController();
    dialogEmailController.text =
        _emailController.text; // Aproveita se já digitou

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Redefinir Senha"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              "Digite seu e-mail e enviaremos um link para redefinir sua senha.",
            ),
            const SizedBox(height: 16),
            TextField(
              controller: dialogEmailController,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'E-mail',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            child: const Text("Cancelar"),
            onPressed: () => Navigator.of(ctx).pop(),
          ),
          ElevatedButton(
            child: const Text("Enviar"),
            onPressed: () async {
              final email = dialogEmailController.text.trim();
              if (email.isEmpty || !email.contains('@')) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Digite um e-mail válido.'),
                    backgroundColor: Colors.red,
                  ),
                );
                return;
              }
              try {
                // --- 1. FORÇA O IDIOMA PARA PORTUGUÊS ---
                // Isso já é suficiente para traduzir o E-mail e a Página Web!
                FirebaseAuth.instance.setLanguageCode('pt-BR');

                // --- 2. ENVIA O E-MAIL (Sem configurações extras para evitar bloqueios) ---
                await FirebaseAuth.instance.sendPasswordResetEmail(email: email);

                if (ctx.mounted) Navigator.of(ctx).pop();
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Link enviado! Verifique seu e-mail.'), backgroundColor: Colors.green),
                  );
                }
              } catch (e) {
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Erro ao enviar link: $e'), backgroundColor: Colors.red)
                );
              }
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSmallScreen = MediaQuery.of(context).size.width < 800;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: isSmallScreen ? _buildMobileLayout() : _buildWebLayout(),
    );
  }

  Widget _buildWebLayout() {
    return Row(
      children: [
        Expanded(
          child: Container(
            color: Theme.of(context).brightness == Brightness.dark
                ? Colors.black26
                : Colors.blue.shade50,
            child: Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Image.asset('assets/images/logo_web.png', width: 150),
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
        Expanded(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: _buildLoginForm(),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMobileLayout() {
    return CustomScrollView(
      slivers: [
        SliverFillRemaining(
          hasScrollBody: false, // O segredo: só rola se o conteúdo não couber na tela!
          child: SafeArea(
            // O SafeArea aqui no topo blinda a tela inteira contra as barras da Xiaomi
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24.0),
              child: _buildLoginForm(), // Seu formulário intacto e centralizado
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildLoginForm() {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    return Form(
      key: _formKey,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Exibe a logo apenas no mobile (já que no PC ela fica na área azul)
          // if (!kIsWeb)
          Center(
            child: Image.asset(
              'assets/images/logo_web.png',
              height: 180,
              errorBuilder: (ctx, err, stack) => const Icon(
                Icons.storefront,
                size: 80,
                color: Colors.deepPurple,
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Bem-vindo de volta!',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Faça login para continuar gerenciando seu negócio.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey),
          ),
          const SizedBox(height: 20),

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
            validator: (value) => (value == null || value.isEmpty)
                ? 'Por favor, insira sua senha.'
                : null,
          ),
          const SizedBox(height: 8),

          if (!kIsWeb)
            CheckboxListTile(
              title: const Text("Lembrar dados"),
              value: _rememberMe,
              onChanged: (newValue) =>
                  setState(() => _rememberMe = newValue ?? false),
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              activeColor: Colors.deepPurple,
            ),
          const SizedBox(height: 8),

          if (_isLoading)
            const Center(child: CircularProgressIndicator())
          else
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton(
                        onPressed: _submitLogin,
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          backgroundColor: Colors.deepPurple,
                          foregroundColor: Colors.white,
                        ),
                        child: const Text(
                          'ENTRAR',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    if (_biometricLoginAvailable && !kIsWeb) ...[
                      const SizedBox(width: 16),
                      Container(
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.deepPurple),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: IconButton(
                          icon: const Icon(
                            Icons.fingerprint,
                            size: 32,
                            color: Colors.deepPurple,
                          ),
                          onPressed: _authenticateWithBiometrics,
                          tooltip: 'Login com Digital',
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                TextButton(
                  child: Text(
                    'Esqueci a senha',
                    style: TextStyle(color: isDarkMode ? Colors.purple[200] : Colors.deepPurple,),
                  ),
                  onPressed: () => _showForgotPasswordDialog(),
                ),
                const SizedBox(height: 16),

                // Botão Google protegido contra quebra de tela (Overflow)
                OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: _isLoading ? null : _googleSignIn,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Image.asset('assets/images/google_logo.png', height: 24),
                      const SizedBox(width: 12),
                      Flexible(
                        child: Text(
                          'Continuar com Google',
                          style: TextStyle(fontSize: 16, color: isDarkMode ? Colors.white : Colors.black87,),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          const SizedBox(height: 20),
          SafeArea(
            top: false, // Não interfere na parte superior
            bottom: true, // Calcula e injeta o tamanho da barra de gestos/botões nativa
            child: Padding(
              padding: const EdgeInsets.only(bottom: 12.0), // Respiro extra para conforto visual
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('Ainda não tem uma conta?'),
                  TextButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (ctx) => const RegisterScreen()),
                      );
                    },
                    child: Text(
                      'Cadastre-se',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        color: isDarkMode ? Colors.white : Colors.deepPurple,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
