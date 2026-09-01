// ============================================================================
// ARQUIVO: customer_model.dart
// ============================================================================
//
// OBJETIVO:
//
// Representar um cliente da loja e seu estado operacional.
//
// COMPATIBILIDADE:
//
// Clientes antigos podem não possuir `isArchived`, `archivedAt` ou
// `archivedBy`. Nesses casos:
// - isArchived = false
// - archivedAt = null
// - archivedBy = null
//
// Isso evita migração obrigatória dos documentos já existentes.
//
// IMPORTANTE:
//
// O arquivamento não remove o documento e não altera vendas/parcelas ligadas
// ao customerId. A exclusão física não faz parte da operação normal.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';

class Customer {
  final String id;
  final String name;
  final String? phone;
  final DateTime? createdAt;

  final bool isArchived;
  final DateTime? archivedAt;
  final String? archivedBy;

  Customer({
    required this.id,
    required this.name,
    this.phone,
    this.createdAt,
    this.isArchived = false,
    this.archivedAt,
    this.archivedBy,
  });

  factory Customer.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};

    return Customer(
      id: doc.id,
      name: data['name']?.toString() ?? 'Nome não encontrado',
      phone: data['phone']?.toString(),
      createdAt: _readDate(data['createdAt']),
      isArchived: data['isArchived'] == true,
      archivedAt: _readDate(data['archivedAt']),
      archivedBy: data['archivedBy']?.toString(),
    );
  }

  static DateTime? _readDate(dynamic value) {
    if (value is Timestamp) {
      return value.toDate();
    }

    if (value is DateTime) {
      return value;
    }

    return null;
  }
}
