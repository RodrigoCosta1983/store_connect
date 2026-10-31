import '../data/local/sale_mutation_store.dart';
import 'checkout_coordinator_ports.dart';
import 'checkout_sale_preparation.dart';
import 'sale_mutation_ledger.dart';

/// Local adapter only, borrowing the already validated associated preparation.
/// Does not resolve SDKs, open stores, normalize commands, query or dispatch.
class AssociatedCheckoutCoordinatorAdapter
    implements CheckoutAtomicPreparationPort, CheckoutLocalEvidencePort {
  final SaleMutationStore store;
  CheckoutSaleSession? _session;
  CheckoutContextBinding? _binding;
  CheckoutSalePreparation? _preparation;
  AssociatedCheckoutCoordinatorAdapter(this.store);

  @override
  void invalidate() {
    _session?.change(null);
    _session = null;
    _binding = null;
    _preparation = null;
  }

  CheckoutSalePreparation _for(CheckoutContextBinding binding) {
    if (!identical(_binding, binding)) {
      invalidate();
      _binding = binding;
      _session = CheckoutSaleSession(binding.context);
      _preparation = CheckoutSalePreparation(store: store, session: _session!);
    }
    return _preparation!;
  }

  @override
  CheckoutPreparationProposal create(
    CheckoutContextBinding binding,
    CheckoutDraftSnapshot draft,
  ) {
    final candidate = _for(binding).newAssociatedPurchase(draft.detached);
    return CheckoutPreparationProposal(
      candidate.reference,
      candidate.candidateId,
      candidate,
    );
  }

  @override
  CheckoutPreparationProposal candidate(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
    CheckoutDraftSnapshot draft,
  ) {
    final candidate = _for(
      binding,
    ).candidateForAssociatedIntention(reference, draft.detached);
    return CheckoutPreparationProposal(
      candidate.reference,
      candidate.candidateId,
      candidate,
    );
  }

  CheckoutLocalEvidence _projection(CheckoutAssociatedHandle handle) =>
      CheckoutLocalEvidence(handle.reference, switch (handle.attempt.state) {
        SaleAttemptState.persisted => CheckoutLocalCondition.prepared,
        SaleAttemptState.sending ||
        SaleAttemptState.unknown => CheckoutLocalCondition.unknown,
        _ =>
          CheckoutLocalCondition.recoverable, // B1 never reports confirmation.
      }, requestId: handle.attempt.requestId);

  Future<T> _guard<T>(Future<T> Function() operation) async {
    try {
      return await operation();
    } on CheckoutAssociatedConflict catch (error) {
      throw CheckoutPortFailure(
        CheckoutPortFailureKind.conflict,
        candidatePersisted: error.candidatePersisted,
      );
    } on CheckoutAssociatedBlocked catch (error) {
      throw CheckoutPortFailure(
        CheckoutPortFailureKind.integrity,
        candidatePersisted: error.candidatePersisted,
      );
    } on FormatException {
      throw CheckoutPortFailure(CheckoutPortFailureKind.integrity);
    }
  }

  @override
  Future<CheckoutLocalEvidence> persist(CheckoutPreparationProposal proposal) =>
      _guard(() async {
        final prep = _preparation;
        final token = proposal.token;
        if (prep == null ||
            token is! CheckoutAssociatedCandidate ||
            !token.reference.context.same(proposal.reference.context) ||
            token.reference.intentKey != proposal.reference.intentKey ||
            token.candidateId != proposal.candidateId) {
          throw CheckoutPortFailure(CheckoutPortFailureKind.context);
        }
        return _projection(await prep.persistAssociated(token));
      });

  @override
  Future<CheckoutLocalEvidence> resume(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
  ) => _guard(
    () async => _projection(await _for(binding).resumeAssociated(reference)),
  );

  @override
  Future<CheckoutLocalEvidence> read(
    CheckoutContextBinding binding,
    CheckoutSaleReference reference,
    String candidateId,
  ) => _guard(() async {
    await _for(binding).readAssociatedCandidate(reference, candidateId);
    return CheckoutLocalEvidence(
      reference,
      CheckoutLocalCondition.diagnostic,
      candidateId: candidateId,
    );
  });
}
