@TestOn('browser')
library;

import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:web/web.dart' as web;
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'support/checkout_associated_preparation_cases.dart';
import 'support/checkout_sale_preparation_cases.dart'
    show checkoutContext, checkoutDraft;

@JS('IDBObjectStore.prototype')
external JSObject get _storePrototype;

// Corrupt only the uniquely named synthetic test database, between transactions.
Future<void> _deleteTemporaryEvidence(String name, String key) {
  final done = Completer<void>();
  final request = web.window.indexedDB.open('f9_dc_c_a_$name', 1);
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
  checkoutAssociatedPreparationCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_dc_c_a_$name'),
    deleteTemporaryEvidence: _deleteTemporaryEvidence,
  );
  test(
    'IndexedDB quota fault at last put aborts candidate and binding in real transaction',
    () async {
      final store = await IndexedDbSaleMutationStore.open(
        name: 'f9_dc_c_a_quota_${SaleMutationCommand.newIdentity()}',
      );
      final original = _storePrototype.getProperty<JSFunction>('put'.toJS);
      _storePrototype.setProperty(
        'put'.toJS,
        ((JSObject receiver, JSAny? value, JSAny? key) {
          if ((key as JSString).toDart.contains('confirmSaleV2:')) {
            throw web.DOMException(
              'Synthetic last-put quota',
              'QuotaExceededError',
            );
          }
          return original.callAsFunction(receiver, value, key);
        }).toJSCaptureThis,
      );
      try {
        final prep = CheckoutSalePreparation(
          store: store,
          session: CheckoutSaleSession(checkoutContext()),
        );
        await expectLater(
          prep.persistAssociated(prep.newAssociatedPurchase(checkoutDraft())),
          throwsA(anything),
        );
        expect(await store.keys(''), isEmpty);
      } finally {
        _storePrototype.setProperty('put'.toJS, original);
        await store.close();
      }
    },
  );
}
