import 'dart:convert';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import '../data/local/sale_mutation_store.dart';
import '../data/local/sale_mutation_store_factory.dart';
import 'sale_mutation_command.dart';
import 'commercial_checkout_legacy_guard.dart';

enum CommercialOperation { deferredSale, manualCash }

extension CommercialOperationProtocol on CommercialOperation {
  String get namespace => this == CommercialOperation.deferredSale
      ? 'fiado-create-v1'
      : 'manual-cash-v1';
  String get sendEndpoint => this == CommercialOperation.deferredSale
      ? 'createDeferredSaleV1'
      : 'createManualCashV1';
  String get queryEndpoint => this == CommercialOperation.deferredSale
      ? 'getDeferredSaleResultV1'
      : 'getManualCashResultV1';
}

typedef CommercialOperationCall =
    Future<Map<String, dynamic>> Function(
      String endpoint,
      Map<String, dynamic> command,
    );

/// One durable, actor-owned active command per store and protocol. Different
/// financial operations never share commands, receipts or a sale-kind adapter.
class CommercialOperationService {
  final SaleMutationStore store;
  final CommercialOperationCall call;
  CommercialOperationService({required this.store, required this.call});
  static Future<CommercialOperationService>? _opening;
  static Future<CommercialOperationService> shared() async {
    final future = _opening ??= _open();
    try {
      return await future;
    } catch (_) {
      if (identical(future, _opening)) _opening = null;
      rethrow;
    }
  }

  static Future<CommercialOperationService> _open() async =>
      CommercialOperationService(
        store: await openSaleMutationStore(),
        call: (endpoint, command) async {
          final app = Firebase.app(), scope = saleObject(command['scope']);
          if (app.options.projectId != scope['projectId'] ||
              FirebaseAuth.instanceFor(app: app).currentUser?.uid !=
                  scope['uid']) {
            throw StateError('Sessão comercial substituída.');
          }
          final result =
              await FirebaseFunctions.instanceFor(
                    app: app,
                    region: 'us-central1',
                  )
                  .httpsCallable(
                    endpoint,
                    options: HttpsCallableOptions(
                      timeout: const Duration(seconds: 30),
                    ),
                  )
                  .call(command);
          return saleObject(result.data);
        },
      );
  String _key(Map<String, dynamic> scope, CommercialOperation operation) =>
      '${operation==CommercialOperation.deferredSale?'checkout-v1:':''}${operation.namespace}:${saleHash({'projectId': scope['projectId'], 'storeId': scope['storeId']})}:active';
  String _seal(Map<String, dynamic> record) =>
      jsonEncode({...record, 'integrity': saleHash(record)});
  Map<String, dynamic> _decode(String raw, Map<String, dynamic> scope) {
    final record = saleObject(jsonDecode(raw));
    final integrity = record.remove('integrity');
    if (integrity != saleHash(record)) {
      throw StateError('Registro comercial inválido.');
    }
    final savedScope = saleObject(record['scope']);
    if (savedScope['projectId'] != scope['projectId'] ||
        savedScope['storeId'] != scope['storeId'] ||
        record['state'] == 'active' &&
            saleJson(savedScope) != saleJson(scope)) {
      throw StateError(
        'Pendência de outro operador ou registro inválido. Retome na sessão original.',
      );
    }
    return record;
  }

  Future<Map<String, dynamic>> execute({
    required CommercialOperation operation,
    required Map<String, dynamic> scope,
    required bool Function() isCurrent,
    Map<String, dynamic>? intent,
    bool recoverOnly = false,
  }) async {
    void check() {
      if (!isCurrent()) {
        throw StateError('Conta, loja ou sessão comercial substituída.');
      }
    }

    scope=saleObject(jsonDecode(saleJson(scope)));
    if(intent!=null)intent=saleObject(jsonDecode(saleJson(intent)));
    check();
    final key = _key(scope, operation);
    late String raw;
    late Map<String, dynamic> record;
    while (true) {
      final saved = await store.read(key);
      check();
      record = saved == null
          ? {'scope': scope, 'state': 'idle'}
          : _decode(saved, scope);
      if (record['state'] == 'active') {
        raw = saved!;
        break;
      }
      if (recoverOnly) {
        throw StateError('Nenhuma operação pendente neste dispositivo.');
      }
      if (intent == null ||
          intent.keys.any(
            (k) =>
                {'schemaVersion', 'requestId', 'saleId', 'scope'}.contains(k),
          )) {
        throw ArgumentError('Intenção inválida.');
      }
      final identity = SaleMutationCommand.newIdentity();
      final command = {
        'schemaVersion': 1,
        'requestId': identity,
        'scope': scope,
        ...intent,
        if (operation == CommercialOperation.manualCash &&
            !intent.containsKey('occurredAtMs'))
          'occurredAtMs': DateTime.now().millisecondsSinceEpoch,
        if (operation == CommercialOperation.deferredSale) 'saleId': identity,
      };
      record = {
        'scope': scope,
        'state': 'active',
        'operation': operation.namespace,
        'command': command,
      };
      raw = _seal(record);
      final reserved=operation==CommercialOperation.deferredSale
        ? await _reserveDeferred(scope,key,saved,raw,identity,isCurrent)
        : await store.compareAndSet(key,saved,raw);
      if (reserved) {
        record=_decode(raw,scope);
        break;
      }
    }
    final command = saleObject(record['command']);
    final frozen = Map<String, dynamic>.from(command)
      ..removeWhere(
        (key, _) =>
            {'schemaVersion', 'requestId', 'saleId', 'scope'}.contains(key),
      );
    if (operation == CommercialOperation.manualCash &&
        intent?.containsKey('occurredAtMs') != true) {
      frozen.remove('occurredAtMs');
    }
    if (!recoverOnly && saleJson(frozen) != saleJson(intent)) {
      throw StateError(
        'Existe outra intenção congelada. Consulte antes de nova operação.',
      );
    }
    check();
    var result = await call(operation.queryEndpoint, command);
    check();
    if (result['requestId'] != command['requestId']) {
      throw const FormatException('Resultado incompatível.');
    }
    if (result['status'] == 'not-recorded') {
      if (operation == CommercialOperation.deferredSale) {
        await requireNoActiveCommercialCheckout(
          scope['projectId'] as String,
          scope['storeId'] as String,
          borrowedStore: store,
          allowDeferred: true,
        );
        check();
      }
      result = await call(operation.sendEndpoint, command);
      check();
    }
    if (result['requestId'] != command['requestId'] ||
        !{
          'confirmed',
          'rejected',
          'identity-conflict',
        }.contains(result['status'])) {
      throw const FormatException(
        'Resultado desconhecido. Consulte a operação original.',
      );
    }
    await store.compareAndSet(key, raw, _seal({...record, 'result': result}));
    check();
    return result;
  }

