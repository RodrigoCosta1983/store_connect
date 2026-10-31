import 'package:store_connect/services/checkout_coordinator.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'checkout_sale_preparation_cases.dart'
    show checkoutContext, checkoutDraft;

class CoordinatorContextFake implements CheckoutContextPort {
  Object? captureError;
  CheckoutContextBinding? binding = CheckoutContextBinding(
    checkoutContext(),
    Object(),
  );
  @override
  CheckoutContextBinding? capture() {
    if (captureError != null) throw captureError!;
    return binding;
  }

  @override
  bool isCurrent(CheckoutContextBinding value) => identical(binding, value);
}

class CoordinatorDraftFake implements CheckoutDraftPort {
  Object revision = Object();
  Map<String, dynamic> value = checkoutDraft();
  int captures = 0;
  @override
  CheckoutDraftSnapshot capture() {
    captures++;
    return CheckoutDraftSnapshot(revision, value);
  }

  @override
  bool isCurrent(CheckoutDraftSnapshot snapshot) =>
      identical(snapshot.revision, revision);
}

class CoordinatorEventsFake implements CheckoutSessionEventsPort {
  void Function(CheckoutGenerationChange, void Function())? handler;
  @override
  void bind(
    void Function(CheckoutGenerationChange, void Function()) transition,
  ) {
    handler = transition;
  }

  @override
  void unbind() {
    handler = null;
  }

  void emit(CheckoutGenerationChange event, void Function() publish) =>
      handler!(event, publish);
}

class CoordinatorPresentationFake implements CheckoutPresentationPort {
  final states = <CheckoutCoordinatorState>[];
  void Function(CheckoutCoordinatorState)? observing;
  @override
  void publish(CheckoutCoordinatorState state) {
    states.add(state);
    observing?.call(state);
  }
}

class CoordinatorPreparationFake
    implements CheckoutAtomicPreparationPort, CheckoutLocalEvidencePort {
  int creates = 0, persists = 0, resumes = 0, reads = 0, invalidations = 0;
  Map<String, dynamic>? frozen;
  Object? creationFailure;
  Future<CheckoutLocalEvidence> Function(CheckoutPreparationProposal)?
  persisting;
  Future<CheckoutLocalEvidence> Function(CheckoutSaleReference)? resuming;
  Future<CheckoutLocalEvidence> Function(CheckoutSaleReference, String)?
  reading;
  @override
  void invalidate() {
    invalidations++;
  }

  @override
  CheckoutPreparationProposal create(
    CheckoutContextBinding binding,
    CheckoutDraftSnapshot draft,
  ) {
    creates++;
    frozen = draft.detached;
    if (creationFailure != null) throw creationFailure!;
    return CheckoutPreparationProposal(
      CheckoutSaleReference(
        context: binding.context,
        intentKey: 'fixture-intent-$creates',
      ),
      'fixture-candidate-$creates',
      Object(),
    );
  }

  @override
  CheckoutPreparationProposal candidate(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
    CheckoutDraftSnapshot draft,
  ) {
    frozen = draft.detached;
    return CheckoutPreparationProposal(reference, 'fixture-review', Object());
  }

  @override
  Future<CheckoutLocalEvidence> persist(
    CheckoutPreparationProposal proposal,
  ) async {
    persists++;
    if (persisting != null) return persisting!(proposal);
    return CheckoutLocalEvidence(
      proposal.reference,
      CheckoutLocalCondition.prepared,
      requestId: proposal.reference.intentKey,
    );
  }

  @override
  Future<CheckoutLocalEvidence> resume(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
  ) async {
    resumes++;
    if (resuming != null) return resuming!(reference);
    return CheckoutLocalEvidence(
      reference,
      CheckoutLocalCondition.recoverable,
      requestId: 'fixture-original',
    );
  }

  @override
  Future<CheckoutLocalEvidence> read(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
    String candidateId,
  ) async {
    reads++;
    if (reading != null) return reading!(reference, candidateId);
    return CheckoutLocalEvidence(
      reference,
      CheckoutLocalCondition.diagnostic,
      candidateId: candidateId,
    );
  }
}

class CoordinatorHarness {
  final context = CoordinatorContextFake();
  final draft = CoordinatorDraftFake();
  final events = CoordinatorEventsFake();
  final presentation = CoordinatorPresentationFake();
  late final CheckoutCoordinator coordinator;
  CoordinatorHarness(
    CheckoutAtomicPreparationPort preparation,
    CheckoutLocalEvidencePort evidence, {
    Duration timeout = const Duration(seconds: 5),
  }) {
    coordinator = CheckoutCoordinator(
      context: context,
      draft: draft,
      events: events,
      preparation: preparation,
      evidence: evidence,
      presentation: presentation,
      operationTimeout: timeout,
    );
    coordinator.refreshContext();
  }
}
