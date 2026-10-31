import 'dart:convert';

import '../../services/sale_mutation_command.dart';
import 'sale_mutation_store.dart';

/// Local evidence only. Must be supplied from coherent SDK/session observations.
class SaleStoreContext {
  final SaleMutationScope scope;
  final String target;
  SaleStoreContext({required this.scope, required this.target}) {
    scope.toJson();
    final fields = saleObject(jsonDecode(target));
    saleKeys(fields, {'environment', 'firestoreEndpoint', 'functionsEndpoint'});
    if (saleJson(fields) != target ||
        fields.values.any((v) => v is! String || v.trim().isEmpty)) {
      throw ArgumentError('Invalid canonical local target.');
    }
  }
  String get targetPrefix =>
      'checkout-v1:${base64Url.encode(utf8.encode(target))}:';
  bool same(SaleStoreContext other) =>
      scope.prefix == other.scope.prefix && target == other.target;
}

/// Borrowed store, fixed target/scope and captured generation guard. Does not
/// open a database, resolve Firebase, close its owner, or perform commercial IO.
class ContextualAtomicSaleStore implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore _inner;
  final SaleStoreContext context;
  final void Function() checkCurrent;
  ContextualAtomicSaleStore({
    required SaleMutationStore store,
    required this.context,
    required this.checkCurrent,
  }) : _inner = requireAtomicSaleMutationStore(store);

  String _key(String key) {
    checkCurrent();
    if (!key.startsWith(context.scope.prefix) ||
        key.length == context.scope.prefix.length) {
      throw StateError('Key outside the associated sale context.');
    }
    return '${context.targetPrefix}$key';
  }

  SaleAtomicScope _scope(SaleAtomicScope scope) {
    checkCurrent();
    if (scope.namespace != context.scope.prefix) {
      throw StateError('Atomic namespace differs from the associated context.');
    }
    return SaleAtomicScope(
      namespace: '${context.targetPrefix}${scope.namespace}',
      keys: scope.keys.map(_key),
    );
  }

  SaleAtomicSnapshot _snapshot(SaleAtomicSnapshot physical) =>
      SaleAtomicSnapshot({
        for (final entry in physical.values.entries)
          entry.key.substring(context.targetPrefix.length): entry.value,
      });

  @override
  Future<String?> read(String key) async {
    final result = await _inner.read(_key(key));
    checkCurrent();
    return result;
  }

  @override
  Future<List<String>> keys(String prefix) async {
    checkCurrent();
    if (!prefix.startsWith(context.scope.prefix)) {
      throw StateError('Foreign sale scope.');
    }
    final result = await _inner.keys('${context.targetPrefix}$prefix');
    checkCurrent();
    return result
        .map((key) => key.substring(context.targetPrefix.length))
        .toList();
  }

  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    final result = await _inner.compareAndSet(_key(key), expected, value);
    checkCurrent();
    return result;
  }

  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) async {
    final result = await _inner.readSnapshot(_scope(scope));
    checkCurrent();
    return _snapshot(result);
  }

  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) async {
    SaleAtomicPlan<T>? logical;
    final result = await _inner.transact<T>(_scope(scope), (physical) {
      checkCurrent();
      final plan = decide(_snapshot(physical));
      scope.validate(plan);
      checkCurrent();
      logical = plan;
      return SaleAtomicPlan(
        writes: {
          for (final entry in plan.writes.entries) _key(entry.key): entry.value,
        },
        value: plan.value,
      );
    });
    checkCurrent();
    return SaleAtomicCommit(_snapshot(result.before), logical!);
  }

  @override
  Future<void> close() async =>
      throw StateError('Associated storage is borrowed.');
}
