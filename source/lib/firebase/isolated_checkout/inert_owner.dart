import 'demo_profile.dart';
import 'structure_port.dart';

/// R4-A skeleton only. No Firebase dependency or functional binding exists here.
/// All future SDK creation/configuration must remain inside its reviewed owner.
final class InertCheckoutOwner {
  final CheckoutDemoProfile profile;
  CheckoutStructurePhase _phase = CheckoutStructurePhase.created;
  late final CheckoutStructurePort consumer = _InertConsumer(this);

  InertCheckoutOwner({this.profile = CheckoutDemoProfile.canonical});

  /// No adoption path for arbitrary owners, SDKs, receipts or consumer objects.
  factory InertCheckoutOwner.fromExternal(Object component) {
    throw StateError('External components have no authorized provenance.');
  }

  void planInitialization() {
    _expect(CheckoutStructurePhase.created);
    _phase = CheckoutStructurePhase.initializationPlanned;
  }

  void planConfiguration() {
    _expect(CheckoutStructurePhase.initializationPlanned);
    _phase = CheckoutStructurePhase.configurationPlanned;
  }

  /// Always refuses: planning is not initialization, provenance or admission.
  bool requestAdmission() {
    _expect(CheckoutStructurePhase.configurationPlanned);
    _phase = CheckoutStructurePhase.admissionBlocked;
    return false;
  }

  /// Terminal and idempotent. A closed owner cannot be reset/reconfigured.
  /// There are no SDK/store/listener resources in R4-A to release.
  void close() {
    _phase = CheckoutStructurePhase.closed;
  }

  void _expect(CheckoutStructurePhase expected) {
    if (_phase != expected) {
      throw StateError('Invalid structural phase; no SDK action is permitted.');
    }
  }
}

final class _InertConsumer implements CheckoutStructurePort {
  final InertCheckoutOwner _owner;
  _InertConsumer(this._owner);

  @override
  CheckoutStructurePhase get phase => _owner._phase;
  @override
  bool get available => false;
}
