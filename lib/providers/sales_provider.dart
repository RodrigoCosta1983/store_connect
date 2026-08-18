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
    if (_storeId == null) throw Exception("Store ID não definido.");

    // 🛡️ VERIFICAÇÃO DE SEGURANÇA ANTES DE GRAVAR
    final storeDoc = await FirebaseFirestore.instance.collection('stores').doc(_storeId).get();
    if (storeDoc.data()?['subscriptionStatus'] != 'active') {
      throw Exception("Sua assinatura expirou. Regularize o pagamento para continuar vendendo.");
    }

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
        'paymentMethod': 'A prazo',
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

  Future<void> receiveCustomerDebtPayment({
    required String customerId,
    required String customerName,
    required double amountToPay,
  }) async {
    if (_storeId == null) {
      throw Exception("Store ID não definido no SalesProvider.");
    }

    if (amountToPay <= 0) {
      throw Exception("O valor recebido deve ser maior que zero.");
    }

    final firestore = FirebaseFirestore.instance;

    // Busca todas as vendas ainda abertas do cliente.
    final querySnapshot = await firestore
        .collection('stores')
        .doc(_storeId)
        .collection('sales')
        .where('customerId', isEqualTo: customerId)
        .where('isPaid', isEqualTo: false)
        .get();

    if (querySnapshot.docs.isEmpty) {
      throw Exception("Este cliente não possui dívidas em aberto.");
    }

    // A transação precisa primeiro ler todos os documentos
    // e somente depois realizar as gravações.
    await firestore.runTransaction((transaction) async {
      final snapshots = <DocumentSnapshot>[];

      for (final doc in querySnapshot.docs) {
        final snapshot = await transaction.get(doc.reference);
        snapshots.add(snapshot);
      }

      // ------------------------------------------------------------
      // MONTA TODAS AS OBRIGAÇÕES ABERTAS DO CLIENTE
      // ------------------------------------------------------------

      final obligations = <Map<String, dynamic>>[];

      for (final snapshot in snapshots) {
        final data = snapshot.data() as Map<String, dynamic>;

        final installments =
        data['installments'] as List<dynamic>?;

        // ----------------------------------------------------------
        // VENDA NOVA PARCELADA
        // ----------------------------------------------------------
        if (installments != null && installments.isNotEmpty) {
          for (int i = 0; i < installments.length; i++) {
            final installment =
            Map<String, dynamic>.from(
              installments[i] as Map,
            );

            final amount =
            (installment['amount'] as num? ?? 0).toDouble();

            final paidAmount =
            (installment['paidAmount'] as num? ?? 0).toDouble();

            final remaining = amount - paidAmount;

            if (remaining <= 0.001) {
              continue;
            }

            final dueDate =
            installment['dueDate'] is Timestamp
                ? (installment['dueDate'] as Timestamp).toDate()
                : DateTime(2100);

            obligations.add({
              'type': 'installment',
              'saleSnapshot': snapshot,
              'installmentIndex': i,
              'dueDate': dueDate,
            });
          }

          continue;
        }

        // ----------------------------------------------------------
        // VENDA ANTIGA
        // ----------------------------------------------------------

        final totalAmount =
        (data['totalAmount'] as num? ?? 0).toDouble();

        final paidAmount =
        (data['paidAmount'] as num? ?? 0).toDouble();

        final remaining = totalAmount - paidAmount;

        if (remaining <= 0.001) {
          continue;
        }

        final dueDate = data['dueDate'] is Timestamp
            ? (data['dueDate'] as Timestamp).toDate()
            : (data['createdAt'] is Timestamp
            ? (data['createdAt'] as Timestamp).toDate()
            : DateTime(2100));

        obligations.add({
          'type': 'legacy',
          'saleSnapshot': snapshot,
          'dueDate': dueDate,
        });
      }

      // Mais antigo / vencimento mais próximo primeiro.
      obligations.sort(
            (a, b) => (a['dueDate'] as DateTime)
            .compareTo(b['dueDate'] as DateTime),
      );

      // Calcula dívida total antes de mexer em qualquer coisa.
      double totalDebt = 0.0;

      for (final obligation in obligations) {
        final snapshot =
        obligation['saleSnapshot'] as DocumentSnapshot;

        final data =
        snapshot.data() as Map<String, dynamic>;

        if (obligation['type'] == 'installment') {
          final installments =
          data['installments'] as List<dynamic>;

          final index =
          obligation['installmentIndex'] as int;

          final installment =
          Map<String, dynamic>.from(
            installments[index] as Map,
          );

          final amount =
          (installment['amount'] as num? ?? 0).toDouble();

          final paid =
          (installment['paidAmount'] as num? ?? 0).toDouble();

          totalDebt += amount - paid;
        } else {
          final total =
          (data['totalAmount'] as num? ?? 0).toDouble();

          final paid =
          (data['paidAmount'] as num? ?? 0).toDouble();

          totalDebt += total - paid;
        }
      }

      // Não aceita receber mais do que o cliente realmente deve.
      if (amountToPay > totalDebt + 0.001) {
        throw Exception(
          'O valor recebido é maior que a dívida do cliente.',
        );
      }

      double remainingPayment = amountToPay;

      // Vamos manter em memória uma versão atualizada de cada venda.
      final updatedSales =
      <String, Map<String, dynamic>>{};

      final saleSnapshots =
      <String, DocumentSnapshot>{};

      // ------------------------------------------------------------
      // APLICA O PAGAMENTO EM CASCATA
      // ------------------------------------------------------------

      for (final obligation in obligations) {
        if (remainingPayment <= 0.001) {
          break;
        }

        final snapshot =
        obligation['saleSnapshot'] as DocumentSnapshot;

        final saleId = snapshot.id;

        saleSnapshots[saleId] = snapshot;

        final originalData =
        snapshot.data() as Map<String, dynamic>;

        final saleData = updatedSales.putIfAbsent(
          saleId,
              () => Map<String, dynamic>.from(originalData),
        );

        // ----------------------------------------------------------
        // PARCELA NOVA
        // ----------------------------------------------------------
        if (obligation['type'] == 'installment') {
          final originalInstallments =
          saleData['installments'] as List<dynamic>;

          // Cria cópia real da lista/mapas para não alterar
          // a estrutura original por referência.
          final installments =
          originalInstallments.map((item) {
            return Map<String, dynamic>.from(item as Map);
          }).toList();

          final index =
          obligation['installmentIndex'] as int;

          final installment = installments[index];

          final amount =
          (installment['amount'] as num? ?? 0).toDouble();

          final alreadyPaid =
          (installment['paidAmount'] as num? ?? 0).toDouble();

          final debt = amount - alreadyPaid;

          final amountApplied =
          remainingPayment >= debt
              ? debt
              : remainingPayment;

          final newPaidAmount =
              alreadyPaid + amountApplied;

          final installmentPaid =
              newPaidAmount >= amount - 0.001;

          installment['paidAmount'] =
              double.parse(
                newPaidAmount.toStringAsFixed(2),
              );

          installment['isPaid'] =
              installmentPaid;

          installment['paidAt'] =
          installmentPaid
              ? Timestamp.now()
              : null;

          installments[index] = installment;

          saleData['installments'] = installments;

          remainingPayment -= amountApplied;
        }

        // ----------------------------------------------------------
        // VENDA ANTIGA
        // ----------------------------------------------------------
        else {
          final totalAmount =
          (saleData['totalAmount'] as num? ?? 0).toDouble();

          final alreadyPaid =
          (saleData['paidAmount'] as num? ?? 0).toDouble();

          final debt =
              totalAmount - alreadyPaid;

          final amountApplied =
          remainingPayment >= debt
              ? debt
              : remainingPayment;

          final newPaidAmount =
              alreadyPaid + amountApplied;

          saleData['paidAmount'] =
              double.parse(
                newPaidAmount.toStringAsFixed(2),
              );

          saleData['isPaid'] =
              newPaidAmount >= totalAmount - 0.001;

          remainingPayment -= amountApplied;
        }
      }

      // ------------------------------------------------------------
      // RECALCULA O RESUMO DE CADA VENDA ALTERADA
      // ------------------------------------------------------------

      for (final entry in updatedSales.entries) {
        final saleId = entry.key;
        final saleData = entry.value;

        final installments =
        saleData['installments'] as List<dynamic>?;

        if (installments != null && installments.isNotEmpty) {
          double totalPaidAmount = 0.0;
          bool allPaid = true;

          for (final item in installments) {
            final installment =
            Map<String, dynamic>.from(item as Map);

            final amount =
            (installment['amount'] as num? ?? 0).toDouble();

            final paid =
            (installment['paidAmount'] as num? ?? 0).toDouble();

            totalPaidAmount += paid;

            if (paid < amount - 0.001) {
              allPaid = false;
            }
          }

          saleData['totalPaidAmount'] =
              double.parse(
                totalPaidAmount.toStringAsFixed(2),
              );

          saleData['isPaid'] = allPaid;
        }

        final snapshot = saleSnapshots[saleId]!;

        transaction.update(
          snapshot.reference,
          saleData,
        );
      }

      // ------------------------------------------------------------
      // REGISTRA UMA ÚNICA ENTRADA NO FLUXO DE CAIXA
      // ------------------------------------------------------------

      final cashFlowRef = firestore
          .collection('stores')
          .doc(_storeId)
          .collection('cash_flow')
          .doc();

      transaction.set(cashFlowRef, {
        'description':
        'Recebimento de $customerName',
        'amount': amountToPay,
        'type': 'Entrada',
        'createdAt': Timestamp.now(),
      });
    });

    notifyListeners();
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