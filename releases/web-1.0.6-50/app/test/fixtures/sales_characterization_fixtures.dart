import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/models/product_model.dart';

const characterizationStore = 'stores/characterization';
Product characterizationProduct({double price = 100}) => Product(
  id: 'p',
  name: 'Nome no carrinho',
  price: price,
  quantidade: 20,
  minimumStock: 0,
);
Map<String, dynamic> manualStock({int quantity = 20}) => {
  'name': 'Nome atual',
  'price': 999.0,
  'costPrice': 7.0,
  'quantidade': quantity,
  'lotes': <dynamic>[],
  'unknown': {'preserve': true},
};
Map<String, dynamic> lotStock() => {
  ...manualStock(quantity: 5),
  'lotes': [
    {
      'quantidade': 3,
      'validade': Timestamp(1988150400, 123456789),
      'legacyId': 'later',
      'internal': {'keep': true},
    },
    {
      'quantidade': 2,
      'validade': Timestamp(1956614400, 987654321),
      'legacyId': 'earlier',
    },
  ],
};
Map<String, dynamic> legacyDebt({double total = 100, double paid = 0}) => {
  'customerId': 'customer',
  'customerName': 'Nome histórico',
  'totalAmount': total,
  'paidAmount': paid,
  'isPaid': false,
  'paymentMethod': 'Fiado',
  'createdAt': Timestamp(1791970000, 123456789),
  'dueDate': Timestamp.fromDate(DateTime.utc(2030, 1, 1)),
  'products': [
    {'productId': 'p', 'name': 'Histórico', 'quantity': 1, 'price': total},
  ],
  'fiscal': {'legacy': 'keep'},
  'unknown': {'keep': true},
};
Map<String, dynamic> installmentDebt() => {
  ...legacyDebt(),
  'paymentMethod': 'A prazo',
  'installmentCount': 2,
  'installments': [
    {
      'number': 1,
      'amount': 50.0,
      'paidAmount': 0.0,
      'isPaid': false,
      'dueDate': Timestamp.fromDate(DateTime.utc(2030, 1, 1)),
      'paidAt': null,
      'metadata': 'keep',
    },
    {
      'number': 2,
      'amount': 50.0,
      'paidAmount': 0.0,
      'isPaid': false,
      'dueDate': Timestamp.fromDate(DateTime.utc(2030, 2, 1)),
      'paidAt': null,
    },
  ],
};
