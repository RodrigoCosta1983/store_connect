// lib/widgets/subscription_button.dart

import 'package:firebase_auth/firebase_auth.dart'; // 1. Import necessário
import 'package:flutter/foundation.dart'; // Necessário para kIsWeb
import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:in_app_purchase/in_app_purchase.dart'; // Para Google Play Nativo

// Importação Condicional (Mantém o app Web funcionando sem erro de dart:js)
import 'package:store_connect/utils/payment/payment_stub.dart'
if (dart.library.js) 'package:store_connect/utils/payment/payment_web.dart';

class SubscriptionButton extends StatefulWidget {
  const SubscriptionButton({Key? key}) : super(key: key);

  @override
  State<SubscriptionButton> createState() => _SubscriptionButtonState();
}

class _SubscriptionButtonState extends State<SubscriptionButton> {
  bool _isLoading = false;

  // ID do produto na Google Play (Verifique se é o mesmo do Console)
  final String _googlePlayProductId = 'plano_mensal_storeeconnect';

  // Chave pública do Stripe
  final String _stripePublicKey = "pk_test_51RtadZF7qAVyn13s6gJurceEqlBHWNNd4xJdGqklUGjHMDfq8vWc2XzSGU4XtDOqAgVnGQYX4hztddfrWErMECa400Gj0XeNnO";

  // ---------------------------------------------------------
  // LÓGICA 1: WEB (Usa Stripe via Cloud Functions)
  // ---------------------------------------------------------
  Future<void> _handleWebCheckout() async {
    setState(() => _isLoading = true);
    try {
      final user = FirebaseAuth.instance.currentUser; // 2. Pega o usuário

      final functions = FirebaseFunctions.instanceFor(region: "us-central1");
      final callable = functions.httpsCallable('createCheckoutSession');

      // 3. Passa os dados manualmente no corpo da requisição
      final result = await callable.call({
        'email': user?.email,
        'uid': user?.uid,
      });

      final String sessionId = result.data['sessionId'];

      // Redireciona usando o Stripe JS
      redirectToCheckout(sessionId, _stripePublicKey);

    } catch (e) {
      _showError("Erro no pagamento Web: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // ---------------------------------------------------------
  // LÓGICA 2: MOBILE (Usa Google Play Billing Nativo)
  // ---------------------------------------------------------
  Future<void> _handleMobileCheckout() async {
    setState(() => _isLoading = true);
    try {
      final InAppPurchase iap = InAppPurchase.instance;
      final bool available = await iap.isAvailable();

      if (!available) {
        _showError("Loja Google Play indisponível neste dispositivo.");
        return;
      }

      // Busca o produto
      final ProductDetailsResponse response = await iap.queryProductDetails({_googlePlayProductId});

      if (response.notFoundIDs.isNotEmpty) {
        _showError("Produto não encontrado na loja: $_googlePlayProductId");
        return;
      }

      final ProductDetails productDetails = response.productDetails.first;
      final PurchaseParam purchaseParam = PurchaseParam(productDetails: productDetails);

      // Inicia o popup nativo do Google
      // O resultado será capturado pelo seu SubscriptionProvider automaticamente
      await iap.buyNonConsumable(purchaseParam: purchaseParam);

    } catch (e) {
      _showError("Erro ao iniciar Google Play: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
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
    final bool isWeb = kIsWeb;

    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    // O Botão Centralizado com o estilo visual que você escolheu
    return Center(
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          backgroundColor: Colors.white,
          side: const BorderSide(color: Colors.black45, width: 1.5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(30),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 15),
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        // 👇 Lógica Condicional de Pagamento 👇
        onPressed: () {
          if (isWeb) {
            _handleWebCheckout(); // Se for Web, vai pro Stripe
          } else {
            _handleMobileCheckout(); // Se for Android, vai DIRETO pro Nativo
          }
        },
        child: Text(
          isWeb ? 'Assinar Agora via WEB' : 'Assinar Agora',
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.black,
          ),
        ),
      ),
    );
  }
}