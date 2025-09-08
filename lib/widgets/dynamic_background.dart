// lib/widgets/dynamic_background.dart

import 'package:flutter/material.dart';

class DynamicBackground extends StatelessWidget {
  const DynamicBackground({super.key});

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    return Positioned.fill(
      child: Opacity(
        opacity: isDarkMode ? 0.3 : 0.4,
        child: Image.asset(
          isDarkMode
              ? 'assets/images/background_light.png'
              : 'assets/images/background_dark.jpg',
          key: ValueKey(isDarkMode), // Garante a troca suave da imagem
          fit: BoxFit.cover,
        ),
      ),
    );
  }
}