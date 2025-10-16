import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:store_connect/screens/auth/register_screen.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:flutter_signin_button/flutter_signin_button.dart';

// TODO: Adicionar o import para sua tela de cadastro quando ela for criada
// import 'package:store_connect/screens/auth/register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final GoogleSignIn _googleSignIn = GoogleSignIn();
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

  // --- LÓGICA DO "ESQUECI A SENHA" ---
  void _forgotPassword() {
    final TextEditingController emailController = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Redefinir Senha"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text("Digite seu e-mail e enviaremos um link para você redefinir sua senha."),
            const SizedBox(height: 16),
            TextField(
              controller: emailController,
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
              final email = emailController.text.trim();
              if (email.isEmpty || !email.contains('@')) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Por favor, digite um e-mail válido.')),
                );
                return;
              }

              try {
                await FirebaseAuth.instance.sendPasswordResetEmail(email: email);
                if (context.mounted) Navigator.of(ctx).pop();
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Link para redefinição de senha enviado!')),
                  );
                }
              } on FirebaseAuthException catch (e) {
                if (context.mounted) Navigator.of(ctx).pop();
                String errorMessage = "Ocorreu um erro. Tente novamente.";
                if (e.code == 'user-not-found') {
                  // Mensagem genérica por segurança
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Link para redefinição de senha enviado!')),
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(errorMessage)),
                  );
                }
              }
            },
          ),
        ],
      ),
    );
  }

  // --- LÓGICA DO "CADASTRE-SE" (ainda não faz nada) ---
  void _navigateToRegisterScreen() {
    // TODO: Implementar a navegação para a tela de cadastro
     Navigator.of(context).push(MaterialPageRoute(builder: (ctx) => RegisterScreen()));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Tela de cadastro ainda não implementada.')),
    );
  }


  // --- MÉTODO DE LOGIN COM GOOGLE ---
  void _signInWithGoogle() async {
    print('--- Botão "Continuar com Google" pressionado! ---');
    setState(() => _isLoading = true);
    try {
      // Inicia o fluxo de autenticação do Google
      final googleUser = await _googleSignIn.signIn();

      // Obtém os detalhes da autenticação da requisição
      final googleAuth = await googleUser?.authentication;

      if (googleAuth != null) {
        // Cria uma credencial para o Firebase
        final credential = GoogleAuthProvider.credential(
          accessToken: googleAuth.accessToken,
          idToken: googleAuth.idToken,
        );

        // Faz o login no Firebase com a credencial
        await _firebaseAuth.signInWithCredential(credential);
        // O AuthGate cuidará da navegação após o login bem-sucedido
      }
    } on FirebaseAuthException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.message ?? 'Falha no login com Google.'),
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
      body: isSmallScreen
          ? _buildMobileLayout()
          : _buildWebLayout(),
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
    return Center(
      child: _buildLoginForm(),
    );
  }



  Widget _buildLoginForm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24.0),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Bem-vindo de volta!',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Text(
              'Faça login para continuar.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 48),
            TextFormField(
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'E-mail',
                border: OutlineInputBorder(),
              ),
              validator: (value) =>
              (value == null || !value.contains('@')) ? 'E-mail inválido.' : null,
              onSaved: (value) => _enteredEmail = value!,
            ),
            const SizedBox(height: 16),
            TextFormField(
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Senha',
                border: OutlineInputBorder(),
              ),
              validator: (value) =>
              (value == null || value.trim().length < 6)
                  ? 'Senha deve ter no mínimo 6 caracteres.'
                  : null,
              onSaved: (value) => _enteredPassword = value!,
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                TextButton(
                  onPressed: _forgotPassword,
                  child: const Text('Esqueci a senha'),
                ),
                TextButton(
                  onPressed: _navigateToRegisterScreen,
                  child: const Text('Cadastre-se'),
                ),
              ],
            ),
            const SizedBox(height: 24),
            if (_isLoading)
              const Center(child: CircularProgressIndicator())
            else
              ElevatedButton(
                onPressed: _submit,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: const Text('ENTRAR'),
              ),

            // --- BOTÃO DO GOOGLE ADICIONADO AQUI ---
            const SizedBox(height: 24),
            Row(
              children: [
                const Expanded(child: Divider()),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8.0),
                  child: Text('OU', style: TextStyle(color: Colors.grey.shade600)),
                ),
                const Expanded(child: Divider()),
              ],
            ),
            const SizedBox(height: 24),
            // ADICIONE ESTE NOVO BOTÃO NO LUGAR DO ANTIGO
            ElevatedButton(
              onPressed: _isLoading ? null : _signInWithGoogle,
              style: ElevatedButton.styleFrom(
                // Estilo para se parecer com o botão do Google, mas pode ser customizado
                backgroundColor: Colors.white,
                foregroundColor: Colors.black87,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // TODO: Adicione um ícone do Google aqui. Ex:
                  Image.asset('assets/images/google_logo.png', height: 20.0),
                  //const Text('G', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20, color: Colors.blue)), // Ícone provisório
                  const SizedBox(width: 12),
                  const Text('Continuar com Google', style: TextStyle(fontSize: 16)),
                ],
              ),
            ),
            // --- FIM DA ADIÇÃO ---
          ],
        ),
      ),
    );
  }
}