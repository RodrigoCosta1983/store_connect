import 'dart:async';
import 'dart:collection';
import 'checkout_coordinator_ports.dart';
import 'checkout_sale_preparation.dart';

class CheckoutGenerationTicket {
  final Object generation;
  final CheckoutContextBinding binding;
  final CheckoutDraftSnapshot draft;
  CheckoutGenerationTicket._(this.generation, this.binding, this.draft);
}

class _CheckoutOperation {
  final CheckoutGenerationTicket ticket;
  final CheckoutSaleReference reference;
  final String? candidateId;
  final completer = Completer<CheckoutOperationOutcome>();
  _CheckoutOperation(this.ticket, this.reference, this.candidateId);
}

/// Pure orchestration. No SDKs, storage opening, command construction or writer.
class CheckoutCoordinator {
  final CheckoutContextPort context;
  final CheckoutDraftPort draft;
  final CheckoutSessionEventsPort events;
  final CheckoutAtomicPreparationPort preparation;
  final CheckoutLocalEvidencePort evidence;
  final CheckoutPresentationPort presentation;
  final Duration operationTimeout;
  final _actions =
      HashMap<CheckoutExplicitAction, _CheckoutOperation>.identity();
  final _rejectedActions = HashSet<CheckoutExplicitAction>.identity();
  Object _generation = Object();
  CheckoutContextBinding? _binding;
  _CheckoutOperation? _active;
  CheckoutSaleReference? _recoveryRequired;
  bool _disposed = false;
  bool _screenAvailable = true;
  CheckoutCoordinatorState _state = const CheckoutCoordinatorState(
    CheckoutCoordinatorPhase.contextUnavailable,
  );
  CheckoutCoordinatorState get state => _state;
  bool get canPrepareNewPurchase =>
      !_disposed &&
      _screenAvailable &&
      _active == null &&
      _recoveryRequired == null &&
      _binding != null &&
      _bindingCurrent(_binding!) &&
      {
        CheckoutCoordinatorPhase.ready,
        CheckoutCoordinatorPhase.prepared,
        CheckoutCoordinatorPhase.recoverable,
      }.contains(_state.phase);

  CheckoutCoordinator({
    required this.context,
    required this.draft,
    required this.events,
    required this.preparation,
    required this.evidence,
    required this.presentation,
    this.operationTimeout = const Duration(seconds: 30),
  }) {
    if (operationTimeout <= Duration.zero) {
      throw ArgumentError('Invalid local timeout');
    }
    events.bind(transition);
  }

  void _publish(CheckoutCoordinatorState state) {
    _state = state;
    presentation.publish(state);
  }

  /// Rotate BEFORE external mutation/listener cancellation; never undo COMMIT.
  void transition(
    CheckoutGenerationChange reason,
    void Function() publishChange,
  ) {
    if (_disposed) return;
    _generation = Object();
    _binding = null;
    if (_active != null) _recoveryRequired = _active!.reference;
    if (reason == CheckoutGenerationChange.closed) _screenAvailable = false;
    if (reason == CheckoutGenerationChange.reopened ||
        reason == CheckoutGenerationChange.screen) {
      _screenAvailable = true;
    }
    preparation.invalidate();
    _publish(
      const CheckoutCoordinatorState(CheckoutCoordinatorPhase.contextReplaced),
    );
    publishChange();
  }

  void refreshContext() {
    if (_disposed || !_screenAvailable) return;
    CheckoutContextBinding? binding;
    try {
      binding = context.capture();
      if (binding != null && !context.isCurrent(binding)) binding = null;
    } catch (_) {
      binding = null;
    }
    if (binding == null) {
      transition(CheckoutGenerationChange.authorization, () {});
      _publish(
        const CheckoutCoordinatorState(
          CheckoutCoordinatorPhase.contextUnavailable,
        ),
      );
      return;
    }
    if (identical(_binding, binding)) return;
    transition(CheckoutGenerationChange.target, () {});
    if (!_bindingCurrent(binding)) return;
    _binding = binding;
    _publish(const CheckoutCoordinatorState(CheckoutCoordinatorPhase.ready));
  }

  bool _current(CheckoutGenerationTicket ticket) {
    if (_disposed ||
        !_screenAvailable ||
        !identical(ticket.generation, _generation) ||
        !identical(ticket.binding, _binding)) {
      return false;
    }
    try {
      return context.isCurrent(ticket.binding) && draft.isCurrent(ticket.draft);
    } catch (_) {
      return false;
    }
  }

  bool _bindingCurrent(CheckoutContextBinding binding) {
    try {
      return context.isCurrent(binding);
    } catch (_) {
      return false;
    }
  }

  CheckoutGenerationTicket? _capture() {
    final binding = _binding;
    if (_disposed || binding == null || !_bindingCurrent(binding)) {
      if (!_disposed && binding != null) {
        transition(CheckoutGenerationChange.authorization, () {});
      }
      return null;
    }
    // A new selected operation invalidates callbacks for any previous one,
    // including reentrant observers acting between publication and completion.
    _generation = Object();
    preparation.invalidate();
    late CheckoutDraftSnapshot snapshot;
    try {
      snapshot = draft.capture();
    } // Frozen before any await.
    catch (error) {
      _publish(_failure(error));
      return null;
    }
    final ticket = CheckoutGenerationTicket._(_generation, binding, snapshot);
    return _current(ticket) ? ticket : null;
  }

