import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/firebase_core_platform_interface.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/app_environment.dart';
import 'package:store_connect/services/google_sign_in_configuration.dart';
import 'package:store_connect/firebase/firebase_bootstrap.dart';
import 'package:store_connect/firebase/firebase_options_hml.dart';
import 'package:store_connect/firebase/firebase_options_prod.dart';
import 'package:store_connect/firebase_options.dart';
import 'package:store_connect/main.dart' as legacy;

class _FirebaseHost extends MockFirebaseApp {
  int initializes = 0;
  bool mismatch = false;
  @override
  Future<List<CoreInitializeResponse>> initializeCore() async => [];
  @override
  Future<CoreInitializeResponse> initializeApp(
    String appName,
    CoreFirebaseOptions options,
  ) async {
    initializes++;
    if (mismatch) options.projectId = 'unexpected-project';
    return CoreInitializeResponse(
      name: appName,
      options: options,
      pluginConstants: {},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('environment must be explicit; legacy paths never select PROD', () {
    for (final value in ['', 'prod', 'unknown', 'PRODUCTION']) {
      expect(() => AppEnvironment.parse(value), throwsStateError);
    }
    expect(() => AppConfiguration.environment, throwsStateError);
    expect(createGoogleSignIn, throwsStateError);
    expect(legacy.main, throwsStateError);
    expect(() => DefaultFirebaseOptions.currentPlatform, throwsStateError);
  });
  for (final environment in AppEnvironment.values) {
    test(
      '${environment.name} resolves official identities and rejects mismatches',
      () {
        final android = environment == AppEnvironment.production
            ? ProdFirebaseOptions.android
            : HmlFirebaseOptions.android;
        final web = environment == AppEnvironment.production
            ? ProdFirebaseOptions.web
            : HmlFirebaseOptions.web;
        expect(AppEnvironment.parse(environment.name), environment);
        environment.validateIdentity(
          projectId: android.projectId,
          appId: android.appId,
          web: false,
        );
        environment.validateIdentity(
          projectId: web.projectId,
          appId: web.appId,
          web: true,
        );
        environment.validateFlavor(environment.androidFlavor);
        for (final flavor in [
          null,
          '',
          'unknown',
          environment == AppEnvironment.production ? 'hml' : 'prod',
        ]) {
          expect(() => environment.validateFlavor(flavor), throwsStateError);
        }
        for (final isWeb in [false, true]) {
          expect(
            () => environment.validateIdentity(
              projectId: 'unexpected-project',
              appId: isWeb ? environment.webAppId : environment.androidAppId,
              web: isWeb,
            ),
            throwsStateError,
          );
          expect(
            () => environment.validateIdentity(
              projectId: environment.projectId,
              appId: 'unexpected-app',
              web: isWeb,
            ),
            throwsStateError,
          );
        }
      },
    );
    test('${environment.name} Android source set belongs to expected client', () {
      final config =
          jsonDecode(
                File(
                  'android/app/src/${environment.androidFlavor}/google-services.json',
                ).readAsStringSync(),
              )
              as Map<String, dynamic>;
      expect(config['project_info']['project_id'], environment.projectId);
      final expectedWebClient = environment == AppEnvironment.production
          ? '294766590074-s5uc0aaaege2em5vsg8j5mimih6at2i1.apps.googleusercontent.com'
          : '324469869942-u261si9hsdh11j8k0lt4a4lrm3csniav.apps.googleusercontent.com';
      expect(environment.googleSignInWebClientId, expectedWebClient);
      final oauth = (config['client'] as List).expand(
        (client) => client['oauth_client'] as List,
      );
      expect(
        oauth
            .where((client) => client['client_type'] == 3)
            .map((client) => client['client_id']),
        [expectedWebClient],
      );
      if (environment == AppEnvironment.hml) {
        final androidOauth = oauth.singleWhere(
          (client) => client['client_type'] == 1,
        );
        expect(
          androidOauth['client_id'],
          '324469869942-38aj1pk41qd85qbb1q0hu3ago87aai5p.apps.googleusercontent.com',
        );
        expect(
          androidOauth['android_info']['certificate_hash'],
          'b2bbebd975458ae3da9b1423ae92fe59c3713839',
        );
      }
      final clients = config['client'] as List;
      expect(clients, hasLength(1));
      expect(
        clients.single['client_info']['mobilesdk_app_id'],
        environment.androidAppId,
      );
      expect(
        clients.single['client_info']['android_client_info']['package_name'],
        'com.storeeconnect.app',
      );
    });
  }
  test(
    'public URLs separated; active Android identity is current; no root fallback',
    () {
      expect(AppEnvironment.production.projectId, 'store-connect-app');
      expect(AppEnvironment.hml.projectId, 'store-connect-hml');
      expect(
        AppEnvironment.production.publicBaseUrl,
        'https://app.storeconnect.com.br',
      );
      expect(
        AppEnvironment.hml.publicBaseUrl,
        'https://store-connect-hml.web.app',
      );
      expect(
        ProdFirebaseOptions.android.appId,
        '1:294766590074:android:f993b08bb3f300b2afe3c3',
      );
      expect(
        ProdFirebaseOptions.android.appId,
        isNot('1:294766590074:android:82c38b9f3a34123dafe3c3'),
      );
      expect(File('android/app/google-services.json').existsSync(), isFalse);
      expect(
        File('web/index.html').readAsStringSync(),
        isNot(contains('google-signin-client_id')),
      );
    },
  );

  group('Android bootstrap with native channel and Firebase mocked', () {
    late _FirebaseHost host;
    late Map<String, String> native;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    setUp(() {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      MethodChannelFirebase.appInstances.clear();
      MethodChannelFirebase.isCoreInitialized = false;
      host = _FirebaseHost();
      TestFirebaseCoreHostApi.setUp(host);
      native = {
        'flavor': 'hml',
        'projectId': AppEnvironment.hml.projectId,
        'appId': AppEnvironment.hml.androidAppId,
      };
      messenger.setMockMethodCallHandler(
        nativeConfigurationChannel,
        (_) async => native,
      );
    });
    tearDown(() {
      debugDefaultTargetPlatformOverride = null;
      messenger.setMockMethodCallHandler(nativeConfigurationChannel, null);
      MethodChannelFirebase.appInstances.clear();
      MethodChannelFirebase.isCoreInitialized = false;
      TestFirebaseCoreHostApi.setUp(null);
    });
    test('opposite entrypoint fails before Firebase initialization', () async {
      await expectLater(
        initializeEnvironmentFirebase(AppEnvironment.production),
        throwsStateError,
      );
      expect(host.initializes, 0);
    });
    test(
      'native flavor mismatch fails before Firebase initialization',
      () async {
        native['flavor'] = 'prod';
        await expectLater(
          initializeEnvironmentFirebase(AppEnvironment.hml),
          throwsStateError,
        );
        expect(host.initializes, 0);
      },
    );
    test(
      'native project mismatch fails before Firebase initialization',
      () async {
        native['projectId'] = 'store-connect-app';
        await expectLater(
          initializeEnvironmentFirebase(AppEnvironment.hml),
          throwsStateError,
        );
        expect(host.initializes, 0);
      },
    );
    test('native app mismatch fails before Firebase initialization', () async {
      native['appId'] = AppEnvironment.production.androidAppId;
      await expectLater(
        initializeEnvironmentFirebase(AppEnvironment.hml),
        throwsStateError,
      );
      expect(host.initializes, 0);
    });
    test('native channel failures are sanitized', () async {
      messenger.setMockMethodCallHandler(nativeConfigurationChannel, (_) async {
        throw PlatformException(code: 'failure', message: 'sensitive-fixture');
      });
      await expectLater(
        initializeEnvironmentFirebase(AppEnvironment.hml),
        throwsA(
          isA<StateError>().having(
            (error) => error.message,
            'sanitized',
            'Firebase environment initialization rejected.',
          ),
        ),
      );
      expect(host.initializes, 0);
    });
    test('post-initialize project mismatch is rejected', () async {
      host.mismatch = true;
      await expectLater(
        initializeEnvironmentFirebase(AppEnvironment.hml),
        throwsStateError,
      );
      expect(host.initializes, 1);
      expect(() => AppConfiguration.environment, throwsStateError);
    });
    test('unsupported iOS is explicitly rejected', () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      await expectLater(
        initializeEnvironmentFirebase(AppEnvironment.hml),
        throwsUnsupportedError,
      );
      expect(host.initializes, 0);
    });
    test(
      'matching native flavor and identity initialize the selected app',
      () async {
        await initializeEnvironmentFirebase(AppEnvironment.hml);
        expect(Firebase.app().options.projectId, 'store-connect-hml');
        expect(AppConfiguration.environment, AppEnvironment.hml);
        final googleSignIn = createGoogleSignIn();
        expect(googleSignIn.clientId, isNull);
        expect(googleSignIn.serverClientId, isNull);
        expect(host.initializes, 1);
        expect(
          () => AppConfiguration.configure(AppEnvironment.production),
          throwsStateError,
        );
      },
    );
  });
}
