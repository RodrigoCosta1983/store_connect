import 'dart:convert';
import '../data/local/sale_mutation_store.dart';
import '../data/local/sale_mutation_store_factory.dart';
import 'sale_mutation_command.dart';

/// Used even when V2 opt-in is disabled after an upgrade/restart. No remote IO,
/// no deletion, no new identity. A corrupt active pointer fails closed.
Future<void> requireNoActiveCommercialCheckout(
  String projectId,
  String storeId, {
  SaleMutationStore? borrowedStore,
  bool allowDeferred = false,
}) async {
  final store = borrowedStore ?? await openSaleMutationStore();
  try {
    for (final key in await store.keys('')) {
      if (!allowDeferred && key.startsWith('checkout-v1:fiado-create-v1:') && key.endsWith(':active')) {
        final raw = await store.read(key);
        if (raw == null) throw StateError('Referência de fiado indisponível.');
        final record = saleObject(jsonDecode(raw));
        final integrity = record.remove('integrity');
        if (integrity != saleHash(record)) throw StateError('Referência de fiado inválida.');
        final scope = saleObject(record['scope']);
        if (scope['projectId'] == projectId && scope['storeId'] == storeId && record['state'] == 'active') {
          throw StateError('Fiado pendente. Consulte o resultado antes de outra venda.');
        }
      }
      if (!key.endsWith('android-active-cart')) continue;
      final raw = await store.read(key);
      if (raw == null) throw StateError('Referencia V2 indisponivel.');
      final pointer = saleObject(jsonDecode(raw));
      final integrity = pointer.remove('integrity');
      if (integrity != saleHash(pointer)) {
        throw StateError('Referencia V2 corrompida.');
      }
      final scope = saleObject(pointer['scope']);
      if (scope['projectId'] == projectId &&
          scope['storeId'] == storeId &&
          pointer['state'] == 'active') {
        throw StateError('Intencao V2 ativa; consulte o resultado original.');
      }
    }
  } finally {
    if (borrowedStore == null) await store.close();
  }
}

// Shared resource lock only. Each family retains its own command and receipt.
String commercialSaleFamilyKey(String projectId,String storeId) =>
  'checkout-v1:commercial-sale-family:${saleHash({'projectId':projectId,'storeId':storeId})}';

Map<String,dynamic>? readCommercialSaleFamily(String? raw) {
  if(raw==null)return null;
  final record=saleObject(jsonDecode(raw)),hash=saleObject(jsonDecode(raw))['integrity'];
  record.remove('integrity');
  if(hash!=saleHash(record) || !{'active','idle'}.contains(record['state']) ||
    !{'instant','deferred'}.contains(record['kind'])) {
    throw StateError('Trava comercial inválida.');
  }
  return record;
}
String sealCommercialSaleFamily(Map<String,dynamic> scope,String kind,String identity,String reference,String state) {
  final record={'scope':scope,'kind':kind,'identity':identity,'reference':reference,'state':state};
  return saleJson({...record,'integrity':saleHash(record)});
}
