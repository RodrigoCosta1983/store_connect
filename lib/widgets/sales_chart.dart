import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class SalesChart extends StatelessWidget {
  final Map<int, double> weeklySales;

  const SalesChart({super.key, required this.weeklySales});

  @override
  Widget build(BuildContext context) {
    double maxSale = 100.0;
    if (weeklySales.isNotEmpty && weeklySales.values.any((v) => v > 0)) {
      maxSale = weeklySales.values.reduce((a, b) => a > b ? a : b);
    }

    return BarChart(
      BarChartData(
        alignment: BarChartAlignment.spaceAround,
        maxY: maxSale * 1.2,
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipItem: (group, groupIndex, rod, rodIndex) {
              final value = rod.toY;
              return BarTooltipItem(
                'R\$ ${value.toStringAsFixed(2)}',
                const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
              );
            },
          ),
        ),
        titlesData: FlTitlesData(
          show: true,
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              getTitlesWidget: (double value, TitleMeta meta) {
                const style = TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14);
                String text;
                switch (value.toInt()) {
                  case 0: text = 'Dom'; break;
                  case 1: text = 'Seg'; break;
                  case 2: text = 'Ter'; break;
                  case 3: text = 'Qua'; break;
                  case 4: text = 'Qui'; break;
                  case 5: text = 'Sex'; break;
                  case 6: text = 'Sáb'; break;
                  default: text = ''; break;
                }
                return SideTitleWidget(axisSide: meta.axisSide, child: Text(text, style: style));
              },
              reservedSize: 38,
            ),
          ),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 40,
              getTitlesWidget: (value, meta) {
                if (value == 0) return const SizedBox.shrink();
                return Text(
                  NumberFormat.compact().format(value),
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                  textAlign: TextAlign.left,
                );
              },
            ),
          ),
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        borderData: FlBorderData(
          show: true,
          border: const Border(
            bottom: BorderSide(color: Colors.white, width: 2),
            left: BorderSide(color: Colors.white, width: 2),
          ),
        ),
        gridData: const FlGridData(show: false),
        barGroups: List.generate(7, (index) {
          return BarChartGroupData(
            x: index,
            barRods: [
              BarChartRodData(
                toY: weeklySales[index] ?? 0,
                color: Colors.lightBlueAccent,
                width: 22,
                borderRadius: BorderRadius.circular(6),
              )
            ],
          );
        }),
      ),
    );
  }
}