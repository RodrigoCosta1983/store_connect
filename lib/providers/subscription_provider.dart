// lib/providers/subscription_provider.dart

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

const String _subscriptionId = 'plano_mensal_storeconnect';

class SubscriptionProvider with ChangeNotifier {
  final InAppPurchase _inAppPurchase = InAppPurchase.instance;
  late StreamSubscription<List<PurchaseDetails>> _subscription;

  List<ProductDetails> _products = [];
  bool _isAvailable = false;
  bool _isLoading = true;

  // ✅ ADICIONA CALLBACK PARA NOTIFICAR QUANDO COMPRA FOR CONCLUÍDA
  VoidCallback? _onPurchaseSuccess;

  List<ProductDetails> get products => _products;
  bool get isAvailable => _isAvailable;
  bool get isLoading => _isLoading;

  // ✅ MÉTODO PARA DEFINIR O CALLBACK
  void setOnPurchaseSuccessCallback(VoidCallback? callback) {
    _onPurchaseSuccess = callback;
  }

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

  Future<void> _handleSuccessfulPurchase(PurchaseDetails purchaseDetails) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      print('❌ Usuário não autenticado para processar compra');
      return;
    }

    print('🔄 Iniciando processamento da compra...');
    print('   User ID: ${user.uid}');
    print('   Purchase ID: ${purchaseDetails.purchaseID}');
    print('   Product ID: ${purchaseDetails.productID}');

    try {
      final userDoc = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();

      if (!userDoc.exists) {
        print('❌ Documento do usuário não existe');
        return;
      }

      final storeId = userDoc.data()?['storeId'] as String?;
      if (storeId == null || storeId.isEmpty) {
        print('❌ StoreId não encontrado no documento do usuário');
        return;
      }

      print('   Store ID encontrado: $storeId');

      final updateData = {
        'subscriptionStatus': 'active',
        'productId': purchaseDetails.productID,
        'purchaseDate': Timestamp.now(),
        'googlePlayOrderId': purchaseDetails.purchaseID,
        'lastUpdated': Timestamp.now(),
      };

      print('   Atualizando documento da loja...');
      print('   Dados: $updateData');

      await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .set(updateData, SetOptions(merge: true));

      print('✅ Assinatura ativada com sucesso!');
      print('   Store ID: $storeId');
      print('   Status: active');

      notifyListeners();

      // ✅ AGUARDA UM POUCO ANTES DE CHAMAR O CALLBACK PARA GARANTIR QUE A UI ESTEJA ESTÁVEL
      print('🔄 Aguardando UI estabilizar...');
      await Future.delayed(const Duration(milliseconds: 1000));

      print('🔄 Chamando callback para atualizar AuthGate...');
      if (_onPurchaseSuccess != null) {
        _onPurchaseSuccess!();
      }

    } catch (e, stackTrace) {
      print('❌ Erro ao processar compra: $e');
      print('   Stack: $stackTrace');
    }
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}