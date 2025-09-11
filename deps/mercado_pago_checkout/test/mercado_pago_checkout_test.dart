import 'package:flutter_test/flutter_test.dart';
import 'package:mercado_pago_checkout/mercado_pago_checkout.dart';
import 'package:mercado_pago_checkout/mercado_pago_checkout_platform_interface.dart';
import 'package:mercado_pago_checkout/mercado_pago_checkout_method_channel.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

class MockMercadoPagoCheckoutPlatform 
    with MockPlatformInterfaceMixin
    implements MercadoPagoCheckoutPlatform {

  @override
  Future<String?> getPlatformVersion() => Future.value('42');
}

void main() {
  final MercadoPagoCheckoutPlatform initialPlatform = MercadoPagoCheckoutPlatform.instance;

  test('$MethodChannelMercadoPagoCheckout is the default instance', () {
    expect(initialPlatform, isInstanceOf<MethodChannelMercadoPagoCheckout>());
  });

  test('getPlatformVersion', () async {
    MercadoPagoCheckout mercadoPagoCheckoutPlugin = MercadoPagoCheckout();
    MockMercadoPagoCheckoutPlatform fakePlatform = MockMercadoPagoCheckoutPlatform();
    MercadoPagoCheckoutPlatform.instance = fakePlatform;
  
    expect(await mercadoPagoCheckoutPlugin.getPlatformVersion(), '42');
  });
}
