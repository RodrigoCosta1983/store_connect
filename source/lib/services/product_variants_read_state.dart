import 'package:flutter/foundation.dart';
import 'product_mutation_command.dart';
import 'variant_authoritative_contract.dart';
import 'variant_intent_ledger.dart';
import 'variant_preview_state.dart';

enum ProductVariantsReadStatus {
  unavailable,
  loading,
  unverified,
  denied,
  error,
  unknown,
  identityConflict,
}

// Presentation of the existing B2 read boundary, never authentication. There is
// no operational adapter or complete-list contract yet. In particular, reading
// only a parent (or receiving unknown) cannot establish an empty variant list.
class ProductVariantsReadState extends ChangeNotifier {
  final VariantB2ReadTransport? transport;
  ProductVariantsReadStatus _status = ProductVariantsReadStatus.unavailable;
  VariantAuthoritativeResponse? _response;
  int _generation = 0;
  bool _disposed = false;
  ProductVariantsReadState({this.transport});

  ProductVariantsReadStatus get status => _status;
  VariantAuthoritativeResponse? get response => _response;
  bool get canSave => false;
  bool get hasProvenEmptyList => false;

  String get message => switch (_status) {
    ProductVariantsReadStatus.unavailable =>
      'As variantes gravadas não estão disponíveis para leitura: falta uma conexão autorizada.',
    ProductVariantsReadStatus.loading => 'Consultando a variante…',
    ProductVariantsReadStatus.unverified =>
      'Resposta recebida sem origem autenticada. Não confirma a lista de variantes nem permite salvar.',
    ProductVariantsReadStatus.denied =>
      'Acesso à leitura negado. Os dados digitados foram preservados.',
    ProductVariantsReadStatus.error =>
      'Erro na leitura das variantes. Os dados digitados foram preservados.',
    ProductVariantsReadStatus.unknown =>
      'Leitura inconclusiva. Não foi comprovada a ausência de variantes.',
    ProductVariantsReadStatus.identityConflict =>
      'A leitura não corresponde ao produto ou à sessão atual.',
  };

  void _set(ProductVariantsReadStatus status) {
    _status = status;
    _response = null;
    notifyListeners();
  }

  void invalidate() {
    if (_disposed) return;
    _generation++;
    _set(ProductVariantsReadStatus.unavailable);
  }

  // Optional port is exercised only by isolated local tests at present. The
  // operational form supplies neither a transport nor a fabricated access.
  Future<void> read({
    required VariantLocalAccess access,
    required VariantIdentity identity,
    required Future<VariantLocalAccess?> Function() currentAccess,
  }) async {
    if (_disposed) return;
    final generation = ++_generation;
    final scope = productCanonicalJson(access.scope);
    bool matches(VariantLocalAccess? current) =>
        current != null &&
        !current.revoked &&
        !access.revoked &&
        access.sessionToken.isNotEmpty &&
        current.sessionToken == access.sessionToken &&
        current.role == access.role &&
        {
          'admin',
          'gerente',
          'operador',
          'caixa',
          'vendedor',
        }.contains(current.role) &&
        productCanonicalJson(current.scope) == scope;
    bool active() => !_disposed && generation == _generation;
    if (transport == null) {
      _set(ProductVariantsReadStatus.unavailable);
      return;
    }
    _set(ProductVariantsReadStatus.loading);
    try {
      if (access.scope.length != 3 ||
          !access.scope.keys.toSet().containsAll({
            'projectId',
            'uid',
            'storeId',
          })) {
        throw const FormatException('Escopo incompleto.');
      }
      for (final value in access.scope.values) {
        VariantIdentity(value as String, identity.variantId);
      }
      final before = await currentAccess();
      if (!active()) return;
      if (!matches(before)) {
        _set(ProductVariantsReadStatus.denied);
        return;
      }
      final result = await transport!.readState(access, identity);
      if (!active()) return;
      final after = await currentAccess();
      if (!active()) return;
      if (!matches(after)) {
        _set(ProductVariantsReadStatus.denied);
        return;
      }
      switch (result.status) {
        case VariantReadStatus.available:
          if (productCanonicalJson(result.scope) != scope ||
              result.productId != identity.productId ||
              result.variantId != identity.variantId) {
            _set(ProductVariantsReadStatus.identityConflict);
            return;
          }
          // Keep the immutable DTO, including exact baselines and unknown data.
          // Both existing origins are untrusted; never populate editable drafts.
          _status = ProductVariantsReadStatus.unverified;
          _response = result;
          notifyListeners();
        case VariantReadStatus.accessDenied:
          _set(ProductVariantsReadStatus.denied);
        case VariantReadStatus.unknown:
          _set(ProductVariantsReadStatus.unknown);
        case VariantReadStatus.identityConflict:
          _set(ProductVariantsReadStatus.identityConflict);
        case VariantReadStatus.inconsistentState:
        case VariantReadStatus.confirmed:
          _set(ProductVariantsReadStatus.error);
      }
    } catch (_) {
      if (active()) _set(ProductVariantsReadStatus.error);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
