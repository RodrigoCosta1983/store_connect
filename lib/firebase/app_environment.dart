enum AppEnvironment {
  production('store-connect-app', 'prod', 'https://app.storeconnect.com.br'),
  hml('store-connect-hml', 'hml', 'https://store-connect-hml.web.app');

  const AppEnvironment(this.projectId, this.androidFlavor, this.publicBaseUrl);
  final String projectId;
  final String androidFlavor;
  final String publicBaseUrl;

  static AppEnvironment parse(String value) => switch (value) {
    'production' => production,
    'hml' => hml,
    _ => throw StateError('Explicit supported environment required.'),
  };

  String get androidAppId => switch (this) {
    production => '1:294766590074:android:f993b08bb3f300b2afe3c3',
    hml => '1:324469869942:android:4482c313ccd8c0e9ae7e57',
  };

  String get webAppId => switch (this) {
    production => '1:294766590074:web:fbe25231b8ef11d8afe3c3',
    hml => '1:324469869942:web:0d50059ae896f7e3ae7e57',
  };

  void validateIdentity({
    required String? projectId,
    required String? appId,
    required bool web,
  }) {
    if (projectId != this.projectId ||
        appId != (web ? webAppId : androidAppId)) {
      throw StateError('Firebase environment identity mismatch.');
    }
  }

  void validateFlavor(String? flavor) {
    if (flavor != androidFlavor) {
      throw StateError('Android flavor/environment mismatch.');
    }
  }
}

class AppConfiguration {
  static AppEnvironment? _environment;
  static AppEnvironment get environment =>
      _environment ?? (throw StateError('Explicit environment required.'));

  static void configure(AppEnvironment environment) {
    if (_environment != null && _environment != environment) {
      throw StateError('Environment cannot change during execution.');
    }
    _environment = environment;
  }
}
