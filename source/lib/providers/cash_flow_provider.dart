import 'package:flutter/material.dart';
import '../services/commercial_operation_service.dart';

class CashFlowProvider with ChangeNotifier {
  final CommercialOperationService? operations;
  CashFlowProvider({this.operations});
  Future<Map<String,dynamic>> addCashFlowEntry({required String description,required double amount,
    required String type,required String storeId,String category='Outros',DateTime? occurredAt}) async {
    if(!amount.isFinite || amount<=0 || amount>1000000000 ||
      (amount*100-(amount*100).round()).abs()>0.00001 || !{'Entrada','Saída'}.contains(type) ||
      description.trim().isEmpty || description.length>2048 || category.trim().isEmpty || category.length>120 ||
      occurredAt!=null && (occurredAt.year<2000 || occurredAt.year>2101)) {
      throw ArgumentError('Revise valor, tipo, categoria e motivo.');
    }
    final result=await withCommercialOperationSession(storeId:storeId,service:operations,
      action:(service,scope,current)=>service.execute(operation:CommercialOperation.manualCash,
        scope:scope,isCurrent:current,intent:{'amountCents':(amount*100).round(),'type':type,
          'category':category.trim(),'reason':description.trim(),if(occurredAt!=null)'occurredAtMs':occurredAt.millisecondsSinceEpoch}));
    if(result['status']!='confirmed')throw StateError('Movimentação não confirmada: ${result['status']}');
    notifyListeners();return result;
  }
  Future<Map<String,dynamic>> recover(String storeId) => withCommercialOperationSession(
    storeId:storeId,service:operations,action:(service,scope,current)=>service.execute(
      operation:CommercialOperation.manualCash,scope:scope,isCurrent:current,recoverOnly:true));
  Future<void> beginNew(String storeId) => withCommercialOperationSession(storeId:storeId,service:operations,
    action:(service,scope,current)=>service.acknowledge(CommercialOperation.manualCash,scope,current));
}
