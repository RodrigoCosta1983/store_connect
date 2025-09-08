// lib/screens/dashboard_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/widgets/KpiCard.dart';

import '../widgets/dynamic_background.dart';

class DashboardScreen extends StatefulWidget {
  final String storeId;
  const DashboardScreen({super.key, required this.storeId});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  // Variáveis para guardar os dados do dashboard
  double _totalSalesToday = 0;
  int _salesCountToday = 0;
  int _lowStockProductsCount = 0;
  double _totalFiado = 0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _fetchDashboardData();
  }

  Future<void> _fetchDashboardData() async {
    if (mounted) setState(() => _isLoading = true);

    final now = DateTime.now();
    // Define o início do dia de hoje (00:00:00)
    final startOfToday = DateTime(now.year, now.month, now.day);

    final firestore = FirebaseFirestore.instance;
    final storeRef = firestore.collection('stores').doc(widget.storeId);

    try {
      // 1. Busca as vendas de hoje
      final salesTodaySnapshot = await storeRef
          .collection('sales')
          .where('createdAt', isGreaterThanOrEqualTo: startOfToday)
          .get();

      double totalSales = 0;
      for (var doc in salesTodaySnapshot.docs) {
        totalSales += (doc.data()['totalAmount'] as num? ?? 0).toDouble();
      }

      // 2. Busca produtos com estoque baixo (exemplo: <= 5 unidades)
      // Primeiro, busca o valor do limite do documento da loja
      final storeDoc = await storeRef.get();
      final lowStockThreshold = (storeDoc
          .data()?['lowStockThreshold'] as int? ?? 5); // Usa 5 como padrão

      // Agora, usa o valor dinâmico na busca
      final lowStockSnapshot = await storeRef
          .collection('products')
          .where('quantidade',
          isLessThanOrEqualTo: lowStockThreshold) // <-- Valor dinâmico
          .get();

      // 3. Busca o total de vendas "fiado" (não pagas)
      final fiadoSnapshot = await storeRef
          .collection('sales')
          .where('isPaid', isEqualTo: false)
          .get();

      double totalFiado = 0;
      for (var doc in fiadoSnapshot.docs) {
        totalFiado += (doc.data()['totalAmount'] as num? ?? 0).toDouble();
      }

      // Atualiza o estado com todos os dados de uma vez
      if (mounted) {
        setState(() {
          _totalSalesToday = totalSales;
          _salesCountToday = salesTodaySnapshot.docs.length;
          _lowStockProductsCount = lowStockSnapshot.docs.length;
          _totalFiado = totalFiado;
        });
      }
    } catch (e) {
      print('Erro ao buscar dados do dashboard: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao carregar dados do dashboard.'),
              backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // lib/screens/dashboard_screen.dart -> dentro da classe _DashboardScreenState

  @override
  Widget build(BuildContext context) {
    final double ticketMedio = _salesCountToday > 0 ? _totalSalesToday /
        _salesCountToday : 0;
    final formatCurrency = NumberFormat.currency(
        locale: 'pt_BR', symbol: 'R\$');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _fetchDashboardData,
            tooltip: 'Atualizar Dados',
          ),
        ],
      ),
      extendBodyBehindAppBar: true,
      body: Stack(
        children: [
          const DynamicBackground(),
          SafeArea(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : RefreshIndicator(
              onRefresh: _fetchDashboardData,
              child: GridView.count(
                padding: const EdgeInsets.all(16),
                crossAxisCount: 2,
                crossAxisSpacing: 16,
                mainAxisSpacing: 16,
                childAspectRatio: 1.1,
                // Mantive o valor que funcionou para o layout
                children: [
                  KpiCard(
                    title: 'Vendas de Hoje',
                    value: formatCurrency.format(_totalSalesToday),
                    icon: Icons.point_of_sale,
                    color: Colors.green,
                  ),
                  KpiCard(
                    title: 'Nº de Vendas (Hoje)',
                    value: _salesCountToday.toString(),
                    icon: Icons.receipt_long,
                    color: Colors.blue,
                  ),
                  KpiCard(
                    title: 'Ticket Médio (Hoje)',
                    value: formatCurrency.format(ticketMedio),
                    icon: Icons.price_check,
                    color: Colors.purple,
                  ),
                  KpiCard(
                    title: 'Total a Receber (Fiado)',
                    value: formatCurrency.format(_totalFiado),
                    icon: Icons.person_add_disabled,
                    color: Colors.orange,
                  ),
                  KpiCard(
                    title: 'Produtos c/ Estoque Baixo',
                    value: _lowStockProductsCount.toString(),
                    icon: Icons.warning_amber,
                    color: Colors.red,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}