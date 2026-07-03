import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/models/product_model.dart';

class ExpiringProductsScreen extends StatelessWidget {
  final String storeId;
  const ExpiringProductsScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Produtos Próximos ao Vencimento'),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('stores')
            .doc(storeId)
            .collection('products')
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return const Center(child: Text('Ocorreu um erro ao carregar dados.'));
          }
          if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
            return const Center(child: Text('Nenhum produto cadastrado.'));
          }

          final allProducts = snapshot.data!.docs;

          // Filtra produtos que possuem ao menos um lote vencendo nos próximos dias
          final expiringProducts = allProducts.where((doc) {
            final data = doc.data() as Map<String, dynamic>;
            final lotes = data['lotes'] as List<dynamic>? ?? [];

            // Define o prazo de alerta (buscando do documento da loja se necessário ou usando 30 dias)
            // Nota: Para simplicidade, usamos 30 dias, igual à lógica do seu Dashboard
            final limit = DateTime.now().add(const Duration(days: 30));

            return lotes.any((lote) {
              final validade = (lote['validade'] as Timestamp).toDate();
              final qtdLote = lote['quantidade'] as int? ?? 0;
              return validade.isBefore(limit) && qtdLote > 0;
            });
          }).toList();

          if (expiringProducts.isEmpty) {
            return const Center(
              child: Text(
                'Tudo certo! Nenhum produto próximo ao vencimento.',
                style: TextStyle(fontSize: 16, color: Colors.grey),
              ),
            );
          }

          return ListView.builder(
            itemCount: expiringProducts.length,
            itemBuilder: (ctx, index) {
              final productDoc = expiringProducts[index];
              final product = Product.fromMap(productDoc.id, productDoc.data() as Map<String, dynamic>);
              final data = productDoc.data() as Map<String, dynamic>;
              final lotes = data['lotes'] as List<dynamic>? ?? [];

              // Encontra o lote mais próximo do vencimento para mostrar na lista
              final limit = DateTime.now().add(const Duration(days: 30));
              final lotesVencendo = lotes.where((l) =>
              (l['validade'] as Timestamp).toDate().isBefore(limit) && (l['quantidade'] as int) > 0
              ).toList();
              lotesVencendo.sort((a, b) => (a['validade'] as Timestamp).compareTo(b['validade'] as Timestamp));
              final proximoLote = lotesVencendo.first;
              final DateTime dataValidade = (proximoLote['validade'] as Timestamp).toDate();

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
                    'Vence em: ${DateFormat('dd/MM/yyyy').format(dataValidade)}',
                    style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold),
                  ),
                  trailing: const Icon(Icons.calendar_month, color: Colors.amber),
                ),
              );
            },
          );
        },
      ),
    );
  }
}