// Atomic compare-and-set prevents competing tabs/instances from replacing a
// frozen command. A successful future means the storage transaction committed.
abstract interface class ProductMutationStore {
  Future<String?> read(String key);
  Future<List<String>> keys(String prefix);
  Future<bool> compareAndSet(String key, String? expected, String value);
  Future<void> close();
}
