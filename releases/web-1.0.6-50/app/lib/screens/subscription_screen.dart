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
import '../services/subscription_billing_access.dart';

class SubscriptionScreen extends StatefulWidget {
  final String storeId;
  final Future<SubscriptionBillingAccess> Function(String)? billingFactory;
  final bool observeStatus;
  const SubscriptionScreen({super.key, required this.storeId, this.billingFactory, this.observeStatus = true});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {
  bool _isLoading = false;
  // A failed callable response is not proof that the provider did not write.
  // This is a UI hold only; reconciliation must remain authoritative.
  bool _requiresBillingReview = false;
  static const _billingReviewMessage =
      'Não foi possível confirmar a situação financeira. '
      'Não tente assinar ou pagar novamente até o suporte conferir o vínculo '
      'e as cobranças existentes. O acesso permanece sujeito ao status oficial.';
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _statusListener;
  SubscriptionBillingAccess? _billing;
  Map<String, dynamic>? _billingState;
  String? _billingQueryError;
  bool _queryingBilling = true;
  bool get _hasExistingBinding => _billingState?['billingState'] == 'bound';

  Future<void> _openExistingInvoice() async {
    if (_isLoading || _queryingBilling || !_hasExistingBinding || _billing == null) return;
    setState(() => _isLoading = true);
    try {
      final uri = await _billing!.existingInvoice();
      if (!mounted) return;
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && mounted) {
        _showSnackBar('Não foi possível abrir a cobrança. Tente novamente.', Colors.red);
      }
    } catch (_) {
      if (mounted) _showSnackBar('Não foi possível consultar a cobrança existente. Nenhuma nova contratação foi iniciada.', Colors.red);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void initState() {
    super.initState();
    if (widget.observeStatus) _startListeningToStatus();
    unawaited(_queryBilling());
  }

  Future<void> _queryBilling() async {
    if (mounted) setState(() { _queryingBilling = true; _billingQueryError = null; });
    try {
      final billing = _billing ?? await (widget.billingFactory ?? SubscriptionBillingAccess.open)(widget.storeId);
      final state = await billing.query();
      if (mounted) setState(() { _billing = billing; _billingState = state; });
    } on FirebaseFunctionsException catch (e) {
      if (mounted) setState(() => _billingQueryError = billingReadErrorMessage(e, endpoint: 'getAsaasSubscriptionStateV1'));
    } catch (_) {
      if (mounted) setState(() => _billingQueryError = 'Não foi possível conferir o estado financeiro. Nenhuma contratação iniciada.');
    } finally { if (mounted) setState(() => _queryingBilling = false); }
  }

  @override
  void dispose() {
    _statusListener?.cancel();
    super.dispose();
  }

  /// Monitora se o pagamento foi confirmado via Webhook
  /// Listener para monitorar mudanças de status da assinatura
  DateTime? _parseFlexibleDate(dynamic rawValue) {
    if (rawValue == null) return null;

    if (rawValue is DateTime) {
      return rawValue;
    }

    if (rawValue is String) {
      return DateTime.tryParse(rawValue);
    }

    try {
      final converted = rawValue.toDate();

      if (converted is DateTime) {
        return converted;
      }
    } catch (_) {
      // Tipo de data não suportado.
    }

    return null;
  }
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
            final trialEndDate = _parseFlexibleDate(data?['trialEndDate']);

            // 1. Calcula se o trial ainda é válido
            bool isTrialActive = false;
            if (trialEndDate != null) {
              try {
                isTrialActive = DateTime.now().isBefore(
                  trialEndDate,
                );
              } catch (e) {}
            }

            // 2. A MESMA REGRA DO AUTHGATE:
            bool hasAccess = false;
            if (status == 'active') {
              if (type == 'pro' || type == 'business' || isTrialActive) {
                hasAccess = true;
              }
            }

            // 3. Se realmente tem acesso (Pagou ou Trial Válido), volta para AuthGate
            if (hasAccess && mounted) {
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (ctx) => const AuthGate()),
                (route) => false,
              );
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

  /// Modal rápido para capturar o CPF/CNPJ caso não esteja salvo na loja
  Future<String?> _askForDocumentModal(BuildContext context) async {
    final controller = TextEditingController();
    final formKey = GlobalKey<FormState>();

    return showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text(
          "Informação Necessária",
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
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
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  prefixIcon: const Icon(Icons.badge_outlined),
                ),
                validator: (val) {
                  if (val == null || val.isEmpty) return "Campo obrigatório.";
                  if (val.length != 11 && val.length != 14)
                    return "Digite 11 (CPF) ou 14 (CNPJ) números.";
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
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
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

  /// Inicia o processo de assinatura buscando os dados já salvos no Firestore
  Future<void> _startSubscriptionProcess() async {
    if (_isLoading || _requiresBillingReview || _queryingBilling || _billingState?['canStart'] != true || _billing == null) return;
    var requestStarted = false;
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
      String document =
          storeData['document'] ?? ''; // 👇 Mudamos de final para String
      final name = storeData['name'] ?? '';
      final phone = storeData['phone'] ?? '';

      // 🚀 REDE DE SEGURANÇA: Se o CPF não estiver no banco, pede na hora!
      if (document.isEmpty) {
        setState(
          () => _isLoading = false,
        ); // Pausa o loading para abrir o modal

        final inputDoc = await _askForDocumentModal(context);
        if (inputDoc == null || inputDoc.isEmpty)
          return; // Se o usuário cancelar, interrompe o fluxo

        document = inputDoc;
        setState(() => _isLoading = true); // Retoma o loading


      }

      // 2. Chama a Cloud Function do Asaas enviando os dados garantidos
      final consent = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
        title: const Text('Confirmar contratação'),
        content: const Text('Consultar a assinatura não gera cobrança. Ao confirmar, você solicita a contratação expressa do plano apresentado. Não repita em caso de resultado inconclusivo.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmar contratação'))]));
      if (consent != true || !mounted) return;
      requestStarted = true;
      final data = await _billing!.contract({
            "cpfCnpj": document, // Agora sempre terá um valor válido!
            "name": name,
            "email": user.email,
            "phone": phone,
          }, consentToContract: true);

