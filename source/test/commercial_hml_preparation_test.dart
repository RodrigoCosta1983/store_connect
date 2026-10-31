import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/app_environment.dart';
import 'package:store_connect/firebase/commercial_checkout_bundle.dart';

void main() {
  test('HML profiles select existing V2 and S03 paths without emulator or PROD defaults', () {
    Map<String, dynamic> profile(String name) => jsonDecode(
      File('config/f9-commercial-hml-$name.json').readAsStringSync()) as Map<String, dynamic>;
    expect(profile('checkout'), {'COMMERCIAL_CHECKOUT_V2': true, 'USE_FIREBASE_EMULATORS': false});
    expect(profile('offline'), {'COMMERCIAL_CHECKOUT_V2': false, 'USE_FIREBASE_EMULATORS': false});
    expect(File('lib/main_hml.dart').readAsStringSync(), contains('bootstrap(AppEnvironment.hml)'));
    expect(AppEnvironment.hml.projectId, 'store-connect-hml');
  });
  test('existing HML package collision is explicit; no alternate unregistered identifier is invented', () {
    final config = jsonDecode(File('android/app/src/hml/google-services.json').readAsStringSync()) as Map<String, dynamic>;
    expect(config['project_info']['project_id'], 'store-connect-hml');
    final client = (config['client'] as List).single as Map;
    expect(client['client_info']['mobilesdk_app_id'], AppEnvironment.hml.androidAppId);
    expect(client['client_info']['android_client_info']['package_name'], 'com.storeeconnect.app');
  });
  test('commercial PROD bundle remains blocked before any Firebase or SQLite access', () async {
    await expectLater(CommercialCheckoutBundle.open(AppEnvironment.production), throwsStateError);
  });
}
