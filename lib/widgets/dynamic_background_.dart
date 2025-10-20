// lib/widgets/dynamic_background.dart

import 'package:flutter/material.dart';

class DynamicBackground extends StatelessWidget {
  const DynamicBackground({super.key});

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    // Define as listas de cores para cada modo
    final List<Color> gradientColors = isDarkMode
        ? [
      const Color(0xFF1D242E), // Cor inicial - Modo Escuro
      const Color(0xFF2A3A54), // Cor final - Modo Escuro
    ]
        : [
      const Color(0xFFF5F7FA), // Cor inicial - Modo Claro
      const Color(0xFFE8EDF4), // Cor final - Modo Claro
    ];

    return Container(
      // Usamos um Container para aplicar a decoração de fundo
      decoration: BoxDecoration(
        // A decoração será um gradiente linear
        gradient: LinearGradient(
          colors: gradientColors, // As cores são escolhidas dinamicamente
          begin: Alignment.topCenter, // O gradiente começa no topo
          end: Alignment.bottomCenter,   // E termina na base
        ),
      ),
    );
  }
}