      // Do not log payment URLs, provider identifiers or the full payload.

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
          await launchUrl(
            Uri.parse(paymentUrl.toString()),
            mode: LaunchMode.externalApplication,
          );
        } catch (e) {
          await Clipboard.setData(ClipboardData(text: paymentUrl.toString()));
          if (mounted)
            _showSnackBar(
              '📋 Link copiado para a área de transferência!',
              Colors.orange,
            );
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
        setState(() => _requiresBillingReview = true);
        _showSnackBar(_billingReviewMessage, Colors.orange);
      }
    } on FirebaseFunctionsException catch (e) {
      final requiresReview = requestStarted && !const [
        'unauthenticated', 'permission-denied', 'invalid-argument',
      ].contains(e.code);
      if (mounted && requiresReview) {
        setState(() => _requiresBillingReview = true);
      }
      _showSnackBar(requiresReview
          ? '$_billingReviewMessage Código: ${e.code}.'
          : 'Erro: ${e.message}', Colors.red);
      debugPrint("Firebase Error: ${e.code}");
    } catch (e) {
      if (mounted && requestStarted) {
        setState(() => _requiresBillingReview = true);
      }
      _showSnackBar(requestStarted ? _billingReviewMessage
          : 'Não foi possível preparar a solicitação de assinatura.', Colors.red);
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
                padding: const EdgeInsets.symmetric(
                  vertical: 40.0,
                  horizontal: 30.0,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.workspace_premium,
                      size: 80,
                      color: Colors.deepPurple,
                    ),
                    const SizedBox(height: 24),
                    Text(
                      _hasExistingBinding
                          ? 'Sua assinatura ${_billingState?['subscriptionType'] == 'business' ? 'Business' : 'Pro'}'
                          : 'Assine o Plano Pro',
                      style: const TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                        color: Colors.black87,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _hasExistingBinding
                          ? 'Sua loja já possui uma assinatura. Consulte a cobrança existente para conferir o pagamento e seu acesso.'
                          : 'Confira a situação da sua conta e assine o Plano Pro para continuar usando sua loja.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 16,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 40),

                    // Benefícios (Visual Limpo)
                    _buildFeatureRow(
                      Icons.check_circle,
                      "Gestão completa de vendas",
                    ),
                    const SizedBox(height: 12),
                    _buildFeatureRow(
                      Icons.check_circle,
                      "Controle de estoque ilimitado",
                    ),
                    const SizedBox(height: 12),
                    _buildFeatureRow(Icons.check_circle, "Suporte prioritário"),

                    const SizedBox(height: 40),

                    if (!_hasExistingBinding) SizedBox(
                      width: double.infinity,
                      height: 55,
                      child: ElevatedButton.icon(
                        onPressed: _isLoading || _requiresBillingReview || _queryingBilling || _billingQueryError != null || _billingState?['canStart'] != true
                            ? null
                            : _startSubscriptionProcess,
                        icon: _isLoading
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  color: Colors.white,
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.lock_open),
                        label: Text(
                          _isLoading ? "PROCESSANDO..." : _requiresBillingReview
                              ? "AGUARDANDO CONFERÊNCIA" : "ASSINAR AGORA",
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.deepPurple,
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: Colors.grey[400],
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      ),
                    ),
                    if (_hasExistingBinding) ...[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _isLoading || _queryingBilling || _billingQueryError != null ? null : _openExistingInvoice,
                        icon: const Icon(Icons.receipt_long),
                        label: const Text('Abrir cobrança existente'),
                      ),
                    ],
                    if (_requiresBillingReview) ...[
                      const SizedBox(height: 12),
                      const Text(_billingReviewMessage,
                          textAlign: TextAlign.center),
                    ],
                    if (_queryingBilling) const LinearProgressIndicator(),
                    if (_billingQueryError != null) Text(_billingQueryError!, textAlign: TextAlign.center),
                    if (_billingState?['operationsEnabled'] == false)
                      const Text('Contratação indisponível por segurança. Consultar este estado não cria assinatura nem cobrança.', textAlign: TextAlign.center),
                    if (_billingState != null) Text('Estado: ${_billingState!['subscriptionStatus']} · motivo: ${_billingState!['inactiveReason'] ?? 'não se aplica'}\nTentativa: ${_billingState!['attemptStatus']}', textAlign: TextAlign.center),
                    TextButton(onPressed: _queryingBilling || _isLoading ? null : _queryBilling, child: const Text('Consultar estado — sem criar cobrança')),
                    const SizedBox(height: 20),
                    TextButton.icon(
                      onPressed: () => FirebaseAuth.instance.signOut(),
                      icon: const Icon(
                        Icons.logout,
                        size: 18,
                        color: Colors.grey,
                      ),
                      label: const Text(
                        "Sair da conta",
                        style: TextStyle(color: Colors.grey),
                      ),
                    ),
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
