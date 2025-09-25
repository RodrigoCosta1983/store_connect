// lib/providers/subscription_provider.dart

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

// SUBSTITUA 'plano_mensal_storeconnect' PELO ID EXATO DO SEU PRODUTO NO PLAY CONSOLE
const String _subscriptionId = 'plano_mensal_storeconnect';

class SubscriptionProvider with ChangeNotifier {
  final InAppPurchase _inAppPurchase = InAppPurchase.instance;
  late StreamSubscription<List<PurchaseDetails>> _subscription;

  List<ProductDetails> _products = [];
  bool _isAvailable = false;
  bool _isLoading = true;

  List<ProductDetails> get products => _products;
  bool get isAvailable => _isAvailable;
  bool get isLoading => _isLoading;

  SubscriptionProvider() {
    final Stream<List<PurchaseDetails>> purchaseUpdated = _inAppPurchase.purchaseStream;
    _subscription = purchaseUpdated.listen((purchaseDetailsList) {
      _listenToPurchaseUpdated(purchaseDetailsList);
    }, onDone: () {
      _subscription.cancel();
    }, onError: (error) {
      print("Erro no stream de compras: $error");
    });

    initStoreInfo();
  }

  Future<void> initStoreInfo() async {
    _isAvailable = await _inAppPurchase.isAvailable();
    if (_isAvailable) {
      await _loadProducts();
    }
    _isLoading = false;
    notifyListeners();
  }

  Future<void> _loadProducts() async {
    try {
      final ProductDetailsResponse response = await _inAppPurchase.queryProductDetails({_subscriptionId});
      if (response.notFoundIDs.isNotEmpty) {
        print('Produto não encontrado: ${response.notFoundIDs}');
      }
      _products = response.productDetails;
      notifyListeners();
    } catch (e) {
      print("Erro ao carregar produtos: $e");
    }
  }

  Future<void> buySubscription(ProductDetails productDetails) async {
    final PurchaseParam purchaseParam = PurchaseParam(productDetails: productDetails);
    await _inAppPurchase.buyNonConsumable(purchaseParam: purchaseParam);
  }

  Future<void> _listenToPurchaseUpdated(List<PurchaseDetails> purchaseDetailsList) async {
    for (final PurchaseDetails purchaseDetails in purchaseDetailsList) {
      if (purchaseDetails.status == PurchaseStatus.purchased || purchaseDetails.status == PurchaseStatus.restored) {
        await _handleSuccessfulPurchase(purchaseDetails);
      } else if (purchaseDetails.status == PurchaseStatus.error) {
        print('Erro na compra: ${purchaseDetails.error}');
      }

      if (purchaseDetails.pendingCompletePurchase) {
        await _inAppPurchase.completePurchase(purchaseDetails);
      }
    }
  }

  // --- FUNÇÃO CORRIGIDA ---
  Future<void> _handleSuccessfulPurchase(PurchaseDetails purchaseDetails) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;

    try {
      final userDoc = await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
      final storeId = userDoc.data()?['storeId'];

      if (storeId != null) {
        // ATUALIZA O DOCUMENTO DA LOJA COM TODAS AS INFORMAÇÕES NECESSÁRIAS
        await FirebaseFirestore.instance.collection('stores').doc(storeId).update({
          'subscriptionStatus': 'active',
          'productId': purchaseDetails.productID,
          'purchaseDate': DateTime.now().toIso8601String(),
          'googlePlayOrderId': purchaseDetails.purchaseID, // <-- LINHA ADICIONADA
        });
        print('Assinatura ativada e ID do Pedido salvo para a loja: $storeId');
      }
    } catch (e) {
      print('Erro ao atualizar o status da assinatura no Firestore: $e');
    }
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}