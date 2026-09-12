import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
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
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // 1. Inicializa o Firebase
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
    }
    debugPrint('✅ Firebase.initializeApp() OK');
  } catch (e) {
    debugPrint('❌ Erro Firebase: $e');
  }

  // 2. ATIVAÇÃO DO APP CHECK (MODO DEBUG) 🛡️
  // Isso resolve o erro "No AppCheckProvider installed"
  try {
    await FirebaseAppCheck.instance.activate(
      // Define o provedor como DEBUG para testes no Android
      androidProvider: AndroidProvider.debug,

      // Se fosse usar no iOS simulador:
      appleProvider: AppleProvider.debug,
      webProvider: ReCaptchaV3Provider('debug'),
    );
    debugPrint('✅ App Check ativado: AndroidProvider.debug');
  } catch (e) {
    debugPrint('⚠️ Erro App Check: $e');
  }

  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final publicCatalogRoute = _publicCatalogRoute;

    if (publicCatalogRoute != null) {
      return ChangeNotifierProvider(
        create: (ctx) => ThemeProvider(),
        child: Consumer<ThemeProvider>(
          builder: (context, themeProvider, child) {
            return MaterialApp(
              navigatorKey: NavigationService.navigatorKey,
              title: 'Store&Connect',
              debugShowCheckedModeBanner: false,
              theme: AppTheme.lightTheme,
              darkTheme: AppTheme.darkTheme,
              themeMode: themeProvider.themeMode,
              home: PublicCatalogScreen(
                publicSlug: publicCatalogRoute.publicSlug,
                publicToken: publicCatalogRoute.publicToken,
              ),
            );
          },
        ),
      );
    }

    final List<SingleChildWidget> appProviders = <SingleChildWidget>[
      ChangeNotifierProvider(create: (ctx) => UserRoleProvider()),
      ChangeNotifierProvider(create: (ctx) => ThemeProvider()),
      ChangeNotifierProvider(create: (ctx) => CartProvider()),
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
