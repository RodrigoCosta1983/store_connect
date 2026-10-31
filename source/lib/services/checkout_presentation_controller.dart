import 'package:flutter/foundation.dart';
import 'checkout_coordinator.dart';
import 'checkout_coordinator_ports.dart';
import 'checkout_intention_reader.dart';

enum CheckoutListingPhase {
  idle,
  loading,
  complete,
  partial,
  unavailable,
  contextInvalid,
}

/// Isolated composition: no storage ownership, identity allocation or dispatch.
class CheckoutPresentationController extends ChangeNotifier
    implements CheckoutPresentationPort {
  final CheckoutIntentionReader reader;
  final CheckoutContextPort context;
  late final CheckoutCoordinator _coordinator;
  CheckoutContextBinding? _binding;
  CheckoutIntentionScan? _scan;
  Object _generation = Object();
  bool _disposed = false, _busy = false;
  CheckoutListingPhase _listing = CheckoutListingPhase.idle;
  CheckoutCoordinatorState _state = const CheckoutCoordinatorState(
    CheckoutCoordinatorPhase.contextUnavailable,
  );
  String? _notice;

  CheckoutPresentationController({
    required this.reader,
    required this.context,
    required CheckoutDraftPort draft,
    required CheckoutSessionEventsPort events,
    required CheckoutAtomicPreparationPort preparation,
    required CheckoutLocalEvidencePort evidence,
  }) {
    if (!identical(reader.context, context)) {
      throw ArgumentError('Reader and coordinator must share the origin port');
    }
    _coordinator = CheckoutCoordinator(
      context: context,
      draft: draft,
      preparation: preparation,
      evidence: evidence,
      presentation: this,
      events: _PresentationEvents(events, _invalidate),
    );
  }

  bool get _current {
    try {
      return !_disposed && _binding != null && context.isCurrent(_binding!);
    } catch (_) {
      return false;
    }
  }

  bool _valid(Object generation) =>
      identical(generation, _generation) && _current;
  bool get busy => !_disposed && _busy;
  bool get canRefresh => _current && !busy;
  CheckoutCoordinatorState get state =>
      !_disposed && (_current || _binding == null)
      ? _state
      : const CheckoutCoordinatorState(
          CheckoutCoordinatorPhase.contextReplaced,
        );
  CheckoutListingPhase get listing => _binding != null && !_current
      ? CheckoutListingPhase.contextInvalid
      : _listing;
  String? get notice => _current ? _notice : null;
  List<CheckoutIntentionEntry> get entries =>
      _current ? _scan?.entries ?? const [] : const [];

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _invalidate() {
    _generation = Object();
    reader.generation.invalidate();
    _binding = null;
    _scan = null;
    _notice = null;
    _busy = false;
    _listing = CheckoutListingPhase.contextInvalid;
    _state = const CheckoutCoordinatorState(
      CheckoutCoordinatorPhase.contextReplaced,
    );
    _notify();
  }

  @override
  void publish(CheckoutCoordinatorState value) {
    if (_disposed) return;
    if (value.phase == CheckoutCoordinatorPhase.contextReplaced ||
        value.phase == CheckoutCoordinatorPhase.contextUnavailable) {
      _invalidate();
    } else if (value.phase == CheckoutCoordinatorPhase.ready) {
      try {
        _binding = context.capture();
      } catch (_) {
        _binding = null;
      }
    }
    if (value.phase != CheckoutCoordinatorPhase.contextReplaced &&
        value.phase != CheckoutCoordinatorPhase.contextUnavailable &&
        !_current) {
      return;
    }
    if (value.reference != null &&
        !(_binding?.context.same(value.reference!.context) ?? false)) {
      return;
    }
    _state = value;
    _notify();
  }

  /// Explicit local origin refresh; never allocates a purchase/action token.
  void refreshContext() {
    if (!_disposed && !busy) _coordinator.refreshContext();
  }

  Future<void> refresh({CheckoutIntentionLimits? limits}) async {
    if (!canRefresh) return;
    final token = _generation;
    _busy = true;
    _scan = null;
    _notice = null;
    _listing = CheckoutListingPhase.loading;
    _notify();
    try {
      final result = await reader.scan(
        expectedBinding: _binding,
        limits: limits,
      );
      if (!_valid(token)) return;
      _scan = result;
      _listing = switch (result.status) {
        CheckoutIntentionScanStatus.complete => CheckoutListingPhase.complete,
        CheckoutIntentionScanStatus.partial => CheckoutListingPhase.partial,
        CheckoutIntentionScanStatus.unavailable =>
          CheckoutListingPhase.unavailable,
        CheckoutIntentionScanStatus.contextInvalid =>
          CheckoutListingPhase.contextInvalid,
      };
    } catch (_) {
      if (_valid(token)) _listing = CheckoutListingPhase.unavailable;
    } finally {
      if (_valid(token)) {
        _busy = false;
        _notify();
      }
    }
  }

  bool canSelect(CheckoutIntentionEntry entry) =>
      _current &&
      !busy &&
      (_scan?.isCurrent ?? false) &&
      entries.contains(entry) &&
      entry.canSelectV2;

  Future<void> select(CheckoutIntentionEntry entry) async {
    if (!canSelect(entry)) return;
    final token = _generation;
    final scan = _scan!;
    _busy = true;
    _notice = null;
    _notify();
    try {
      final selection = await reader.selectV2(scan, entry);
      if (!_valid(token)) return;
      // Reference access rechecks B2's ticket immediately before B1.resume.
      await _coordinator.resume(selection.reference);
      if (!_valid(token)) return;
    } on CheckoutIntentionSelectionBlocked {
      if (_valid(token)) {
        _scan = null;
        _listing = CheckoutListingPhase.partial;
        _notice =
            'A referência mudou ou não está disponível. Atualize a lista.';
      }
    } catch (_) {
      if (_valid(token)) _notice = 'Não foi possível ler a intenção local.';
    } finally {
      if (_valid(token)) {
        _busy = false;
        _notify();
      }
    }
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _generation = Object();
    reader.generation.invalidate();
    _scan = null;
    _binding = null;
    _state = const CheckoutCoordinatorState(
      CheckoutCoordinatorPhase.contextReplaced,
    );
    _coordinator.dispose();
    super.dispose();
  }
}

/// Single BEFORE-mutation fan-out, without replacing B1's transition handler.
class _PresentationEvents implements CheckoutSessionEventsPort {
  final CheckoutSessionEventsPort source;
  final void Function() invalidate;
  _PresentationEvents(this.source, this.invalidate);
  @override
  void bind(
    void Function(CheckoutGenerationChange, void Function()) transition,
  ) {
    source.bind((reason, mutation) {
      invalidate();
      transition(reason, mutation);
    });
  }

  @override
  void unbind() => source.unbind();
}
