// lib/models/sale_order_model.dart

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/cart_item_model.dart';

class SaleOrder {
  final String id;
  final double totalAmount; // 'amount'
  final List<CartItem> products;
  final DateTime createdAt; // 'date'
  final String? customerId;
  final String? customerName; // Parte de 'customer'
  final bool isPaid;
  final String paymentMethod;
  final DateTime? dueDate;

  SaleOrder({
    required this.id,
    required this.totalAmount,
    required this.products,
    required this.createdAt,
    this.customerId,
    this.customerName,
    required this.isPaid,
    required this.paymentMethod,
    this.dueDate,
  });

  factory SaleOrder.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;

    final List<CartItem> loadedProducts = (data['products'] as List<dynamic>).map((item) {
      return CartItem.fromMap(item as Map<String, dynamic>);
    }).toList();

    return SaleOrder(
      id: doc.id,
      totalAmount: (data['totalAmount'] as num).toDouble(),
      products: loadedProducts,
      createdAt: (data['createdAt'] as Timestamp).toDate(),
      customerId: data['customerId'],
      customerName: data['customerName'],
      isPaid: data['isPaid'] ?? false,
      paymentMethod: data['paymentMethod'] ?? 'Não informado',
      // Converte o Timestamp de dueDate apenas se ele não for nulo
      dueDate: data['dueDate'] != null ? (data['dueDate'] as Timestamp).toDate() : null,
    );
  }
}