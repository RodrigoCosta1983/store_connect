// lib/themes/app_theme.dart

import 'package:flutter/material.dart';

class AppTheme {
  // --- TEMA CLARO (Light Mode) ---
  static final ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    primarySwatch: Colors.deepPurple,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    scaffoldBackgroundColor: Colors.grey.shade100,
    cardTheme: CardThemeData(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );

  // --- TEMA ESCURO (Dark Mode) - COM MELHORIAS ---
  static final ThemeData darkTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    primarySwatch: Colors.deepPurple,
    // Define a cor primária para ser usada em elementos de destaque
    primaryColor: Colors.deepPurple.shade300,
    visualDensity: VisualDensity.adaptivePlatformDensity,
    scaffoldBackgroundColor: const Color(0xFF121212),
    cardColor: const Color(0xFF1E1E1E),
    // Define cores de texto com melhor contraste
    textTheme: const TextTheme(
      bodyLarge: TextStyle(color: Colors.white),      // Texto principal
      bodyMedium: TextStyle(color: Colors.white70),   // Texto secundário
      headlineSmall: TextStyle(color: Colors.white),  // Títulos
      headlineMedium: TextStyle(color: Colors.white), // Títulos maiores
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.deepPurple.shade400,
        foregroundColor: Colors.white,
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Color(0xFF1F1F1F),
      elevation: 2,
    ),
    cardTheme: CardThemeData(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}