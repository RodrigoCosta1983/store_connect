import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:brasil_fields/brasil_fields.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:cloud_functions/cloud_functions.dart'; // <--- Importante!
import 'package:store_connect/screens/auth/auth_gate.dart';

class SubscriptionScreen extends StatefulWidget {
  final String storeId;

  const SubscriptionScreen({super.key, required this.storeId});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> with WidgetsBindingObserver {
  bool _isLoading = false;
  final _cpfCnpjController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cpfCnpjController.dispose();
    super.dispose();
  }

  // --- A Lógica Definitiva do Asaas ---
  Future<void> _startSubscriptionProcess() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception("Usuário não logado");

      final cpfCnpjLimpo = UtilBrasilFields.removeCaracteres(_cpfCnpjController.text);

      // --- CORREÇÃO AQUI ---
      // Garante que o nome nunca vá vazio, mesmo se o displayName for ""
      String nomeCliente = user.displayName ?? "";
      if (nomeCliente.trim().isEmpty) {
        // Se estiver vazio, pega a parte antes do @ do email (ex: rodrigo25.inf)
        nomeCliente = user.email?.split('@')[0] ?? "Cliente StoreConnect";
      }
      // ---------------------

      print("Chamando Asaas para: $nomeCliente ($cpfCnpjLimpo)");

      // 1. Chama a Função
      final result = await FirebaseFunctions.instance
          .httpsCallable(
          'createAsaasSubscription',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 120))
      )
          .call({
        "cpfCnpj": cpfCnpjLimpo,
        "name": nomeCliente,
        "email": user.email,
        "phone": ""
      });

      final data = result.data as Map<dynamic, dynamic>;
      final paymentUrl = data['paymentUrl'] as String;

      print("Link gerado: $paymentUrl");

      final uri = Uri.parse(paymentUrl);

      // Tenta abrir DIRETO, sem perguntar canLaunchUrl antes (Bypass no bug do Android 11+)
      try {
        await launchUrl(uri, mode: LaunchMode.externalApplication);

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text("✅ Link gerado! Pague no seu banco e aguarde aqui."),
              backgroundColor: Colors.blue,
            ),
          );
        }
      } catch (e) {
        // Se falhar mesmo tentando forçar, aí sim mostramos erro
        print("Erro ao tentar abrir URL: $e");
        throw Exception("Não foi possível abrir o navegador: $e");
      }

    } on FirebaseFunctionsException catch (e) {
      _showError("Erro no Asaas: ${e.message}");
      print("Erro detalhado Cloud Functions: ${e.details}"); // Ajuda no debug
    } catch (e) {
      _showError("Erro: $e");
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: Card(
              elevation: 4,
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 40.0, horizontal: 30.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.verified_user_outlined, size: 60, color: Colors.deepPurple),
                      const SizedBox(height: 20),

                      const Text(
                        "Assinatura Segura",
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                      ),

                      const SizedBox(height: 10),

                      Text(
                        "Informe o CPF/CNPJ para gerar sua nota fiscal e acessar o sistema.",
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                      ),

                      const SizedBox(height: 30),

                      TextFormField(
                        controller: _cpfCnpjController,
                        decoration: InputDecoration(
                          labelText: 'CPF ou CNPJ',
                          hintText: 'Digite apenas números',
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          prefixIcon: const Icon(Icons.badge_outlined),
                        ),
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          CpfOuCnpjFormatter(),
                        ],
                        validator: (value) {
                          if (value == null || value.isEmpty) return 'Obrigatório';
                          if (!UtilBrasilFields.isCPFValido(value) && !UtilBrasilFields.isCNPJValido(value)) {
                            return 'Documento inválido';
                          }
                          return null;
                        },
                      ),

                      const SizedBox(height: 30),

                      SizedBox(
                        width: double.infinity,
                        height: 55,
                        child: ElevatedButton.icon(
                          onPressed: _isLoading ? null : _startSubscriptionProcess,
                          icon: _isLoading
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                              : const Icon(Icons.lock_outline),
                          label: Text(
                              _isLoading ? "Gerando Assinatura..." : "Ir para Pagamento",
                              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.deepPurple,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),

                      const SizedBox(height: 15),

                      TextButton(
                        onPressed: () async {
                          await FirebaseAuth.instance.signOut();
                          if (context.mounted) {
                            Navigator.of(context).pushAndRemoveUntil(
                                MaterialPageRoute(builder: (ctx) => const AuthGate()),
                                    (route) => false
                            );
                          }
                        },
                        child: const Text("Sair da conta", style: TextStyle(color: Colors.grey)),
                      )
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