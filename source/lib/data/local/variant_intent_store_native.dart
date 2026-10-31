import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';
import 'variant_intent_store.dart';

Future<VariantIntentStore> openStore() async {
  final directory = await getApplicationSupportDirectory();
  await directory.create(recursive: true);
  return SqliteVariantIntentStore(
    '${directory.path}${Platform.pathSeparator}variant_intents_v1.sqlite',
  );
}

// Separate database; never opens or migrates F9 databases.
class SqliteVariantIntentStore implements VariantIntentStore {
  final Database _db;
  SqliteVariantIntentStore(String path) : _db = sqlite3.open(path) {
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

  @override
  Future<void> close() async => _db.dispose();
}
