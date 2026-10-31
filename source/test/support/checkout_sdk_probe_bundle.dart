import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'package:web/web.dart' as web;
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/firebase/checkout_sdk_manifest.dart';

part 'checkout_sdk_probe_context_port.dart';

/// DIAGNOSTIC PROTOTYPE ONLY: the mandatory external-reconfiguration test fails.
/// Not approved for production or B1/B2/B3 integration. Kept outside lib so that
/// the failed immutable-receipt assumption remains reproducible without shipping
/// an admitted context adapter. No callable/ledger API exists here.
class CheckoutSdkBundle {
  static int _sequence = 0;
  static CheckoutSdkBundle? _owner;
  final CheckoutSdkManifest manifest;
  final FirebaseApp _app;
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;
  final IndexedDbSaleMutationStore _store;
  final String _origin;
  bool _closed = false;
  Object _authGeneration = Object();
  StreamSubscription<User?>? _authEvents;
  late final CheckoutSdkContextPort context;
  CheckoutSdkBundle._(
    this.manifest,
    this._app,
    this._auth,
    this._firestore,
    this._functions,
    this._store,
    this._origin,
  ) {
    context = CheckoutSdkContextPort._(this);
    _authEvents = _auth.userChanges().listen(
      (_) => invalidate(),
      onError: (Object _) => invalidate(),
    );
  }

  static Future<CheckoutSdkBundle> open(CheckoutSdkManifest manifest) async {
    if (!kIsWeb ||
        _owner != null ||
        Firebase.apps.isNotEmpty ||
        web.window.location.hostname != 'localhost' &&
            web.window.location.hostname != '127.0.0.1') {
      throw StateError('Exclusive local demo harness required.');
    }
    await _probe(manifest);
    final app = await Firebase.initializeApp(
      name: 'checkout-demo-b4b-${++_sequence}',
      options: FirebaseOptions(
        apiKey: 'demo-key-not-a-credential',
        appId: CheckoutSdkManifest.appId,
        messagingSenderId: '1234567890',
        projectId: manifest.projectId,
      ),
    );
    try {
      final auth = FirebaseAuth.instanceFor(app: app);
      await auth.useAuthEmulator(
        manifest.auth.host,
        manifest.auth.port,
        automaticHostMapping: false,
      );
      final firestore = FirebaseFirestore.instanceFor(
        app: app,
        databaseId: manifest.databaseId,
      );
      firestore.useFirestoreEmulator(
        manifest.firestore.host,
        manifest.firestore.port,
        automaticHostMapping: false,
      );
      final functions = FirebaseFunctions.instanceFor(
        app: app,
        region: manifest.region,
      );
      functions.useFunctionsEmulator(
        manifest.functions.host,
        manifest.functions.port,
        automaticHostMapping: false,
      );
      await auth.authStateChanges().first;
      final store = await IndexedDbSaleMutationStore.open(
        name: CheckoutSdkManifest.storeName,
      );
      final bundle = CheckoutSdkBundle._(
        manifest,
        app,
        auth,
        firestore,
        functions,
        store,
        web.window.location.origin,
      );
      _owner = bundle;
      if (!bundle._coherent) {
        await bundle.close();
        throw StateError('SDK origin rejected.');
      }
      return bundle;
    } catch (_) {
      if (Firebase.apps.any((candidate) => candidate.name == app.name)) {
        await app.delete();
      }
      throw StateError('Demo SDK initialization failed closed.');
    }
  }

  static Future<void> _probe(CheckoutSdkManifest manifest) async {
    late web.Response response;
    try {
      response = await web.window
          .fetch(
            '${manifest.hub}/emulators'.toJS,
            web.RequestInit(redirect: 'error'),
          )
          .toDart
          .timeout(const Duration(seconds: 3));
    } catch (_) {
      throw StateError('Local emulator hub transport unavailable.');
    }
    if (response.status != 200) {
      throw StateError('Local emulator hub unavailable.');
    }
    final services = jsonDecode((await response.text().toDart).toDart) as Map;
    for (final service in {
      'auth': manifest.auth,
      'firestore': manifest.firestore,
      'functions': manifest.functions,
    }.entries) {
      final descriptor = services[service.key];
      if (descriptor is! Map ||
          descriptor['host'] != service.value.host ||
          descriptor['port'] != service.value.port) {
        throw StateError('Incomplete local emulator configuration.');
      }
      late web.Response probe;
      try {
        probe = await web.window
            .fetch(
              (service.key == 'functions'
                      ? 'http://127.0.0.1:4460/health/functions'
                      : '${service.value}/')
                  .toJS,
              web.RequestInit(redirect: 'error'),
            )
            .toDart
            .timeout(const Duration(seconds: 3));
      } catch (_) {
        throw StateError('Local ${service.key} transport unavailable.');
      }
      if (probe.redirected) throw StateError('Local endpoint redirected.');
    }
  }

  bool get _coherent =>
      !_closed &&
      identical(_owner, this) &&
      identical(_auth.app, _app) &&
      identical(_firestore.app, _app) &&
      identical(_functions.app, _app) &&
      _app.options.projectId == manifest.projectId &&
      _app.options.appId == CheckoutSdkManifest.appId &&
      _auth.tenantId == null &&
      _firestore.databaseId == '(default)' &&
      web.window.location.origin == _origin &&
      Firebase.apps.length == 1 &&
      Firebase.apps.single.name == _app.name &&
      Firebase.apps.single.options.projectId == manifest.projectId &&
      Firebase.apps.single.options.appId == CheckoutSdkManifest.appId;

  /// Minimal invalidation, not B4-C's lifecycle/event authority or fan-out.
  void invalidate() {
    _authGeneration = Object();
    context._binding = null;
  }

  Future<void> signInFixture(String email, String password) async {
    invalidate();
    if (!_coherent || !email.endsWith('@demo.invalid')) {
      throw StateError('Demo fixture only.');
    }
    await _auth.signInWithEmailAndPassword(email: email, password: password);
  }

  Future<void> signOutFixture() async {
    invalidate();
    await _auth.signOut();
  }

  Future<void> close() async {
    if (_closed) return;
    invalidate();
    _closed = true;
    await _authEvents?.cancel();
    await _store.close();
    await _app.delete();
    if (identical(_owner, this)) _owner = null;
  }
}
