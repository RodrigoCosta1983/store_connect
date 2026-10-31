import 'dart:convert';
import 'checkout_sale_preparation.dart';

/// Trust belongs to the injected origin adapter, not to this DTO or the cart.
class CheckoutContextBinding {
  final CheckoutSaleContext context;
  final Object origin;
  CheckoutContextBinding(this.context, this.origin);
}

abstract interface class CheckoutContextPort {
  CheckoutContextBinding? capture();
  bool isCurrent(CheckoutContextBinding binding);
}

/// Detached input only. Normalization and identity remain in preparation/ledger.
class CheckoutDraftSnapshot {
  final Object revision;
  final String _json;
  CheckoutDraftSnapshot(this.revision, Map<String, dynamic> draft)
    : _json = jsonEncode(draft);
  Map<String, dynamic> get detached =>
      Map<String, dynamic>.from(jsonDecode(_json) as Map);
}

abstract interface class CheckoutDraftPort {
  CheckoutDraftSnapshot capture();
  bool isCurrent(CheckoutDraftSnapshot snapshot);
}

enum CheckoutGenerationChange {
  user,
  store,
  project,
  target,
  screen,
  closed,
  reopened,
  cart,
  quantity,
  price,
  customer,
  notes,
  payment,
  cleared,
  authorization,
  storage,
}

/// Deliver synchronously BEFORE publishing external context/draft mutations.
abstract interface class CheckoutSessionEventsPort {
  void bind(
    void Function(CheckoutGenerationChange, void Function()) transition,
  );
  void unbind();
}

class CheckoutPreparationProposal {
  final CheckoutSaleReference reference;
  final String candidateId;
  final Object token;
  CheckoutPreparationProposal(this.reference, this.candidateId, this.token);
}

enum CheckoutLocalCondition { prepared, recoverable, unknown, diagnostic }

/// Transient read projection, never another command, receipt or persisted owner.
class CheckoutLocalEvidence {
  final CheckoutSaleReference reference;
  final CheckoutLocalCondition condition;
  final String? requestId;
  final String? candidateId;
  CheckoutLocalEvidence(
    this.reference,
    this.condition, {
    this.requestId,
    this.candidateId,
  });
}

enum CheckoutPortFailureKind { conflict, integrity, storage, context }

class CheckoutPortFailure implements Exception {
  final CheckoutPortFailureKind kind;
  final bool candidatePersisted;
  CheckoutPortFailure(this.kind, {this.candidatePersisted = false});
}

/// No network, commercial dispatch, confirmation or UI effects in this port.
abstract interface class CheckoutAtomicPreparationPort {
  void invalidate();
  CheckoutPreparationProposal create(
    CheckoutContextBinding binding,
    CheckoutDraftSnapshot draft,
  );
  CheckoutPreparationProposal candidate(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
    CheckoutDraftSnapshot draft,
  );
  Future<CheckoutLocalEvidence> persist(CheckoutPreparationProposal proposal);
  Future<CheckoutLocalEvidence> resume(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
  );
}

abstract interface class CheckoutLocalEvidencePort {
  Future<CheckoutLocalEvidence> read(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
    String candidateId,
  );
}

enum CheckoutCoordinatorPhase {
  contextUnavailable,
  ready,
  preparing,
  prepared,
  recoverable,
  unknown,
  conflict,
  integrityBlocked,
  storageUnavailable,
  contextReplaced,
}

class CheckoutCoordinatorState {
  final CheckoutCoordinatorPhase phase;
  final CheckoutSaleReference? reference;
  final String? candidateId;
  final bool candidatePersisted;
  const CheckoutCoordinatorState(
    this.phase, {
    this.reference,
    this.candidateId,
    this.candidatePersisted = false,
  });
  String get message => switch (phase) {
    CheckoutCoordinatorPhase.contextUnavailable =>
      'Contexto indisponível ou carregando.',
    CheckoutCoordinatorPhase.ready => 'Contexto pronto para preparação local.',
    CheckoutCoordinatorPhase.preparing =>
      'Preparando ou recuperando intenção local.',
    CheckoutCoordinatorPhase.prepared =>
      'Intenção preparada, ainda não enviada.',
    CheckoutCoordinatorPhase.recoverable =>
      'Intenção local recuperável; sem confirmação comercial.',
    CheckoutCoordinatorPhase.unknown =>
      'Resultado desconhecido; retome a mesma referência.',
    CheckoutCoordinatorPhase.conflict =>
      'Conflito: intenção original preservada.',
    CheckoutCoordinatorPhase.integrityBlocked =>
      'Identidade incompleta ou integridade bloqueada.',
    CheckoutCoordinatorPhase.storageUnavailable =>
      'Armazenamento indisponível; preparação suspensa.',
    CheckoutCoordinatorPhase.contextReplaced =>
      'Contexto invalidado ou substituído.',
  };
}

/// Synchronous, nonthrowing projection sink; never a commercial effect callback.
abstract interface class CheckoutPresentationPort {
  void publish(CheckoutCoordinatorState state);
}

/// One caller-created token per explicit human action, never a content hash.
class CheckoutExplicitAction {}

enum CheckoutOperationStatus {
  completed,
  superseded,
  blocked,
  failed,
  uncertain,
}

class CheckoutOperationOutcome {
  final CheckoutOperationStatus status;
  final CheckoutLocalEvidence? evidence;
  const CheckoutOperationOutcome(this.status, [this.evidence]);
}
