// lib/models/customer_model.dart

import 'package:cloud_firestore/cloud_firestore.dart';

class Customer {
  final String id;
  final String name;
  final String? phone;
  final DateTime? createdAt; // NOVO: Campo para data de criação

  Customer({
    required this.id,
    required this.name,
    this.phone,
    this.createdAt, // NOVO
  });

  factory Customer.fromFirestore(DocumentSnapshot doc) {
    Map<String, dynamic> data = doc.data() as Map<String, dynamic>;
    return Customer(
      id: doc.id,
      name: data['name'] ?? 'Nome não encontrado',
      phone: data['phone'],
      // MODIFICADO: Lê o Timestamp do Firebase e o converte para DateTime
      createdAt: data['createdAt'] != null
          ? (data['createdAt'] as Timestamp).toDate()
          : null,
    );
  }
}