  Future<CheckoutOperationOutcome> _blocked() => Future.value(
    const CheckoutOperationOutcome(CheckoutOperationStatus.blocked),
  );

  Future<CheckoutOperationOutcome> newPurchase(CheckoutExplicitAction action) {
    final previous = _actions[action];
    if (previous != null) {
      return _current(previous.ticket)
          ? previous.completer.future
          : Future.value(
              const CheckoutOperationOutcome(
                CheckoutOperationStatus.superseded,
              ),
            );
    }
    if (_rejectedActions.contains(action)) return _blocked();
    if (!canPrepareNewPurchase) return _blocked();
    final ticket = _capture();
    if (ticket == null) return _blocked();
    _rejectedActions.add(
      action,
    ); // An admitted action is allocated at most once.
    try {
      final proposal = preparation.create(ticket.binding, ticket.draft);
      if (!_validReference(ticket, proposal.reference)) return _invalid(ticket);
      final op = _CheckoutOperation(
        ticket,
        proposal.reference,
        proposal.candidateId,
      );
      _actions[action] = op;
      return _launch(op, () => preparation.persist(proposal));
    } catch (error) {
      _rejectedActions.add(action);
      return _synchronousFailure(ticket, error);
    }
  }

  /// Review existing intent explicitly. This cannot create a missing identity.
  Future<CheckoutOperationOutcome> review(
    CheckoutExplicitAction action,
    CheckoutSaleReference reference,
  ) {
    final previous = _actions[action];
    if (previous != null && !_same(reference, previous.reference)) {
      return _blocked();
    }
    if (previous != null) {
      return _current(previous.ticket)
          ? previous.completer.future
          : Future.value(
              const CheckoutOperationOutcome(
                CheckoutOperationStatus.superseded,
              ),
            );
    }
    if (_rejectedActions.contains(action)) return _blocked();
    if (_active != null) return _blocked();
    final ticket = _capture();
    if (ticket == null || !_validReference(ticket, reference)) {
      return _blocked();
    }
    try {
      _rejectedActions.add(action);
      final proposal = preparation.candidate(
        ticket.binding,
        reference,
        ticket.draft,
      );
      if (!_same(reference, proposal.reference)) return _invalid(ticket);
      final op = _CheckoutOperation(ticket, reference, proposal.candidateId);
      _actions[action] = op;
      return _launch(op, () => preparation.persist(proposal));
    } catch (error) {
      _rejectedActions.add(action);
      return _synchronousFailure(ticket, error);
    }
  }

  Future<CheckoutOperationOutcome> resume(CheckoutSaleReference reference) =>
      _read(reference, null);
  Future<CheckoutOperationOutcome> readLocalEvidence(
    CheckoutSaleReference reference,
    String candidateId,
  ) => _read(reference, candidateId);

  Future<CheckoutOperationOutcome> _read(
    CheckoutSaleReference reference,
    String? candidateId,
  ) {
    final active = _active;
    if (active != null) {
      if (_current(active.ticket) &&
          _same(active.reference, reference) &&
          active.candidateId == candidateId) {
        return active.completer.future;
      }
      return _blocked();
    }
    final ticket = _capture();
    if (ticket == null || !_validReference(ticket, reference)) {
      return _blocked();
    }
    final op = _CheckoutOperation(ticket, reference, candidateId);
    return _launch(
      op,
      () => candidateId == null
          ? preparation.resume(ticket.binding, reference)
          : evidence.read(ticket.binding, reference, candidateId),
    );
  }

  bool _same(CheckoutSaleReference a, CheckoutSaleReference b) =>
      a.context.same(b.context) && a.intentKey == b.intentKey;
  bool _validReference(
    CheckoutGenerationTicket ticket,
    CheckoutSaleReference ref,
  ) => _current(ticket) && ticket.binding.context.same(ref.context);

  Future<CheckoutOperationOutcome> _invalid(CheckoutGenerationTicket ticket) =>
      _synchronousFailure(
        ticket,
        CheckoutPortFailure(CheckoutPortFailureKind.integrity),
      );
  Future<CheckoutOperationOutcome> _synchronousFailure(
    CheckoutGenerationTicket ticket,
    Object error,
  ) {
    if (_current(ticket)) _publish(_failure(error));
    return Future.value(
      CheckoutOperationOutcome(
        _current(ticket)
            ? CheckoutOperationStatus.failed
            : CheckoutOperationStatus.superseded,
      ),
    );
  }

