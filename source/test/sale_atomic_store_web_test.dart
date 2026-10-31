@TestOn('browser')
library;

import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'package:flutter_test/flutter_test.dart';
import 'package:web/web.dart' as web;
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store_web.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'support/sale_atomic_store_cases.dart';

@JS('IDBObjectStore.prototype')
external JSObject get _storePrototype;

void main() {
  saleAtomicStoreCases(
    (name) => IndexedDbSaleMutationStore.open(name: 'f9_dc_a_$name'),
  );

  for (final quota in [false, true]) {
    test(
      quota
          ? 'IndexedDB simulated quota on last put aborts everything'
          : 'IndexedDB last request ConstraintError rolls back earlier successful puts',
      () async {
        final store = await IndexedDbSaleMutationStore.open(
          name: 'f9_dc_a_fault_${SaleMutationCommand.newIdentity()}',
        );
        final scope = SaleAtomicScope(
          namespace: 'fault:',
          keys: ['fault:a', 'fault:b', 'fault:c'],
        );
        await store.compareAndSet('fault:c', null, 'old');
        final original = _storePrototype.getProperty<JSFunction>('put'.toJS);
        _storePrototype.setProperty(
          'put'.toJS,
          ((JSObject receiver, JSAny? value, JSAny? key) {
            if ((key as JSString).toDart == 'fault:c') {
              if (quota) {
                throw web.DOMException(
                  'Synthetic storage quota',
                  'QuotaExceededError',
                );
              }
              return (receiver as web.IDBObjectStore).add(value, key);
            }
            return original.callAsFunction(receiver, value, key);
          }).toJSCaptureThis,
        );
        try {
          await expectLater(
            store.transact<void>(
              scope,
              (_) => SaleAtomicPlan(
                writes: {'fault:a': 'a', 'fault:b': 'b', 'fault:c': 'c'},
                value: null,
              ),
            ),
            throwsA(anything),
          );
        } finally {
          _storePrototype.setProperty('put'.toJS, original);
        }
        try {
          expect((await store.readSnapshot(scope)).values, {
            'fault:a': null,
            'fault:b': null,
            'fault:c': 'old',
          });
          expect(await store.compareAndSet('fault:a', null, 'usable'), isTrue);
        } finally {
          await store.close();
        }
      },
    );
  }

  test(
    'IndexedDB returns only after transaction complete, never put success',
    () async {
      final store = await IndexedDbSaleMutationStore.open(
        name: 'f9_dc_a_complete_${SaleMutationCommand.newIdentity()}',
      );
      final scope = SaleAtomicScope(
        namespace: 'complete:',
        keys: ['complete:a', 'complete:b', 'complete:c'],
      );
      final original = _storePrototype.getProperty<JSFunction>('put'.toJS);
      var returned = false;
      var successes = 0;
      var premature = false;
      _storePrototype.setProperty(
        'put'.toJS,
        ((JSObject receiver, JSAny? value, JSAny? key) {
          final request =
              original.callAsFunction(receiver, value, key) as web.IDBRequest;
          request.addEventListener(
            'success',
            ((web.Event event) {
              premature = premature || returned;
              successes++;
            }).toJS,
          );
          return request;
        }).toJSCaptureThis,
      );
      try {
        await store.transact<void>(
          scope,
          (_) => SaleAtomicPlan(
            writes: {for (final key in scope.keys) key: 'value'},
            value: null,
          ),
        );
        returned = true;
        expect(successes, 3);
        expect(premature, isFalse);
      } finally {
        _storePrototype.setProperty('put'.toJS, original);
        await store.close();
      }
    },
  );

  test(
    'closing IndexedDB lets the already active transaction finish atomically',
    () async {
      final name = 'f9_dc_a_closing_${SaleMutationCommand.newIdentity()}';
      final store = await IndexedDbSaleMutationStore.open(name: name);
      final scope = SaleAtomicScope(
        namespace: 'closing:',
        keys: ['closing:a', 'closing:b', 'closing:c'],
      );
      final pending = store.transact<void>(
        scope,
        (_) => SaleAtomicPlan(
          writes: {for (final key in scope.keys) key: 'committed'},
          value: null,
        ),
      );
      await store.close();
      final committed = await pending;
      final reopened = await IndexedDbSaleMutationStore.open(name: name);
      try {
        expect(
          (await reopened.readSnapshot(scope)).values,
          committed.after.values,
        );
        expect(committed.after.values.values, everyElement('committed'));
      } finally {
        await reopened.close();
      }
    },
  );

  test(
    'closed IndexedDB connection fails both atomic APIs without fallback',
    () async {
      final store = await IndexedDbSaleMutationStore.open(
        name: 'f9_dc_a_closed_${SaleMutationCommand.newIdentity()}',
      );
      final scope = SaleAtomicScope(namespace: 'closed:', keys: ['closed:a']);
      await store.close();
      await expectLater(store.readSnapshot(scope), throwsA(anything));
      await expectLater(
        store.transact<void>(
          scope,
          (_) => SaleAtomicPlan(writes: {'closed:a': 'no'}, value: null),
        ),
        throwsA(anything),
      );
    },
  );
}
