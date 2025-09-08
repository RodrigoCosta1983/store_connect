// lib/screens/reports/customer_debt_detail_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/widgets/order_item_widget.dart';

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

// lib/screens/reports/customer_debt_detail_screen.dart

class _CustomerDebtDetailScreenState extends State<CustomerDebtDetailScreen> {
  // NOVO: Variável de estado para guardar a lista de vendas
  List<QueryDocumentSnapshot> _salesDocs = [];

  Future<void> _payOldestSale(String saleId) async {
    try {
      await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .collection('sales')
          .doc(saleId)
          .update({'isPaid': true});

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Pagamento registrado com sucesso!'),
              backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text('Erro ao registrar pagamento: $e'),
              backgroundColor: Colors.red),
        );
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
      body: StreamBuilder<QuerySnapshot>(
        stream: salesQuery.snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(child: Text('Ocorreu um erro.'));
          }

          // MODIFICADO: Atualiza a variável de estado com os dados mais recentes
          _salesDocs = snapshot.data?.docs ?? [];

          if (_salesDocs.isEmpty) {
            // Adicionado um pop para voltar automaticamente se não houver mais dívidas
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) {
                Navigator.of(context).pop();
              }
            });
            return const Center(
                child: Text('Este cliente não possui dívidas pendentes.'));
          }

          return ListView.builder(
            itemCount: _salesDocs.length,
            itemBuilder: (ctx, index) {
              final order = SaleOrder.fromFirestore(_salesDocs[index]);
              return OrderItemWidget(order: order, storeId: widget.storeId);
            },
          );
        },
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          // MODIFICADO: Usa a variável de estado que está acessível aqui
          if (_salesDocs.isNotEmpty) {
            // Pega o ID da primeira venda da lista (a mais antiga)
            final oldestSaleId = _salesDocs[0].id;
            _payOldestSale(oldestSaleId);
          }
        },
        icon: const Icon(Icons.check),
        label: const Text('Quitar Venda Mais Antiga'),
      ),
    );
  }
}