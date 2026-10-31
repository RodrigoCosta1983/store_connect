import '../data/local/sale_mutation_store.dart';
import '../data/local/sale_mutation_store_factory.dart';
import '../services/android_checkout_cart.dart';
import 'app_environment.dart';
import 'commercial_checkout_origin.dart';

/// Opt-in HML composition. Production activation intentionally has no switch here.
final class CommercialCheckoutBundle {
  final CommercialCheckoutOrigin origin;
  final SaleMutationStore store;
  final AndroidCheckoutCart checkout;
  CommercialCheckoutBundle._(this.origin, this.store, this.checkout);
  static Future<CommercialCheckoutBundle> open(
    AppEnvironment environment,
  ) async {
    if (environment != AppEnvironment.hml) {
      throw StateError('Checkout PROD ainda nao admitido.');
    }
    final origin = await CommercialCheckoutOrigin.open(environment);
    try {
      final store = await openSaleMutationStore();
      return CommercialCheckoutBundle._(
        origin,
        store,
        AndroidCheckoutCart(origin: origin, store: store),
      );
    } catch (_) {
      await origin.close();
      rethrow;
    }
  }

  Future<void> close() async {
    checkout.close();
    try {
      await origin.close();
    } finally {
      await store.close();
    }
  }
}
