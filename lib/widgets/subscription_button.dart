import 'package:flutter/foundation.dart'; // Para kIsWeb
import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart'; // Para Android/iOS
import 'package:store_connect/screens/subscription_screen.dart';

class SubscriptionButton extends StatefulWidget {
  const SubscriptionButton({super.key});

  @override
  State<SubscriptionButton> createState() => _SubscriptionButtonState();
}

class _SubscriptionButtonState extends State<SubscriptionButton> {
  bool _isLoading = false;
  final String _googlePlayProductId = 'plano_mensal_storeeconnect';

  // --- LÓGICA 1: WEB (Vai para a tela do Asaas) ---
  void _handleWebCheckout() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (context) => const SubscriptionScreen(storeId: ""),
      ),
    );
  }

  // --- LÓGICA 2: MOBILE (Google Play Nativo) ---
  Future<void> _handleMobileCheckout() async {
    setState(() => _isLoading = true);
    try {
      final InAppPurchase iap = InAppPurchase.instance;
      if (!(await iap.isAvailable())) {
        _showError("Loja indisponível.");
        return;
      }
      final response = await iap.queryProductDetails({_googlePlayProductId});
      if (response.notFoundIDs.isNotEmpty) {
        _showError("Produto não encontrado na loja.");
        return;
      }
      final purchaseParam = PurchaseParam(productDetails: response.productDetails.first);
      await iap.buyNonConsumable(purchaseParam: purchaseParam);
    } catch (e) {
      _showError("Erro Google Play: $e");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Colors.red));
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) return const Center(child: CircularProgressIndicator());

    // Se estiver na Web, botão leva ao Asaas. Se for Mobile, leva ao Google Play.
    // Dica: Se quiser usar Asaas no Android também (para fugir da taxa do Google),
    // troque _handleMobileCheckout por _handleWebCheckout no onPressed abaixo.
    return Center(
      child: OutlinedButton(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 15),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
          side: const BorderSide(color: Colors.black45),
        ),
        onPressed: () {
          if (kIsWeb) {
            _handleWebCheckout();
          } else {
            _handleMobileCheckout();
          }
        },
        child: Text(
          kIsWeb ? 'Assinar com Pix' : 'Assinar Agora',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.black),
        ),
      ),
    );
  }
}