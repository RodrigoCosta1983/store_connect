/// Planning states only. No state represents an initialized or admitted SDK.
enum CheckoutStructurePhase {
  created,
  initializationPlanned,
  configurationPlanned,
  admissionBlocked,
  closed,
}

/// Consumer projection: no SDK, configuration, admission, storage or dispatch.
abstract interface class CheckoutStructurePort {
  CheckoutStructurePhase get phase;
  bool get available;
}
