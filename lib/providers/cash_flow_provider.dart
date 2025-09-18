// Em lib/providers/cash_flow_provider.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class CashFlowProvider with ChangeNotifier {
  // Seus outros métodos e variáveis do provider ficam aqui...

  // --- ADICIONE ESTE MÉTODO COMPLETO ---
  Future<void> addCashFlowEntry({
    required String description,
    required double amount,
    required String type, // Será 'Entrada' ou 'Saída'
    required String storeId,
  }) async {
    try {
      await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .collection('cash_flow')
          .add({
        'description': description,
        'amount': amount,
        'type': type,
        'createdAt': Timestamp.now(),
      });

      // Opcional: notificar ouvintes se você tiver uma tela que mostra o fluxo de caixa em tempo real.
      // notifyListeners();

    } catch (error) {
      print('Erro ao adicionar entrada no fluxo de caixa: $error');
      // Lançar o erro novamente para que a função que chamou saiba que algo deu errado
      throw error;
    }
  }
}