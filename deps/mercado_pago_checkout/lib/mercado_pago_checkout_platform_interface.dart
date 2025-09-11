import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'mercado_pago_checkout_method_channel.dart';

abstract class MercadoPagoCheckoutPlatform extends PlatformInterface {
  /// Constructs a MercadoPagoCheckoutPlatform.
  MercadoPagoCheckoutPlatform() : super(token: _token);

  static final Object _token = Object();

  static MercadoPagoCheckoutPlatform _instance = MethodChannelMercadoPagoCheckout();

  /// The default instance of [MercadoPagoCheckoutPlatform] to use.
  ///
  /// Defaults to [MethodChannelMercadoPagoCheckout].
  static MercadoPagoCheckoutPlatform get instance => _instance;
  
  /// Platform-specific implementations should set this with their own
  /// platform-specific class that extends [MercadoPagoCheckoutPlatform] when
  /// they register themselves.
  static set instance(MercadoPagoCheckoutPlatform instance) {
    PlatformInterface.verifyToken(instance, _token);
    _instance = instance;
  }

  Future<String?> getPlatformVersion() {
    throw UnimplementedError('platformVersion() has not been implemented.');
  }
}
