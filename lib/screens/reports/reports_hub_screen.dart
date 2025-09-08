// lib/screens/reports/reports_hub_screen.dart

import 'package:flutter/material.dart';
import 'package:store_connect/screens/reports/sales_by_period_screen.dart'; // Vamos criar este arquivo a seguir
import 'package:store_connect/screens/reports/low_stock_report_screen.dart';

import 'abc_report_screen.dart';
import 'accounts_receivable_screen.dart';

class ReportsHubScreen extends StatelessWidget {
  final String storeId;
  const ReportsHubScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Análises e Relatórios'),
      ),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.calendar_today, color: Colors.blue),
            title: const Text('Vendas por Período'),
            subtitle: const Text('Veja o total de vendas em um intervalo de datas.'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (ctx) => SalesByPeriodScreen(storeId: storeId),
                ),
              );
            },
          ),

          const Divider(),
          ListTile(
            leading: const Icon(Icons.show_chart, color: Colors.purple),
            title: const Text('Análise ABC de Produtos'),
            subtitle: const Text('Descubra seus produtos mais importantes.'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (ctx) => AbcReportScreen(storeId: storeId),
                ),
              );
            },
          ),

          const Divider(),
          ListTile(
            leading: const Icon(Icons.warning_amber, color: Colors.red),
            title: const Text('Produtos com Estoque Baixo'),
            subtitle: const Text('Liste todos os produtos que precisam de reposição.'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (ctx) => LowStockReportScreen(storeId: storeId),
                ),
              );
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.people, color: Colors.orange),
            title: const Text('Contas a Receber (Fiado)'),
            subtitle: const Text('Veja o saldo devedor de cada cliente.'),
            trailing: const Icon(Icons.chevron_right),
            // MODIFICADO: Adicionada a navegação
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (ctx) => AccountsReceivableScreen(storeId: storeId),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}