import 'dart:async';
import 'dart:js_interop';
import 'package:web/web.dart' as web;
import 'product_mutation_store.dart';

Future<ProductMutationStore> openStore() =>
    IndexedDbProductMutationStore.open();

class IndexedDbProductMutationStore implements ProductMutationStore {
  final web.IDBDatabase _db;
  IndexedDbProductMutationStore._(this._db);
  static Future<IndexedDbProductMutationStore> open({
    String name = 'store_connect_product_mutations_v1',
  }) {
    final done = Completer<IndexedDbProductMutationStore>();
    try {
      final request = web.window.indexedDB.open(name, 1);
      request.onupgradeneeded = ((web.Event event) {
        (request.result as web.IDBDatabase).createObjectStore('attempts');
      }).toJS;
      request.onsuccess = ((web.Event event) {
        if (!done.isCompleted) {
          done.complete(
            IndexedDbProductMutationStore._(request.result as web.IDBDatabase),
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
  @override
  Future<void> close() async => _db.close();
}
