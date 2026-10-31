import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/checkout_sdk_manifest.dart';

void main() {
  test(
    'closed demo profile preserves explicit loopback and default database',
    () {
      final manifest = CheckoutSdkManifest();
      expect(manifest.projectId, startsWith('demo-'));
      expect(manifest.databaseId, '(default)');
      expect(manifest.region, 'us-central1');
      expect(manifest.auth.host, '127.0.0.1');
    },
  );
  for (final project in [
    'store-connect-app',
    'store-connect-hml',
    '',
    'demo-other',
  ]) {
    test('reject real or ambiguous project $project', () {
      expect(
        () => CheckoutSdkManifest(projectId: project),
        throwsArgumentError,
      );
    });
  }
  for (final endpoint in [
    'https://example.invalid',
    'http://localhost:9099',
    'http://127.0.0.1:9098',
    'http://127.0.0.1:9099/path',
  ]) {
    test('reject unrepresented Auth destination $endpoint', () {
      expect(
        () => CheckoutSdkManifest(authEndpoint: endpoint),
        throwsArgumentError,
      );
    });
  }
  test('reject region/database/tenant outside target mapping', () {
    expect(() => CheckoutSdkManifest(region: 'other'), throwsArgumentError);
    expect(() => CheckoutSdkManifest(databaseId: 'other'), throwsArgumentError);
    expect(() => CheckoutSdkManifest(tenantId: 'tenant'), throwsArgumentError);
  });
  test('reject mixed Firestore or remote Functions', () {
    expect(
      () => CheckoutSdkManifest(firestoreEndpoint: 'http://127.0.0.1:8081'),
      throwsArgumentError,
    );
    expect(
      () => CheckoutSdkManifest(functionsEndpoint: 'https://example.invalid'),
      throwsArgumentError,
    );
  });
}
