@TestOn('browser')
library;

import 'dart:convert';
import 'dart:js_interop';
import 'package:web/web.dart' as web;
import 'package:flutter_test/flutter_test.dart';
// ignore: depend_on_referenced_packages
import 'package:flutter_web_plugins/flutter_web_plugins.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_web/firebase_core_web.dart';
// ignore: depend_on_referenced_packages
import 'package:cloud_functions_web/cloud_functions_web.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'checkout_sdk_bundle_web_test.dart' show loadCachedSdk;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final registrar = Registrar();
  FirebaseCoreWeb.registerWith(registrar);
  FirebaseFunctionsWeb.registerWith(registrar);
  setUpAll(loadCachedSdk);
  test('R2 real Flutter Web explicit URL routing and lost response', () async {
    final app = await Firebase.initializeApp(
      name: 'r2-explicit-only',
      options: const FirebaseOptions(
        apiKey: 'demo-key-not-a-credential',
        appId: '1:123:web:synthetic',
        messagingSenderId: '123',
        projectId: 'demo-store-connect-checkout',
      ),
    );
    try {
      final functions = FirebaseFunctions.instanceFor(app: app, region: 'us-central1');
      functions.useFunctionsEmulator('127.0.0.1', 4471, automaticHostMapping: false);
      final fixed = functions.httpsCallableFromUrl('http://127.0.0.1:4471/diagnosticOnly');
      expect((await fixed.call({'probe': true})).data['port'], 4471);
      final recovered = FirebaseFunctions.instanceFor(app: Firebase.app(app.name), region: 'us-central1');
      expect(identical(recovered, functions), true);
      recovered.useFunctionsEmulator('127.0.0.1', 4472, automaticHostMapping: false);
      expect((await recovered.httpsCallable('diagnosticOnly').call({'probe': true})).data['port'], 4472);
      expect((await fixed.call({'probe': true})).data['port'], 4471);
      // Also create the explicit callable AFTER reconfiguration.
      expect((await recovered.httpsCallableFromUri(Uri.parse('http://127.0.0.1:4471/diagnosticOnly')).call({'probe': true})).data['port'], 4471);
      final lost = recovered.httpsCallableFromUrl('http://127.0.0.1:4471/lost',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 1)));
      await expectLater(lost.call({'probe': true}), throwsA(isA<FirebaseFunctionsException>().having((e) => e.code, 'code', 'deadline-exceeded')));
      final response = await web.window.fetch('http://127.0.0.1:4471/evidence'.toJS).toDart;
      final evidence = jsonDecode((await response.text().toDart).toDart) as List;
      expect(evidence.map((e) => e['port']).toList(), [4471, 4472, 4471, 4471, 4471]);
      expect(evidence.every((e) => e['credentialsAbsent'] == true && e['synthetic'] == true), true);
      // Test evidence only; responders retain no token values.
      // ignore: avoid_print
      print('R2 received traffic: ${jsonEncode(evidence)}');
    } finally {
      await app.delete();
    }
  });
}
