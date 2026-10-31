// Login smoke test without native storage, network or production Firebase.
// ignore_for_file: subtype_of_sealed_class
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'package:store_connect/screens/auth/login_screen.dart';

class _SignedOutAuth extends Fake implements FirebaseAuth {
  @override
  Stream<User?> authStateChanges() => Stream.value(null);
}
class _NoDatabase extends Fake implements FirebaseFirestore {}

void main() {
  for (final size in [const Size(360, 640), const Size(800, 600), const Size(1280, 800)]) {
  testWidgets('signed-out entry shows login without overflow at $size', (tester) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    const secure = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    const biometrics = MethodChannel('plugins.flutter.io/local_auth');
    messenger.setMockMethodCallHandler(secure, (_) async => null);
    messenger.setMockMethodCallHandler(biometrics, (_) async => false);
    addTearDown(() {
      messenger.setMockMethodCallHandler(secure, null);
      messenger.setMockMethodCallHandler(biometrics, null);
    });
    await tester.pumpWidget(MaterialApp(home: AuthGate(
      auth: _SignedOutAuth(), firestore: _NoDatabase(),
    )));
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('ENTRAR'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(2));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  }
}
