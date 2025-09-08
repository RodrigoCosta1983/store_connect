// lib/providers/sales_provider.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/models/abc_product_model.dart';

class SalesProvider with ChangeNotifier {
  var isLoading = false;

  Future<void> addOrder({
    required String storeId,
    required List<CartItem> cartProducts,
    required double total,
    required Customer customer,
    required DateTime dueDate,
    required String notes,
  }) async {
    isLoading = true;
    notifyListeners();

    try {
      await FirebaseFirestore.instance
          .collection('stores').doc(storeId)
          .collection('sales').add({
        'totalAmount': total,
        'products': cartProducts.map((cp) => cp.toMap()).toList(),
        'createdAt': Timestamp.now(),
        'storeId': storeId,
        'notes': notes,
        'paymentMethod': 'Fiado',
        'isPaid': false, // Vendas fiado começam como não pagas
        'dueDate': Timestamp.fromDate(dueDate), // Data de vencimento
        'customerId': customer.id,
        'customerName': customer.name,
      });
    } catch (error) {
      // Lança o erro para ser tratado na UI
      throw Exception(error.toString());
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<List<AbcProduct>> calculateAbcAnalysis({
    required String storeId,
    DateTime? startDate,
  }) async {
    // 1. Busca as vendas no período especificado
    Query salesQuery = FirebaseFirestore.instance
        .collection('stores')
        .doc(storeId)
        .collection('sales');

    if (startDate != null) {
      salesQuery = salesQuery.where('createdAt', isGreaterThanOrEqualTo: startDate);
    }
    final salesSnapshot = await salesQuery.get();
    if (salesSnapshot.docs.isEmpty) return [];

    // 2. Agrega os dados: soma a receita e quantidade por produto
    final Map<String, AbcProduct> productData = {};
    double overallTotalRevenue = 0;

    for (var doc in salesSnapshot.docs) {
      final sale = SaleOrder.fromFirestore(doc);
      for (var item in sale.products) {
        final revenue = item.price * item.quantity;

        productData.putIfAbsent(
          item.productId,
              () => AbcProduct(productId: item.productId, productName: item.name),
        );

        productData[item.productId]!.totalRevenue += revenue;
        productData[item.productId]!.totalQuantity += item.quantity;
        overallTotalRevenue += revenue;
      }
    }

    // 3. Ordena os produtos por receita (do maior para o menor)
    final sortedProducts = productData.values.toList()
      ..sort((a, b) => b.totalRevenue.compareTo(a.totalRevenue));

    // 4. Calcula a porcentagem acumulada e classifica em A, B ou C
    double cumulativePercentage = 0;
    for (var product in sortedProducts) {
      product.percentageOfTotal = (product.totalRevenue / overallTotalRevenue) * 100;
      cumulativePercentage += product.percentageOfTotal;

      if (cumulativePercentage <= 80) {
        product.classification = 'A'; // Produtos mais importantes (80% da receita)
      } else if (cumulativePercentage <= 95) {
        product.classification = 'B'; // Produtos de importância média (próximos 15% da receita)
      } else {
        product.classification = 'C'; // Produtos menos importantes (últimos 5% da receita)
      }
    }

    return sortedProducts;
  }

}