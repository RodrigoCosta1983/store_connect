import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'support/checkout_coordinator_fakes.dart';
import 'support/checkout_sale_preparation_cases.dart' show checkoutContext;

void main() {
  late CoordinatorPreparationFake port;
  late CoordinatorHarness h;
  setUp(() {
    port = CoordinatorPreparationFake();
    h = CoordinatorHarness(port, port);
  });
  tearDown(() => h.coordinator.dispose());

  test(
    'unavailable context blocks new action, valid binding explicitly enables local readiness',
    () async {
      h.events.emit(
        CheckoutGenerationChange.user,
        () => h.context.binding = null,
      );
      h.coordinator.refreshContext();
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.contextUnavailable,
      );
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.blocked,
      );
      expect(port.creates, 0);
      h.context.binding = CheckoutContextBinding(checkoutContext(), Object());
      h.coordinator.refreshContext();
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.ready);
    },
  );

  test(
    'explicit action prepares once, freezes nested draft before await; never rereads input',
    () async {
      final gate = Completer<CheckoutLocalEvidence>();
      late CheckoutPreparationProposal candidate;
      port.persisting = (p) {
        candidate = p;
        return gate.future;
      };
      final action = CheckoutExplicitAction();
      final pending = h.coordinator.newPurchase(action);
      h.draft.value['items'][0]['quantity'] = 999;
      expect(port.frozen!['items'][0]['quantity'], 1);
      expect(h.draft.captures, 1);
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.preparing);
      final again = h.coordinator.newPurchase(action);
      expect(identical(again, pending), true);
      gate.complete(
        CheckoutLocalEvidence(
          candidate.reference,
          CheckoutLocalCondition.prepared,
          requestId: 'original',
        ),
      );
      expect((await pending).status, CheckoutOperationStatus.completed);
      await again;
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.prepared);
      expect(port.creates, 1);
      expect(port.persists, 1);
      await h.coordinator.newPurchase(action);
      expect(port.creates, 1);
      expect(port.resumes + port.reads, 0);
    },
  );

  test(
    'equal legitimate purchases use separate action tokens and references',
    () async {
      final a = await h.coordinator.newPurchase(CheckoutExplicitAction());
      final b = await h.coordinator.newPurchase(CheckoutExplicitAction());
      expect(
        a.evidence!.reference.intentKey,
        isNot(b.evidence!.reference.intentKey),
      );
      expect(port.creates, 2);
    },
  );

  test(
    'resume known reference never calls creation; repeated in-flight load coalesces',
    () async {
      final ref = CheckoutSaleReference(
        context: checkoutContext(),
        intentKey: 'durable',
      );
      final gate = Completer<CheckoutLocalEvidence>();
      port.resuming = (_) => gate.future;
      final pending = h.coordinator.resume(ref);
      final again = h.coordinator.resume(ref);
      expect(identical(pending, again), true);
      gate.complete(
        CheckoutLocalEvidence(
          ref,
          CheckoutLocalCondition.recoverable,
          requestId: 'original',
        ),
      );
      expect((await pending).evidence!.requestId, 'original');
      expect(port.creates, 0);
      expect(port.resumes, 1);
    },
  );

  for (final reason in CheckoutGenerationChange.values) {
    test(
      '$reason invalidates before mutation/publication and suppresses old preparation callback',
      () async {
        final gate = Completer<CheckoutLocalEvidence>();
        late CheckoutPreparationProposal p;
        port.persisting = (proposal) {
          p = proposal;
          return gate.future;
        };
        final pending = h.coordinator.newPurchase(CheckoutExplicitAction());
        final previousInvalidations = port.invalidations;
        h.events.emit(reason, () {
          expect(
            h.coordinator.state.phase,
            CheckoutCoordinatorPhase.contextReplaced,
          );
          expect(port.invalidations, greaterThan(previousInvalidations));
          h.draft.revision = Object();
        });
        final count = h.presentation.states.length;
        gate.complete(
          CheckoutLocalEvidence(
            p.reference,
            CheckoutLocalCondition.prepared,
            requestId: 'old',
          ),
        );
        expect((await pending).status, CheckoutOperationStatus.superseded);
        expect(h.presentation.states.length, count);
        expect(h.coordinator.state.reference, isNull);
      },
    );
  }

  for (final boundary in ['persist', 'resume', 'evidence']) {
    test(
      'ABA at $boundary rejects callback even when original binding object returns',
      () async {
        final gate = Completer<CheckoutLocalEvidence>();
        final original = h.context.binding!;
        final ref = CheckoutSaleReference(
          context: original.context,
          intentKey: 'known',
        );
        late CheckoutSaleReference expected;
        late Future<CheckoutOperationOutcome> pending;
        if (boundary == 'persist') {
          port.persisting = (p) {
            expected = p.reference;
            return gate.future;
          };
          pending = h.coordinator.newPurchase(CheckoutExplicitAction());
        } else if (boundary == 'resume') {
          expected = ref;
          port.resuming = (_) => gate.future;
          pending = h.coordinator.resume(ref);
        } else {
          expected = ref;
          port.reading = (_, _) => gate.future;
          pending = h.coordinator.readLocalEvidence(ref, 'candidate');
        }
        h.events.emit(
          CheckoutGenerationChange.user,
          () => h.context.binding = CheckoutContextBinding(
            checkoutContext(uid: 'b'),
            Object(),
          ),
        );
        h.events.emit(
          CheckoutGenerationChange.user,
          () => h.context.binding = original,
        );
        h.coordinator.refreshContext();
        final count = h.presentation.states.length;
        gate.complete(
          CheckoutLocalEvidence(
            expected,
            CheckoutLocalCondition.recoverable,
            requestId: 'old',
          ),
        );
        expect((await pending).status, CheckoutOperationStatus.superseded);
        expect(h.presentation.states.length, count);
        expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.ready);
      },
    );
  }

  for (final other in [
    checkoutContext(uid: 'b'),
    checkoutContext(store: 'b'),
    checkoutContext(project: 'other'),
    checkoutContext(endpoint: 'other:8080'),
  ]) {
    test(
      'foreign ${other.scope.prefix}/${other.target} reference never reaches port',
      () async {
        final foreign = CheckoutSaleReference(
          context: other,
          intentKey: 'foreign',
        );
        expect(
          (await h.coordinator.resume(foreign)).status,
          CheckoutOperationStatus.blocked,
        );
        expect(port.resumes, 0);
        expect(port.creates, 0);
      },
    );
  }

  test(
    'timeout keeps physical operation busy; late commit response never publishes prepared',
    () async {
      h.coordinator.dispose();
      h = CoordinatorHarness(
        port,
        port,
        timeout: const Duration(milliseconds: 15),
      );
      final gate = Completer<CheckoutLocalEvidence>();
      late CheckoutPreparationProposal p;
      port.persisting = (proposal) {
        p = proposal;
        return gate.future;
      };
      final action = CheckoutExplicitAction();
      final pending = h.coordinator.newPurchase(action);
      expect((await pending).status, CheckoutOperationStatus.uncertain);
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.unknown);
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.blocked,
      );
      final count = h.presentation.states.length;
      gate.complete(
        CheckoutLocalEvidence(
          p.reference,
          CheckoutLocalCondition.prepared,
          requestId: 'committed',
        ),
      );
      await Future<void>.delayed(Duration.zero);
      expect(h.presentation.states.length, count);
      expect(port.creates, 1);
      expect(
        (await h.coordinator.newPurchase(action)).status,
        CheckoutOperationStatus.uncertain,
      );
      final resumed = await h.coordinator.resume(p.reference);
      expect(resumed.evidence!.requestId, 'fixture-original');
      expect(port.creates, 1);
    },
  );

  for (final kind in CheckoutPortFailureKind.values) {
    test(
      '$kind typed failure preserves diagnostic flag and never retries action',
      () async {
        port.persisting = (_) async => throw CheckoutPortFailure(
          kind,
          candidatePersisted: kind == CheckoutPortFailureKind.conflict,
        );
        final action = CheckoutExplicitAction();
        await h.coordinator.newPurchase(action);
        final expected = switch (kind) {
          CheckoutPortFailureKind.conflict => CheckoutCoordinatorPhase.conflict,
          CheckoutPortFailureKind.integrity =>
            CheckoutCoordinatorPhase.integrityBlocked,
          CheckoutPortFailureKind.storage =>
            CheckoutCoordinatorPhase.storageUnavailable,
          CheckoutPortFailureKind.context =>
            CheckoutCoordinatorPhase.contextReplaced,
        };
        expect(h.coordinator.state.phase, expected);
        expect(
          h.coordinator.state.candidatePersisted,
          kind == CheckoutPortFailureKind.conflict,
        );
        await h.coordinator.newPurchase(action);
        expect(port.creates, 1);
        expect(port.persists, 1);
      },
    );
  }

  test(
    'missing reference is integrity blocked, never interpreted as new purchase',
    () async {
      port.resuming = (_) async =>
          throw CheckoutPortFailure(CheckoutPortFailureKind.integrity);
      await h.coordinator.resume(
        CheckoutSaleReference(context: checkoutContext(), intentKey: 'absent'),
      );
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.integrityBlocked,
      );
      expect(port.creates, 0);
    },
  );

  test(
    'UNKNOWN remains noncommercial; a different action cannot bypass uncertainty',
    () async {
      port.resuming = (ref) async => CheckoutLocalEvidence(
        ref,
        CheckoutLocalCondition.unknown,
        requestId: 'original',
      );
      await h.coordinator.resume(
        CheckoutSaleReference(context: checkoutContext(), intentKey: 'unknown'),
      );
      expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.unknown);
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.blocked,
      );
      expect(port.creates, 0);
    },
  );

  test(
    'read local evidence does not infer a complete commercial identity',
    () async {
      final result = await h.coordinator.readLocalEvidence(
        CheckoutSaleReference(context: checkoutContext(), intentKey: 'known'),
        'diagnostic',
      );
      expect(result.evidence!.requestId, isNull);
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.integrityBlocked,
      );
      expect(port.creates + port.persists, 0);
    },
  );

  test('origin-mismatched result is rejected, never adopted', () async {
    port.persisting = (_) async => CheckoutLocalEvidence(
      CheckoutSaleReference(
        context: checkoutContext(uid: 'other'),
        intentKey: 'foreign',
      ),
      CheckoutLocalCondition.prepared,
      requestId: 'other',
    );
    await h.coordinator.newPurchase(CheckoutExplicitAction());
    expect(
      h.coordinator.state.phase,
      CheckoutCoordinatorPhase.integrityBlocked,
    );
  });

  test('missing identity in prepared projection blocks integrity', () async {
    port.persisting = (p) async =>
        CheckoutLocalEvidence(p.reference, CheckoutLocalCondition.prepared);
    await h.coordinator.newPurchase(CheckoutExplicitAction());
    expect(
      h.coordinator.state.phase,
      CheckoutCoordinatorPhase.integrityBlocked,
    );
  });

  test(
    'unobserved revision mismatch suppresses result and redacts old reference',
    () async {
      final gate = Completer<CheckoutLocalEvidence>();
      late CheckoutPreparationProposal p;
      port.persisting = (v) {
        p = v;
        return gate.future;
      };
      final pending = h.coordinator.newPurchase(CheckoutExplicitAction());
      h.draft.revision = Object();
      gate.complete(
        CheckoutLocalEvidence(
          p.reference,
          CheckoutLocalCondition.prepared,
          requestId: 'old',
        ),
      );
      expect((await pending).status, CheckoutOperationStatus.superseded);
      expect(h.coordinator.state.reference, isNull);
    },
  );

  test(
    'reentrant state observer invalidates before any persistence invocation',
    () async {
      h.presentation.observing = (state) {
        if (state.phase == CheckoutCoordinatorPhase.preparing) {
          h.events.emit(CheckoutGenerationChange.closed, () {});
        }
      };
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.superseded,
      );
      expect(port.persists, 0);
    },
  );

  test(
    'synchronous failure of candidate creation cannot be retried by the same action',
    () async {
      port.creationFailure = CheckoutPortFailure(
        CheckoutPortFailureKind.integrity,
      );
      final action = CheckoutExplicitAction();
      await h.coordinator.newPurchase(action);
      port.creationFailure = null;
      h.events.emit(CheckoutGenerationChange.reopened, () {});
      h.coordinator.refreshContext();
      await h.coordinator.newPurchase(action);
      expect(port.creates, 1);
    },
  );

  test(
    'dispose detaches events, rejects late completion and all subsequent commands',
    () async {
      final gate = Completer<CheckoutLocalEvidence>();
      late CheckoutPreparationProposal p;
      port.persisting = (v) {
        p = v;
        return gate.future;
      };
      final pending = h.coordinator.newPurchase(CheckoutExplicitAction());
      h.coordinator.dispose();
      expect(h.events.handler, isNull);
      final count = h.presentation.states.length;
      gate.complete(
        CheckoutLocalEvidence(
          p.reference,
          CheckoutLocalCondition.prepared,
          requestId: 'late',
        ),
      );
      expect((await pending).status, CheckoutOperationStatus.superseded);
      expect(h.presentation.states.length, count);
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.blocked,
      );
    },
  );

  test(
    'states have no confirmed phase or local-only sales-success message',
    () {
      expect(CheckoutCoordinatorPhase.values, hasLength(10));
      for (final phase in CheckoutCoordinatorPhase.values) {
        final message = CheckoutCoordinatorState(phase).message.toLowerCase();
        expect(message, isNot(contains('venda confirmada')));
        expect(message, isNot(contains('venda finalizada')));
      }
    },
  );

  test('closed screen cannot become ready until explicit reopen', () async {
    h.events.emit(CheckoutGenerationChange.closed, () {});
    h.coordinator.refreshContext();
    expect(h.coordinator.state.phase, CheckoutCoordinatorPhase.contextReplaced);
    expect(
      (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
      CheckoutOperationStatus.blocked,
    );
    h.events.emit(CheckoutGenerationChange.reopened, () {});
    h.coordinator.refreshContext();
    expect(
      (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
      CheckoutOperationStatus.completed,
    );
  });

  test(
    'context capture error is unavailable rather than inferred readiness',
    () {
      h.context.captureError = StateError('unavailable origin');
      h.coordinator.refreshContext();
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.contextUnavailable,
      );
      expect(port.creates, 0);
    },
  );

  test(
    'invalid frozen draft is integrity blocked rather than storage failure',
    () async {
      port.creationFailure = const FormatException('invalid draft');
      await h.coordinator.newPurchase(CheckoutExplicitAction());
      expect(
        h.coordinator.state.phase,
        CheckoutCoordinatorPhase.integrityBlocked,
      );
    },
  );

  test(
    'unknown cannot be bypassed by refreshing or reopening the same context',
    () async {
      final ref = CheckoutSaleReference(
        context: checkoutContext(),
        intentKey: 'unknown',
      );
      port.resuming = (r) async => CheckoutLocalEvidence(
        r,
        CheckoutLocalCondition.unknown,
        requestId: 'original',
      );
      await h.coordinator.resume(ref);
      h.events.emit(CheckoutGenerationChange.closed, () {});
      h.events.emit(CheckoutGenerationChange.reopened, () {});
      h.coordinator.refreshContext();
      expect(h.coordinator.canPrepareNewPurchase, false);
      expect(
        (await h.coordinator.newPurchase(CheckoutExplicitAction())).status,
        CheckoutOperationStatus.blocked,
      );
      expect(port.creates, 0);
      port.resuming = (r) async => CheckoutLocalEvidence(
        r,
        CheckoutLocalCondition.recoverable,
        requestId: 'original',
      );
      await h.coordinator.resume(ref);
      expect(h.coordinator.canPrepareNewPurchase, true);
    },
  );

  test(
    'reentrant new intention invalidates previous result before completion is delivered',
    () async {
      Future<CheckoutOperationOutcome>? next;
      h.presentation.observing = (state) {
        if (state.phase == CheckoutCoordinatorPhase.prepared && next == null) {
          next = h.coordinator.newPurchase(CheckoutExplicitAction());
        }
      };
      final previous = await h.coordinator.newPurchase(
        CheckoutExplicitAction(),
      );
      expect(previous.status, CheckoutOperationStatus.superseded);
      expect((await next!).status, CheckoutOperationStatus.completed);
      expect(port.creates, 2);
    },
  );
}
