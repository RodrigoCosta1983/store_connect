// lib/widgets/kpi_card.dart

import 'package:flutter/material.dart';

class KpiCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color color;

  const KpiCard({
    super.key,
    required this.title,
    required this.value,
    required this.icon,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
      clipBehavior: Clip.antiAlias, // Garante que nada "vaze" para fora do card
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // --- LINHA DO TÍTULO E ÍCONE ---
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Expanded garante que o título quebre a linha se for muito longo,
                // sem empurrar o ícone para fora.
                Expanded(
                  child: Text(
                    title,
                    style: TextStyle(
                      fontSize: 16,
                      color: Colors.grey.shade700,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Icon(icon, color: color, size: 28),
              ],
            ),

            // --- LINHA DO VALOR ---
            // FittedBox garante que o texto do valor diminua de tamanho
            // para caber perfeitamente no espaço, sem ser cortado.
            Expanded(
              child: Align(
                // O Align empurra o número para o canto inferior esquerdo do cartão
                alignment: Alignment.bottomLeft,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  // Agora o FittedBox sabe exatamente a largura E a altura máximas!
                  child: Text(
                    value,
                    style: const TextStyle(
                      fontSize: 28, // Mantemos o seu tamanho original
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 1,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
