import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

Map<String, dynamic> buildProductUpdatePayload({
  required String productId,
  required String requestId,
  required Map<String, dynamic> data,
}) {
  final product = Map<String, dynamic>.from(data)..remove('name_lowercase');
  product['lotes'] = (data['lotes'] as List).map((raw) {
    final lot = Map<String, dynamic>.from(raw as Map);
    final validity = lot['validade'];
    final date = validity is Timestamp
        ? validity.toDate()
        : validity as DateTime;
    return <String, dynamic>{
      'quantidade': lot['quantidade'],
      'validadeMs': date.millisecondsSinceEpoch,
    };
  }).toList();
  if (product['fiscal'] is Map) {
    product['fiscal'] = Map<String, dynamic>.from(product['fiscal'] as Map)
      ..remove('updatedAt');
  }
  return {'productId': productId, 'requestId': requestId, 'product': product};
}

class ProductUpdateService {
  Future<void> update({
    required String productId,
    required String requestId,
    required Map<String, dynamic> data,
  }) async {
    final result = await FirebaseFunctions.instance
        .httpsCallable(
          'updateProduct',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
        )
        .call(
          buildProductUpdatePayload(
            productId: productId,
            requestId: requestId,
            data: data,
          ),
        );
    final response = result.data;
    if (response is! Map ||
        response['success'] != true ||
        response['productId'] != productId) {
      throw StateError('Resposta inválida ao editar produto.');
    }
  }
}
