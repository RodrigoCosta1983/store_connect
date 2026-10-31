import 'package:firebase_app_check/firebase_app_check.dart';

/// Explicit local opt-in. Production attestation never falls back to debug.
WebProvider? webAppCheckProvider({
  required bool web,
  required bool debugBuild,
  required bool debugRequested,
  required Uri uri,
  required String siteKey,
}) {
  if (!web) return null;
  if (debugRequested) {
    final loopback = {'localhost', '127.0.0.1', '::1', '[::1]'}.contains(uri.host);
    if (!debugBuild || !loopback || !{'http', 'https'}.contains(uri.scheme)) {
      throw StateError('Web App Check debug requires a local debug build.');
    }
    return WebDebugProvider();
  }
  if (siteKey != siteKey.trim() ||
      {'debug', 'null', 'undefined'}.contains(siteKey.toLowerCase()) ||
      !RegExp(r'^[A-Za-z0-9_-]{20,200}$').hasMatch(siteKey)) {
    throw StateError('Web App Check requires a configured public reCAPTCHA v3 site key.');
  }
  return ReCaptchaV3Provider(siteKey);
}
