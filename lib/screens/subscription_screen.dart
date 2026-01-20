// lib/screens/subscription_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class SubscriptionScreen extends StatefulWidget {
  final String storeId;

  const SubscriptionScreen({super.key, required this.storeId});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> with WidgetsBindingObserver {
  bool _isVerifying = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkSubscriptionStatus();
    }
  }

  Future<void> _checkSubscriptionStatus() async {
    if (_isVerifying) return;

    setState(() {
      _isVerifying = true;
    });

    // Simula tempo de verificação enquanto o AuthGate recebe o stream
    await Future.delayed(const Duration(seconds: 4));

    if (mounted) {
      setState(() {
        _isVerifying = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Ainda aguardando confirmação do pagamento...'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _openPaymentPortal() async {
    final Uri url = Uri.parse("https://rodrigocosta1983.github.io/StoreConnect_SITE/Appland/index.html");

    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } else {
      debugPrint("Erro ao abrir URL: $url");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // Fundo levemente cinza para destacar o cartão branco na Web
      backgroundColor: Colors.grey[50],
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: ConstrainedBox(
            // --- O SEGREDO DO LAYOUT WEB ---
            // Define uma largura máxima. Se a tela for maior que 500px (PC),
            // o card para de crescer. Se for menor (Celular), ele se adapta.
            constraints: const BoxConstraints(maxWidth: 500),
            child: Card(
              elevation: 4, // Sombra suave
              surfaceTintColor: Colors.white, // Garante branco puro no Material 3
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 40.0, horizontal: 30.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min, // Ocupa apenas o necessário verticalmente
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Ícone animado ou estático
                    _isVerifying
                        ? const SizedBox(
                      height: 80,
                      width: 80,
                      child: CircularProgressIndicator(strokeWidth: 6, color: Colors.deepPurple),
                    )
                        : const Icon(Icons.lock_person_outlined, size: 80, color: Colors.deepPurple),

                    const SizedBox(height: 24),

                    Text(
                      _isVerifying ? "Verificando..." : "Finalize sua Assinatura",
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: Colors.black87),
                    ),

                    const SizedBox(height: 16),

                    Text(
                      "Para ativar sua loja, acesse nosso site, faça login e realize o pagamento.\n\nAssim que pagar, volte para cá!",
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 16, color: Colors.grey[600], height: 1.5),
                    ),

                    const SizedBox(height: 40),

                    if (!_isVerifying) ...[
                      // Botão 1: Ir Pagar
                      SizedBox(
                        width: double.infinity,
                        height: 55, // Botão um pouco mais alto fica mais bonito na web
                        child: ElevatedButton.icon(
                          onPressed: _openPaymentPortal,
                          icon: const Icon(Icons.open_in_new),
                          label: const Text(
                              "Ir para o Site e Pagar",
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.deepPurple,
                            foregroundColor: Colors.white,
                            elevation: 0,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),

                      const SizedBox(height: 16),

                      // Botão 2: Já Paguei
                      SizedBox(
                        width: double.infinity,
                        height: 55,
                        child: OutlinedButton.icon(
                          onPressed: _checkSubscriptionStatus,
                          icon: const Icon(Icons.refresh),
                          label: const Text("Já paguei, liberar acesso"),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.deepPurple,
                            side: const BorderSide(color: Colors.deepPurple),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                    ],

                    const SizedBox(height: 30),

                    TextButton.icon(
                      onPressed: () async {
                        await FirebaseAuth.instance.signOut();
                        if (context.mounted) {
                          Navigator.of(context).pushAndRemoveUntil(
                              MaterialPageRoute(builder: (ctx) => const AuthGate()),
                                  (route) => false
                          );
                        }
                      },
                      icon: const Icon(Icons.logout, size: 18),
                      label: const Text("Sair da conta"),
                      style: TextButton.styleFrom(foregroundColor: Colors.grey),
                    )
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}