// lib/models/sale_order_model.dart

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/installment_model.dart';
import 'sale_payment_allocation.dart';

class SaleOrder {
  final String id;
  final double totalAmount;
  final List<CartItem> products;
  final DateTime createdAt;
  final String? customerId;
  final String? customerName;
  final bool isPaid;
  final String paymentMethod;
  final List<SalePaymentAllocation> payments;
  String get paymentDescription => payments.isEmpty ? paymentMethod : describeSplitPayments(payments);
  final DateTime? dueDate;
  final String notes;
  final String storeId;

  // CAMPOS FINANCEIROS
  final double totalPaidAmount;
  final int installmentCount;
  final List<Installment> installments;

  SaleOrder({
    required this.id,
    required this.totalAmount,
    required this.products,
    required this.createdAt,
    this.customerId,
    this.customerName,
    required this.isPaid,
    required this.paymentMethod,
    this.payments = const [],
    this.dueDate,
    required this.notes,
    required this.storeId,

    // CAMPOS FINANCEIROS
    required this.totalPaidAmount,
    required this.installmentCount,
    required this.installments,
  });

  factory SaleOrder.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;

    final List<CartItem> loadedProducts =
    (data['products'] as List<dynamic>? ?? []).map((item) {
      return CartItem.fromMap(
        item as Map<String, dynamic>,
      );
    }).toList();

    // Compatibilidade com vendas antigas
    final double loadedTotalPaidAmount =
        (data['totalPaidAmount'] as num?)?.toDouble() ??
            (data['paidAmount'] as num?)?.toDouble() ??
            0.0;

    // Vendas antigas não possuem installmentCount
    final int loadedInstallmentCount =
        (data['installmentCount'] as num?)?.toInt() ?? 1;

    // Carrega as parcelas quando existirem.
    // Vendas antigas não possuem esse campo,
    // então a lista ficará vazia.
    final List<Installment> loadedInstallments =
    (data['installments'] as List<dynamic>? ?? [])
        .map((item) {
      return Installment.fromMap(
        item as Map<String, dynamic>,
      );
    })
        .toList();

    return SaleOrder(
      id: doc.id,
      totalAmount:
      (data['totalAmount'] as num? ?? 0).toDouble(),

      products: loadedProducts,

      createdAt:
      (data['createdAt'] as Timestamp? ?? Timestamp.now())
          .toDate(),

      customerId: data['customerId'],
      customerName: data['customerName'],

      isPaid: data['isPaid'] ?? false,

      paymentMethod:
      data['paymentMethod'] ?? 'Não informado',
      payments: data['payments'] == null ? const [] : validateSplitPayments(
        (data['payments'] as List).map((payment) => SalePaymentAllocation.fromJson(
          Map<String, dynamic>.from(payment as Map))).toList(),
        ((data['totalAmount'] as num) * 100).round()),

      dueDate: data['dueDate'] != null
          ? (data['dueDate'] as Timestamp).toDate()
          : null,

      notes: data['notes'] ?? '',

      storeId: data['storeId'] ?? '',

      // CAMPOS FINANCEIROS
      totalPaidAmount: loadedTotalPaidAmount,
      installmentCount: loadedInstallmentCount,
      installments: loadedInstallments,
    );
  }
}
