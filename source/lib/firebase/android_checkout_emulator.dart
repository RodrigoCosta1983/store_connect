import 'dart:async';
import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import '../services/android_checkout_cart.dart';
import '../services/checkout_coordinator_ports.dart';
import '../services/checkout_sale_preparation.dart';
import '../services/sale_mutation_command.dart';

/// Owned secondary app, never adopts the commercial default app. Android USB
/// uses adb reverse; automatic 10.0.2.2 mapping is deliberately disabled.
final class AndroidCheckoutEmulator extends AndroidCheckoutOrigin {
  static int _sequence = 0;
  static const project = 'demo-store-connect-android04';
  final FirebaseApp _app;
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final Map<String, HttpsCallable> _calls;
  StreamSubscription<User?>? _authEvents;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _profileEvents;
  CheckoutContextBinding? _binding;
  Object _generation = Object();
  bool _closed = false;
  Future<void> _profileReady = Future<void>.value();
  AndroidCheckoutEmulator._(this._app, this._auth, this._firestore, this._calls);

  static Future<AndroidCheckoutEmulator> open() async {
    if (kIsWeb || !Platform.isAndroid) {
      throw UnsupportedError('Adaptador exclusivo Android/Emulator.');
    }
    final app = await Firebase.initializeApp(name: 'android-checkout04-${++_sequence}',
      options: const FirebaseOptions(apiKey: 'demo-android04-not-a-credential',
        appId: '1:1234567890:android:0000000000000000000000',
        messagingSenderId: '1234567890', projectId: project));
    try {
      final auth = FirebaseAuth.instanceFor(app: app);
      await auth.useAuthEmulator('127.0.0.1', 9194, automaticHostMapping: false);
      final firestore = FirebaseFirestore.instanceFor(app: app);
      firestore.settings = const Settings(persistenceEnabled: false);
      firestore.useFirestoreEmulator('127.0.0.1', 8194, automaticHostMapping: false);
      final functions = FirebaseFunctions.instanceFor(app: app, region: 'us-central1');
      // Capture immutable callable URLs synchronously on the new app, before any
      // handle leaves this owner. No named-call destination or default SDK.
      final calls = {for (final name in ['confirmSaleV2', 'getSaleMutationResultV1'])
        name: functions.httpsCallableFromUrl(
          'http://127.0.0.1:5194/$project/us-central1/$name',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 30)))};
      final owner = AndroidCheckoutEmulator._(app, auth, firestore, calls);
      owner._authEvents = auth.idTokenChanges().listen((user) {
        owner._invalidate();
        owner._profileEvents?.cancel();
        if (user != null) {
          final ready = Completer<void>();
          owner._profileReady = ready.future;
          owner._profileEvents = firestore.collection('users').doc(user.uid)
            .snapshots(includeMetadataChanges: true).listen((snapshot) {
              owner._invalidate();
              if (!snapshot.metadata.isFromCache && !ready.isCompleted) ready.complete();
            }, onError: (Object _) {
              owner._invalidate();
              if (!ready.isCompleted) ready.complete();
            });
        }
      }, onError: (Object _) => owner._invalidate());
      await auth.idTokenChanges().first;
      return owner;
    } catch (_) {
      await app.delete();
      rethrow;
    }
  }
  void _invalidate() {
    _generation = Object();
    _binding = null;
    notifyListeners();
  }
  bool get _coherent => !_closed && _app.options.projectId == project && _auth.tenantId == null &&
    _firestore.settings.host == '127.0.0.1:8194' && _firestore.settings.sslEnabled == false;

  /// Only Emulator credentials; no default Auth or externally supplied User.
  Future<void> signIn(String email, String password) async {
    if (!_coherent) throw StateError('Destino Android alterado.');
    _invalidate();
    await _auth.signInWithEmailAndPassword(email: email, password: password);
  }
  Future<void> signOut() async { _invalidate(); await _auth.signOut(); }

  @override
  CheckoutContextBinding? capture() => _binding != null && isCurrent(_binding!) ? _binding : null;
  @override
  bool isCurrent(CheckoutContextBinding binding) => _coherent && identical(binding, _binding) &&
    identical(binding.origin, _generation) && _auth.currentUser?.uid == binding.context.scope.uid;

  @override
  Future<CheckoutContextBinding> authorize() async {
    if (!_coherent || _auth.currentUser == null) throw StateError('Autenticacao Android indisponivel.');
    await _profileReady.timeout(const Duration(seconds: 10));
    if (!_coherent || _auth.currentUser == null) throw StateError('Sessao Android substituida.');
    final uid = _auth.currentUser!.uid;
    final generation = _generation;
    final profile = await _firestore.collection('users').doc(uid).get(const GetOptions(source: Source.server));
    if (!_coherent || !identical(generation, _generation) || _auth.currentUser?.uid != uid) {
      throw StateError('Sessao Android mudou durante autorizacao.');
    }
    final data = profile.data();
    final role = data?['role'];
    final accessStatus = data?['accessStatus'];
    if (!profile.exists || profile.metadata.isFromCache || data == null ||
        (accessStatus is String && accessStatus.trim().toLowerCase() == 'revoked') ||
        role is! String ||
        !['admin', 'gerente', 'operador', 'caixa', 'vendedor'].contains(role.trim().toLowerCase())) {
      throw StateError('Perfil Android nao autorizado.');
    }
    final context = CheckoutSaleContext(scope: SaleMutationScope(projectId: project, uid: uid,
      storeId: saleId(data['storeId'])), environment: 'android-emulator-auth9194',
      firestoreEndpoint: 'http://127.0.0.1:8194',
      functionsEndpoint: 'http://127.0.0.1:5194/$project/us-central1');
    final old = _binding;
    if (old != null && !old.context.same(context)) _invalidate();
    _binding ??= CheckoutContextBinding(context, _generation);
    return _binding!;
  }
  @override
  Future<Map<String, dynamic>> readStore() async {
    final binding = await authorize();
    final doc = await _firestore.collection('stores').doc(binding.context.scope.storeId)
      .get(const GetOptions(source: Source.server));
    if (!isCurrent(binding) || !doc.exists || doc.metadata.isFromCache) throw StateError('Loja indisponivel.');
    return Map<String, dynamic>.from(doc.data()!);
  }

  Future<Map<String, dynamic>> _call(String name, SaleMutationScope scope, Map<String, dynamic> raw) async {
    final captured = capture();
    if (captured == null || captured.context.scope.prefix != scope.prefix) throw StateError('Sessao de envio obsoleta.');
    final command = SaleMutationCommand.fromJson(raw);
    if (command.scope.prefix != scope.prefix) throw StateError('Comando de outra loja/conta.');
    final current = await authorize();
    if (!identical(current, captured) || !isCurrent(captured)) throw StateError('Autorizacao de envio substituida.');
    final response = await _calls[name]!.call(command.payload);
    if (!isCurrent(captured)) throw StateError('Resposta de sessao antiga.');
    return saleObject(response.data);
  }
  @override
  Future<Map<String, dynamic>> send(SaleMutationScope scope, Map<String, dynamic> command) => _call('confirmSaleV2', scope, command);
  @override
  Future<Map<String, dynamic>> recover(SaleMutationScope scope, Map<String, dynamic> command) => _call('getSaleMutationResultV1', scope, command);

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _invalidate();
    await _profileEvents?.cancel();
    await _authEvents?.cancel();
    await _firestore.terminate();
    await _app.delete();
    super.dispose();
  }
}
