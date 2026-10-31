import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode;
import 'package:flutter/material.dart';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';
// Importação do App Check
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:provider/provider.dart';
import 'package:provider/single_child_widget.dart';
import 'package:store_connect/providers/user_role_provider.dart';

import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'package:store_connect/providers/theme_provider.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'package:store_connect/screens/public/public_catalog_screen.dart';
import 'package:store_connect/themes/app_theme.dart';
import 'package:store_connect/services/navigation_service.dart';
import 'firebase/app_environment.dart';
import 'firebase/firebase_bootstrap.dart';
import 'firebase/app_check_policy.dart';
import 'firebase/web_app_check_policy.dart';
import 'firebase/web_app_check_cache_stub.dart'
    if (dart.library.js_interop) 'firebase/web_app_check_cache_web.dart';
import 'firebase/commercial_checkout_bundle.dart';
import 'services/android_checkout_cart.dart';

const bool _useFirebaseEmulators = bool.fromEnvironment(
  'USE_FIREBASE_EMULATORS',
  defaultValue: false,
);

Future<void> _connectFirebaseEmulators() async {
  if (!_useFirebaseEmulators) {
    return;
  }

  // Este fluxo local foi preparado para o teste Flutter Web.
  // Sem --dart-define=USE_FIREBASE_EMULATORS=true,
  // o aplicativo usa exclusivamente o ambiente do entrypoint.
  const host = '127.0.0.1';

  await FirebaseAuth.instance.useAuthEmulator(host, 9099);
  FirebaseFirestore.instance.useFirestoreEmulator(host, 8080);
  FirebaseFunctions.instance.useFunctionsEmulator(host, 5001);
  FirebaseStorage.instance.useStorageEmulator(host, 9199);

  debugPrint('Firebase Emulators ATIVOS');
  debugPrint('Auth      : $host:9099');
  debugPrint('Firestore : $host:8080');
  debugPrint('Functions : $host:5001');
  debugPrint('Storage   : $host:9199');
}
Future<void> bootstrap(AppEnvironment environment) async {
  WidgetsFlutterBinding.ensureInitialized();
  final webProvider = webAppCheckProvider(
    web: kIsWeb,
    debugBuild: kDebugMode,
    debugRequested: const bool.fromEnvironment('WEB_APPCHECK_DEBUG', defaultValue: false),
    uri: Uri.base,
    siteKey: const String.fromEnvironment('WEB_APPCHECK_SITE_KEY'),
  );
  if (kIsWeb) resetWebAppCheckProviderCache();
  await initializeEnvironmentFirebase(environment);
  await _connectFirebaseEmulators();
  // Debug USB requires a separately registered debug token. Play releases use
  // Play Integrity and must be configured with the Play app-signing certificate.
  try {
    await FirebaseAppCheck.instance.activate(
      providerAndroid: androidAppCheckProvider(debugBuild: kDebugMode),

      // Se fosse usar no iOS simulador:
      providerApple: const AppleDebugProvider(),
      providerWeb: webProvider,
    );
    if (kIsWeb) await FirebaseAppCheck.instance.setTokenAutoRefreshEnabled(true);
    debugPrint('App Check inicializado.');
  } catch (_) {
    // Never expose a debug token or SDK exception details in application logs.
    throw StateError('App Check initialization rejected.');
  }

  const commercialV2 = bool.fromEnvironment('COMMERCIAL_CHECKOUT_V2', defaultValue: false);
  final checkout = commercialV2 ? await CommercialCheckoutBundle.open(environment) : null;
  runApp(MyApp(checkout: checkout));
}

class MyApp extends StatefulWidget {
  final CommercialCheckoutBundle? checkout;
  const MyApp({super.key, this.checkout});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  StreamSubscription<User?>? _authSubscription;

  late final _PublicCatalogRoute? _publicCatalogRoute;

  @override
  void initState() {
    super.initState();

    _publicCatalogRoute =
        _PublicCatalogRoute.fromCurrentUrl();

    if (_publicCatalogRoute == null) {
      _authSubscription =
          FirebaseAuth.instance.authStateChanges().listen(
        (User? user) {
          if (user == null) {
            NavigationService.refreshAuthGate();
          }
        },
      );
    }
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    widget.checkout?.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final publicCatalogRoute = _publicCatalogRoute;

    if (publicCatalogRoute != null) {
      return MaterialApp(
        navigatorKey: NavigationService.navigatorKey,
        title: 'Store&Connect',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        themeMode: ThemeMode.light,
        home: PublicCatalogScreen(
          publicSlug: publicCatalogRoute.publicSlug,
          publicToken: publicCatalogRoute.publicToken,
        ),
      );
    }

    final List<SingleChildWidget> appProviders = <SingleChildWidget>[
      ChangeNotifierProvider(create: (ctx) => UserRoleProvider()),
      ChangeNotifierProvider(create: (ctx) => ThemeProvider()),
      ChangeNotifierProvider(create: (ctx) => CartProvider()),
      Provider<AndroidCheckoutCart?>.value(value: widget.checkout?.checkout),
      ChangeNotifierProvider(create: (ctx) => CashFlowProvider()),
      ChangeNotifierProvider(create: (ctx) => SalesProvider()),
    ];

    return MultiProvider(
      providers: appProviders,
      child: Consumer<ThemeProvider>(
        builder: (context, themeProvider, child) {
          return MaterialApp(
            navigatorKey: NavigationService.navigatorKey,
            title: 'Store&Connect',
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            darkTheme: AppTheme.darkTheme,
            themeMode: themeProvider.themeMode,
            home: const AuthGate(),
          );
        },
      ),
    );
  }
}

class _PublicCatalogRoute {
  const _PublicCatalogRoute({
    required this.publicSlug,
    required this.publicToken,
  });

  final String publicSlug;
  final String publicToken;

  static _PublicCatalogRoute? fromCurrentUrl() {
    if (!kIsWeb) {
      return null;
    }

    final uri = Uri.base;

    final segments = uri.pathSegments
        .where(
          (segment) => segment.trim().isNotEmpty,
        )
        .toList(growable: false);

    if (
      segments.length != 3 ||
      segments[1].toLowerCase() != 'catalogo'
    ) {
      return null;
    }

    final publicSlug =
        Uri.decodeComponent(
          segments[0],
        ).trim();

    final publicToken =
        Uri.decodeComponent(
          segments[2],
        ).trim();

    if (
      publicSlug.isEmpty ||
      publicToken.isEmpty
    ) {
      return null;
    }

    return _PublicCatalogRoute(
      publicSlug: publicSlug,
      publicToken: publicToken,
    );
  }
}
