import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_coordinator_preparation_adapter.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'checkout_associated_preparation_cases.dart'
    show CheckoutAssociatedTestStore;
import 'checkout_coordinator_fakes.dart';
import 'checkout_sale_preparation_cases.dart' show checkoutContext;

class _CoordinatorResponseDelayStore extends CheckoutAssociatedTestStore {
  Completer<void>? responseGate;
  Completer<void>? committed;
  _CoordinatorResponseDelayStore(super.inner);
  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) async {
    final commit = await super.transact(scope, decide);
    final signal = committed;
    committed = null;
    signal?.complete();
    await responseGate?.future;
    return commit;
  }
}

// Control only the coordinator deadline, leaving real database I/O untouched.
// The test runner's own deadline still detects a hung database or callback.
class _CoordinatorDeadline implements Timer {
  final void Function() callback;
  bool _active = true;
  int _tick = 0;
  _CoordinatorDeadline(this.callback);
  @override
  bool get isActive => _active;
  @override
  int get tick => _tick;
  @override
  void cancel() => _active = false;
  void fire() {
    if (!_active) throw StateError('Deadline already completed');
    _active = false;
    _tick = 1;
    callback();
  }
}

void checkoutCoordinatorStoreCases(
  Future<AtomicSaleMutationStore> Function(String name) open,
) {
  late AtomicSaleMutationStore raw;
  late _CoordinatorResponseDelayStore store;
  late AssociatedCheckoutCoordinatorAdapter adapter;
  late CoordinatorHarness h;
  setUp(() async {
    raw = await open(SaleMutationCommand.newIdentity());
    store = _CoordinatorResponseDelayStore(raw);
    adapter = AssociatedCheckoutCoordinatorAdapter(store);
    h = CoordinatorHarness(adapter, adapter);
  });
  tearDown(() async {
    h.coordinator.dispose();
    await raw.close();
  });
  Future<Map<String, String>> records() async => {
    for (final key in await raw.keys('')) key: (await raw.read(key))!,
  };

  test(
    'coordinator delegates one atomic preparation; same action and resume keep ledger identity',
    () async {
      final action = CheckoutExplicitAction();
      final a = h.coordinator.newPurchase(action);
      final b = h.coordinator.newPurchase(action);
      final first = await a;
      final second = await b;
      expect(first.evidence!.requestId, second.evidence!.requestId);
      expect(await records(), hasLength(3));
      expect(store.plans, hasLength(1));
      expect(store.plans.single, hasLength(3));
      final before = await records();
      final loaded = await h.coordinator.resume(first.evidence!.reference);
      expect(loaded.evidence!.requestId, first.evidence!.requestId);
      expect(await records(), before);
      final record = saleObject(
        jsonDecode(
          before.values.singleWhere((v) => v.contains('"ledgerVersion":1')),
        ),
      );
      final hash = record.remove('recordHash');
      expect(hash, saleHash(record));
      expect(
        record['commandHash'],
        SaleMutationCommand.fromJson(
          saleObject(record['command']),
        ).integrityHash,
      );
      expect(record['prepared'], false);
      expect(record['attempts'], 0);
    },
  );

  test(
    'separate legitimate equal purchases have different canonical IDs',
    () async {
      final a = await h.coordinator.newPurchase(CheckoutExplicitAction());
      final b = await h.coordinator.newPurchase(CheckoutExplicitAction());
      expect(
        a.evidence!.reference.intentKey,
        isNot(b.evidence!.reference.intentKey),
      );
      expect(a.evidence!.requestId, isNot(b.evidence!.requestId));
      expect(await records(), hasLength(6));
    },
  );

  test(
    'failure before real transaction commit produces no partial records or automatic identity',
    () async {
      store.before = true;
      final action = CheckoutExplicitAction();
      await h.coordinator.newPurchase(action);
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.storageUnavailable,
      );
      final reference = h.coordinator.state.reference!;
      expect(await records(), isEmpty);
      store.before = false;
      await h.coordinator.newPurchase(action);
      expect(await records(), isEmpty);
      await h.coordinator.resume(reference);
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.integrityBlocked,
      );
      expect(await records(), isEmpty);
    },
  );

  test(
    'lost response after actual commit recovers exact original record without another ID',
    () async {
      store.after = true;
      final action = CheckoutExplicitAction();
      await h.coordinator.newPurchase(action);
      final reference = h.coordinator.state.reference!;
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.storageUnavailable,
      );
      final before = await records();
      expect(before, hasLength(3));
      store.after = false;
      final loaded = await h.coordinator.resume(reference);
      expect(loaded.status, CheckoutOperationStatus.completed);
      expect(
        loaded.evidence!.requestId,
        saleObject(
          jsonDecode(
            before.values.singleWhere((v) => v.contains('"ledgerVersion":1')),
          ),
        )['requestId'],
      );
      expect(await records(), before);
    },
  );

  test(
    'ABA after commit retains original data and prevents obsolete publication',
    () async {
      late dynamic reference;
      h.presentation.observing = (state) {
        if (state.phase == CheckoutCoordinatorPhase.preparing) {
          reference = state.reference;
        }
      };
      store.afterCommit = () {
        h.events.emit(
          CheckoutGenerationChange.user,
          () => h.context.binding = CheckoutContextBinding(
            checkoutContext(uid: 'b'),
            Object(),
          ),
        );
        h.events.emit(
          CheckoutGenerationChange.user,
          () => h.context.binding = CheckoutContextBinding(
            checkoutContext(),
            Object(),
          ),
        );
      };
      final result = await h.coordinator.newPurchase(CheckoutExplicitAction());
      expect(result.status, CheckoutOperationStatus.superseded);
      expect(h.coordinator.state.reference, isNull);
      final before = await records();
      expect(before, hasLength(3));
      store.afterCommit = null;
      h.coordinator.refreshContext();
      final loaded = await h.coordinator.resume(reference);
      expect(loaded.status, CheckoutOperationStatus.completed);
      expect(await records(), before);
    },
  );

  test(
    'real draft revision before transaction rejects callback with zero writes',
    () async {
      store.afterSnapshot = (_) async {
        h.events.emit(CheckoutGenerationChange.notes, () {
          h.draft.revision = Object();
          h.draft.value['notes'] = 'new';
        });
      };
      final result = await h.coordinator.newPurchase(CheckoutExplicitAction());
      expect(result.status, CheckoutOperationStatus.superseded);
      expect(await records(), isEmpty);
    },
  );

  test(
    'UNKNOWN stays unchanged with zero dispatch, preparation or state migration',
    () async {
      final prepared = await h.coordinator.newPurchase(
        CheckoutExplicitAction(),
      );
      final entry = (await records()).entries.singleWhere(
        (e) => e.key.contains('confirmSaleV2:'),
      );
      final value = saleObject(jsonDecode(entry.value))..remove('recordHash');
      value['state'] = 'unknown';
      value['prepared'] = true;
      await raw.compareAndSet(
        entry.key,
        entry.value,
        saleJson({...value, 'recordHash': saleHash(value)}),
      );
      final before = await records();
      final loaded = await h.coordinator.resume(prepared.evidence!.reference);
      expect(loaded.evidence!.condition, CheckoutLocalCondition.unknown);
      expect(await records(), before);
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.unknown);
    },
  );

  test(
    'conflict preserves canonical bytes and durably records candidate; evidence read has no repair',
    () async {
      final prepared = await h.coordinator.newPurchase(
        CheckoutExplicitAction(),
      );
      final before = await records();
      h.events.emit(CheckoutGenerationChange.notes, () {
        h.draft.revision = Object();
        h.draft.value['notes'] = 'different';
      });
      h.coordinator.refreshContext();
      await h.coordinator.review(
        CheckoutExplicitAction(),
        prepared.evidence!.reference,
      );
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.conflict);
      expect(h.coordinator.state.candidatePersisted, true);
      final candidateId = h.coordinator.state.candidateId!;
      final after = await records();
      expect(after, hasLength(4));
      for (final entry in before.entries) {
        expect(after[entry.key], entry.value);
      }
      await h.coordinator.readLocalEvidence(
        prepared.evidence!.reference,
        candidateId,
      );
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.integrityBlocked,
      );
      expect(await records(), after);
    },
  );

  test(
    'failure persisting conflict evidence never announces durable conflict',
    () async {
      final prepared = await h.coordinator.newPurchase(
        CheckoutExplicitAction(),
      );
      final before = await records();
      h.events.emit(CheckoutGenerationChange.notes, () {
        h.draft.revision = Object();
        h.draft.value['notes'] = 'different';
      });
      h.coordinator.refreshContext();
      store.before = true;
      await h.coordinator.review(
        CheckoutExplicitAction(),
        prepared.evidence!.reference,
      );
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.storageUnavailable,
      );
      expect(h.coordinator.state.candidatePersisted, false);
      expect(await records(), before);
    },
  );

  test(
    'timeout after commit is not cancellation; delayed response cannot publish or rewrite state',
    () async {
      h.coordinator.dispose();
      h = CoordinatorHarness(
        adapter,
        adapter,
        timeout: const Duration(milliseconds: 20),
      );
      final gate = Completer<void>();
      store.responseGate = gate;
      store.committed = Completer<void>();
      final deadlines = <_CoordinatorDeadline>[];
      final deadlineZone = Zone.current.fork(
        specification: ZoneSpecification(
          createTimer: (self, parent, zone, duration, callback) {
            if (duration != const Duration(milliseconds: 20)) {
              return parent.createTimer(zone, duration, callback);
            }
            final timer = _CoordinatorDeadline(zone.bindCallback(callback));
            deadlines.add(timer);
            return timer;
          },
        ),
      );
      final action = CheckoutExplicitAction();
      final pending = deadlineZone.run(() => h.coordinator.newPurchase(action));
      final committed = store.committed!.future;
      await committed;
      final before = await records();
      expect(before, hasLength(3));
      expect(deadlines, hasLength(1));
      expect(deadlines.single.isActive, true);
      deadlines.single.fire(); // Expire only AFTER the actual database COMMIT.
      expect((await pending).status, CheckoutOperationStatus.uncertain);
      final reference = h.coordinator.state.reference!;
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.unknown);
      expect(h.coordinator.canPrepareNewPurchase, false);
      expect(
        (await h.coordinator.newPurchase(action)).status,
        CheckoutOperationStatus.uncertain,
      );
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.blocked,
      );
      expect(store.plans, hasLength(1));
      final count = h.presentation.states.length;
      gate.complete();
      // One event turn drains the released response's microtasks, not a delay
      // chosen to make database I/O finish within a wall-clock window.
      await Future<void>(() {});
      expect(h.presentation.states.length, count);
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.unknown);
      expect(h.coordinator.canPrepareNewPurchase, false);
      store.responseGate = null;
      final loaded = await deadlineZone.run(
        () => h.coordinator.resume(reference),
      );
      expect(loaded.status, CheckoutOperationStatus.completed);
      expect(deadlines, hasLength(2));
      expect(deadlines.last.isActive, false); // Real resume cancels its deadline.
      expect(
        loaded.evidence!.requestId,
        saleObject(
          jsonDecode(
            before.values.singleWhere((v) => v.contains('"ledgerVersion":1')),
          ),
        )['requestId'],
      );
      expect(store.plans, hasLength(2));
      expect(store.plans.last, isEmpty); // Resume validates without writing.
      expect(await records(), before);
    },
  );
}
