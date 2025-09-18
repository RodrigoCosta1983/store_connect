// lib/models/sale_order_model.dart

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/cart_item_model.dart';

class SaleOrder {
  final String id;
  final double totalAmount;
  final List<CartItem> products;
  final DateTime createdAt;
  final String? customerId;
  final String? customerName;
  final bool isPaid;
  final String paymentMethod;
  final DateTime? dueDate;
  final String notes; // <-- 1. CAMPO ADICIONADO
  final String storeId;

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
    required this.notes, // <-- 2. CAMPO ADICIONADO AO CONSTRUTOR
    required this.storeId,
  });

  factory SaleOrder.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;

    final List<CartItem> loadedProducts = (data['products'] as List<dynamic>).map((item) {
      return CartItem.fromMap(item as Map<String, dynamic>);
    }).toList();

    return SaleOrder(
      id: doc.id,
      totalAmount: (data['totalAmount'] as num? ?? 0).toDouble(),
      products: loadedProducts,
      createdAt: (data['createdAt'] as Timestamp? ?? Timestamp.now()).toDate(),
      customerId: data['customerId'],
      customerName: data['customerName'],
      isPaid: data['isPaid'] ?? false,
      paymentMethod: data['paymentMethod'] ?? 'Não informado',
      dueDate: data['dueDate'] != null ? (data['dueDate'] as Timestamp).toDate() : null,
      notes: data['notes'] ?? '', // <-- 3. CAMPO CARREGADO DO FIREBASE
      storeId: data['storeId'] ?? '',
    );
  }
}