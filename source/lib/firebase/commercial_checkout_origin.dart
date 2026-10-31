import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import '../services/android_checkout_cart.dart';
import 'app_environment.dart';
import '../services/checkout_coordinator_ports.dart';
import '../services/checkout_sale_preparation.dart';
import '../services/sale_mutation_command.dart';

/// Borrows the app authenticated by the commercial bootstrap. Never signs in,
/// deletes, terminates or reconfigures shared Firebase instances.
final class CommercialCheckoutOrigin extends AndroidCheckoutOrigin {
  final AppEnvironment environment;
  String get project => environment.projectId;
  @override
  bool get commercial => true;
  final FirebaseApp _app;
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final Map<String, HttpsCallable> _calls;
  StreamSubscription<User?>? _authEvents;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _profileEvents;
  CheckoutContextBinding? _binding;
  Object _generation = Object();
  Object _authWatch = Object();
  bool _closed = false;
  Future<void> _profileReady = Future<void>.value();
  CommercialCheckoutOrigin._(
    this.environment,
    this._app,
    this._auth,
    this._firestore,
    this._calls,
  );

  static Future<CommercialCheckoutOrigin> open(
    AppEnvironment environment,
  ) async {
    final app = Firebase.app();
    environment.validateIdentity(
      projectId: app.options.projectId,
      appId: app.options.appId,
      web: kIsWeb,
    );
    final auth = FirebaseAuth.instanceFor(app: app);
    final firestore = FirebaseFirestore.instanceFor(app: app);
    final functions = FirebaseFunctions.instanceFor(
      app: app,
      region: 'us-central1',
    );
    final calls = {
      for (final name in [
        'confirmCommercialSaleV2',
        'getCommercialSaleMutationResultV1',
      ])
        name: functions.httpsCallableFromUrl(
          'https://us-central1-${environment.projectId}.cloudfunctions.net/$name',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
        ),
    };
    final owner = CommercialCheckoutOrigin._(
      environment,
      app,
      auth,
      firestore,
      calls,
    );
    if (!owner._coherent) throw StateError('Destino comercial recusado.');
    final authReady = Completer<void>();
    owner._authEvents = auth.idTokenChanges().listen((user) {
      owner._invalidate();
      final watch = Object();
      owner._authWatch = watch;
      if (!authReady.isCompleted) authReady.complete();
      owner._profileEvents?.cancel();
      if (user != null) {
        final ready = Completer<void>();
        owner._profileReady = ready.future;
        owner._profileEvents = firestore
            .collection('users')
            .doc(user.uid)
            .snapshots(includeMetadataChanges: true)
            .listen(
              (snapshot) {
                if (owner._closed ||
                    !identical(watch, owner._authWatch) ||
                    owner._auth.currentUser?.uid != user.uid) {
                  return;
                }
                owner._invalidate();
                if (!snapshot.metadata.isFromCache && !ready.isCompleted) {
                  ready.complete();
                }
              },
              onError: (Object _) {
                if (owner._closed || !identical(watch, owner._authWatch)) {
                  return;
                }
                owner._invalidate();
                if (!ready.isCompleted) ready.complete();
              },
            );
      }
    }, onError: (Object _) => owner._invalidate());
    try {
      await authReady.future.timeout(const Duration(seconds: 10));
      return owner;
    } catch (_) {
      await owner.close();
      rethrow;
    }
  }

  void _invalidate() {
    _generation = Object();
    _binding = null;
    notifyListeners();
  }

  bool get _coherent =>
      !_closed &&
      _app.options.projectId == project &&
      _auth.tenantId == null &&
      _app.options.appId ==
          (kIsWeb ? environment.webAppId : environment.androidAppId) &&
      _firestore.settings.host == 'firestore.googleapis.com' &&
      _firestore.settings.sslEnabled != false;

  @override
  CheckoutContextBinding? capture() =>
      _binding != null && isCurrent(_binding!) ? _binding : null;
  @override
  bool isCurrent(CheckoutContextBinding binding) =>
      _coherent &&
      identical(binding, _binding) &&
      identical(binding.origin, _generation) &&
      _auth.currentUser?.uid == binding.context.scope.uid;