  Future<void> acknowledge(
    CommercialOperation operation,
    Map<String, dynamic> scope,
    bool Function() isCurrent,
  ) async {
    final key = _key(scope, operation);
    while (true) {
      if (!isCurrent()) throw StateError('Sessão substituída.');
      final raw = await store.read(key);
      if (raw == null) return;
      final record = _decode(raw, scope);
      if (record['state'] != 'active') return;
      if (!{
        'confirmed',
        'rejected',
      }.contains(saleObject(record['result'] ?? {})['status'])) {
        throw StateError(
          'Resultado desconhecido/conflitante não pode ser encerrado.',
        );
      }
      final history =
          '$key:history:${saleObject(record['command'])['requestId']}';
      final old = await store.read(history);
      if (old == null && !await store.compareAndSet(history, null, raw)) {
        continue;
      }
      if (!isCurrent()) throw StateError('Sessão substituída.');
      final idle=_seal({'scope':scope,'state':'idle'});
      bool released;
      if(operation==CommercialOperation.deferredSale) {
        final familyKey=commercialSaleFamilyKey(scope['projectId'] as String,scope['storeId'] as String);
        final result=await requireAtomicSaleMutationStore(store).transact<bool>(
          SaleAtomicScope(namespace:'checkout-v1:',keys:[key,familyKey]),(snapshot){
            if(!isCurrent())throw StateError('Sessão substituída.');
            if(snapshot.values[key]!=raw)return SaleAtomicPlan(writes:{},value:false);
            final family=readCommercialSaleFamily(snapshot.values[familyKey]);
            final identity=saleObject(record['command'])['requestId'] as String;
            if(family!=null && family['state']=='active' && (family['kind']!='deferred' || family['identity']!=identity)) {
              throw StateError('Trava comercial pertence a outra intenção.');
            }
            return SaleAtomicPlan(writes:{key:idle,familyKey:sealCommercialSaleFamily(scope,'deferred',identity,key,'idle')},value:true);
          });
        released=result.value;
      }else{released=await store.compareAndSet(key,raw,idle);}
      if (released) {
        return;
      }
    }
  }

  Future<bool> _reserveDeferred(Map<String,dynamic> scope,String key,String? expected,String value,
      String identity,bool Function() isCurrent) async {
    final familyKey=commercialSaleFamilyKey(scope['projectId'] as String,scope['storeId'] as String);
    final result=await requireAtomicSaleMutationStore(store).transact<bool>(
      SaleAtomicScope(namespace:'checkout-v1:',keys:[key,familyKey]),(snapshot){
        if(!isCurrent())throw StateError('Sessão substituída.');
        if(snapshot.values[key]!=expected)return SaleAtomicPlan(writes:{},value:false);
        final family=readCommercialSaleFamily(snapshot.values[familyKey]);
        if(family!=null && family['state']=='active')throw StateError('Outra intenção comercial está ativa. Consulte o resultado.');
        return SaleAtomicPlan(writes:{key:value,familyKey:sealCommercialSaleFamily(scope,'deferred',identity,key,'active')},value:true);
      });
    return result.value;
  }
}

Future<T> withCommercialOperationSession<T>({
  required String storeId,
  required Future<T> Function(
    CommercialOperationService service,
    Map<String, dynamic> scope,
    bool Function() current,
  )
  action,
  CommercialOperationService? service,
  bool Function()? isStoreCurrent,
}) async {
  final app = Firebase.app(),
      auth = FirebaseAuth.instanceFor(app: Firebase.app()),
      user = FirebaseAuth.instanceFor(app: Firebase.app()).currentUser;
  if (user == null) throw StateError('Autenticação obrigatória.');
  var replaced = false;
  final observer = auth.authStateChanges().listen((value) {
    if (value?.uid != user.uid) replaced = true;
  });
  bool current() =>
      !replaced &&
      auth.currentUser?.uid == user.uid &&
      (isStoreCurrent?.call() ?? true);
  try {
    final active = service ?? await CommercialOperationService.shared();
    if (!current()) throw StateError('Sessão substituída.');
    return await action(active, {
      'projectId': app.options.projectId,
      'uid': user.uid,
      'storeId': storeId,
    }, current);
  } finally {
    await observer.cancel();
  }
}
