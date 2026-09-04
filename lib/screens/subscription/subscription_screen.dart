// ============================================================================
// STORE CONNECT - SUBSCRIPTION SCREEN / ASSINATURA E REGULARIZAÇÃO
// ============================================================================
//
// Arquivo:
//   lib/screens/subscription_screen.dart
//
// OBJETIVO:
//
// Exibir o fluxo de assinatura/regularização e acompanhar, em tempo real,
// o estado financeiro persistido da loja.
//
// P6.8-B - AUTORIDADE FINANCEIRA:
//
// Este arquivo NÃO grava mais CPF/CNPJ nem campos de assinatura no Firestore.
// O Flutter pode somente:
//   - ler o documento da loja para saber se já existe CPF/CNPJ;
//   - solicitar o CPF/CNPJ ao proprietário apenas como fallback legado;
//   - chamar createAsaasSubscription;
//   - reagir ao status persistido pelo backend/webhook.
//
// Quando uma loja legada não possui `document`, o CPF/CNPJ informado é enviado
// para a Cloud Function. O backend valida proprietário/admin, reserva o documento
// e persiste `stores/{storeId}.document` de forma transacional.
//
// CUIDADOS DE MANUTENÇÃO:
//
// • Não reintroduzir update/set de `document` neste arquivo.
// • Não escrever subscriptionStatus/subscriptionType pelo cliente.
// • Nome, telefone e e-mail usados no Asaas são resolvidos pelo backend.
// • A decisão local de acesso serve apenas para navegação; a autoridade
//   persistente continua no backend + Firestore.
// • A proteção técnica final contra writes indevidos será concluída no P7.
//
// ============================================================================

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


  DateTime? _parseTrialEndDate(dynamic rawValue) {
    if (rawValue == null) return null;

    if (rawValue is Timestamp) {
      return rawValue.toDate();
    }

    if (rawValue is DateTime) {
      return rawValue;
    }

    if (rawValue is! String || rawValue.trim().isEmpty) {
      return null;
    }

    try {
      var normalized = rawValue.trim();
      final fractionalMatch = RegExp(r'(\.\d{3})\d+');
      normalized = normalized.replaceFirstMapped(
        fractionalMatch,
        (match) => match.group(1)!,
      );
      return DateTime.parse(normalized);
    } catch (_) {
      return null;
    }
  }

  /// Monitora mudanças persistidas pelo backend/webhook e retorna ao AuthGate
  /// quando a mesma matriz de acesso do P6 indicar que a loja pode entrar.
  void _startListeningToStatus() {
    _statusListener = FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .snapshots()
        .listen((docSnapshot) {
      if (!docSnapshot.exists) return;

      final data = docSnapshot.data() ?? <String, dynamic>{};

      final status =
          (data['subscriptionStatus']?.toString() ?? 'trial')
              .trim()
              .toLowerCase();

      final type =
          (data['subscriptionType']?.toString() ?? 'free')
              .trim()
              .toLowerCase();

      final trialEndDate = _parseTrialEndDate(data['trialEndDate']);
      final isTrialActive =
          trialEndDate != null && DateTime.now().isBefore(trialEndDate);

      final isPaidPlanType = type == 'pro' || type == 'business';
      final hasPaidAccess = status == 'active' && isPaidPlanType;
      final hasTrialAccess =
          (status == 'trial' || (status == 'active' && !isPaidPlanType)) &&
          isTrialActive;
      final hasOverdueGraceAccess = status == 'overdue';

      final hasAccess =
          hasPaidAccess || hasTrialAccess || hasOverdueGraceAccess;

      if (hasAccess && mounted) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (ctx) => const AuthGate()),
          (route) => false,
        );
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

  /// Modal rápido para capturar o CPF/CNPJ caso não esteja salvo na loja
  Future<String?> _askForDocumentModal(BuildContext context) async {
    final controller = TextEditingController();
    final formKey = GlobalKey<FormState>();

    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text("Informação Necessária", style: TextStyle(fontWeight: FontWeight.bold)),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                "Para emitir sua fatura no Asaas e ativar seu plano, precisamos do seu CPF ou CNPJ:",
                style: TextStyle(fontSize: 14, color: Colors.black87),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: controller,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: "CPF ou CNPJ (apenas números)",
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  prefixIcon: const Icon(Icons.badge_outlined),
                ),
                validator: (val) {
                  if (val == null || val.isEmpty) return "Campo obrigatório.";
                  if (val.length != 11 && val.length != 14) return "Digite 11 (CPF) ou 14 (CNPJ) números.";
                  return null;
                },
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(null),
            child: const Text("Cancelar", style: TextStyle(color: Colors.grey)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.deepPurple,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () {
              if (formKey.currentState!.validate()) {
                Navigator.of(ctx).pop(controller.text.trim());
              }
            },
            child: const Text("Confirmar"),
          ),
        ],
      ),
    );
  }


  /// Inicia o processo de assinatura sem conceder autoridade financeira ao
  /// cliente. O Flutter apenas identifica a loja e, quando necessário, coleta
  /// um CPF/CNPJ legado; toda validação e persistência ocorre no backend.
  Future<void> _startSubscriptionProcess() async {
    setState(() => _isLoading = true);

    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        throw Exception('Usuário não logado');
      }

      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();

      if (!storeDoc.exists) {
        throw Exception('Loja não encontrada');
      }

      final storeData = storeDoc.data() ?? <String, dynamic>{};
      final storedDocument =
          (storeData['document']?.toString() ?? '').replaceAll(
        RegExp(r'[^0-9]'),
        '',
      );

      final payload = <String, dynamic>{
        'storeId': widget.storeId,
      };

      // Fallback somente para lojas legadas sem documento. O valor NÃO é
      // persistido pelo Flutter; a Cloud Function fará a validação e o write.
      if (storedDocument.isEmpty) {
        if (mounted) {
          setState(() => _isLoading = false);
        }

        if (!mounted) return;

        final inputDoc = await _askForDocumentModal(context);

        if (inputDoc == null || inputDoc.isEmpty) {
          return;
        }

        payload['cpfCnpj'] = inputDoc;

        if (mounted) {
          setState(() => _isLoading = true);
        }
      }

      final response = await FirebaseFunctions.instance
          .httpsCallable(
            'createAsaasSubscription',
            options: HttpsCallableOptions(
              timeout: const Duration(seconds: 120),
            ),
          )
          .call(payload);

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