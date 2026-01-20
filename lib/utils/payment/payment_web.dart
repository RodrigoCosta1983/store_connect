// lib/utils/payment/payment_web.dart

// 1. Importamos o pacote de anotações SEM apelido (as)
import 'package:js/js.dart';

// 2. (Opcional) Importamos o dart:js apenas se precisar de acesso de baixo nível
// ignore: avoid_web_libraries_in_flutter
import 'dart:js' as internal_js;

// --- Configuração da Interop JS ---

// Agora usamos @JS diretamente, sem prefixos
@JS('Stripe')
class Stripe {
  external Stripe(String publicKey);
  external void redirectToCheckout(CheckoutOptions options);
}

@JS()
@anonymous // Usamos @anonymous diretamente
class CheckoutOptions {
  external String get sessionId;
  external factory CheckoutOptions({String sessionId});
}
// --- Fim da Configuração JS ---

// A função que o botão chama
void redirectToCheckout(String sessionId, String publicKey) {
  try {
    // Inicializar o Stripe.js
    final stripe = Stripe(publicKey);

    // Redirecionar
    stripe.redirectToCheckout(CheckoutOptions(sessionId: sessionId));
  } catch (e) {
    print("Erro no redirecionamento Web: $e");
  }
}