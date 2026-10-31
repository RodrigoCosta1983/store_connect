part of 'checkout_sdk_probe_bundle.dart';

/// Bounded server observation. No UI events, lifecycle fan-out or commercial IO.
class CheckoutSdkContextPort implements CheckoutContextPort {
  final CheckoutSdkBundle _bundle;
  CheckoutContextBinding? _binding;
  String? _uid;
  Object? _generation;
  int _request = 0;
  CheckoutSdkContextPort._(this._bundle);
  @override
  CheckoutContextBinding? capture() =>
      _binding != null &&
          _bundle._coherent &&
          identical(_generation, _bundle._authGeneration) &&
          _uid == _bundle._auth.currentUser?.uid
      ? _binding
      : null;
  @override
  bool isCurrent(CheckoutContextBinding binding) =>
      identical(capture(), binding);

  Future<bool> refresh({String? expectedStoreId}) async {
    final request = ++_request;
    final previous = capture();
    _binding = null;
    final generation = _bundle._authGeneration;
    final uid = _bundle._auth.currentUser?.uid;
    bool current() =>
        request == _request &&
        _bundle._coherent &&
        identical(generation, _bundle._authGeneration) &&
        uid != null &&
        uid == _bundle._auth.currentUser?.uid;
    try {
      if (!current()) return false;
      await CheckoutSdkBundle._probe(_bundle.manifest);
      if (!current()) return false;
      await _bundle._store.keys('checkout-sdk-health:');
      if (!current()) return false;
      final profile = await _bundle._firestore
          .collection('users')
          .doc(uid)
          .get(const GetOptions(source: Source.server));
      if (!current() ||
          !profile.exists ||
          profile.metadata.isFromCache ||
          profile.metadata.hasPendingWrites) {
        return false;
      }
      final data = profile.data()!;
      final store = data['storeId'];
      final role = data['role'];
      if (store is! String ||
          store.trim().isEmpty ||
          store.contains('/') ||
          role is! String ||
          ![
            'admin',
            'gerente',
            'operador',
            'caixa',
            'vendedor',
          ].contains(role.trim().toLowerCase()) ||
          data['accessStatus']?.toString().trim().toLowerCase() == 'revoked' ||
          expectedStoreId != null && expectedStoreId != store) {
        return false;
      }
      final shop = await _bundle._firestore
          .collection('stores')
          .doc(store)
          .get(const GetOptions(source: Source.server));
      if (!current() ||
          !shop.exists ||
          shop.metadata.isFromCache ||
          shop.metadata.hasPendingWrites) {
        return false;
      }
      _uid = uid;
      _generation = generation;
      final context = CheckoutSaleContext(
        scope: SaleMutationScope(
          projectId: _bundle.manifest.projectId,
          uid: uid!,
          storeId: store,
        ),
        environment: 'demo',
        firestoreEndpoint: _bundle.manifest.firestore.toString(),
        functionsEndpoint:
            '${_bundle.manifest.functions}/${_bundle.manifest.region}',
      );
      _binding = previous != null && previous.context.same(context)
          ? previous
          : CheckoutContextBinding(context, _bundle);
      return true;
    } catch (_) {
      return false;
    }
  }
}
