// lib/screens/reports/low_stock_report_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/product_model.dart';

class LowStockReportScreen extends StatelessWidget {
  final String storeId;
  const LowStockReportScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Produtos com Estoque Baixo'),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('stores')
            .doc(storeId)
            .collection('products')
            .orderBy('name_lowercase')
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(child: Text('Ocorreu um erro.'));
          }
          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(child: Text('Nenhum produto cadastrado.'));
          }

          final allProducts = snapshot.data!.docs;

          // --- FILTRANDO OS PRODUTOS DIRETAMENTE NO APP ---
          final lowStockProducts = allProducts.where((doc) {
            final productData = doc.data() as Map<String, dynamic>;
            final quantidade = (productData['quantidade'] as num? ?? 0).toInt();
            final minimumStock = (productData['minimumStock'] as num? ?? 0).toInt();
            return quantidade <= minimumStock;
          }).toList();
          // --- FIM DO FILTRO ---

          if (lowStockProducts.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(16.0),
                child: Text(
                  'Ótimo! Nenhum produto com estoque baixo no momento.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 18, color: Colors.grey),
                ),
              ),
            );
          }

          return ListView.builder(
            itemCount: lowStockProducts.length,
            itemBuilder: (ctx, index) {
              final productDoc = lowStockProducts[index];
              final product = Product.fromMap(productDoc.id, productDoc.data() as Map<String, dynamic>);

              return Card(
                margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundImage: product.imageUrl != null && product.imageUrl!.isNotEmpty
                        ? NetworkImage(product.imageUrl!)
                        : null,
                    child: product.imageUrl == null || product.imageUrl!.isEmpty
                        ? const Icon(Icons.inventory_2)
                        : null,
                  ),
                  title: Text(product.name, style: const TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text(
                    'Estoque Atual: ${product.quantidade}  |  Mínimo: ${product.minimumStock}',
                    style: const TextStyle(color: Colors.red, fontWeight: FontWeight.w500),
                  ),
                  trailing: const Icon(Icons.warning_amber, color: Colors.orange),
                ),
              );
            },
          );
        },
      ),
    );
  }
}