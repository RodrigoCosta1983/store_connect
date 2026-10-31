import 'dart:convert';
import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import '../data/local/variant_intent_store.dart';
import '../data/local/variant_intent_store_factory.dart';
import '../firebase/app_environment.dart';

typedef VariantRegistrationCall = Future<Map<String, dynamic>> Function(
  String endpoint, Map<String, dynamic> data);

int variantMoneyCents(String text) {
  final match = RegExp(r'^(\d+)(?:[.,](\d{1,2}))?$').firstMatch(text.trim());
  if (match == null) throw const FormatException('Informe um valor com até dois decimais.');
  final value = int.parse(match[1]!) * 100 + int.parse((match[2] ?? '').padRight(2, '0'));
  if (value > 9007199254740991) throw const FormatException('Valor fora do limite seguro.');
  return value;
}

String newVariantRegistrationId() => List.generate(16,
  (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();

/// A durable, immutable registration slot per actor/store/project. Reuses the
/// existing F10 CAS store, in its own namespace, without opening F9 queues.
class VariantProductRegistration {
  final VariantIntentStore store;
  final Map<String, dynamic> scope;
  final Future<Map<String, dynamic>> Function() currentScope;
  final Future<Map<String, dynamic>> Function()? localScope;
  final VariantRegistrationCall call;
  VariantProductRegistration({required this.store, required Map<String, dynamic> scope,
    required this.currentScope, required this.call, this.localScope}) : scope = Map.unmodifiable(scope);
  String get key => 'f10-registration-v1:${jsonEncode([scope['projectId'], scope['uid'], scope['storeId']])}';

  static Future<VariantProductRegistration> open(String storeId, {bool allowCached = false}) async {
    final app = Firebase.app();
    final environment = AppConfiguration.environment;
    if (environment != AppEnvironment.hml) throw StateError('Cadastro F10 ainda não habilitado em PROD.');
    environment.validateIdentity(projectId: app.options.projectId, appId: app.options.appId, web: kIsWeb);
    final auth = FirebaseAuth.instanceFor(app: app);
    final firestore = FirebaseFirestore.instanceFor(app: app);
    Future<Map<String, dynamic>> binding([bool cached = false]) async {
      final uid = auth.currentUser?.uid;
      if (uid == null) throw StateError('Entre novamente para cadastrar variantes.');
      final profile = await firestore.collection('users').doc(uid).get(GetOptions(source: cached ? Source.cache : Source.server));
      final data = profile.data();
      if (auth.currentUser?.uid != uid || data?['storeId'] != storeId ||
          '${data?['accessStatus']}'.trim().toLowerCase() == 'revoked' ||
          !['admin', 'gerente', 'operador', 'caixa', 'vendedor'].contains('${data?['role']}'.trim().toLowerCase())) {
        throw StateError('Perfil ou loja não autorizado.');
      }
      return {'projectId': app.options.projectId, 'uid': uid, 'storeId': storeId};
    }
    Map<String, dynamic> scope;
    try { scope = await binding(); }
    on FirebaseException catch (e) {
      if (!allowCached || !['unavailable', 'deadline-exceeded'].contains(e.code)) rethrow;
      scope = await binding(true); // Pending intent only; server still authorizes effects.
    }
    final sdk = FirebaseFunctions.instanceFor(app: app, region: 'us-central1');
    final store = await openVariantIntentStore();
    return VariantProductRegistration(store: store, scope: scope, currentScope: binding, localScope: () => binding(true),
      call: (endpoint, data) async {
        final result = await sdk.httpsCallableFromUrl(
          'https://us-central1-${environment.projectId}.cloudfunctions.net/$endpoint',
          options: HttpsCallableOptions(timeout: const Duration(seconds: 60))).call(data);
        return Map<String, dynamic>.from(result.data as Map);
      });
  }

  Future<void> _check() async {
    final current = await currentScope();
    if (scope.length != current.length || scope.entries.any((e) => current[e.key] != e.value)) {
      throw StateError('Operador ou loja alterado. Intenção preservada na origem.');
    }
  }
  Future<Map<String, dynamic>?> pending() async {
    final raw = await store.read(key);
    if (raw == null) return null;
    final value = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    if (['confirmed', 'abandoned'].contains(value['status'])) return null;
    return value;
  }
  Future<Map<String, dynamic>> prepare(Map<String, dynamic> command) async {
    final snapshot = Map<String, dynamic>.from(jsonDecode(jsonEncode(command)) as Map);
    if (utf8.encode(jsonEncode(snapshot)).length > 400000) {
      throw const FormatException('Cadastro muito grande. Reduza as opções ou divida em produtos distintos.');
    }
    await _check();
    if (!mapEquals(Map<String, dynamic>.from(snapshot['scope'] as Map), scope)) throw StateError('Identidade inválida.');
    final before = await store.read(key);
    if (before != null && !['confirmed', 'abandoned'].contains((jsonDecode(before) as Map)['status'])) {
      throw StateError('Recupere o cadastro pendente antes de iniciar outro.');
    }
    final frozen = jsonEncode({'status': 'prepared', 'command': snapshot});
    if (!await store.compareAndSet(key, before, frozen) || await store.read(key) != frozen) {
      throw StateError('Não foi possível persistir a intenção. Nenhum envio iniciado.');
    }
    return Map<String, dynamic>.from(jsonDecode(frozen) as Map);
  }
  Future<void> abandonRejected() async {
    await _check();
    final raw = await store.read(key);
    if (raw == null) return;
    final saved = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    if (saved['status'] != 'rejected') throw StateError('Resultado desconhecido exige recuperação.');
    await store.compareAndSet(key, raw, jsonEncode({...saved, 'status': 'abandoned'}));
  }
  Future<Map<String, dynamic>> synchronize() async {
    await _check();
    final raw = await store.read(key);
    if (raw == null) throw StateError('Não há intenção persistida.');
    final saved = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    final command = Map<String, dynamic>.from(saved['command'] as Map);
    if (saved['status'] == 'abandoned') throw StateError('Cadastro rejeitado encerrado.');
    if (saved['status'] == 'confirmed') return Map<String, dynamic>.from(saved['result'] as Map);
    // Mark uncertain BEFORE network. Process death cannot erase this command.
    final unknown = jsonEncode({...saved, 'status': 'unknown'});
    if (!await store.compareAndSet(key, raw, unknown)) throw StateError('Outra tentativa está usando este cadastro.');
    var sending = false;
    try {
      var result = await call('getVariantProductRegistrationResultV1', command);
      await _check();
      if (result['status'] == 'unknown') {
        if (result['requestId'] != command['requestId'] || result['productId'] != command['productId']) {
          throw StateError('Consulta de resultado incompatível.');
        }
        sending = true;
        result = await call('registerVariantProductV1', command);
        await _check();
      }
      if (result['status'] != 'created' || result['productId'] != command['productId'] ||
          result['requestId'] != command['requestId'] ||
          !listEquals(result['variantIds'] as List?, (command['variants'] as List).map((v) => v['variantId']).toList())) {
        throw StateError('Comprovante inválido. Recuperação necessária.');
      }
      await store.compareAndSet(key, unknown, jsonEncode({...saved, 'status': 'confirmed', 'result': result}));
      return result;
    } on FirebaseFunctionsException catch (e) {
      if (sending && ['invalid-argument', 'already-exists', 'failed-precondition'].contains(e.code)) {
        await store.compareAndSet(key, unknown, jsonEncode({...saved, 'status': 'rejected', 'reason': e.message}));
      }
      rethrow;
    }
  }
  Future<Map<String, dynamic>> list(String productId) async {
    await _check();
    final rows = <dynamic>[];
    Map<String, dynamic>? cursor, first;
    do {
      final input = <String, dynamic>{'scope': scope, 'productId': productId, 'pageSize': 50};
      if (cursor != null) input['cursor'] = cursor;
      final page = await call('listRegisteredProductVariantsV1', input);
      await _check();
      if (page['status'] != 'available' || !mapEquals(Map<String, dynamic>.from(page['scope'] as Map), scope) ||
          page['identity']?['productId'] != productId || page['identity']?['variantId'] != null) {
        throw StateError('Leitura de variantes não confirmada: ${page['reason'] ?? page['status']}');
      }
      first ??= page;
      final pagination = Map<String, dynamic>.from(page['pagination'] as Map);
      final expected = first['pagination'] as Map;
      if (pagination['fingerprint'] != expected['fingerprint'] || pagination['offset'] != rows.length ||
          pagination['totalCount'] != expected['totalCount'] || rows.length > 200) {
        throw StateError('Listagem alterada. Atualize a leitura.');
      }
      rows.addAll(page['variants'] as List);
      cursor = pagination['nextCursor'] == null ? null : Map<String, dynamic>.from(pagination['nextCursor'] as Map);
      if (pagination['complete'] != (cursor == null)) throw StateError('Listagem incompleta.');
    } while (cursor != null);
    if (rows.length != (first['pagination'] as Map)['totalCount']) throw StateError('Listagem incompleta.');
    return {...first, 'variants': rows};
  }
  Future<void> close() => store.close();
}
