// lib/screens/subscription_screen.dart

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  bool _isLoading = false;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _statusListener;

  @override
  void initState() {
    super.initState();
    _startListeningToStatus();
  }

  @override
  void dispose() {
    _statusListener?.cancel();
    super.dispose();
  }


  /// Monitora se o pagamento foi confirmado via Webhook
  /// Listener para monitorar mudanças de status da assinatura
  void _startListeningToStatus() {
    _statusListener = FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .snapshots()
        .listen((docSnapshot) {
      if (docSnapshot.exists) {
        final data = docSnapshot.data();
        final status = data?['subscriptionStatus'] as String?;
        final type = data?['subscriptionType'] as String?;
        final trialEndDate = data?['trialEndDate'] as String?;

        // 1. Calcula se o trial ainda é válido
        bool isTrialActive = false;
        if (trialEndDate != null) {
          try {
            isTrialActive = DateTime.now().isBefore(DateTime.parse(trialEndDate));
          } catch (e) {}
        }

        // 2. A MESMA REGRA DO AUTHGATE:
        bool hasAccess = false;
        if (status == 'active') {
          if (type == 'pro' || isTrialActive) {
            hasAccess = true;
          }
        }

        // 3. Se realmente tem acesso (Pagou ou Trial Válido), volta para AuthGate
        if (hasAccess && mounted) {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (ctx) => const AuthGate()),
                  (route) => false);
        }
      }
    });
  }

  void _showSnackBar(String message, Color color) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: color,
        duration: const Duration(seconds: 4),
      ),
    );
  }

  /// Inicia o processo de assinatura buscando os dados já salvos no Firestore
  Future<void> _startSubscriptionProcess() async {
    setState(() => _isLoading = true);

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw Exception("Usuário não logado");

      // 1. Busca os dados da loja que já foram salvos no cadastro inicial
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();

      if (!storeDoc.exists) throw Exception("Loja não encontrada");

      final storeData = storeDoc.data()!;
      final document = storeData['document'] ?? '';
      final name = storeData['name'] ?? '';
      final phone = storeData['phone'] ?? '';

      if (document.isEmpty) {
        throw Exception("CPF/CNPJ não encontrado no cadastro. Contate o suporte.");
      }

      // 2. Chama a Cloud Function do Asaas enviando os dados recuperados do banco
      final response = await FirebaseFunctions.instance
          .httpsCallable('createAsaasSubscription',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 120)))
          .call({
        "cpfCnpj": document, // Já está limpo no banco
        "name": name,
        "email": user.email,
        "phone": phone
      });

      final data = response.data as Map<String, dynamic>;
      debugPrint('📱 RESPOSTA COMPLETA: $data');

      if (!mounted) return;

      // ✅ JÁ ESTÁ ATIVA
      if (data['alreadyActive'] == true) {
        _showSnackBar("✅ Sua assinatura já está ativa!", Colors.green);
        await Future.delayed(const Duration(seconds: 2));
        if (mounted) {
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (ctx) => const AuthGate()),
                (route) => false,
          );
        }
        return;
      }

      // ✅ BOLETO/PIX CRIADO OU PENDENTE
      final paymentUrl = data['paymentUrl'];
      final subscriptionId = data['subscriptionId'];

      if (paymentUrl != null && paymentUrl.toString().isNotEmpty) {
        _showSnackBar("📄 Gerando fatura de assinatura...", Colors.green);

        try {
          await launchUrl(Uri.parse(paymentUrl.toString()),
              mode: LaunchMode.externalApplication);
        } catch (e) {
          await Clipboard.setData(ClipboardData(text: paymentUrl.toString()));
          if (mounted) _showSnackBar('📋 Link copiado para a área de transferência!', Colors.orange);
        }

        await Future.delayed(const Duration(milliseconds: 500));

        if (mounted) {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (ctx) => PaymentWaitingScreen(
                subscriptionId: subscriptionId ?? '',
                paymentUrl: paymentUrl.toString(),
                storeId: widget.storeId,
              ),
            ),
          );
        }
      } else {
        _showSnackBar("URL do pagamento não disponível", Colors.red);
      }
    } on FirebaseFunctionsException catch (e) {
      _showSnackBar("Erro: ${e.message}", Colors.red);
      debugPrint("Firebase Error: ${e.code}");
    } catch (e) {
      _showSnackBar("Erro: $e", Colors.red);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 450),
            child: Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 40.0, horizontal: 30.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.workspace_premium,
                      size: 80,
                      color: Colors.deepPurple,
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      "Assine o Plano Pro",
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                        color: Colors.black87,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      "Seu acesso está temporariamente suspenso. Assine o Plano Pro ou regularize sua fatura pendente para restaurar o acesso ilimitado à sua loja. ",
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 16,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 40),

                    // Benefícios (Visual Limpo)
                    _buildFeatureRow(Icons.check_circle, "Gestão completa de vendas"),
                    const SizedBox(height: 12),
                    _buildFeatureRow(Icons.check_circle, "Controle de estoque ilimitado"),
                    const SizedBox(height: 12),
                    _buildFeatureRow(Icons.check_circle, "Suporte prioritário"),

                    const SizedBox(height: 40),

                    SizedBox(
                      width: double.infinity,
                      height: 55,
                      child: ElevatedButton.icon(
                        onPressed: _isLoading ? null : _startSubscriptionProcess,
                        icon: _isLoading
                            ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                        )
                            : const Icon(Icons.lock_open),
                        label: Text(
                          _isLoading ? "PROCESSANDO..." : "ASSINAR AGORA",
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.deepPurple,
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: Colors.grey[400],
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    TextButton.icon(
                      onPressed: () => FirebaseAuth.instance.signOut(),
                      icon: const Icon(Icons.logout, size: 18, color: Colors.grey),
                      label: const Text("Sair da conta", style: TextStyle(color: Colors.grey)),
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

  Widget _buildFeatureRow(IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, color: Colors.green, size: 24),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontSize: 15, color: Colors.black87),
          ),
        ),
      ],
    );
  }
}