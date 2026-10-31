import 'dart:async';
import 'dart:js_interop';
import 'package:web/web.dart' as web;
import 'sale_mutation_store.dart';

Future<SaleMutationStore> openStore() => IndexedDbSaleMutationStore.open();

class IndexedDbSaleMutationStore implements AtomicSaleMutationStore {
  final web.IDBDatabase _db;
  bool _atomicDeciding = false;
  IndexedDbSaleMutationStore._(this._db);
  static Future<IndexedDbSaleMutationStore> open({
    String name = 'store_connect_sale_mutations_v1',
  }) {
    final done = Completer<IndexedDbSaleMutationStore>();
    try {
      final request = web.window.indexedDB.open(name, 1);
      request.onupgradeneeded = ((web.Event event) {
        (request.result as web.IDBDatabase).createObjectStore('attempts');
      }).toJS;
      request.onsuccess = ((web.Event event) {
        if (!done.isCompleted) {
          done.complete(
            IndexedDbSaleMutationStore._(request.result as web.IDBDatabase),
          );
        } else {
          (request.result as web.IDBDatabase).close();
        }
      }).toJS;
      request.onerror = ((web.Event event) {
        if (!done.isCompleted) {
          done.completeError(
            StateError('IndexedDB indisponível. Envio bloqueado.'),
          );
        }
      }).toJS;
      request.onblocked = ((web.Event event) {
        if (!done.isCompleted) {
          done.completeError(StateError('IndexedDB bloqueado por outra aba.'));
        }
      }).toJS;
    } catch (error, stack) {
      done.completeError(error, stack);
    }
    return done.future;
  }

  Future<T> _transaction<T>(
    String mode,
    void Function(web.IDBObjectStore, void Function(T)) start,
  ) {
    final done = Completer<T>();
    final tx = _db.transaction(
      'attempts'.toJS,
      mode,
      mode == 'readwrite'
          ? web.IDBTransactionOptions(durability: 'strict')
          : web.IDBTransactionOptions(),
    );
    T? result;
    var hasResult = false;
    tx.oncomplete = ((web.Event event) {
      if (!done.isCompleted) {
        if (hasResult) {
          done.complete(result as T);
        } else {
          done.completeError(StateError('Transação sem resultado.'));
        }
      }
    }).toJS;
    void fail(web.Event event) {
      if (!done.isCompleted) {
        done.completeError(StateError('Persistência IndexedDB falhou.'));
      }
    }

    tx.onabort = fail.toJS;
    tx.onerror = fail.toJS;
    try {
      start(tx.objectStore('attempts'), (value) {
        result = value;
        hasResult = true;
      });
    } catch (error, stack) {
      tx.abort();
      if (!done.isCompleted) done.completeError(error, stack);
    }
    return done.future;
  }

  @override
  Future<String?> read(String key) => _transaction('readonly', (store, set) {
    final request = store.get(key.toJS);
    request.onsuccess = ((web.Event event) {
      set((request.result as JSString?)?.toDart);
    }).toJS;
  });
  @override
  Future<List<String>> keys(String prefix) =>
      _transaction('readonly', (store, set) {
        final request = store.getAllKeys();
        request.onsuccess = ((web.Event event) {
          set(
            (request.result as JSArray<JSString>).toDart
                .map((key) => key.toDart)
                .where((key) => key.startsWith(prefix))
                .toList(),
          );
        }).toJS;
      });
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) =>
      _transaction('readwrite', (store, set) {
        final request = store.get(key.toJS);
        request.onsuccess = ((web.Event event) {
          final current = (request.result as JSString?)?.toDart;
          final matches = current == expected;
          if (matches) store.put(value.toJS, key.toJS);
          set(matches);
        }).toJS;
      });

  Future<T> _atomic<T>(SaleAtomicScope scope, String mode,
      T Function(SaleAtomicSnapshot, web.IDBObjectStore) execute) {
    if (_atomicDeciding) {
      return Future.error(StateError('Reentrant atomic storage decision.'));
    }
    final done = Completer<T>();
    final decisionZone = Zone.current;
    late web.IDBTransaction tx;
    try {
      tx = _db.transaction('attempts'.toJS, mode,
        mode == 'readwrite' ? web.IDBTransactionOptions(durability: 'strict')
          : web.IDBTransactionOptions());
    } catch (error, stack) {
      return Future.error(error, stack);
    }
    Object? failure;
    StackTrace? failureStack;
    T? result;
    var hasResult = false;
    void abort(Object error, StackTrace stack) {
      failure ??= error;
      failureStack ??= stack;
      try { tx.abort(); } catch (_) {}
      // Completion is deferred to onabort: no caller observes partial rollback.
    }
    tx.onabort = ((web.Event event) {
      if (!done.isCompleted) {
        done.completeError(failure ?? StateError('IndexedDB atomic transaction aborted.'),
          failureStack ?? StackTrace.current);
      }
    }).toJS;
    tx.onerror = ((web.Event event) {
      abort(StateError('IndexedDB atomic storage request failed.'), StackTrace.current);
    }).toJS;
    tx.oncomplete = ((web.Event event) {
      if (!done.isCompleted) {
        if (failure != null) {
          done.completeError(failure!, failureStack);
        } else if (hasResult) {
          done.complete(result as T);
        } else {
          done.completeError(StateError('Atomic storage completed without a result.'));
        }
      }
    }).toJS;
    try {
      final store = tx.objectStore('attempts');
      final values = <String, String?>{};
      var remaining = scope.keys.length;
      for (final key in scope.keys) {
        final request = store.get(key.toJS);
        request.onsuccess = ((web.Event event) {
          if (failure != null) return;
          try {
            values[key] = (request.result as JSString?)?.toDart;
            remaining--;
            if (remaining == 0) {
              _atomicDeciding = true;
              try {
                // All requests, the synchronous decision and puts belong to tx.
                result = decisionZone.run(() => execute(SaleAtomicSnapshot(values), store));
                hasResult = true;
              } finally {
                _atomicDeciding = false;
              }
            }
          } catch (error, stack) {
            abort(error, stack);
          }
        }).toJS;
      }
    } catch (error, stack) {
      abort(error, stack);
    }
    return done.future;
  }

  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) =>
      _atomic(scope, 'readonly', (snapshot, store) => snapshot);

  @override
  Future<SaleAtomicCommit<T>> transact<T>(SaleAtomicScope scope,
      SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide) =>
      _atomic(scope, 'readwrite', (snapshot, store) {
        final plan = decide(snapshot);
        scope.validate(plan);
        for (final entry in plan.writes.entries) {
          store.put(entry.value.toJS, entry.key.toJS);
        }
        return SaleAtomicCommit(snapshot, plan);
      });
  @override
  Future<void> close() async => _db.close();
}
