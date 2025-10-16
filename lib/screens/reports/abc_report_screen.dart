// lib/screens/reports/abc_report_screen.dart

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart'; // Importe para formatação de moeda
import '../../models/abc_product_model.dart';
import '../../providers/sales_provider.dart';

enum ReportPeriod { last7days, last30days, allTime }

class AbcReportScreen extends StatefulWidget {
  final String storeId;
  const AbcReportScreen({super.key, required this.storeId});

  @override
  State<AbcReportScreen> createState() => _AbcReportScreenState();
}

class _AbcReportScreenState extends State<AbcReportScreen> {
  ReportPeriod _selectedPeriod = ReportPeriod.last30days;
  Future<List<AbcProduct>>? _abcAnalysisFuture;

  @override
  void initState() {
    super.initState();
    _generateReport();
  }

  void _generateReport() {
    final salesProvider = Provider.of<SalesProvider>(context, listen: false);
    DateTime? startDate;
    if (_selectedPeriod == ReportPeriod.last7days) {
      startDate = DateTime.now().subtract(const Duration(days: 7));
    } else if (_selectedPeriod == ReportPeriod.last30days) {
      startDate = DateTime.now().subtract(const Duration(days: 30));
    }
    setState(() {
      _abcAnalysisFuture = salesProvider.calculateAbcAnalysis(startDate: startDate);
    });
  }

  Color _getClassColor(String classification) {
    switch (classification) {
      case 'A': return Colors.green.shade600;
      case 'B': return Colors.blue.shade600;
      case 'C': return Colors.grey.shade600;
      default: return Colors.black;
    }
  }

  // NOVO MÉTODO: CONSTRÓI A SEÇÃO DA LEGENDA
  Widget _buildLegend() {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Legenda:',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          const SizedBox(height: 8),
          _buildLegendItem('Classe A', '80% da Receita (Produtos mais importantes)', Colors.green.shade600),
          _buildLegendItem('Classe B', '15% da Receita (Produtos de média importância)', Colors.blue.shade600),
          _buildLegendItem('Classe C', '5% da Receita (Produtos menos importantes)', Colors.grey.shade600),
        ],
      ),
    );
  }

  // NOVO MÉTODO: ITEM INDIVIDUAL DA LEGENDA
  Widget _buildLegendItem(String title, String description, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        children: [
          CircleAvatar(radius: 8, backgroundColor: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '$title: $description',
              style: const TextStyle(fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Análise de Produtos (ABC)'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: ToggleButtons(
              isSelected: [
                _selectedPeriod == ReportPeriod.last7days,
                _selectedPeriod == ReportPeriod.last30days,
                _selectedPeriod == ReportPeriod.allTime,
              ],
              onPressed: (index) {
                setState(() {
                  if (index == 0) _selectedPeriod = ReportPeriod.last7days;
                  if (index == 1) _selectedPeriod = ReportPeriod.last30days;
                  if (index == 2) _selectedPeriod = ReportPeriod.allTime;
                  _generateReport();
                });
              },
              borderRadius: BorderRadius.circular(8),
              children: const [
                Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('7 Dias')),
                Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('30 Dias')),
                Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('Tudo')),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<List<AbcProduct>>(
              future: _abcAnalysisFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(child: Text('Erro ao gerar relatório: ${snapshot.error}'));
                }
                if (!snapshot.hasData || snapshot.data!.isEmpty) {
                  return const Center(child: Text('Nenhuma venda encontrada no período.'));
                }
                final products = snapshot.data!;
                return ListView.builder(
                  padding: const EdgeInsets.all(8.0),
                  itemCount: products.length,
                  itemBuilder: (context, index) {
                    final product = products[index];
                    final formatCurrency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
                    return Card(
                      elevation: 2,
                      margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: _getClassColor(product.classification),
                          child: Text(
                            product.classification,
                            style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white),
                          ),
                        ),
                        title: Text(product.productName, style: const TextStyle(fontWeight: FontWeight.bold)),
                        subtitle: Text(
                          '${product.totalQuantity} vendidos | ${product.percentageOfTotal.toStringAsFixed(2)}% da receita',
                        ),
                        trailing: Text(
                          formatCurrency.format(product.totalRevenue),
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          // AQUI É ONDE CHAMAMOS A NOVA LEGENDA!
          _buildLegend(),
        ],
      ),
    );
  }
}