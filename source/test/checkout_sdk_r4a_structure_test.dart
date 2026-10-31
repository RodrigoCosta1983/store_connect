import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/checkout_sdk_manifest.dart';
import 'package:store_connect/firebase/isolated_checkout/demo_profile.dart';
import 'package:store_connect/firebase/isolated_checkout/inert_owner.dart';
import 'package:store_connect/firebase/isolated_checkout/structure_port.dart';

void main() {
  test('canonical demo is immutable and matches the existing manifest', () {
    final profile = CheckoutDemoProfile.checked();
    final previous = CheckoutSdkManifest();
    expect(identical(profile, CheckoutDemoProfile.canonical), isTrue);
    expect(profile.projectId, previous.projectId);
    expect(profile.appId, CheckoutSdkManifest.appId);
    expect(profile.region, previous.region);
    expect(profile.databaseId, previous.databaseId);
    expect(profile.tenantId, isNull);
    expect(profile.authEndpoint, previous.auth.toString());
    expect(profile.firestoreEndpoint, previous.firestore.toString());
    expect(profile.functionsEndpoint, previous.functions.toString());
    expect(profile.hubEndpoint, previous.hub.toString());
    final dynamic immutable = profile;
    expect(() => immutable.projectId = 'another', throwsNoSuchMethodError);
  });

  test('real projects and a different demo are refused', () {
    for (final project in ['store-connect-app', 'store-connect-hml', 'demo-other']) {
      expect(() => CheckoutDemoProfile.checked(projectId: project), throwsArgumentError);
    }
  });

  test('noncanonical app tenant database region and endpoints are refused', () {
    final attempts = <void Function()>[
      () => CheckoutDemoProfile.checked(appId: 'other'),
      () => CheckoutDemoProfile.checked(tenantId: 'tenant'),
      () => CheckoutDemoProfile.checked(databaseId: 'named'),
      () => CheckoutDemoProfile.checked(region: 'europe-west1'),
      () => CheckoutDemoProfile.checked(authEndpoint: 'https://example.invalid'),
      () => CheckoutDemoProfile.checked(firestoreEndpoint: 'http://localhost:8080'),
      () => CheckoutDemoProfile.checked(functionsEndpoint: 'http://127.0.0.1:5002'),
      () => CheckoutDemoProfile.checked(hubEndpoint: 'http://127.0.0.1:4401'),
    ];
    for (final attempt in attempts) {
      expect(attempt, throwsArgumentError);
    }
  });

  test('unknown component or owner cannot be adopted', () {
    expect(() => InertCheckoutOwner.fromExternal(Object()), throwsStateError);
    expect(() => InertCheckoutOwner.fromExternal(InertCheckoutOwner()), throwsStateError);
    expect(() => InertCheckoutOwner.fromExternal(InertCheckoutOwner().consumer), throwsStateError);
  });

  test('planning phases never initialize or admit a functional context', () {
    final owner = InertCheckoutOwner();
    final port = owner.consumer;
    expect(port.available, isFalse);
    expect(port.phase, CheckoutStructurePhase.created);
    owner.planInitialization();
    expect(port.phase, CheckoutStructurePhase.initializationPlanned);
    owner.planConfiguration();
    expect(port.phase, CheckoutStructurePhase.configurationPlanned);
    expect(owner.requestAdmission(), isFalse);
    expect(port.phase, CheckoutStructurePhase.admissionBlocked);
    expect(port.available, isFalse);
    expect(identical(port, owner.consumer), isTrue);
  });

  test('configuration and admission cannot run out of order', () {
    final owner = InertCheckoutOwner();
    expect(owner.planConfiguration, throwsStateError);
    expect(owner.requestAdmission, throwsStateError);
  });

  test('blocked admission cannot be followed by reconfiguration', () {
    final owner = InertCheckoutOwner();
    owner.planInitialization();
    owner.planConfiguration();
    owner.requestAdmission();
    expect(owner.planInitialization, throwsStateError);
    expect(owner.planConfiguration, throwsStateError);
    expect(owner.requestAdmission, throwsStateError);
  });

  test('close is terminal idempotent and invalidates the retained projection', () {
    for (final stage in [0, 1, 2, 3]) {
      final owner = InertCheckoutOwner();
      final port = owner.consumer;
      if (stage >= 1) owner.planInitialization();
      if (stage >= 2) owner.planConfiguration();
      if (stage >= 3) owner.requestAdmission();
      owner.close();
      owner.close();
      expect(port.phase, CheckoutStructurePhase.closed);
      expect(port.available, isFalse);
      expect(owner.planInitialization, throwsStateError);
      expect(owner.planConfiguration, throwsStateError);
      expect(owner.requestAdmission, throwsStateError);
    }
  });

  test('consumer has no SDK setters or initialization admission and close methods', () {
    final dynamic port = InertCheckoutOwner().consumer;
    expect(() => port.useAuthEmulator('127.0.0.1', 9099), throwsNoSuchMethodError);
    expect(() => port.useFirestoreEmulator('127.0.0.1', 8080), throwsNoSuchMethodError);
    expect(() => port.useFunctionsEmulator('127.0.0.1', 5001), throwsNoSuchMethodError);
    expect(() => port.planInitialization(), throwsNoSuchMethodError);
    expect(() => port.planConfiguration(), throwsNoSuchMethodError);
    expect(() => port.requestAdmission(), throwsNoSuchMethodError);
    expect(() => port.close(), throwsNoSuchMethodError);
  });

  test('consumer has no sale ledger callable context or SDK capability', () {
    final dynamic port = InertCheckoutOwner().consumer;
    expect(() => port.send(), throwsNoSuchMethodError);
    expect(() => port.persist(), throwsNoSuchMethodError);
    expect(() => port.httpsCallable('confirmSaleV2'), throwsNoSuchMethodError);
    expect(() => port.capture(), throwsNoSuchMethodError);
    expect(() => port.app, throwsNoSuchMethodError);
  });
}
