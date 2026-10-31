// FlutterFire's official host-test APIs are transitive plugin dependencies.
// ignore_for_file: depend_on_referenced_packages
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_functions_platform_interface/src/pigeon/messages.pigeon.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/android_checkout_emulator.dart';

class _Core implements TestFirebaseCoreHostApi {
  @override
  Future<List<CoreInitializeResponse>> initializeCore() async => [];
  @override
  Future<CoreInitializeResponse> initializeApp(String name, CoreFirebaseOptions options) async =>
    CoreInitializeResponse(name: name, options: options, pluginConstants: {});
  @override
  Future<CoreFirebaseOptions> optionsFromResource() => throw StateError('No default app permitted');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('Android owner refuses non-Android host before initializing an SDK', () async {
    await expectLater(AndroidCheckoutEmulator.open(), throwsUnsupportedError);
  });
  test('real FlutterFire callable freezes demo URL/app/region despite later emulator reconfiguration', () async {
    TestFirebaseCoreHostApi.setUp(_Core());
    const options = FirebaseOptions(apiKey: 'synthetic-only', appId: 'synthetic-app',
      messagingSenderId: '123', projectId: AndroidCheckoutEmulator.project);
    final app = await Firebase.initializeApp(name: 'android04-channel-test', options: options);
    final functions = FirebaseFunctions.instanceFor(app: app, region: 'us-central1');
    final requests = <Map<Object?, Object?>>[];
    const channel = BasicMessageChannel<Object?>(
      'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
      CloudFunctionsHostApi.pigeonChannelCodec);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(channel, (message) async {
      requests.add(Map<Object?, Object?>.from((message as List).single as Map));
      return [{'status': 'not-recorded', 'saleId': 'synthetic-sale', 'definitive': false}];
    });
    final captures = {for (final endpoint in ['confirmSaleV2', 'getSaleMutationResultV1'])
      endpoint: functions.httpsCallableFromUrl(
        'http://127.0.0.1:5194/${AndroidCheckoutEmulator.project}/us-central1/$endpoint')};
    functions.useFunctionsEmulator('127.0.0.1', 5999, automaticHostMapping: false);
    for (final endpoint in captures.keys) {
      // Same construction used by the owned adapter. Tests the installed plugin,
      // not a stand-in callable or transport implementation.
      await captures[endpoint]!.call({'requestId': 'synthetic-sale'});
      final request = requests.last;
      expect(request['appName'], app.name);
      expect(request['region'], 'us-central1');
      expect(request['functionUri'], endsWith('/$endpoint'));
      expect(request['functionUri'], startsWith('http://127.0.0.1:5194/'));
      expect(request['origin'], isNull);
    }
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(channel, null);
  });
}
