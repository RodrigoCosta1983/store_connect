// lib/screens/reports/accounts_receivable_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/screens/reports/customer_debt_detail_screen.dart'; // Vamos criar a seguir

class AccountsReceivableScreen extends StatefulWidget {
  final String storeId;
  const AccountsReceivableScreen({super.key, required this.storeId});

  @override
  State<AccountsReceivableScreen> createState() => _AccountsReceivableScreenState();
}

class _CustomerDebt {
  final String customerId;
  final String customerName;
  double totalDebt = 0;
  int saleCount = 0;

  _CustomerDebt({required this.customerId, required this.customerName});
}

// lib/screens/reports/accounts_receivable_screen.dart

class _AccountsReceivableScreenState extends State<AccountsReceivableScreen> {
  Future<List<_CustomerDebt>>? _debtsFuture;
  // NOVO: Variável para guardar a mensagem de erro detalhada
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _debtsFuture = _fetchCustomerDebts();
  }

  Future<List<_CustomerDebt>> _fetchCustomerDebts() async {
    // Limpa erros antigos antes de uma nova busca
    setState(() {
      _errorMessage = null;
    });

    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .collection('sales')
          .where('isPaid', isEqualTo: false)
          .get();

      if (snapshot.docs.isEmpty) {
        return [];
      }

      final Map<String, _CustomerDebt> debtsMap = {};
      for (var doc in snapshot.docs) {
        final sale = SaleOrder.fromFirestore(doc);
        if (sale.customerId != null) {
          if (!debtsMap.containsKey(sale.customerId!)) {
            debtsMap[sale.customerId!] = _CustomerDebt(
              customerId: sale.customerId!,
              customerName: sale.customerName ?? 'Cliente sem nome',
            );
          }
          debtsMap[sale.customerId!]!.totalDebt += sale.totalAmount;
          debtsMap[sale.customerId!]!.saleCount++;
        }
      }

      final debtsList = debtsMap.values.toList();
      debtsList.sort((a, b) => b.totalDebt.compareTo(a.totalDebt));
      return debtsList;

    } catch (e) {
      // MODIFICADO: Salva a mensagem de erro detalhada no estado
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
        });
      }
      // Retorna uma lista vazia em caso de erro para o FutureBuilder não reclamar
      return [];
    }
  }

  @override
  Widget build(BuildContext context) {
    final formatCurrency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
    return Scaffold(
      appBar: AppBar(
        title: const Text('Contas a Receber (Fiado)'),
      ),
      // MODIFICADO: A lógica de exibição agora checa se há uma mensagem de erro
      body: _errorMessage != null
          ? Center(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Text(
            'Ocorreu um erro:\n\n$_errorMessage',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.red, fontSize: 16),
          ),
        ),
      )
          : FutureBuilder<List<_CustomerDebt>>(
        future: _debtsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          // O erro já foi tratado no catch, aqui apenas lidamos com a lista
          final debts = snapshot.data ?? [];
          if (debts.isEmpty) {
            return const Center(child: Text('Nenhuma conta pendente encontrada.'));
          }

          return ListView.builder(
            itemCount: debts.length,
            itemBuilder: (ctx, index) {
              final debt = debts[index];
              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: ListTile(
                  leading: const Icon(Icons.person, color: Colors.orange),
                  title: Text(debt.customerName, style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text('${debt.saleCount} venda(s) pendente(s)'),
                  trailing: Text(
                    formatCurrency.format(debt.totalDebt),
                    style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.red, fontSize: 16),
                  ),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (ctx) => CustomerDebtDetailScreen(
                          storeId: widget.storeId,
                          customerId: debt.customerId,
                          customerName: debt.customerName,
                        ),
                      ),
                    );
                    setState(() {
                      _debtsFuture = _fetchCustomerDebts();
                    });
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}