// lib/providers/sales_provider.dart

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import '../services/commercial_checkout_legacy_guard.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/models/abc_product_model.dart';
import 'cash_flow_provider.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../services/debt_payment_service.dart';
import '../services/commercial_operation_service.dart';

class SalesProvider with ChangeNotifier {
  var isLoading = false;
  int _financialGeneration = 0;
  String? _storeId; // Variável interna para guardar o ID da loja

  // Construtor agora é simples e não exige mais o storeId
  final DebtPaymentService? _debtPayments;
  final CommercialOperationService? _commercialOperations;
  SalesProvider({DebtPaymentService? debtPayments, CommercialOperationService? commercialOperations})
    : _debtPayments = debtPayments, _commercialOperations = commercialOperations;

  // Novo método para atualizar o storeId após o login
  void updateStoreId(String newId) {
    if (_storeId != newId) _financialGeneration++;
    _storeId = newId;
    notifyListeners(); // Notifica caso alguma UI dependa de saber se o ID já existe
  }

  Future<T> _commercial<T>(Future<T> Function(CommercialOperationService service,
      Map<String,dynamic> scope,bool Function() current) action, {String? expectedStoreId}) {
    final storeId=_storeId, generation=_financialGeneration;
    if(storeId==null || expectedStoreId!=null && expectedStoreId!=storeId) {
      throw StateError('Loja da operação foi substituída.');
    }
    return withCommercialOperationSession(storeId:storeId,service:_commercialOperations,
      isStoreCurrent:()=>_storeId==storeId && _financialGeneration==generation,action:action);
  }

  Future<Map<String,dynamic>> addOrder({
    required List<CartItem> cartProducts, required double total, required Customer customer,
    required DateTime dueDate, required String notes, int installmentCount=1, String? expectedStoreId,
  }) async {
    final originStore=_storeId,originGeneration=_financialGeneration;
    if(originStore==null || expectedStoreId!=null && originStore!=expectedStoreId) {
      throw StateError('Loja da operação foi substituída.');
    }
    await requireNoActiveCommercialCheckout(Firebase.app().options.projectId,originStore,
      borrowedStore:_commercialOperations?.store,allowDeferred:true);
    if(_storeId!=originStore || originGeneration!=_financialGeneration)throw StateError('Loja substituída durante verificação.');
    int cents(double value) {
      if(!value.isFinite || value<0 || value>1000000000 || (value*100-(value*100).round()).abs()>0.00001) {
        throw ArgumentError('Preço inválido para venda a prazo.');
      }
      return (value*100).round();
    }
    final totalCents=cents(total), seen=<String>{};
    final items=cartProducts.map((item){
      if(item.variantId!=null || item.quantity<=0 || !seen.add(item.productId)) throw ArgumentError('Itens inválidos para fiado F9 simples. Variantes exigem o protocolo F10.');
      return {'productId':item.productId,'quantity':item.quantity,'expectedUnitPriceCents':cents(item.price)};
    }).toList()..sort((a,b)=>(a['productId'] as String).compareTo(b['productId'] as String));
    if(totalCents<=0 || items.isEmpty || items.length>100 || installmentCount<1 || installmentCount>12 ||
      dueDate.year<2000 || dueDate.year>2101 || notes.length>2048 ||
      (totalCents/installmentCount).round()<=0 || totalCents-(totalCents/installmentCount).round()*(installmentCount-1)<=0 ||
      items.fold<int>(0,(acc,item)=>acc+(item['quantity'] as int)*(item['expectedUnitPriceCents'] as int))!=totalCents) {
      throw ArgumentError('Plano de parcelas/total inválido. Revise a venda.');
    }
    final date='${dueDate.year.toString().padLeft(4,'0')}-${dueDate.month.toString().padLeft(2,'0')}-${dueDate.day.toString().padLeft(2,'0')}';
    return _commercial((service,scope,current) async {
      await requireNoActiveCommercialCheckout(scope['projectId'] as String,scope['storeId'] as String,
        borrowedStore:service.store,allowDeferred:true);
      return service.execute(operation:CommercialOperation.deferredSale,scope:scope,isCurrent:current,intent:{
        'items':items,'expectedTotalCents':totalCents,'customerId':customer.id,'notes':notes,
        'installmentCount':installmentCount,'firstDueDate':date,'utcOffsetMinutes':dueDate.timeZoneOffset.inMinutes});
    },expectedStoreId:expectedStoreId);
  }

  Future<Map<String,dynamic>> recoverDeferredSale(String storeId) => _commercial(
    (service,scope,current)=>service.execute(operation:CommercialOperation.deferredSale,
      scope:scope,isCurrent:current,recoverOnly:true),expectedStoreId:storeId);

