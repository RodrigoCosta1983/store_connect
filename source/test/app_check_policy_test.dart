import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/app_check_policy.dart';

void main() {
  test('release and profile require Play Integrity', () {
    expect(androidAppCheckProvider(debugBuild: false), isA<AndroidPlayIntegrityProvider>());
  });
  test('debug USB remains separate from Play distribution', () {
    expect(androidAppCheckProvider(debugBuild: true), isA<AndroidDebugProvider>());
  });
}
