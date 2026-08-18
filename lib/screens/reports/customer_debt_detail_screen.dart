// lib/screens/reports/customer_debt_detail_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/widgets/order_item_widget.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/sales_provider.dart';


class CustomerDebtDetailScreen extends StatefulWidget {
  final String storeId;
  final String customerId;
  final String customerName;

  const CustomerDebtDetailScreen({
    super.key,
    required this.storeId,
    required this.customerId,
    required this.customerName,
  });

  @override
  State<CustomerDebtDetailScreen> createState() => _CustomerDebtDetailScreenState();
}

class _CustomerDebtDetailScreenState extends State<CustomerDebtDetailScreen> {
  List<QueryDocumentSnapshot> _salesDocs = [];
  bool _isLoading = false;

  // Calcula a dívida total somando o que falta pagar em cada nota
  double get _totalDebt {
    double total = 0.0;

    for (var doc in _salesDocs) {
      final data = doc.data() as Map<String, dynamic>;

      final installments =
      data['installments'] as List<dynamic>?;

      // ------------------------------------------------------------
      // VENDA NOVA PARCELADA
      // ------------------------------------------------------------
      if (installments != null && installments.isNotEmpty) {
        for (final installment in installments) {
          final installmentData =
          installment as Map<String, dynamic>;

          final amount =
          (installmentData['amount'] as num? ?? 0).toDouble();

          final paidAmount =
          (installmentData['paidAmount'] as num? ?? 0).toDouble();

          final remaining = amount - paidAmount;

          if (remaining > 0) {
            total += remaining;
          }
        }

        continue;
      }

      // ------------------------------------------------------------
      // VENDA ANTIGA
      // ------------------------------------------------------------
      final amount =
      (data['totalAmount'] as num? ?? 0).toDouble();

      final paid =
          (data['paidAmount'] as num?)?.toDouble() ?? 0.0;

      final remaining = amount - paid;

      if (remaining > 0) {
        total += remaining;
      }
    }

    return total;
  }

  // Abre a janela para o lojista digitar o valor do pagamento
  void _showPaymentDialog() {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Receber Pagamento'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Dívida Total: R\$ ${_totalDebt.toStringAsFixed(2)}'),
            const SizedBox(height: 15),
            TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Valor recebido (R\$)',
                border: OutlineInputBorder(),
                prefixText: 'R\$ ',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              final text = controller.text.replaceAll(',', '.');
              final amount = double.tryParse(text);
              if (amount != null && amount > 0) {
                Navigator.of(ctx).pop();
                _processCascadingPayment(amount);
              } else {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Digite um valor válido.')),
                );
              }
            },
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
  }

  // Algoritmo de Pagamento em Cascata
  Future<void> _processCascadingPayment(double amountToPay) async {
    if (amountToPay <= 0) return;

    setState(() => _isLoading = true);

    try {
      final salesProvider = Provider.of<SalesProvider>(
        context,
        listen: false,
      );

      await salesProvider.receiveCustomerDebtPayment(
        customerId: widget.customerId,
        customerName: widget.customerName,
        amountToPay: amountToPay,
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Pagamento de R\$ ${amountToPay.toStringAsFixed(2)} abatido com sucesso!',
            ),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Erro ao processar pagamento: ${e.toString()}',
            ),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final salesQuery = FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .collection('sales')
        .where('customerId', isEqualTo: widget.customerId)
        .where('isPaid', isEqualTo: false)
        .orderBy('createdAt', descending: false);

    return Scaffold(
      appBar: AppBar(
        title: Text('Dívidas de ${widget.customerName}'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : StreamBuilder<QuerySnapshot>(
        stream: salesQuery.snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(child: Text('Ocorreu um erro.'));
          }

          _salesDocs = snapshot.data?.docs ?? [];

          if (_salesDocs.isEmpty) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) {
                Navigator.of(context).pop();
              }
            });
            return const Center(
                child: Text('Este cliente não possui dívidas pendentes.'));
          }

          return Column(
            children: [
              // Banner de Resumo da Dívida
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                color: Colors.red.shade50,
                child: Column(
                  children: [
                    const Text('Total em Aberto', style: TextStyle(fontSize: 16)),
                    Text(
                      'R\$ ${_totalDebt.toStringAsFixed(2)}',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: Colors.red.shade800,
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: _salesDocs.length,
                  itemBuilder: (ctx, index) {
                    final order = SaleOrder.fromFirestore(_salesDocs[index]);
                    return OrderItemWidget(order: order, storeId: widget.storeId);
                  },
                ),
              ),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          // Quando o usuário clica, ele verifica se a lista já carregou
          if (_salesDocs.isNotEmpty) {
            _showPaymentDialog();
          }
        },
        icon: const Icon(Icons.payments_outlined),
        label: const Text('Abater Saldo'),
        backgroundColor: Colors.green.shade600,
        foregroundColor: Colors.white,
      ),
    );
  }
}