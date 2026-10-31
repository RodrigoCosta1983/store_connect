@TestOn('browser')
library;

// Real installed Web plugins, registered explicitly in this isolated runner.
// ignore_for_file: depend_on_referenced_packages

import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'package:web/web.dart' as web;
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_web_plugins/flutter_web_plugins.dart';
import 'package:firebase_core_web/firebase_core_web.dart';
import 'package:firebase_auth_web/firebase_auth_web.dart';
import 'package:cloud_firestore_web/cloud_firestore_web.dart';
import 'package:cloud_functions_web/cloud_functions_web.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:store_connect/firebase/checkout_sdk_manifest.dart';
import 'support/checkout_sdk_probe_bundle.dart';

Future<void> loadCachedSdk() async {
  final done = Completer<void>();
  final script = web.HTMLScriptElement()..type = 'module';
  // Local cached modules; no CDN download or version override.
  script.text = '''
    import * as core from 'http://127.0.0.1:4460/firebase-app.js';
    import * as auth from 'http://127.0.0.1:4460/firebase-auth.js';
    import * as firestore from 'http://127.0.0.1:4460/firebase-firestore-pipelines.js';
    import * as functions from 'http://127.0.0.1:4460/firebase-functions.js';
    window.firebase_core = core; window.firebase_auth = auth;
    window.firebase_firestore = firestore; window.firebase_functions = functions;
    window.dispatchEvent(new Event('checkout-sdk-ready'));
  ''';
  web.window.addEventListener(
    'checkout-sdk-ready',
    ((web.Event _) => done.complete()).toJS,
  );
  web.document.head!.append(script);
  await done.future.timeout(const Duration(seconds: 10));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final registrar = Registrar();
  FirebaseCoreWeb.registerWith(registrar);
  FirebaseAuthWeb.registerWith(registrar);
  FirebaseFirestoreWeb.registerWith(registrar);
  FirebaseFunctionsWeb.registerWith(registrar);
  setUpAll(loadCachedSdk);
  CheckoutSdkBundle? bundle;
  tearDown(() async {
    await bundle?.close();
    bundle = null;
  });
  Future<Map> fixture(String mode) async {
    final response = await web.window
        .fetch('http://127.0.0.1:4460/seed/$mode'.toJS)
        .toDart;
    expect(response.status, 200);
    return jsonDecode((await response.text().toDart).toDart) as Map;
  }

  Future<void> authenticate(String mode) async {
    final user = await fixture(mode);
    bundle = await CheckoutSdkBundle.open(CheckoutSdkManifest());
    await bundle!.signInFixture(
      user['email'] as String,
      user['password'] as String,
    );
  }

  test('real named SDK bundle stays unavailable while logged out', () async {
    bundle = await CheckoutSdkBundle.open(CheckoutSdkManifest());
    expect(Firebase.apps.single.name, startsWith('checkout-demo-b4b-'));
    expect(await bundle!.context.refresh(), false);
    expect(bundle!.context.capture(), isNull);
  });
  test('real Auth and server profile admit stable local binding', () async {
    await authenticate('valid');
    expect(
      await bundle!.context.refresh(expectedStoreId: 'fixture-shop'),
      true,
    );
    final binding = bundle!.context.capture();
    expect(binding, isNotNull);
    expect(binding!.context.scope.projectId, CheckoutSdkManifest.project);
    expect(await bundle!.context.refresh(), true);
    expect(identical(bundle!.context.capture(), binding), true);
    await bundle!.signOutFixture();
    expect(bundle!.context.capture(), isNull);
  });
  for (final mode in ['missing', 'invalid', 'revoked']) {
    test('real server $mode profile blocks binding', () async {
      await authenticate(mode);
      expect(await bundle!.context.refresh(), false);
      expect(bundle!.context.capture(), isNull);
    });
  }
  test(
    'divergent store expectation blocks without inferring another store',
    () async {
      await authenticate('valid');
      expect(await bundle!.context.refresh(expectedStoreId: 'other'), false);
    },
  );
  test(
    'extra app invalidates SDK provenance without adopting its Auth',
    () async {
      await authenticate('valid');
      expect(await bundle!.context.refresh(), true);
      final foreign = await Firebase.initializeApp(
        name: 'foreign-demo',
        options: const FirebaseOptions(
          apiKey: 'demo-key',
          appId: '1:123:web:other',
          messagingSenderId: '123',
          projectId: CheckoutSdkManifest.project,
        ),
      );
      expect(bundle!.context.capture(), isNull);
      await foreign.delete();
    },
  );
  test('externally reconfigured Functions must invalidate binding', () async {
    await authenticate('valid');
    expect(await bundle!.context.refresh(), true);
    final app = Firebase.apps.single;
    // No callable is invoked. This is the mandatory hidden-reconfiguration probe.
    FirebaseFunctions.instanceFor(
      app: app,
      region: 'us-central1',
    ).useFunctionsEmulator('127.0.0.1', 5002, automaticHostMapping: false);
    expect(
      bundle!.context.capture(),
      isNull,
      reason:
          'An immutable factory receipt cannot certify a mutable external SDK.',
    );
  });
  test('unsupported Auth tenant blocks current capture', () async {
    await authenticate('valid');
    expect(await bundle!.context.refresh(), true);
    FirebaseAuth.instanceFor(app: Firebase.apps.single).tenantId =
        'unsupported';
    expect(bundle!.context.capture(), isNull);
  });
}
