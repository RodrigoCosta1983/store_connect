import 'dart:convert';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'product_mutation_command.dart';
import 'product_mutation_ledger.dart';

class ProductEditState {
  final String _encoded;
  ProductEditState._(this._encoded);
  factory ProductEditState.fromJson(dynamic raw) {
    final dto = requireObject(raw);
    if (dto['schemaVersion'] != 1 ||
        dto['productId'] is! String ||
        (dto['productId'] as String).isEmpty ||
        dto['storeId'] is! String ||
        dto['uid'] is! String ||
        dto['unavailable'] is! List ||
        (dto['unavailable'] as List).any((value) => value is! String)) {
      throw const FormatException('Estado de edição inválido.');
    }
    requireObject(dto['product']);
    requireProductToken(dto['expectedUpdateTime']);
    return ProductEditState._(productCanonicalJson(dto));
  }
  Map<String, dynamic> get _dto => requireObject(jsonDecode(_encoded));
  String get productId => _dto['productId'] as String;
  String get storeId => _dto['storeId'] as String;
  String get uid => _dto['uid'] as String;
  Map<String, dynamic> get product => requireObject(_dto['product']);
  Map<String, dynamic> get expectedUpdateTime =>
      requireProductToken(_dto['expectedUpdateTime']);
  List<String> get unavailable =>
      List<String>.from(_dto['unavailable'] as List);
}

// Not wired to any screen. Future UI integration must invoke the ledger, which
// supplies this transport with the already-persisted command.
class ProductMutationApi implements ProductMutationTransport {
  final FirebaseApp app;
  ProductMutationApi({required this.app});
  FirebaseAuth get _auth => FirebaseAuth.instanceFor(app: app);
  FirebaseFunctions get _functions => FirebaseFunctions.instanceFor(app: app);
  void _check(ProductMutationScope scope) {
    if (scope.projectId != app.options.projectId ||
        scope.uid != _auth.currentUser?.uid) {
      throw StateError('Tentativa pertence a outra conta/projeto.');
    }
  }

  Future<Map<String, dynamic>> _call(
    String name,
    Map<String, dynamic> data,
  ) async {
    final result = await _functions
        .httpsCallable(
          name,
          options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
        )
        .call(data);
    return requireObject(result.data);
  }

  Future<ProductEditState> getEditState(String productId) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Usuário não autenticado.');
    final state = ProductEditState.fromJson(
      await _call('getProductEditState', {'productId': productId}),
    );
    if (state.productId != productId ||
        state.uid != uid ||
        _auth.currentUser?.uid != uid) {
      throw StateError('Identidade mudou durante a leitura.');
    }
    return state;
  }

  void _commandScope(ProductMutationScope scope, Map<String, dynamic> command) {
    _check(scope);
    if (productCanonicalJson(command['scope']) !=
        productCanonicalJson(scope.toJson())) {
      throw StateError('Comando sem escopo persistido correspondente.');
    }
  }

  @override
  Future<Map<String, dynamic>> send(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) {
    _commandScope(scope, command);
    if (!productMutationOperations.contains(operation)) {
      throw StateError('Operação inválida.');
    }
    return _call(operation, command);
  }

  @override
  Future<Map<String, dynamic>> recover(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) {
    _commandScope(scope, command);
    return _call('getProductMutationResult', {
      'operation': operation,
      'command': command,
      'expectedStoreId': scope.storeId,
    });
  }
}
