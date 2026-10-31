/// Closed initial profile: changing an unrepresented target attribute is refused,
/// rather than silently sharing a historical namespace with another origin.
class CheckoutSdkManifest {
  static const project = 'demo-store-connect-checkout';
  static const appId = '1:1234567890:web:0000000000000000000000';
  static const storeName = 'checkout_demo_sdk_b4b';
  final String projectId, region, databaseId;
  final Uri auth, firestore, functions, hub;
  CheckoutSdkManifest({
    this.projectId = project,
    this.region = 'us-central1',
    this.databaseId = '(default)',
    String? tenantId,
    String authEndpoint = 'http://127.0.0.1:9099',
    String firestoreEndpoint = 'http://127.0.0.1:8080',
    String functionsEndpoint = 'http://127.0.0.1:5001',
    String hubEndpoint = 'http://127.0.0.1:4400',
  }) : auth = Uri.parse(authEndpoint),
       firestore = Uri.parse(firestoreEndpoint),
       functions = Uri.parse(functionsEndpoint),
       hub = Uri.parse(hubEndpoint) {
    if (!projectId.startsWith('demo-') ||
        projectId != project ||
        region != 'us-central1' ||
        databaseId != '(default)' ||
        tenantId != null ||
        authEndpoint != 'http://127.0.0.1:9099' ||
        firestoreEndpoint != 'http://127.0.0.1:8080' ||
        functionsEndpoint != 'http://127.0.0.1:5001' ||
        hubEndpoint != 'http://127.0.0.1:4400') {
      throw ArgumentError('Unsupported or ambiguous demo SDK profile.');
    }
  }
}
