@TestOn('browser')
library;

import 'dart:async';
import 'dart:js_interop';
import 'package:flutter_test/flutter_test.dart';
import 'package:web/web.dart' as web;
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'support/checkout_intention_reader_cases.dart';

Future<void> _deleteTemporaryEvidence(String name, String key) {
  final done = Completer<void>();
  final request = web.window.indexedDB.open('f9_dc_c_c_b2_$name', 1);
  request.onerror = ((web.Event _) {
    done.completeError(StateError('Synthetic DB open failed'));
  }).toJS;
  request.onsuccess = ((web.Event _) {
    final db = request.result as web.IDBDatabase;
    final tx = db.transaction('attempts'.toJS, 'readwrite');
    tx.objectStore('attempts').delete(key.toJS);
    tx.oncomplete = ((web.Event _) {
      db.close();
      done.complete();
    }).toJS;
    tx.onabort = ((web.Event _) {
      db.close();
      done.completeError(StateError('Synthetic delete failed'));
    }).toJS;
  }).toJS;
  return done.future;
}

void main() {
  checkoutIntentionReaderCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_dc_c_c_b2_$name'),
    deleteTemporaryEvidence: _deleteTemporaryEvidence,
  );
}
