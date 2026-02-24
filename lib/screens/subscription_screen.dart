import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:brasil_fields/brasil_fields.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'package:store_connect/screens/payment_waiting_screen.dart';

class SubscriptionScreen extends StatefulWidget {
  final String storeId;
  const SubscriptionScreen({super.key, required this.storeId});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen>
    with WidgetsBindingObserver, AutomaticKeepAliveClientMixin {

  bool _isLoading = false;
  bool _isExistingClient = false;
  bool _isSubscriptionActive = false;

  late final TextEditingController _nameController;
  late final TextEditingController _phoneController;
  late final TextEditingController _cpfCnpjController;

  final _formKey = GlobalKey<FormState>();
  StreamSubscription<QuerySnapshot>? _statusListener;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _nameController = TextEditingController();
    _phoneController = TextEditingController();
    _cpfCnpjController = TextEditingController();

    _cpfCnpjController.addListener(_verifyCpfUsage);

    final user = FirebaseAuth.instance.currentUser;
    if (user?.displayName != null && user!.displayName!.isNotEmpty) {
      _nameController.text = user.displayName!;
    }

   // _startListeningToStatus();//
  }

  Future<void> _verifyCpfUsage() async {
    // ✅ Verificar se o campo está vazio ANTES de remover caracteres
    if (_cpfCnpjController.text.isEmpty) {
      if (_isExistingClient) {
        setState(() => _isExistingClient = false);
      }
      return;
    }

    String cleanDoc = UtilBrasilFields.removeCaracteres(_cpfCnpjController.text);

    if (cleanDoc.length == 11 || cleanDoc.length == 14) {
      final docSnap = await FirebaseFirestore.instance
          .collection('cpfs_cadastrados')
          .doc(cleanDoc)
          .get();

      if (mounted) {
        setState(() {
          _isExistingClient = docSnap.exists;
        });
      }
    } else if (_isExistingClient) {
      setState(() => _isExistingClient = false);
    }
  }

  @override
  void dispose() {
    _cpfCnpjController.removeListener(_verifyCpfUsage);
    _nameController.dispose();
    _phoneController.dispose();
    _cpfCnpjController.dispose();
    _statusListener?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

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
        final status = data['subscriptionStatus'] as String?;

        if (mounted) {
          setState(() {
            _isSubscriptionActive = status == 'active';
          });
        }

        if (status == 'active' && mounted) {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (ctx) => const AuthGate()),
                  (route) => false);
        }
      }
    });
  }

  /// ✨ NOVO: MÉTODO FALTANDO - Agora está aqui!
  void _showSuccess(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.green[600],
        duration: const Duration(seconds: 3),
      ),
    );
  }

  void _showWarning(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.orange[600],
        duration: const Duration(seconds: 3),
      ),
    );
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red[600],
        duration: const Duration(seconds: 4),
      ),
    );
  }

  Future<void> _startSubscriptionProcess() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isLoading = true);

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception("Usuário não logado");

      final response = await FirebaseFunctions.instance
          .httpsCallable('createAsaasSubscription',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 120)))
          .call({
        "cpfCnpj": UtilBrasilFields.removeCaracteres(_cpfCnpjController.text),
        "name": _nameController.text.trim(),
        "email": user.email,
        "phone": UtilBrasilFields.removeCaracteres(_phoneController.text)
      });

      final data = response.data as Map<String, dynamic>;

      // 🔍 DEBUG: Imprimir toda a resposta
      print('📱 RESPOSTA COMPLETA:');
      print(data);
      print('paymentUrl: ${data['paymentUrl']}');
      print('subscriptionId: ${data['subscriptionId']}');
      print('isTrial: ${data['isTrial']}');
      print('alreadyActive: ${data['alreadyActive']}');
      print('alreadyExists: ${data['alreadyExists']}');

      if (mounted) {
        // 🔹 1. Verificar se já está ativa
        if (data['alreadyActive'] == true) {
          _showSuccess("✅ Sua assinatura já está ativa!");
          await Future.delayed(const Duration(seconds: 2));
          if (mounted) {
            Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (ctx) => const AuthGate()),
                  (route) => false,
            );
          }
          return;
        }

        // 🔹 2. Se existe boleto pendente
        if (data['alreadyExists'] == true) {
          final paymentUrl = data['paymentUrl'];
          final subscriptionId = data['subscriptionId'];

          print('📄 BOLETO PENDENTE: $paymentUrl');

          if (paymentUrl != null && paymentUrl.toString().isNotEmpty) {
            _showWarning("📄 Abrindo boleto pendente...");

            final uri = Uri.parse(paymentUrl.toString());

            try {
              print('✅ Tentando abrir URL no navegador externo...');
              await launchUrl(uri, mode: LaunchMode.externalApplication);
              print('✅ URL aberta com sucesso!');
            } catch (e) {
              print('❌ Erro ao abrir URL: $e');
              await Clipboard.setData(ClipboardData(text: paymentUrl));
              if (mounted) {
                _showWarning('📋 URL copiada! Cole no navegador.');
              }
            }

            await Future.delayed(const Duration(milliseconds: 500));

            if (mounted) {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (ctx) => PaymentWaitingScreen(
                    subscriptionId: subscriptionId ?? '',
                    paymentUrl: paymentUrl.toString(),
                  ),
                ),
              );
            }
          } else {
            _showError("URL do boleto não disponível");
          }
          return;
        }

