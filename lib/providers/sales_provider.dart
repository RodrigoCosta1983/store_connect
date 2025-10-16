// lib/providers/sales_provider.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/models/abc_product_model.dart';
import 'cash_flow_provider.dart';

class SalesProvider with ChangeNotifier {
  var isLoading = false;
  String? _storeId; // Variável interna para guardar o ID da loja

  // Construtor agora é simples e não exige mais o storeId
  SalesProvider();

  // Novo método para atualizar o storeId após o login
  void updateStoreId(String newId) {
    _storeId = newId;
    notifyListeners(); // Notifica caso alguma UI dependa de saber se o ID já existe
  }

  Future<void> addOrder({
    required List<CartItem> cartProducts,
    required double total,
    required Customer customer,
    required DateTime dueDate,
    required String notes,
  }) async {
    if (_storeId == null) throw Exception("Store ID não definido no SalesProvider.");

    isLoading = true;
    notifyListeners();

    try {
      await FirebaseFirestore.instance
          .collection('stores').doc(_storeId) // Usa a variável interna
          .collection('sales').add({
        'totalAmount': total,
        'products': cartProducts.map((cp) => cp.toMap()).toList(),
        'createdAt': Timestamp.now(),
        'storeId': _storeId,
        'notes': notes,
        'paymentMethod': 'Fiado',
        'isPaid': false,
        'dueDate': Timestamp.fromDate(dueDate),
        'customerId': customer.id,
        'customerName': customer.name,
      });
    } catch (error) {
      throw Exception(error.toString());
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<List<AbcProduct>> calculateAbcAnalysis({
    DateTime? startDate,
  }) async {
    if (_storeId == null) throw Exception("Store ID não definido no SalesProvider.");

    Query salesQuery = FirebaseFirestore.instance
        .collection('stores')
        .doc(_storeId) // Usa a variável interna
        .collection('sales');

    if (startDate != null) {
      salesQuery = salesQuery.where('createdAt', isGreaterThanOrEqualTo: startDate);
    }
    final salesSnapshot = await salesQuery.get();
    if (salesSnapshot.docs.isEmpty) return [];

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

    final sortedProducts = productData.values.toList()
      ..sort((a, b) => b.totalRevenue.compareTo(a.totalRevenue));

    double cumulativePercentage = 0;
    for (var product in sortedProducts) {
      product.percentageOfTotal = (product.totalRevenue / overallTotalRevenue) * 100;
      cumulativePercentage += product.percentageOfTotal;
      if (cumulativePercentage <= 80) product.classification = 'A';
      else if (cumulativePercentage <= 95) product.classification = 'B';
      else product.classification = 'C';
    }
    return sortedProducts;
  }

  // --- MÉTODO ADICIONADO QUE ESTAVA FALTANDO ---
  Future<void> markOrderAsPaid(String orderId, double amount, CashFlowProvider cashFlowProvider) async {
    if (_storeId == null) throw Exception("Store ID não definido no SalesProvider.");

    try {
      final orderRef = FirebaseFirestore.instance.collection('stores').doc(_storeId).collection('sales').doc(orderId);
      await orderRef.update({'isPaid': true});

      await cashFlowProvider.addCashFlowEntry(
        description: 'Recebimento Venda #${orderId.substring(0, 6)}',
        amount: amount,
        type: 'Entrada',
        storeId: _storeId!,
      );
      notifyListeners();
    } catch (error) {
      print("Erro ao marcar a venda como paga: $error");
      throw error;
    }
  }
}