  CheckoutCoordinatorState _failure(Object error, [_CheckoutOperation? op]) {
    final failure = error is CheckoutPortFailure
        ? error
        : (error is FormatException || error is ArgumentError)
        ? CheckoutPortFailure(CheckoutPortFailureKind.integrity)
        : null;
    final phase = switch (failure?.kind) {
      CheckoutPortFailureKind.conflict => CheckoutCoordinatorPhase.conflict,
      CheckoutPortFailureKind.integrity =>
        CheckoutCoordinatorPhase.integrityBlocked,
      CheckoutPortFailureKind.context =>
        CheckoutCoordinatorPhase.contextReplaced,
      _ => CheckoutCoordinatorPhase.storageUnavailable,
    };
    return CheckoutCoordinatorState(
      phase,
      reference: op?.reference,
      candidateId: op?.candidateId,
      candidatePersisted: failure?.candidatePersisted ?? false,
    );
  }

  Future<CheckoutOperationOutcome> _launch(
    _CheckoutOperation op,
    Future<CheckoutLocalEvidence> Function() invoke,
  ) {
    _active = op;
    _publish(
      CheckoutCoordinatorState(
        CheckoutCoordinatorPhase.preparing,
        reference: op.reference,
        candidateId: op.candidateId,
      ),
    );
    unawaited(_execute(op, invoke));
    return op.completer.future;
  }

  Future<void> _execute(
    _CheckoutOperation op,
    Future<CheckoutLocalEvidence> Function() invoke,
  ) async {
    CheckoutOperationOutcome outcome;
    try {
      if (!_current(op.ticket)) {
        outcome = const CheckoutOperationOutcome(
          CheckoutOperationStatus.superseded,
        );
        if (identical(_active, op)) _active = null;
      } else {
        // Clearing the physical busy flag waits for the ORIGINAL future, not
        // timeout. Late completion has no path to publish a success afterward.
        final original = Future<CheckoutLocalEvidence>.sync(invoke);
        final observed = original.then(
          (value) {
            if (identical(_active, op)) _active = null;
            return value;
          },
          onError: (Object error, StackTrace stack) {
            if (identical(_active, op)) _active = null;
            Error.throwWithStackTrace(error, stack);
          },
        );
        final result = await observed.timeout(operationTimeout);
        if (!_current(op.ticket)) {
          outcome = const CheckoutOperationOutcome(
            CheckoutOperationStatus.superseded,
          );
        } else if (!_same(result.reference, op.reference) ||
            (result.condition != CheckoutLocalCondition.diagnostic &&
                (result.requestId == null || result.requestId!.isEmpty)) ||
            (result.condition == CheckoutLocalCondition.diagnostic &&
                result.candidateId != op.candidateId)) {
          _publish(
            _failure(
              CheckoutPortFailure(CheckoutPortFailureKind.integrity),
              op,
            ),
          );
          outcome = const CheckoutOperationOutcome(
            CheckoutOperationStatus.failed,
          );
        } else {
          if (result.condition == CheckoutLocalCondition.unknown) {
            _recoveryRequired = op.reference;
          } else if (result.condition != CheckoutLocalCondition.diagnostic &&
              _recoveryRequired != null &&
              _same(_recoveryRequired!, op.reference)) {
            _recoveryRequired = null;
          }
          final phase = switch (result.condition) {
            CheckoutLocalCondition.prepared =>
              CheckoutCoordinatorPhase.prepared,
            CheckoutLocalCondition.unknown => CheckoutCoordinatorPhase.unknown,
            CheckoutLocalCondition.recoverable =>
              CheckoutCoordinatorPhase.recoverable,
            CheckoutLocalCondition.diagnostic =>
              CheckoutCoordinatorPhase.integrityBlocked,
          };
          _publish(
            CheckoutCoordinatorState(
              phase,
              reference: op.reference,
              candidateId: result.candidateId ?? op.candidateId,
            ),
          );
          outcome = _current(op.ticket)
              ? CheckoutOperationOutcome(
                  CheckoutOperationStatus.completed,
                  result,
                )
              : const CheckoutOperationOutcome(
                  CheckoutOperationStatus.superseded,
                );
        }
      }
    } on TimeoutException {
      _recoveryRequired ??= op.reference;
      if (_current(op.ticket)) {
        _publish(
          CheckoutCoordinatorState(
            CheckoutCoordinatorPhase.unknown,
            reference: op.reference,
            candidateId: op.candidateId,
          ),
        );
      }
      outcome = CheckoutOperationOutcome(
        _current(op.ticket)
            ? CheckoutOperationStatus.uncertain
            : CheckoutOperationStatus.superseded,
      );
    } catch (error) {
      _recoveryRequired ??= op.reference;
      if (identical(_active, op)) _active = null;
      if (_current(op.ticket)) _publish(_failure(error, op));
      outcome = CheckoutOperationOutcome(
        _current(op.ticket)
            ? CheckoutOperationStatus.failed
            : CheckoutOperationStatus.superseded,
      );
    }
    if (!_disposed &&
        identical(_generation, op.ticket.generation) &&
        !_current(op.ticket)) {
      transition(CheckoutGenerationChange.authorization, () {});
    }
    op.completer.complete(outcome);
  }

  void dispose() {
    if (_disposed) return;
    transition(CheckoutGenerationChange.closed, () {});
    _disposed = true;
    events.unbind();
    _actions.clear();
    _rejectedActions.clear();
  }
}