// 🔹 3. Novo boleto criado
        if (data['paymentUrl'] != null && data['paymentUrl'].toString().isNotEmpty) {
          final paymentUrl = data['paymentUrl'].toString();
          final subscriptionId = data['subscriptionId'];
          final isTrial = data['isTrial'] == true;

          print('📄 NOVO BOLETO: $paymentUrl');
          print('🎁 isTrial: $isTrial');

          _showSuccess(
            isTrial
                ? "🎁 Ativando seus 7 dias grátis!"
                : "📄 Gerando fatura de assinatura...",
          );

          final uri = Uri.parse(paymentUrl);

          try {
            print('✅ Tentando abrir URL...');
            await launchUrl(uri, mode: LaunchMode.platformDefault);
            print('✅ URL aberta com sucesso!');
          } catch (e) {
            print('❌ Erro ao abrir URL: $e');
            await Clipboard.setData(ClipboardData(text: paymentUrl));
            if (mounted) {
              _showWarning('📋 URL copiada! Cole no navegador.');
            }
          }

          await Future.delayed(const Duration(milliseconds: 500));

          if (mounted) {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (ctx) => PaymentWaitingScreen(
                  subscriptionId: subscriptionId ?? '',
                  paymentUrl: paymentUrl,
                ),
              ),
            );
          }
        } else {
          print('❌ paymentUrl é null ou vazio');
          _showError("URL do pagamento não disponível");
        }
      }
    } on FirebaseFunctionsException catch (e) {
      _showError("Erro na assinatura: ${e.message}");
      debugPrint("Firebase Error Code: ${e.code}");
      debugPrint("Firebase Error Details: ${e.details}");
    } catch (e) {
      _showError("Erro inesperado: $e");
      debugPrint("Error: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _abrirBoleto(String paymentUrl) async {
    try {
      print("🔗 Abrindo: $paymentUrl");
      final uri = Uri.parse(paymentUrl);

      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        print("🔗 Aberto com sucesso!");
        return;
      }

      try {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        print("🔗 Aberto (tentativa 2)");
        return;
      } catch (e) {
        print("🔗 Falha total: $e");
        throw e;
      }

    } catch (e) {
      print("🔗 Erro: $e");
      // Silenciosamente falha aqui
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Scaffold(
      backgroundColor: Colors.grey[50],
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 40.0, horizontal: 30.0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    children: [
                      Icon(
                        _isSubscriptionActive ? Icons.check_circle :
                        _isExistingClient ? Icons.lock_open :
                        Icons.rocket_launch,
                        size: 60,
                        color: _isExistingClient || _isSubscriptionActive
                            ? Colors.green
                            : Colors.deepPurple,
                      ),
                      const SizedBox(height: 20),
                      Text(
                        _isSubscriptionActive
                            ? "Assinatura Ativa ✓"
                            : (_isExistingClient
                            ? "Assinar Plano Pro"
                            : "Complete seu Cadastro"),
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        _isSubscriptionActive
                            ? "Seu acesso já está liberado!"
                            : (_isExistingClient
                            ? "Este CPF já utilizou o período de teste."
                            : "Informe seus dados para ativar os 7 dias grátis."),
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey[600]),
                      ),
                      const SizedBox(height: 30),
                      if (!_isSubscriptionActive) ...[
                        TextFormField(
                          controller: _nameController,
                          decoration: InputDecoration(
                            labelText: 'Nome Completo',
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          validator: (value) => (value == null || value.trim().length < 3) ? 'Nome inválido' : null,
                        ),
                        const SizedBox(height: 15),
                        TextFormField(
                          controller: _phoneController,
                          decoration: InputDecoration(
                            labelText: 'WhatsApp',
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                          keyboardType: TextInputType.phone,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly, TelefoneInputFormatter()],
                          validator: (value) => (value == null || value.isEmpty) ? 'Obrigatório' : null,
                        ),
                        const SizedBox(height: 15),
                        TextFormField(
                          controller: _cpfCnpjController,
                          decoration: InputDecoration(
                            labelText: 'CPF ou CNPJ',
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                            suffixIcon: _isExistingClient ? const Icon(Icons.check_circle, color: Colors.green) : null,
                          ),
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly, CpfOuCnpjFormatter()],
                          validator: (value) {
                            if (value == null || value.isEmpty) return 'Obrigatório';
                            if (!UtilBrasilFields.isCPFValido(value) && !UtilBrasilFields.isCNPJValido(value)) {
                              return 'Documento inválido';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 30),
                      ],
                      SizedBox(
                        width: double.infinity,
                        height: 55,
                        child: ElevatedButton.icon(
                          onPressed: (_isSubscriptionActive || _isLoading) ? null : _startSubscriptionProcess,
                          icon: _isLoading
                              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                              : Icon(_isSubscriptionActive ? Icons.check : (_isExistingClient ? Icons.payment : Icons.card_giftcard)),
                          label: Text(
                            _isSubscriptionActive ? "✓ ATIVO" : (_isLoading ? "PROCESSANDO..." : (_isExistingClient ? "ASSINAR PLANO PRO" : "ATIVAR 7 DIAS GRÁTIS")),
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _isSubscriptionActive || _isLoading ? Colors.grey[600] : (_isExistingClient ? Colors.green[700] : Colors.deepPurple),
                            foregroundColor: Colors.white,
                            disabledBackgroundColor: Colors.grey[400],
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                          ),
                        ),
                      ),
                      const SizedBox(height: 15),
                      TextButton(
                        onPressed: () => FirebaseAuth.instance.signOut(),
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