import 'package:firebase_app_check/firebase_app_check.dart';

// Profile builds also use attestation; only a debug build may use debug tokens.
AndroidAppCheckProvider androidAppCheckProvider({required bool debugBuild}) =>
    debugBuild ? const AndroidDebugProvider() : const AndroidPlayIntegrityProvider();
