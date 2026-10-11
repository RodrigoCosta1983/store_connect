// Ambiguous platform configuration is intentionally disabled.
import 'package:firebase_core/firebase_core.dart';

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform => throw StateError(
    'Use an explicit Firebase environment entrypoint.',
  );
}