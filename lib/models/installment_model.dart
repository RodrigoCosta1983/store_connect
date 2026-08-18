// lib/models/installment_model.dart

import 'package:cloud_firestore/cloud_firestore.dart';

class Installment {
  final int number;
  final double amount;
  final double paidAmount;
  final bool isPaid;
  final DateTime dueDate;
  final DateTime? paidAt;

  Installment({
    required this.number,
    required this.amount,
    required this.paidAmount,
    required this.isPaid,
    required this.dueDate,
    this.paidAt,
  });

  factory Installment.fromMap(Map<String, dynamic> data) {
    return Installment(
      number: (data['number'] as num? ?? 1).toInt(),
      amount: (data['amount'] as num? ?? 0).toDouble(),
      paidAmount: (data['paidAmount'] as num? ?? 0).toDouble(),
      isPaid: data['isPaid'] ?? false,
      dueDate: data['dueDate'] is Timestamp
          ? (data['dueDate'] as Timestamp).toDate()
          : DateTime.now(),
      paidAt: data['paidAt'] is Timestamp
          ? (data['paidAt'] as Timestamp).toDate()
          : null,
    );
  }
}