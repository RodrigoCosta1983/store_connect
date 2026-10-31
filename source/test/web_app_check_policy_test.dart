import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/firebase/web_app_check_policy.dart';

void main() {
  const publicTestKey = 'synthetic_public_site_key_only_for_tests';
  WebProvider? select({bool web = true, bool debug = false, bool optIn = false,
      String origin = 'https://app.storeconnect.com.br', String key = publicTestKey}) =>
    webAppCheckProvider(web: web, debugBuild: debug, debugRequested: optIn,
      uri: Uri.parse(origin), siteKey: key);
  test('native provider selection is unaffected by Web configuration', () {
    expect(select(web: false, optIn: true, key: ''), isNull);
  });
  test('production selects reCAPTCHA v3 with the explicit public site key', () {
    final provider = select();
    expect(provider, isA<ReCaptchaV3Provider>());
    expect(provider!.siteKey, publicTestKey);
  });
  test('missing and placeholder keys cannot silently enable debug', () {
    for (final key in ['', 'debug', 'null', 'undefined', ' $publicTestKey', '$publicTestKey ', 'contains invalid spaces']) {
      expect(() => select(key: key), throwsStateError);
    }
  });
  test('local debug requires explicit opt-in, not merely a debug build', () {
    expect(() => select(debug: true, origin: 'http://127.0.0.1:58103', key: ''), throwsStateError);
  });
  test('the official debug provider is allowed only in local debug builds', () {
    for (final host in ['localhost', '127.0.0.1', '[::1]']) {
      expect(select(debug: true, optIn: true, origin: 'http://$host:58103', key: ''), isA<WebDebugProvider>());
    }
  });
  test('release and profile cannot opt in to local debug', () {
    expect(() => select(optIn: true, origin: 'http://127.0.0.1:58103'), throwsStateError);
  });
  test('public hosts and lookalike hosts cannot enable debug', () {
    for (final origin in ['https://app.storeconnect.com.br', 'https://store-connect-hml.web.app', 'http://localhost.example.invalid', 'http://127.0.0.1.example.invalid', 'file:///tmp/preview']) {
      expect(() => select(debug: true, optIn: true, origin: origin), throwsStateError);
    }
  });
}
