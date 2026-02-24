import 'dart:async';

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:url_launcher/url_launcher.dart';


class PaymentWaitingScreen extends StatefulWidget {
  final String subscriptionId;
  final String paymentUrl;

  const PaymentWaitingScreen({
    required this.subscriptionId,
    required this.paymentUrl,
    Key? key,
  }) : super(key: key);

  @override
  State<PaymentWaitingScreen> createState() => _PaymentWaitingScreenState();
}

class _PaymentWaitingScreenState extends State<PaymentWaitingScreen> {
  late StreamSubscription<DocumentSnapshot> _subscription;
  bool _paymentConfirmed = false;

  @override
  void initState() {
    super.initState();
    _listenToPaymentStatus();
  }

  void _listenToPaymentStatus() {
    final db = FirebaseFirestore.instance;
    final userId = FirebaseAuth.instance.currentUser!.uid;

    _subscription = db.collection('stores').doc(userId).snapshots().listen((doc) {
      if (doc.exists) {
        final status = doc['subscriptionStatus'];
        print('📊 Status da assinatura: $status');

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
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: Colors.green,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.check, color: Colors.white, size: 50),
            ),
            SizedBox(height: 20),
            Text(
              '✅ Pagamento Confirmado!',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.green.shade900,
              ),
            ),
            SizedBox(height: 10),
            Text(
              'Sua assinatura foi ativada com sucesso.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey.shade700,
              ),
            ),
          ],
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop(); // Fecha diálogo
              Navigator.of(context).pop(); // Volta para tela anterior
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.green,
            ),
            child: Text('Ir para o App'),
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
      appBar: AppBar(
        title: Text('Pagamento'),
        centerTitle: true,
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // 🔄 ANIMAÇÃO DE CARREGAMENTO
            SizedBox(
              width: 80,
              height: 80,
              child: CircularProgressIndicator(
                strokeWidth: 4,
                valueColor: AlwaysStoppedAnimation(Colors.blue),
              ),
            ),
            SizedBox(height: 30),

            // 📋 TÍTULO
            Text(
              'Aguardando Confirmação',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.black87,
              ),
            ),
            SizedBox(height: 10),

            // 📝 DESCRIÇÃO
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'O pagamento está sendo processado. Assim que confirmarmos, você terá acesso total ao app.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14,
                  color: Colors.grey.shade600,
                ),
              ),
            ),
            SizedBox(height: 40),

            // 📊 INFORMAÇÕES
            Container(
              margin: EdgeInsets.symmetric(horizontal: 20),
              padding: EdgeInsets.all(15),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.blue.shade200),
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Usuário:', style: TextStyle(fontWeight: FontWeight.w500)),
                      // ✅ Pega o nome ou e-mail do usuário logado no momento
                      Text(
                        FirebaseAuth.instance.currentUser?.displayName ??
                            FirebaseAuth.instance.currentUser?.email ?? 'Usuário',
                        style: const TextStyle(fontSize: 12, color: Colors.blueGrey),
                      ),
                    ],
                  ),
                  SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Status:', style: TextStyle(fontWeight: FontWeight.w500)),
                      Text('⏳ Aguardando...', style: TextStyle(fontSize: 12, color: Colors.orange)),
                    ],
                  ),
                ],
              ),
            ),
            SizedBox(height: 40),

            // 🔗 BOTÃO PARA ABRIR BOLETO NOVAMENTE
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: ElevatedButton.icon(
                onPressed: () async {
                  try {
                    final Uri uri = Uri.parse(widget.paymentUrl);
                    debugPrint('🔗 Tentando abrir link: ${widget.paymentUrl}');

                    // Tenta abrir no navegador externo (Mais seguro para boletos)
                    bool launched = await launchUrl(
                        uri,
                        mode: LaunchMode.externalApplication
                    );

                    if (!launched) {
                      debugPrint('❌ Falha ao abrir via externalApplication, tentando padrão...');
                      await launchUrl(uri);
                    }
                  } catch (e) {
                    debugPrint('❌ Erro fatal ao abrir boleto: $e');
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Não foi possível abrir o navegador. Tente copiar o link.'),
                          backgroundColor: Colors.red,
                        ),
                      );
                    }
                  }
                },
                icon: const Icon(Icons.open_in_new, color: Colors.white),
                label: const Text('Abrir Boleto Novamente', style: TextStyle(color: Colors.white)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.blue,
                  padding: const EdgeInsets.symmetric(horizontal: 30, vertical: 15),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),

            SizedBox(height: 60),

            // ℹ️ DICA
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                'Dica: Se pagou pelo PIX/TED, pode levar alguns minutos para confirmar.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.grey.shade500,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}