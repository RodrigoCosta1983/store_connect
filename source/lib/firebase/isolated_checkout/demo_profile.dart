/// Immutable structural profile. This does not configure or attest any SDK.
final class CheckoutDemoProfile {
  static const project = 'demo-store-connect-checkout';
  static const application = '1:1234567890:web:0000000000000000000000';
  static const canonical = CheckoutDemoProfile._();

  const CheckoutDemoProfile._();

  factory CheckoutDemoProfile.checked({
    String projectId = project,
    String appId = application,
    String region = 'us-central1',
    String databaseId = '(default)',
    String? tenantId,
    String authEndpoint = 'http://127.0.0.1:9099',
    String firestoreEndpoint = 'http://127.0.0.1:8080',
    String functionsEndpoint = 'http://127.0.0.1:5001',
    String hubEndpoint = 'http://127.0.0.1:4400',
  }) {
    if (projectId != project ||
        appId != application ||
        region != 'us-central1' ||
        databaseId != '(default)' ||
        tenantId != null ||
        authEndpoint != canonical.authEndpoint ||
        firestoreEndpoint != canonical.firestoreEndpoint ||
        functionsEndpoint != canonical.functionsEndpoint ||
        hubEndpoint != canonical.hubEndpoint) {
      throw ArgumentError('Only the canonical local demo profile is supported.');
    }
    return canonical;
  }

  String get projectId => project;
  String get appId => application;
  String get region => 'us-central1';
  String get databaseId => '(default)';
  String? get tenantId => null;
  String get authEndpoint => 'http://127.0.0.1:9099';
  String get firestoreEndpoint => 'http://127.0.0.1:8080';
  String get functionsEndpoint => 'http://127.0.0.1:5001';
  String get hubEndpoint => 'http://127.0.0.1:4400';
}
