import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/widgets/order_item_widget.dart';

// NOVO: Filtros mais úteis para o histórico
enum SalesHistoryFilter { today, thisWeek, thisMonth, all }

// MODIFICADO: Convertido para StatefulWidget para gerenciar o estado do filtro
class SalesHistoryScreen extends StatefulWidget {
  final String storeId;
  const SalesHistoryScreen({super.key, required this.storeId});

  @override
  State<SalesHistoryScreen> createState() => _SalesHistoryScreenState();
}

class _SalesHistoryScreenState extends State<SalesHistoryScreen> {
  // NOVO: Estado para controlar o filtro selecionado
  SalesHistoryFilter _selectedFilter = SalesHistoryFilter.today;
  String _filterTitle = 'Vendas de Hoje';

  // NOVO: Função para atualizar o filtro e o título
  void _setFilter(SalesHistoryFilter filter) {
    setState(() {
      _selectedFilter = filter;
      switch (filter) {
        case SalesHistoryFilter.today:
          _filterTitle = 'Vendas de Hoje';
          break;
        case SalesHistoryFilter.thisWeek:
          _filterTitle = 'Vendas da Semana';
          break;
        case SalesHistoryFilter.thisMonth:
          _filterTitle = 'Vendas do Mês';
          break;
        case SalesHistoryFilter.all:
          _filterTitle = 'Todas as Vendas';
          break;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    // NOVO: Lógica para criar a query do Firebase dinamicamente
    Query salesQuery = FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .collection('sales')
        .orderBy('createdAt', descending: true); // MODIFICADO: Ordena por 'createdAt'

    final now = DateTime.now();
    switch (_selectedFilter) {
      case SalesHistoryFilter.today:
        final startOfToday = DateTime(now.year, now.month, now.day);
        salesQuery = salesQuery.where('createdAt', isGreaterThanOrEqualTo: startOfToday);
        break;
      case SalesHistoryFilter.thisWeek:
        final startOfWeek = now.subtract(Duration(days: now.weekday - 1));
        final startOfTodayForWeek = DateTime(startOfWeek.year, startOfWeek.month, startOfWeek.day);
        salesQuery = salesQuery.where('createdAt', isGreaterThanOrEqualTo: startOfTodayForWeek);
        break;
      case SalesHistoryFilter.thisMonth:
        final startOfMonth = DateTime(now.year, now.month, 1);
        salesQuery = salesQuery.where('createdAt', isGreaterThanOrEqualTo: startOfMonth);
        break;
      case SalesHistoryFilter.all:
      // Nenhuma condição adicional é necessária
        break;
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(_filterTitle), // MODIFICADO: Título dinâmico
        // NOVO: Menu de ações para selecionar o filtro
        actions: [
          PopupMenuButton<SalesHistoryFilter>(
            onSelected: _setFilter,
            icon: const Icon(Icons.filter_list),
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: SalesHistoryFilter.today,
                child: Text('Hoje'),
              ),
              const PopupMenuItem(
                value: SalesHistoryFilter.thisWeek,
                child: Text('Esta Semana'),
              ),
              const PopupMenuItem(
                value: SalesHistoryFilter.thisMonth,
                child: Text('Este Mês'),
              ),
              const PopupMenuItem(
                value: SalesHistoryFilter.all,
                child: Text('Todas'),
              ),
            ],
          )
        ],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: salesQuery.snapshots(), // MODIFICADO: Usa a query dinâmica
        builder: (ctx, salesSnapshot) {
          if (salesSnapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (salesSnapshot.hasError) {
            return Center(child: Text('Ocorreu um erro: ${salesSnapshot.error}'));
          }
          final salesDocs = salesSnapshot.data?.docs ?? [];
          if (salesDocs.isEmpty) {
            return const Center(child: Text('Nenhuma venda encontrada para este período.'));
          }

          return ListView.builder(
            itemCount: salesDocs.length,
            itemBuilder: (ctx, index) {
              // MODIFICADO: Usa 'fromFirestore' para consistência
              final order = SaleOrder.fromFirestore(salesDocs[index]);
              return OrderItemWidget(
                storeId: widget.storeId,
                order: order,
              );
            },
          );
        },
      ),
    );
  }
}