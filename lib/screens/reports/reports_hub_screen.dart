// ============================================================================
// ARQUIVO: reports_hub_screen.dart
// ============================================================================
//
// RESPONSABILIDADE DESTA TELA:
//
// Esta tela funciona como o HUB CENTRAL de análises e relatórios da loja.
//
// A partir dela, o usuário pode acessar:
//
// • Vendas por Período
// • Análise ABC de Produtos
// • Produtos com Estoque Baixo
// • Contas a Receber
//
// RESPONSIVIDADE:
//
// • Mobile:
//   O conteúdo utiliza normalmente a largura disponível da tela.
//
// • Web / Desktop:
//   O conteúdo possui largura máxima de 1100px e permanece centralizado,
//   evitando que os itens fiquem excessivamente largos em monitores grandes.
//
// ============================================================================

import 'package:flutter/material.dart';

import 'package:store_connect/screens/reports/sales_by_period_screen.dart';
import 'package:store_connect/screens/reports/low_stock_report_screen.dart';

import 'abc_report_screen.dart';
import 'accounts_receivable_screen.dart';

class ReportsHubScreen extends StatelessWidget {
  final String storeId;

  const ReportsHubScreen({
    super.key,
    required this.storeId,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // ======================================================================
      // BARRA SUPERIOR
      // ======================================================================

      appBar: AppBar(
        title: const Text('Análises e Relatórios'),
      ),

      // ======================================================================
      // CONTEÚDO
      //
      // Center + ConstrainedBox mantém a tela agradável no Web/Desktop.
      //
      // Em telas menores que 1100px, como celulares, o conteúdo continua
      // utilizando normalmente a largura disponível.
      // ======================================================================

      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            maxWidth: 1100,
          ),
          child: ListView(
            padding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 8,
            ),
            children: [
              // ==============================================================
              // VENDAS POR PERÍODO
              // ==============================================================

              ListTile(
                leading: const Icon(
                  Icons.calendar_today,
                  color: Colors.blue,
                ),
                title: const Text(
                  'Vendas por Período',
                ),
                subtitle: const Text(
                  'Veja o total de vendas em um intervalo de datas.',
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                ),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => SalesByPeriodScreen(
                        storeId: storeId,
                      ),
                    ),
                  );
                },
              ),

              const Divider(),

              // ==============================================================
              // ANÁLISE ABC
              // ==============================================================

              ListTile(
                leading: const Icon(
                  Icons.show_chart,
                  color: Colors.purple,
                ),
                title: const Text(
                  'Análise ABC de Produtos',
                ),
                subtitle: const Text(
                  'Descubra seus produtos mais importantes.',
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                ),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => AbcReportScreen(
                        storeId: storeId,
                      ),
                    ),
                  );
                },
              ),

              const Divider(),

              // ==============================================================
              // ESTOQUE BAIXO
              // ==============================================================

              ListTile(
                leading: const Icon(
                  Icons.warning_amber,
                  color: Colors.red,
                ),
                title: const Text(
                  'Produtos com Estoque Baixo',
                ),
                subtitle: const Text(
                  'Liste todos os produtos que precisam de reposição.',
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                ),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => LowStockReportScreen(
                        storeId: storeId,
                      ),
                    ),
                  );
                },
              ),

              const Divider(),

              // ==============================================================
              // CONTAS A RECEBER
              // ==============================================================

              ListTile(
                leading: const Icon(
                  Icons.people,
                  color: Colors.orange,
                ),
                title: const Text(
                  'Contas a Receber (Crédito)',
                ),
                subtitle: const Text(
                  'Veja o saldo devedor de cada cliente.',
                ),
                trailing: const Icon(
                  Icons.chevron_right,
                ),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => AccountsReceivableScreen(
                        storeId: storeId,
                      ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}