import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'variant_product_registration.dart';
import 'sale_mutation_command.dart';

/// Separate durable mutation slot; never repurposes registration or F9 intents.
class VariantProductManagement {
  final VariantProductRegistration transport;
  VariantProductManagement(this.transport);
  static Future<VariantProductManagement> open(String storeId) async =>
    VariantProductManagement(await VariantProductRegistration.open(storeId));
  String get key => 'f10-management-v1:${saleHash(transport.scope)}';
  Future<void> check() async {
    if (!mapEquals(await transport.currentScope(), transport.scope)) throw StateError('Sessão alterada. Operação preservada na origem.');
  }
  Future<Map<String, dynamic>?> pending() async {
    await check();
    final raw = await transport.store.read(key);
    if (raw == null) return null;
    final record = saleObject(jsonDecode(raw)), hash = record.remove('integrity');
    if (hash != saleHash(record) || !mapEquals(saleObject(record['command']['scope']), transport.scope)) {
      throw StateError('Intenção inválida. Preserve os dados locais.');
    }
    return record['status'] == 'acknowledged' ? null : record;
  }
  String seal(Map<String, dynamic> data) => saleJson({...data, 'integrity': saleHash(data)});
  Future<Map<String, dynamic>> load(String productId) async {
    await check();
    final result = await transport.call('getVariantProductManagementStateV1', {'scope': transport.scope, 'productId': productId});
    await check();
    if (result['status'] != 'available' || result['productId'] != productId ||
        !mapEquals(saleObject(result['scope']), transport.scope)) throw StateError('Leitura de gestão não confirmada.');
    return result;
  }
  Future<void> prepare(Map<String, dynamic> state, String? variantId, String action,
      Map<String, dynamic> changes, String reason) async {
    await check();
    if (await pending() != null) throw StateError('Recupere a alteração original antes de outra.');
    if (!mapEquals(saleObject(state['scope']), transport.scope)) throw StateError('Leitura de outra sessão.');
    final raw = await transport.store.read(key);
    if (raw != null) {
      final previous = saleObject(jsonDecode(raw)), integrity = previous.remove('integrity');
      if (integrity != saleHash(previous) || previous['status'] != 'acknowledged') throw StateError('Outra intenção já ocupa a gestão.');
    }
    final command = {'schemaVersion': 1, 'requestId': newVariantRegistrationId(), 'scope': transport.scope,
      'productId': state['productId'], 'variantId': variantId, 'expectedFingerprint': state['fingerprint'],
      'expectedAdmissionEpoch': state['admissionEpoch'], 'action': action, 'changes': changes, 'reason': reason};
    final record = seal({'status': 'prepared', 'command': command});
    if (!await transport.store.compareAndSet(key, raw, record)) throw StateError('Operação concorrente. Nada enviado.');
    await check();
  }
  Future<Map<String, dynamic>> recover({bool send = false}) async {
    final saved = await pending();
    if (saved == null) throw StateError('Nenhuma operação pendente.');
    if (['confirmed', 'rejected', 'identity-conflict'].contains(saved['status'])) return saleObject(saved['result']);
    final raw = await transport.store.read(key);
    if (raw != seal(saved)) throw StateError('Intenção concorrente.');
    final unknown = seal({...saved, 'status': 'unknown'});
    if (!await transport.store.compareAndSet(key, raw, unknown)) throw StateError('Operação concorrente.');
    final command = saleObject(saved['command']);
    var result = await transport.call('getVariantProductManagementResultV1', command);
    await check();
    if (result['requestId'] != command['requestId']) throw StateError('Identidade de comprovante divergente.');
    if (result['status'] == 'not-recorded' && send) {
      result = await transport.call('manageVariantProductV1', command); await check();
    }
    if (result['requestId'] != command['requestId'] || !['confirmed', 'rejected', 'identity-conflict', 'not-recorded'].contains(result['status'])) {
      throw StateError('Resultado inconclusivo. Preserve a intenção.');
    }
    if (result['status'] != 'not-recorded' && !await transport.store.compareAndSet(key, unknown,
        seal({...saved, 'status': result['status'], 'result': result}))) throw StateError('Resultado concorrente. Consulte novamente.');
    return result;
  }
  Future<void> acknowledge() async {
    final saved = await pending();
    if (saved == null || !['confirmed', 'rejected'].contains(saved['status'])) throw StateError('Resultado inconclusivo não pode ser encerrado.');
    final raw = seal(saved), archive = '$key:resolved:${saleHash(saved['command'])}';
    final existing = await transport.store.read(archive);
    if (existing != null && existing != raw) throw StateError('Evidência divergente.');
    if (existing == null && !await transport.store.compareAndSet(archive, null, raw)) throw StateError('Não foi possível preservar a prova.');
    // Archival commits first; an interruption keeps the active pointer blocked.
    if (!await transport.store.compareAndSet(key, raw, seal({...saved, 'status': 'acknowledged'}))) throw StateError('Operação concorrente.');
  }
  Future<void> close() => transport.close();
}
