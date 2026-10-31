import 'dart:convert';

import '../data/local/contextual_sale_mutation_store.dart';
import 'sale_mutation_command.dart';

/// No sale ID is allocated here. This freezes input before the first await.
/// A request may try first creation only once; later calls are load/adopt-only.
class SaleAssociationRequest {
  final SaleStoreContext context;
  final String intentKey;
  final String candidateId;
  final String _encodedIntent;
  final bool _newIntention;
  bool _started = false;
  SaleAssociationRequest.newIntention({
    required this.context,
    required String intentKey,
    required String candidateId,
    required Map<String, dynamic> intent,
  }) : intentKey = saleId(intentKey),
       candidateId = saleId(candidateId),
       _encodedIntent = jsonEncode(intent),
       _newIntention = true;
  SaleAssociationRequest.forExisting({
    required this.context,
    required String intentKey,
    required String candidateId,
    required Map<String, dynamic> intent,
  }) : intentKey = saleId(intentKey),
       candidateId = saleId(candidateId),
       _encodedIntent = jsonEncode(intent),
       _newIntention = false;
  Map<String, dynamic> get intent => saleObject(jsonDecode(_encodedIntent));
  bool takeCreationPermit() {
    final allowed = _newIntention && !_started;
    _started = true;
    return allowed;
  }
}

enum SaleAssociationStatus { created, adopted, conflict, blocked }

Map<String, dynamic> saleAssociationMetadata(
  SaleAssociationRequest request,
  String kind,
) => {
  'version': 2,
  'kind': kind,
  'intentKey': request.intentKey,
  'scope': request.context.scope.toJson(),
  'target': request.context.target,
};

String sealSaleAssociation(Map<String, dynamic> metadata) =>
    saleJson({...metadata, 'integrity': saleHash(metadata)});

Map<String, dynamic> decodeSaleAssociation(
  String raw,
  SaleAssociationRequest request,
  String kind,
) {
  final record = saleObject(jsonDecode(raw));
  final integrity = record.remove('integrity');
  if (record['version'] != 2 ||
      record['kind'] != kind ||
      record['intentKey'] != request.intentKey ||
      record['target'] != request.context.target ||
      saleJson(record['scope']) != saleJson(request.context.scope.toJson()) ||
      integrity != saleHash(record)) {
    throw const FormatException('Invalid or historical sale association.');
  }
  return record;
}
