// Widget imports remain compatible; execution requires an explicit entrypoint.
export 'app_bootstrap.dart' show MyApp;

Never main() =>
    throw StateError('Use lib/main_hml.dart or lib/main_prod.dart explicitly.');