  @override
  Future<CheckoutContextBinding> authorize() async {
    if (!_coherent || _auth.currentUser == null) {
      throw StateError('Autenticacao comercial indisponivel.');
    }
    await _profileReady.timeout(const Duration(seconds: 10));
    if (!_coherent || _auth.currentUser == null) {
      throw StateError('Sessao comercial substituida.');
    }
    final uid = _auth.currentUser!.uid;
    final generation = _generation;
    final token = await _auth.currentUser!.getIdTokenResult();
    // Decoded claims are a local coherence check. The callable verifies the JWT.
    if (!identical(generation, _generation) ||
        _auth.currentUser?.uid != uid ||
        token.claims?['aud'] != project ||
        token.claims?['sub'] != uid ||
        token.claims?['iss'] != 'https://securetoken.google.com/$project' ||
        token.expirationTime == null ||
        !token.expirationTime!.isAfter(DateTime.now())) {
      throw StateError('Token de outro projeto, usuario ou sessao.');
    }
    final profile = await _firestore
        .collection('users')
        .doc(uid)
        .get(const GetOptions(source: Source.server));
    if (!_coherent ||
        !identical(generation, _generation) ||
        _auth.currentUser?.uid != uid) {
      throw StateError('Sessao comercial mudou durante autorizacao.');
    }
    final data = profile.data();
    final role = data?['role'];
    final accessStatus = data?['accessStatus'];
    if (!profile.exists ||
        profile.metadata.isFromCache ||
        data == null ||
        (accessStatus is String &&
            accessStatus.trim().toLowerCase() == 'revoked') ||
        role is! String ||
        ![
          'admin',
          'gerente',
          'operador',
          'caixa',
          'vendedor',
        ].contains(role.trim().toLowerCase())) {
      throw StateError('Perfil comercial nao autorizado.');
    }
    final context = CheckoutSaleContext(
      scope: SaleMutationScope(
        projectId: project,
        uid: uid,
        storeId: saleId(data['storeId']),
      ),
      environment: 'commercial-flutterfire',
      firestoreEndpoint: 'https://firestore.googleapis.com',
      functionsEndpoint: 'https://us-central1-$project.cloudfunctions.net',
    );
    final old = _binding;
    if (old != null && !old.context.same(context)) _invalidate();
    _binding ??= CheckoutContextBinding(context, _generation);
    return _binding!;
  }

  @override
  Future<Map<String, dynamic>> readStore() async {
    final binding = await authorize();
    final doc = await _firestore
        .collection('stores')
        .doc(binding.context.scope.storeId)
        .get(const GetOptions(source: Source.server));
    if (!isCurrent(binding) || !doc.exists || doc.metadata.isFromCache) {
      throw StateError('Loja indisponivel.');
    }
    return Map<String, dynamic>.from(doc.data()!);
  }

  Future<Map<String, dynamic>> _call(
    String name,
    SaleMutationScope scope,
    Map<String, dynamic> raw,
  ) async {
    final captured = capture();
    if (captured == null || captured.context.scope.prefix != scope.prefix) {
      throw StateError('Sessao de envio obsoleta.');
    }
    final command = SaleMutationCommand.fromJson(raw);
    if (command.scope.prefix != scope.prefix) {
      throw StateError('Comando de outra loja/conta.');
    }
    final current = await authorize();
    if (!identical(current, captured) || !isCurrent(captured)) {
      throw StateError('Autorizacao de envio substituida.');
    }
    final response = await _calls[name]!.call(command.payload);
    if (!isCurrent(captured)) throw StateError('Resposta de sessao antiga.');
    return saleObject(response.data);
  }

  @override
  Future<Map<String, dynamic>> send(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) => _call('confirmCommercialSaleV2', scope, command);
  @override
  Future<Map<String, dynamic>> recover(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) => _call('getCommercialSaleMutationResultV1', scope, command);

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _invalidate();
    await _profileEvents?.cancel();
    await _authEvents?.cancel();
    super.dispose();
  }
}
