import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'support/sale_ledger_cases.dart';

// Test double only; production factory never uses this storage.
class MemorySaleStore implements SaleMutationStore {
  final Map<String, String> data;
  bool closed = false;
  MemorySaleStore(this.data);
  void check() {
    if (closed) throw StateError('closed');
  }

  @override
  Future<String?> read(String key) async {
    check();
    return data[key];
  }

  @override
  Future<List<String>> keys(String prefix) async {
    check();
    return data.keys.where((k) => k.startsWith(prefix)).toList();
  }

  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    check();
    if (data[key] != expected) return false;
    data[key] = value;
    return true;
  }

  @override
  Future<void> close() async {
    closed = true;
  }
}

void main() {
  final databases = <String, Map<String, String>>{};
  saleLedgerCases(
    (name) async => MemorySaleStore(databases.putIfAbsent(name, () => {})),
  );
}
