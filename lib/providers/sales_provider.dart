// lib/providers/sales_provider.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/customer_model.dart';

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
}