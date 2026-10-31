import 'package:cloud_firestore/cloud_firestore.dart';

String normalizeProductCod(String? value) => (value ?? '').trim().toUpperCase();

String? validateProductCod(String? value) =>
    normalizeProductCod(value).length > 40
    ? 'O COD deve ter no máximo 40 caracteres.'
    : null;

bool matchesProductSearch(Map<String, dynamic> data, String query) {
  final term = query.trim().toLowerCase();
  final name = (data['name_lowercase'] ?? data['name'] ?? '').toString();
  return name.toLowerCase().contains(term) ||
      (data['cod'] ?? '').toString().toLowerCase().contains(term);
}

class ProductCodService {
  final FirebaseFirestore firestore;
  ProductCodService(this.firestore);

  Future<bool> isInUse(
    String storeId,
    String? value, {
    String? excludingId,
  }) async {
    final cod = normalizeProductCod(value);
    if (cod.isEmpty) return false;
    final result = await firestore
        .collection('stores')
        .doc(storeId)
        .collection('products')
        .where('cod', isEqualTo: cod)
        .get();
    return result.docs.any((doc) => doc.id != excludingId);
  }
}
