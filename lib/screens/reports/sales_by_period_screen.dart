// lib/screens/reports/sales_by_period_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/widgets/order_item_widget.dart';

class SalesByPeriodScreen extends StatefulWidget {
  final String storeId;
  const SalesByPeriodScreen({super.key, required this.storeId});

  @override
  State<SalesByPeriodScreen> createState() => _SalesByPeriodScreenState();
}

class _SalesByPeriodScreenState extends State<SalesByPeriodScreen> {
  DateTime _startDate = DateTime.now();
  DateTime _endDate = DateTime.now();
  bool _isLoading = false;
  List<SaleOrder> _sales = [];
  double _totalAmount = 0;

  @override
  void initState() {
    super.initState();
    // Define o intervalo inicial para o dia de hoje
    final now = DateTime.now();
    _startDate = DateTime(now.year, now.month, now.day);
    _endDate = DateTime(now.year, now.month, now.day, 23, 59, 59);
    _fetchSales(); // Busca as vendas do dia ao iniciar
  }

  Future<void> _selectDate(BuildContext context, bool isStartDate) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: isStartDate ? _startDate : _endDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2101),
    );
    if (picked != null) {
      setState(() {
        if (isStartDate) {
          _startDate = DateTime(picked.year, picked.month, picked.day);
        } else {
          _endDate = DateTime(picked.year, picked.month, picked.day, 23, 59, 59);
        }
      });
    }
  }

  Future<void> _fetchSales() async {
    setState(() => _isLoading = true);
    try {
      final querySnapshot = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .collection('sales')
          .where('createdAt', isGreaterThanOrEqualTo: _startDate)
          .where('createdAt', isLessThanOrEqualTo: _endDate)
          .orderBy('createdAt', descending: true)
          .get();

      final List<SaleOrder> loadedSales = [];
      double total = 0;
      for (var doc in querySnapshot.docs) {
        final sale = SaleOrder.fromFirestore(doc);
        loadedSales.add(sale);
        total += sale.totalAmount;
      }

      setState(() {
        _sales = loadedSales;
        _totalAmount = total;
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro ao buscar vendas: $e'), backgroundColor: Colors.red),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final formatCurrency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
    final formatDate = DateFormat('dd/MM/yyyy');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Vendas por Período'),
      ),
      body: Column(
        children: [
          // Seletor de Datas e Botão
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    TextButton.icon(
                      icon: const Icon(Icons.date_range),
                      label: Text('De: ${formatDate.format(_startDate)}'),
                      onPressed: () => _selectDate(context, true),
                    ),
                    TextButton.icon(
                      icon: const Icon(Icons.date_range),
                      label: Text('Até: ${formatDate.format(_endDate)}'),
                      onPressed: () => _selectDate(context, false),
                    ),
                  ],
                ),
                ElevatedButton.icon(
                  icon: const Icon(Icons.search),
                  label: const Text('Gerar Relatório'),
                  onPressed: _isLoading ? null : _fetchSales,
                ),
              ],
            ),
          ),
          const Divider(),
          // Resumo
          if (!_isLoading)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('${_sales.length} vendas encontradas', style: const TextStyle(fontWeight: FontWeight.bold)),
                  Text('Total: ${formatCurrency.format(_totalAmount)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.green)),
                ],
              ),
            ),
          // Lista de Vendas
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _sales.isEmpty
                ? const Center(child: Text('Nenhuma venda encontrada para este período.'))
                : ListView.builder(
              itemCount: _sales.length,
              itemBuilder: (ctx, index) {
                return OrderItemWidget(
                  storeId: widget.storeId,
                  order: _sales[index],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}