// lib/screens/dashboard_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/screens/reports/expiring_products_screen.dart';
import 'package:store_connect/screens/reports/low_stock_report_screen.dart';
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
  int _productsExpiringSoonCount = 0;

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

      // 2. Busca configurações da loja (Estoque Baixo e Limite de Vencimento)
      final storeDoc = await storeRef.get();
      final lowStockThreshold = (storeDoc.data()?['lowStockThreshold'] as int? ?? 5);

      // A MÁGICA AQUI: Pega o prazo que o cliente escolheu (ou usa 30 como segurança)
      final expiryThresholdDays = (storeDoc.data()?['expiryThreshold'] as int? ?? 30);

      final lowStockSnapshot = await storeRef
          .collection('products')
          .where('quantidade', isLessThanOrEqualTo: lowStockThreshold)
          .get();

      // Busca os lotes e conta os vencimentos
      final productsSnapshot = await storeRef.collection('products').get();
      int expiringCount = 0;

      // O limite agora é dinâmico com base na configuração do cliente
      final limit = DateTime.now().add(Duration(days: expiryThresholdDays));

      for (var doc in productsSnapshot.docs) {
        final lotes = doc.data()['lotes'] as List<dynamic>? ?? [];

        bool temLoteVencendo = lotes.any((lote) {
          final validade = (lote['validade'] as Timestamp).toDate();
          final qtdLote = lote['quantidade'] as int? ?? 0;

          // Conta como vencendo se a validade for antes do limite E houver saldo no lote
          return validade.isBefore(limit) && qtdLote > 0;
        });

        // Se encontrou algum lote vencendo neste produto, soma 1 no contador
        if (temLoteVencendo) {
          expiringCount++;
        }
      }

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
          _productsExpiringSoonCount = expiringCount; // AGORA O CARD VAI ATUALIZAR!
        });
      }
    } catch (e) {
      print('Erro ao buscar dados do dashboard: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao carregar dados do dashboard.'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

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
              // --- MUDANÇA PRINCIPAL AQUI ---
              child: LayoutBuilder(
                builder: (context, constraints) {
                  // Lógica para determinar o número de colunas
                  final double screenWidth = constraints.maxWidth;
                  int crossAxisCount;
                  double childAspectRatio;

                  if (screenWidth > 1200) {
                    crossAxisCount = 5; // Telas muito largas: 5 colunas
                    childAspectRatio = 1.2;
                  } else if (screenWidth > 900) {
                    crossAxisCount = 4; // Telas largas: 4 colunas
                    childAspectRatio = 1.1;
                  } else if (screenWidth > 600) {
                    crossAxisCount = 3; // Telas médias: 3 colunas
                    childAspectRatio = 1.0;
                  } else {
                    crossAxisCount = 2; // Telas pequenas (mobile): 2 colunas
                    childAspectRatio = 1.1;
                  }

                  return GridView(
                    padding: const EdgeInsets.all(16),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: crossAxisCount, // Usa o valor dinâmico
                      crossAxisSpacing: 16,
                      mainAxisSpacing: 16,
                      childAspectRatio: childAspectRatio, // Proporção ajustável
                    ),
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
                        title: 'Total a Receber (A Prazo)',
                        value: formatCurrency.format(_totalFiado),
                        icon: Icons.person_add_disabled,
                        color: Colors.orange,
                      ),

                      // 1. Card de Estoque Baixo
                      GestureDetector(
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (context) => LowStockReportScreen(storeId: widget.storeId)),
                        ),
                        child: KpiCard(
                          title: 'Produtos Estoque Baixo',
                          value: _lowStockProductsCount.toString(),
                          icon: Icons.warning_amber,
                          color: Colors.red,
                        ),
                      ),

                      // 2. Card de Vencimento Próximo
                      GestureDetector(
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (context) => ExpiringProductsScreen(storeId: widget.storeId)),
                        ),
                        child: KpiCard(
                          title: 'Produtos Vencimento Próximo',
                          value: _productsExpiringSoonCount.toString(),
                          icon: Icons.calendar_month,
                          color: Colors.amber.shade800,
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}