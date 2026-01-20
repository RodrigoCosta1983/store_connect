import 'package:cloud_functions/cloud_functions.dart';
import 'dart:html' as html;

class StripeCheckoutService {
  static Future<void> startCheckout() async {
    try {
      final callable =
      FirebaseFunctions.instance.httpsCallable('createCheckoutSession');

      print('🚀 Chamando createCheckoutSession...');
      final result = await callable.call();
      final sessionId = result.data['sessionId'];
      print('✅ Sessão Stripe criada: $sessionId');

      if (sessionId != null) {
        final checkoutUrl = 'https://checkout.stripe.com/c/pay/$sessionId';
        html.window.open(checkoutUrl, '_blank');
      } else {
        throw Exception('Session ID não retornado pelo servidor.');
      }
    } catch (e, st) {
      print('❌ Erro ao abrir Stripe Checkout: $e');
      print(st);
    }
  }
}
