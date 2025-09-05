import 'package:flutter/foundation.dart';

class CashFlowProvider with ChangeNotifier {
  double _currentBalance = 0.0;

  double get currentBalance => _currentBalance;

  void addIncome(double amount) {
    _currentBalance += amount;
    notifyListeners();
  }
}