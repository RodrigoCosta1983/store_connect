// lib/themes/app_theme.dart

import 'package:flutter/material.dart';

class AppTheme {
  static final ThemeData lightTheme = ThemeData(
    primarySwatch: Colors.blue,
    brightness: Brightness.light,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    // Você pode customizar mais cores e fontes aqui
  );

  static final ThemeData darkTheme = ThemeData(
    primarySwatch: Colors.blue,
    brightness: Brightness.dark,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    // Customizações para o tema escuro
    scaffoldBackgroundColor: const Color(0xFF121212), // Fundo escuro padrão do Material Design 3
    cardColor: const Color(0xFF1E1E1E),
    // Você pode customizar mais cores e fontes aqui
  );
}