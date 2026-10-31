import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';

typedef BillingCall = Future<Map<String, dynamic>> Function(String, Map<String, dynamic>);

// Only structured codes/reasons are displayed; never expose provider payloads.
String billingReadErrorMessage(Object error, {required String endpoint}) {
  final code = error is FirebaseException ? error.code : 'read-failed';
  final details = error is FirebaseFunctionsException ? error.details : null;
  final reason = details is Map ? details['reason'] : null;
  String message;
  if (reason == 'provider_operations_disabled') {
    message = 'Consulta externa bloqueada por segurança. O estado local da loja não comprova pagamento.';
  } else if (reason == 'credential_unavailable' || reason == 'upstream_unauthorized' || reason == 'upstream_forbidden') {
    message = 'Credencial Asaas indisponível. A consulta foi recusada pelo provedor.';
  } else if (code == 'not-found' || code == 'unimplemented') {
    message = 'Serviço de consulta ainda não publicado ou recurso não encontrado.';
  } else if (code == 'unavailable' || code == 'deadline-exceeded') {
    message = 'Serviço de consulta temporariamente indisponível.';
  } else if (code == 'permission-denied' || code == 'unauthenticated') {
    message = 'Consulta não autorizada. Confira a sessão e as permissões da loja.';
  } else if (code == 'failed-precondition') {
    message = 'Consulta bloqueada por uma condição de segurança ou vínculo pendente.';
  } else if (code == 'internal') {
    message = 'Falha interna na consulta. A causa precisa ser conferida no servidor.';
  } else {
    message = 'Não foi possível consultar o estado financeiro.';
  }
  return '$message ($code; $endpoint). Nenhuma contratação ou cobrança foi iniciada.';
}

class SubscriptionBillingAccess {
  final String storeId;
  final Future<String?> Function() read;
  final Future<void> Function(String) persist;
  final Future<void> Function() checkScope;
  final BillingCall call;
  bool _sending = false;
  SubscriptionBillingAccess({required this.storeId, required this.read, required this.persist, required this.checkScope, required this.call});
  static Future<SubscriptionBillingAccess> open(String storeId) async {
    final project = Firebase.app().options.projectId, uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) throw StateError('Autenticação necessária.');
    final key = 'billing-attempt-v1:${sha256.convert(utf8.encode(jsonEncode([project, uid, storeId])))}';
    final prefs = await SharedPreferences.getInstance();
    return SubscriptionBillingAccess(storeId: storeId,
      read: () async { await prefs.reload(); return prefs.getString(key); },
      persist: (id) async { if (!await prefs.setString(key, id)) throw StateError('Não foi possível preservar a tentativa. Nada enviado.'); },
      checkScope: () async {
        if (Firebase.app().options.projectId != project || FirebaseAuth.instance.currentUser?.uid != uid) throw StateError('Sessão alterada; preserve a tentativa original.');
      }, call: (endpoint, payload) async {
        final result = await FirebaseFunctions.instance.httpsCallable(endpoint,
          options: HttpsCallableOptions(timeout: Duration(seconds: endpoint == 'createAsaasSubscription' ? 120 : 30))).call(payload);
        return Map<String, dynamic>.from(result.data as Map);
      });
  }
  Future<Map<String, dynamic>> query() async {
    await checkScope();
    final result = await call('getAsaasSubscriptionStateV1', {'storeId': storeId});
    await checkScope();
    if (result['schemaVersion'] != 1 || result['attemptStatus'] is! String || result['canStart'] is! bool) throw StateError('Consulta financeira incompatível. Nenhuma contratação permitida.');
    return {...result, 'canStart': result['canStart'] == true && await read() == null};
  }
  Future<Uri> existingInvoice() async {
    final state = await query();
    if (state['billingState'] != 'bound') {
      throw StateError('A assinatura existente precisa ser conferida.');
    }
    await checkScope();
    final result = await call('getAsaasPortalUrl', {'storeId': storeId});
    await checkScope();
    final uri = Uri.tryParse(result['portalUrl']?.toString() ?? '');
    if (uri == null || uri.scheme != 'https' || uri.userInfo.isNotEmpty ||
        uri.hasPort && uri.port != 443 ||
        !(uri.host == 'asaas.com' || uri.host.endsWith('.asaas.com'))) {
      throw StateError('Link da cobrança indisponível.');
    }
    return uri;
  }
  Future<Map<String, dynamic>> contract(Map<String, dynamic> payload, {bool consentToContract = false}) async {
    if (!consentToContract) throw StateError('Confirmação expressa necessária. Nada enviado.');
    if (_sending) throw StateError('Tentativa em processamento.');
    _sending = true;
    try {
      final state = await query();
      if (state['canStart'] != true) throw StateError('Tentativa ou vínculo exige conferência. Nenhum reenvio.');
      final id = List.generate(16, (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0')).join();
      await persist(id); // Durable before request; never remove/rotate on timeout.
      if (await read() != id) throw StateError('Identidade local não persistida. Nada enviado.');
      await checkScope();
      final result = await call('createAsaasSubscription', {...payload, 'storeId': storeId,
        'schemaVersion': 1, 'requestId': id, 'consentToContract': true});
      await checkScope();
      return result;
    } finally { _sending = false; }
  }
}
