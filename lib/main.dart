import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // ✅ This check prevents the crash
  if (Firebase.apps.isEmpty) {
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (ctx) => CartProvider()),
        ChangeNotifierProvider(create: (ctx) => SalesProvider()),
        ChangeNotifierProvider(create: (ctx) => CashFlowProvider()),
      ],
      child: MaterialApp(
        title: 'StoreConnect',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          primarySwatch: Colors.blue,
          visualDensity: VisualDensity.adaptivePlatformDensity,
        ),
        home: const AuthGate(),
      ),
    );
  }
}