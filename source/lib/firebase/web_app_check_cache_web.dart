import 'package:web/web.dart' as web;

/// FlutterFire app_check_web 0.2.5+2 restores provider settings during
/// Firebase.initializeApp, before the explicit activate call. Discard only
/// these provider hints so an old invalid key or local debug choice cannot
/// override the current build. Auth, cart and IndexedDB data stay untouched.
void resetWebAppCheckProviderCache() {
  const keys = [
    'FlutterFire-[DEFAULT]-recaptchaType',
    'FlutterFire-[DEFAULT]-recaptchaSiteKey',
  ];
  for (final storage in [web.window.localStorage, web.window.sessionStorage]) {
    for (final key in keys) {
      storage.removeItem(key);
    }
  }
}
