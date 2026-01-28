import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:brasil_fields/brasil_fields.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class SubscriptionScreen extends StatefulWidget {
  final String storeId;

  const SubscriptionScreen({super.key, required this.storeId});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

// Adicionado: AutomaticKeepAliveClientMixin para manter os dados vivos
class _SubscriptionScreenState extends State<SubscriptionScreen> with WidgetsBindingObserver, AutomaticKeepAliveClientMixin {

  bool _isLoading = false;

  // Estes controladores DEVEM ser final e criados aqui no State
  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _cpfCnpjController;

  final _formKey = GlobalKey<FormState>();
  StreamSubscription<QuerySnapshot>? _statusListener;

  // Necessário para o KeepAlive
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    // Inicializa os controladores apenas UMA vez
    _nameController = TextEditingController();
    _phoneController = TextEditingController();
    _cpfCnpjController = TextEditingController();

    // Preenche nome se disponível
    final user = FirebaseAuth.instance.currentUser;
    if (user?.displayName != null && user!.displayName!.isNotEmpty) {
      _nameController.text = user.displayName!;
    }

    _startListeningToStatus();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _nameController.dispose();
    _phoneController.dispose();
    _cpfCnpjController.dispose();
    _statusListener?.cancel();
    super.dispose();
  }

  // ... (Mantenha os métodos _startListeningToStatus e _startSubscriptionProcess iguais aos anteriores) ...
  // Vou repetir aqui apenas para facilitar a cópia se precisar, mas a lógica é a mesma.

  void _startListeningToStatus() {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    _statusListener = FirebaseFirestore.instance
        .collection('stores')
        .where('ownerId', isEqualTo: user.uid)
        .limit(1)
        .snapshots()
        .listen((snapshot) {

      if (snapshot.docs.isNotEmpty) {
        final data = snapshot.docs.first.data();
        final status = data['subscriptionStatus'];

        if (status == 'active' && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text("🚀 Acesso Liberado! Entrando na loja..."),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 2),
            ),
          );

          Future.delayed(const Duration(milliseconds: 1500), () {
            if (mounted) {
              Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (ctx) => const AuthGate()),
                      (route) => false
              );
            }
          });
        }
      }
    });
  }

  Future<void> _startSubscriptionProcess() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception("Usuário não logado");

      final cpfCnpjLimpo = UtilBrasilFields.removeCaracteres(_cpfCnpjController.text);
      final telefoneLimpo = UtilBrasilFields.removeCaracteres(_phoneController.text);
      final nomeCompleto = _nameController.text.trim();

      final result = await FirebaseFunctions.instance
          .httpsCallable(
          'createAsaasSubscription',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 120))
      )
          .call({
        "cpfCnpj": cpfCnpjLimpo,
        "name": nomeCompleto,
        "email": user.email,
        "phone": telefoneLimpo
      });

      final data = result.data as Map<dynamic, dynamic>;
      //final paymentUrl = data['paymentUrl'] as String?;

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("🎁 Dados salvos! Ativando 7 Dias Grátis..."),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 4),
          ),
        );
      }
    /*
      if (paymentUrl != null && paymentUrl.isNotEmpty) {
        final uri = Uri.parse(paymentUrl);
        try {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } catch (e) {
          print("Erro ao abrir link: $e");
        }
      }*/

    } on FirebaseFunctionsException catch (e) {
      _showError("Erro no Asaas: ${e.message}");
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
      SnackBar(content: Text(message), backgroundColor: Colors.red),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // Necessário para o AutomaticKeepAliveClientMixin

    return Scaffold(
      backgroundColor: Colors.grey[50],
      // SingleChildScrollView com physics para evitar pulos estranhos
      body: Center(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
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
                        "Complete seu Cadastro",
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        "Informe seus dados para ativar os 7 dias grátis.",
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                      ),
                      const SizedBox(height: 30),

                      // Campos de Texto
                      TextFormField(
                        controller: _nameController,
                        decoration: InputDecoration(
                          labelText: 'Nome Completo',
                          prefixIcon: const Icon(Icons.person_outline),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        validator: (value) => (value == null || value.trim().length < 3) ? 'Informe seu nome completo' : null,
                      ),
                      const SizedBox(height: 15),
                      TextFormField(
                        controller: _phoneController,
                        decoration: InputDecoration(
                          labelText: 'Celular / WhatsApp',
                          prefixIcon: const Icon(Icons.phone_android_outlined),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        keyboardType: TextInputType.phone,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          TelefoneInputFormatter(),
                        ],
                        validator: (value) => (value == null || value.isEmpty) ? 'Obrigatório' : null,
                      ),
                      const SizedBox(height: 15),
                      TextFormField(
                        controller: _cpfCnpjController,
                        decoration: InputDecoration(
                          labelText: 'CPF ou CNPJ',
                          prefixIcon: const Icon(Icons.badge_outlined),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
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
                              : const Icon(Icons.rocket_launch),
                          label: Text(
                              _isLoading ? "Processando..." : "Ativar 7 Dias Grátis",
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