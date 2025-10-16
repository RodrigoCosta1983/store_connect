// lib/models/product_model.dart

import 'package:cloud_firestore/cloud_firestore.dart';


class Product {
  final String id;
  final String name;
  final double price;
  final String? imageUrl;
  final int quantidade;
  final int minimumStock;

  Product({
    required this.id,
    required this.name,
    required this.price,
    this.imageUrl,
    required this.quantidade,
    required this.minimumStock,
  });

  // Sua factory original, mantida para compatibilidade se for usada em outro lugar
  factory Product.fromMap(String id, Map<String, dynamic> data) {
    return Product(
      id: id,
      name: data['name'] ?? 'Produto sem nome',
      price: (data['price'] as num).toDouble(),
      imageUrl: data['imageUrl'],
      quantidade: (data['quantidade'] as num? ?? 0).toInt(),
      minimumStock: (data['minimumStock'] as num? ?? 0).toInt(),
    );
  }

  // --- MÉTODO ADICIONADO PARA CORRIGIR O ERRO ---
  // Ensina a classe a ser construída a partir de um documento do Firestore
  factory Product.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Product(
      id: doc.id,
      name: data['name'] ?? 'Produto sem nome',
      price: (data['price'] as num? ?? 0).toDouble(),
      imageUrl: data['imageUrl'],
      quantidade: (data['quantidade'] as num? ?? 0).toInt(),
      minimumStock: (data['minimumStock'] as num? ?? 0).toInt(),
    );
  }
}