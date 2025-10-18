// lib/main.dart

import 'dart:async';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:provider/provider.dart';
import 'package:provider/single_child_widget.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'package:store_connect/providers/subscription_provider.dart';
import 'package:store_connect/providers/theme_provider.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'package:store_connect/themes/app_theme.dart';
import 'firebase_options.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

// --- ADICIONADO ---
import 'package:store_connect/services/navigation_service.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Inicializa o Firebase com proteção e log
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform,
      );
    }
    debugPrint('✅ Firebase.initializeApp() OK');
  } catch (e, st) {
    debugPrint('❌ Erro ao inicializar Firebase: $e\n$st');
    runApp(_InitErrorApp('Erro ao inicializar Firebase: $e'));
    return;
  }

  // Ativa App Check de forma segura:
  try {
    if (kIsWeb) {
      debugPrint('App Check: pulando ativação automática no Web durante desenvolvimento. Configure webRecaptchaSiteKey se necessário.');
      // Para produção web, ative com:
      // await FirebaseAppCheck.instance.activate(webRecaptchaSiteKey: 'SUA_SITE_KEY_RECAPTCHA');
    } else {
      await FirebaseAppCheck.instance.activate(
        androidProvider: AndroidProvider.playIntegrity,
        appleProvider: AppleProvider.debug,
      );
      debugPrint('✅ Firebase App Check ativado (nativo)');
    }
  } catch (e, st) {
    debugPrint('⚠️ Falha ao ativar App Check: $e\n$st');
    // continua com placeholder token se necessário
  }

  // Stripe: apenas quando não for web
  if (!kIsWeb) {
    Stripe.publishableKey = 'pk_test_51RtadZF7qAVyn13s6gJurceEqlBHWNNd4xJdGqklUGjHMDfq8vWc2XzSGU4XtDOqAgVnGQYX4hztddfrWErMECa400jGYmKoX0';
  }

  runApp(const MyApp());
}

class _InitErrorApp extends StatelessWidget {
  final String message;
  const _InitErrorApp(this.message, {Key? key}) : super(key: key);
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Erro na inicialização',
      home: Scaffold(
        appBar: AppBar(title: const Text('Erro na inicialização')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: SingleChildScrollView(child: Text(message)),
        ),
      ),
    );
  }
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  late StreamSubscription<User?> _authSubscription;

  @override
  void initState() {
    super.initState();
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen((User? user) {
      if (user == null) {
        NavigationService.refreshAuthGate();
      }
    });
  }

  @override
  void dispose() {
    _authSubscription.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Monta a lista de providers e adiciona SubscriptionProvider somente se NÃO for web.
    final List<SingleChildWidget> appProviders = <SingleChildWidget>[
      ChangeNotifierProvider(create: (ctx) => ThemeProvider()),
      ChangeNotifierProvider(create: (ctx) => CartProvider()),
      ChangeNotifierProvider(create: (ctx) => CashFlowProvider()),
      ChangeNotifierProvider(create: (ctx) => SalesProvider()),
    ];

    if (!kIsWeb) {
      // SubscriptionProvider usa in_app_purchase que não está inicializado no Web.
      appProviders.add(ChangeNotifierProvider(create: (ctx) => SubscriptionProvider()));
    } else {
      // Opcional: você pode fornecer um stub/mock para o web se quiser
      // appProviders.add(ChangeNotifierProvider(create: (_) => SubscriptionProviderStub()));
    }

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