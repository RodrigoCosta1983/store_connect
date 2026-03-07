import 'dart:async';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:store_connect/screens/auth/auth_gate.dart'; // Adicionado para poder navegar

class PaymentWaitingScreen extends StatefulWidget {
  final String subscriptionId;
  final String paymentUrl;
  final String storeId; // ✅ NOVO: Agora a tela sabe qual loja vigiar

  const PaymentWaitingScreen({
    required this.subscriptionId,
    required this.paymentUrl,
    required this.storeId, // ✅ NOVO
    Key? key,
  }) : super(key: key);

  @override
  State<PaymentWaitingScreen> createState() => _PaymentWaitingScreenState();
}

class _PaymentWaitingScreenState extends State<PaymentWaitingScreen> {
  late StreamSubscription<DocumentSnapshot> _subscription;
  bool _paymentConfirmed = false;
  bool _boletoAberto = false;

  @override
  void initState() {
    super.initState();
    _listenToPaymentStatus();
    _abrirBoletoAutomaticamente();
  }

  void _abrirBoletoAutomaticamente() async {
    if (_boletoAberto) return;
    _boletoAberto = true;

    await Future.delayed(const Duration(milliseconds: 500));
    try {
      final uri = Uri.parse(widget.paymentUrl);
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      debugPrint("Erro ao abrir boleto automaticamente: $e");
    }
  }

  void _listenToPaymentStatus() {
    final db = FirebaseFirestore.instance;

    // 🚀 CORREÇÃO AQUI: Vigiar a storeId correta, não o userId!
    _subscription = db.collection('stores').doc(widget.storeId).snapshots().listen((doc) {
      if (doc.exists) {
        final status = doc['subscriptionStatus'];
        debugPrint('📊 Status da assinatura: $status');

        if (status == 'active' && !_paymentConfirmed) {
          setState(() => _paymentConfirmed = true);
          _showSuccessDialog();
        }
      }
    });
  }

  void _showSuccessDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.green.shade50,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 80, height: 80,
              decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle),
              child: const Icon(Icons.check, color: Colors.white, size: 50),
            ),
            const SizedBox(height: 20),
            Text('✅ Pagamento Confirmado!', textAlign: TextAlign.center,
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.green.shade900)),
            const SizedBox(height: 10),
            Text('Sua assinatura foi ativada com sucesso.', textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: Colors.grey.shade700)),
          ],
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              // 🚀 CORREÇÃO: Envia para o AuthGate para reiniciar o app liberado
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (context) => const AuthGate()),
                    (route) => false,
              );
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
            child: const Text('Ir para o App'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pagamento'), centerTitle: true),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(width: 80, height: 80, child: CircularProgressIndicator(strokeWidth: 4, valueColor: AlwaysStoppedAnimation(Colors.blue))),
            const SizedBox(height: 30),
            const Text('Aguardando Confirmação', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.black87)),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text('O pagamento está sendo processado. Assim que confirmarmos, você terá acesso total ao app.',
                  textAlign: TextAlign.center, style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
            ),
            const SizedBox(height: 40),
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 20),
              padding: const EdgeInsets.all(15),
              decoration: BoxDecoration(color: Colors.blue.shade50, borderRadius: BorderRadius.circular(10), border: Border.all(color: Colors.blue.shade200)),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Usuário:', style: TextStyle(fontWeight: FontWeight.w500)),
                      Text(FirebaseAuth.instance.currentUser?.displayName ?? FirebaseAuth.instance.currentUser?.email ?? 'Usuário',
                          style: const TextStyle(fontSize: 12, color: Colors.blueGrey)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Status:', style: TextStyle(fontWeight: FontWeight.w500)),
                      Text('⏳ Aguardando...', style: TextStyle(fontSize: 12, color: Colors.orange)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 40),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: ElevatedButton.icon(
                onPressed: () async {
                  final Uri uri = Uri.parse(widget.paymentUrl);
                  try {
                    await launchUrl(uri, mode: LaunchMode.externalApplication);
                  } catch (e) {
                    debugPrint('Erro ao abrir URL: $e');
                  }
                },
                icon: const Icon(Icons.open_in_new, color: Colors.white),
                label: const Text('Abrir Boleto Novamente', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blue, padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}