import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';
import 'sale_mutation_store.dart';

Future<SaleMutationStore> openStore() async {
  final directory = await getApplicationSupportDirectory();
  await directory.create(recursive: true);
  return SqliteSaleMutationStore(
    '${directory.path}${Platform.pathSeparator}sale_mutations_v1.sqlite',
  );
}

// Separate database; never opens or migrates the PendingSales database.
class SqliteSaleMutationStore implements AtomicSaleMutationStore {
  final Database _db;
  bool _atomicActive = false;
  SqliteSaleMutationStore(String path) : _db = sqlite3.open(path) {
    _db.execute('PRAGMA journal_mode=WAL');
    _db.execute('PRAGMA synchronous=FULL');
    _db.execute('PRAGMA busy_timeout=5000');
    _db.execute(
      'CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    );
  }

  String? _read(String key) {
    final rows = _db.select('SELECT value FROM attempts WHERE key = ?', [key]);
    return rows.isEmpty ? null : rows.single['value'] as String;
  }

  @override
  Future<String?> read(String key) async => _read(key);
  @override
  Future<List<String>> keys(String prefix) async => _db
      .select('SELECT key FROM attempts')
      .map((row) => row['key'] as String)
      .where((key) => key.startsWith(prefix))
      .toList();
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) async {
    _db.execute('BEGIN IMMEDIATE');
    try {
      if (_read(key) != expected) {
        _db.execute('ROLLBACK');
        return false;
      }
      _db.execute(
        'INSERT INTO attempts(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      );
      _db.execute('COMMIT');
      return true;
    } catch (_) {
      _db.execute('ROLLBACK');
      rethrow;
    }
  }

  T _atomic<T>(SaleAtomicScope scope, bool write,
      T Function(SaleAtomicSnapshot) execute) {
    if (_atomicActive) throw StateError('Nested atomic storage transaction.');
    // BEGIN failure (including busy) must not roll back someone else's work.
    _db.execute(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
    _atomicActive = true;
    try {
      final snapshot = SaleAtomicSnapshot({
        for (final key in scope.keys) key: _read(key),
      });
      final result = execute(snapshot);
      _db.execute('COMMIT');
      return result;
    } catch (_) {
      // IO/full can already have rolled back. Preserve the original exception.
      try { _db.execute('ROLLBACK'); } catch (_) {}
      rethrow;
    } finally {
      _atomicActive = false;
    }
  }

  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) async =>
      _atomic(scope, false, (snapshot) => snapshot);

  @override
  Future<SaleAtomicCommit<T>> transact<T>(SaleAtomicScope scope,
      SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide) async =>
      _atomic(scope, true, (snapshot) {
        final plan = decide(snapshot);
        scope.validate(plan);
        for (final entry in plan.writes.entries) {
          _db.execute('''INSERT INTO attempts(key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value''',
            [entry.key, entry.value]);
        }
        return SaleAtomicCommit(snapshot, plan);
      });

  @override
  Future<void> close() async => _db.dispose();
}
