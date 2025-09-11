import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'mercado_pago_checkout_platform_interface.dart';

/// An implementation of [MercadoPagoCheckoutPlatform] that uses method channels.
class MethodChannelMercadoPagoCheckout extends MercadoPagoCheckoutPlatform {
  /// The method channel used to interact with the native platform.
  @visibleForTesting
  final methodChannel = const MethodChannel('mercado_pago_checkout');

  @override
  Future<String?> getPlatformVersion() async {
    final version = await methodChannel.invokeMethod<String>('getPlatformVersion');
    return version;
  }
}
