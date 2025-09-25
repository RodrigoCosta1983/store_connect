// lib/main.dart

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'package:store_connect/providers/theme_provider.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'package:store_connect/themes/app_theme.dart';
import 'firebase_options.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

// --- ADICIONADO ---
// Importa a biblioteca para verificar a plataforma (web, mobile, etc.)
import 'package:flutter/foundation.dart' show kIsWeb;

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }

  // --- ALTERAÇÃO PRINCIPAL AQUI ---
  // Só inicializa a Stripe se NÃO estivermos na web
  if (!kIsWeb) {
    Stripe.publishableKey = 'pk_test_51RtadZF7qAVyn13s6gJurceEqlBHWNNd4xJdGqklUGjHMDfq8vWc2XzSGU4XtDOqAgVnGQYX4hztddfrWErMECa400jGYmKoX0';
  }

  runApp(const MyApp());
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
        navigatorKey.currentState?.pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const AuthGate()),
              (route) => false,
        );
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
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (ctx) => ThemeProvider()),
        ChangeNotifierProvider(create: (ctx) => CartProvider()),
        ChangeNotifierProvider(create: (ctx) => CashFlowProvider()),
        ChangeNotifierProvider(create: (ctx) => SalesProvider()),
      ],
      child: Consumer<ThemeProvider>(
        builder: (context, themeProvider, child) {
          return MaterialApp(
            navigatorKey: navigatorKey,
            title: 'StoreConnect',
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