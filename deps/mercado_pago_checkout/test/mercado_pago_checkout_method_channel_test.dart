import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mercado_pago_checkout/mercado_pago_checkout_method_channel.dart';

void main() {
  MethodChannelMercadoPagoCheckout platform = MethodChannelMercadoPagoCheckout();
  const MethodChannel channel = MethodChannel('mercado_pago_checkout');

  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    channel.setMockMethodCallHandler((MethodCall methodCall) async {
      return '42';
    });
  });

  tearDown(() {
    channel.setMockMethodCallHandler(null);
  });

  test('getPlatformVersion', () async {
    expect(await platform.getPlatformVersion(), '42');
  });
}
