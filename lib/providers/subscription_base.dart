import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

abstract class SubscriptionBase extends ChangeNotifier {
  bool get isAvailable;
  bool get isLoading;
  List<ProductDetails> get products;

  Future<void> initStoreInfo();
  Future<void> buySubscription(ProductDetails product);
  void setOnPurchaseSuccessCallback(VoidCallback? callback);
}