  Future<void> acknowledgeDeferredSale(String storeId) => _commercial(
    (service,scope,current)=>service.acknowledge(CommercialOperation.deferredSale,scope,current),expectedStoreId:storeId);

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
        final identity = jsonEncode([item.productId, item.variantId]);
        productData.putIfAbsent(
          identity,
              () => AbcProduct(productId: item.productId, variantId: item.variantId, productName: item.name),
        );
        productData[identity]!.totalRevenue += revenue;
        productData[identity]!.totalQuantity += item.quantity;
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

  Future<T> _financial<T>(Future<T> Function(DebtPaymentService service,
      Map<String, dynamic> scope, bool Function() current) action) async {
    final app = Firebase.app();
    final user = FirebaseAuth.instanceFor(app: app).currentUser;
    final storeId = _storeId;
    final generation = _financialGeneration;
    if (user == null || storeId == null) throw StateError('Sessão e loja obrigatórias.');
    var replaced = false;
    final auth = FirebaseAuth.instanceFor(app: app);
    final observer = auth.authStateChanges().listen((value) {
      if (value?.uid != user.uid) replaced = true;
    });
    bool current() => !replaced && _storeId == storeId && generation == _financialGeneration &&
      auth.currentUser?.uid == user.uid;
    try {
      final service = _debtPayments ?? await DebtPaymentService.shared();
      if (!current()) throw StateError('Sessão substituída.');
      return await action(service, {'projectId': app.options.projectId, 'uid': user.uid,
        'storeId': storeId}, current);
    } finally {
      await observer.cancel();
    }
  }

  int _paymentCents(double amount) {
    if (!amount.isFinite || amount <= 0 || amount > 1000000000 ||
        (amount * 100 - (amount * 100).round()).abs() > 0.00001) {
      throw ArgumentError('Informe um valor positivo com até duas casas decimais.');
    }
    return (amount * 100).round();
  }

  void _requireFinancialStore(String? expectedStoreId) {
    if (expectedStoreId != null && expectedStoreId != _storeId) {
      throw StateError('Loja da tela foi substituída. Reabra os recebimentos.');
    }
  }

  Future<void> beginCustomerDebtPayment(String customerId, {String? expectedStoreId}) {
    _requireFinancialStore(expectedStoreId);
    return _financial((service, scope, current) => service.beginNew(scope, 'customer:$customerId'));
  }

  Future<void> _acceptPayment(Map<String, dynamic> result) async {
    if (result['status'] != 'confirmed') {
      throw StateError('Recebimento: ${result['reason'] ?? result['status']}. Consulte antes de repetir.');
    }
    notifyListeners();
  }

  Future<void> receiveCustomerDebtPayment({
    required String customerId,
    required String customerName,
    required double amountToPay,
    String? expectedStoreId,
  }) async {
    _requireFinancialStore(expectedStoreId);
    final amount = _paymentCents(amountToPay);
    final result = await _financial((service, scope, current) => service.execute(
      scope: scope, target: 'customer:$customerId', isCurrent: current,
      customerId: customerId, amountCents: amount));
    await _acceptPayment(result);
  }

  Future<void> recoverCustomerDebtPayment(String customerId, {String? expectedStoreId}) async {
    _requireFinancialStore(expectedStoreId);
    final result = await _financial((service, scope, current) => service.execute(
      scope: scope, target: 'customer:$customerId', isCurrent: current, recoverOnly: true));
    await _acceptPayment(result);
  }

  Future<void> markOrderAsPaid(String orderId, double amount,
      CashFlowProvider cashFlowProvider, {String? expectedStoreId, String? customerId}) async {
    _requireFinancialStore(expectedStoreId);
    final cents = _paymentCents(amount);
    final target = customerId == null ? 'sale:$orderId' : 'customer:$customerId';
    final result = await _financial((service, scope, current) async {
      await service.beginNew(scope, target, settlementSaleId: orderId);
      return service.execute(scope: scope, target: target, isCurrent: current,
        saleId: orderId, amountCents: cents);
    });
    await _acceptPayment(result);
  }

  Future<void> recoverOrderDebtPayment(String orderId,
      {String? expectedStoreId, String? customerId}) async {
    _requireFinancialStore(expectedStoreId);
    final target = customerId == null ? 'sale:$orderId' : 'customer:$customerId';
    final result = await _financial((service, scope, current) => service.execute(
      scope: scope, target: target, saleId: orderId, isCurrent: current, recoverOnly: true));
    await _acceptPayment(result);
  }
}
