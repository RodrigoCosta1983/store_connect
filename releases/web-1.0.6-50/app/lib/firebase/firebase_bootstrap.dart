import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'app_environment.dart';
import 'firebase_options_hml.dart';
import 'firebase_options_prod.dart';

const nativeConfigurationChannel = MethodChannel(
  'store_connect/firebase_environment',
);

Future<void> initializeEnvironmentFirebase(AppEnvironment environment) async {
  if (!kIsWeb && defaultTargetPlatform != TargetPlatform.android) {
    throw UnsupportedError(
      'Firebase environment is configured only for Android and Web.',
    );
  }
  final options = environment == AppEnvironment.production
      ? (kIsWeb ? ProdFirebaseOptions.web : ProdFirebaseOptions.android)
      : (kIsWeb ? HmlFirebaseOptions.web : HmlFirebaseOptions.android);
  try {
    if (!kIsWeb) {
      environment.validateFlavor(appFlavor);
      final native = await nativeConfigurationChannel
          .invokeMapMethod<String, String>('read');
      environment.validateFlavor(native?['flavor']);
      environment.validateIdentity(
        projectId: native?['projectId'],
        appId: native?['appId'],
        web: false,
      );
    }
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(options: options);
    }
    environment.validateIdentity(
      projectId: Firebase.app().options.projectId,
      appId: Firebase.app().options.appId,
      web: kIsWeb,
    );
  } catch (_) {
    // Platform exception details and Firebase options must never be logged here.
    throw StateError('Firebase environment initialization rejected.');
  }
  AppConfiguration.configure(environment);
}
