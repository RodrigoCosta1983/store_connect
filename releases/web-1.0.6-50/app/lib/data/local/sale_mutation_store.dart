// Atomic compare-and-set prevents competing tabs/instances from replacing a
// frozen command. A successful future means the storage transaction committed.
abstract interface class SaleMutationStore {
  Future<String?> read(String key);
  Future<List<String>> keys(String prefix);
  Future<bool> compareAndSet(String key, String? expected, String value);
  Future<void> close();
}

/// Optional capability. Legacy stores are never adapted with sequential CAS.
abstract interface class AtomicSaleMutationStore implements SaleMutationStore {
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope);
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope, SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  );
}

AtomicSaleMutationStore requireAtomicSaleMutationStore(SaleMutationStore store) {
  if (store is! AtomicSaleMutationStore) {
    throw UnsupportedError('Atomic multikey sale storage is unavailable.');
  }
  return store;
}

/// Trusted caller supplies its authorized namespace, including the trailing
/// delimiter. This is a storage boundary, not Firebase authorization.
class SaleAtomicScope {
  final String namespace;
  final List<String> keys;
  SaleAtomicScope({required this.namespace, required Iterable<String> keys})
    : keys = List.unmodifiable(keys) {
    if (namespace.trim().isEmpty || !namespace.endsWith(':') ||
        namespace.contains('\u0000') || this.keys.isEmpty ||
        this.keys.toSet().length != this.keys.length ||
        this.keys.any((key) => !key.startsWith(namespace) ||
          key.length == namespace.length || key.contains('\u0000'))) {
      throw ArgumentError('Invalid atomic storage scope.');
    }
  }
  void validate<T>(SaleAtomicPlan<T> plan) {
    if (plan.writes.keys.any((key) => !keys.contains(key))) {
      throw ArgumentError('Atomic plan writes outside its declared scope.');
    }
  }
}

class SaleAtomicSnapshot {
  final Map<String, String?> values;
  SaleAtomicSnapshot(Map<String, String?> values)
    : values = Map.unmodifiable(values);
}

/// Pure, synchronous decision only: no network, await or reentrant store calls.
/// Empty writes commit a read/adoption/diagnostic result. No deletion primitive.
class SaleAtomicPlan<T> {
  final Map<String, String> writes;
  final T value;
  SaleAtomicPlan({required Map<String, String> writes, required this.value})
    : writes = Map.unmodifiable(writes);
}

/// Returned only after the storage transaction completed, never per-request.
class SaleAtomicCommit<T> {
  final SaleAtomicSnapshot before;
  final SaleAtomicSnapshot after;
  final int writesApplied;
  final T value;
  SaleAtomicCommit(SaleAtomicSnapshot snapshot, SaleAtomicPlan<T> plan)
    : before = snapshot,
      after = SaleAtomicSnapshot({...snapshot.values, ...plan.writes}),
      writesApplied = plan.writes.length,
      value = plan.value;
}
