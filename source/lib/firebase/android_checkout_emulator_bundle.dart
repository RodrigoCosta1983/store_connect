import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../data/local/sale_mutation_store_native.dart';
import '../services/android_checkout_cart.dart';
import 'android_checkout_emulator.dart';

/// Explicit Android demo composition. Never opens PendingSales or the commercial
/// sale_mutations database; the same isolated file survives app/session rebuilds.
final class AndroidCheckoutEmulatorBundle {
  final AndroidCheckoutEmulator origin;
  final SqliteSaleMutationStore _store;
  final AndroidCheckoutCart checkout;
  bool _closed = false;
  AndroidCheckoutEmulatorBundle._(this.origin, this._store, this.checkout);

  static Future<AndroidCheckoutEmulatorBundle> open() async {
    final origin = await AndroidCheckoutEmulator.open();
    try {
      final directory = await getApplicationSupportDirectory();
      await directory.create(recursive: true);
      final store = SqliteSaleMutationStore(
        '${directory.path}${Platform.pathSeparator}android_checkout04_demo.sqlite');
      return AndroidCheckoutEmulatorBundle._(origin, store,
        AndroidCheckoutCart(origin: origin, store: store));
    } catch (_) {
      await origin.close();
      rethrow;
    }
  }

  Future<String> authorizedStoreId() async => (await origin.authorize()).context.scope.storeId;

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    checkout.close();
    try {await origin.close();} finally {await _store.close();}
  }
}
