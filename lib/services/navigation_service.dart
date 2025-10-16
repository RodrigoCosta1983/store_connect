// lib/services/navigation_service.dart

import 'package:flutter/material.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class NavigationService {
  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  static void navigateToHome(String storeId) {
    navigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => HomeScreen(storeId: storeId)),
          (route) => false,
    );
  }

  static void refreshAuthGate() {
    navigatorKey.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const AuthGate()),
          (route) => false,
    );
  }
}