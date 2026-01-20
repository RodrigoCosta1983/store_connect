import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'subscription_base.dart';

/// Stub usado no ambiente Web (onde in_app_purchase não é suportado)
class SubscriptionProviderStub extends SubscriptionBase {
  bool _isAvailable = false;
  bool _isLoading = false;

  @override
  bool get isAvailable => _isAvailable;

  @override
  bool get isLoading => _isLoading;

  @override
  List<ProductDetails> get products => [];

  @override
  Future<void> initStoreInfo() async {
    debugPrint('[Stub] initStoreInfo() chamado — sem suporte no Web.');
    _isAvailable = false;
    _isLoading = false;
    notifyListeners();
  }

  @override
  Future<void> buySubscription(ProductDetails product) async {
    debugPrint('[Stub] buySubscription() chamado — sem suporte no Web.');
  }

  @override
  void setOnPurchaseSuccessCallback(VoidCallback? callback) {
    debugPrint('[Stub] setOnPurchaseSuccessCallback() ignorado no Web.');
  }
}
