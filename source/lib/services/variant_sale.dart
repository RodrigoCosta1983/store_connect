import 'dart:convert';
import '../models/sale_payment_allocation.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import '../data/local/sale_mutation_store.dart';
import '../data/local/sale_mutation_store_factory.dart';
import 'sale_mutation_command.dart';
import 'commercial_checkout_legacy_guard.dart';
import 'variant_product_registration.dart';
import '../models/cart_item_model.dart';

class VariantSaleChoice {
  final Map<String, dynamic> scope;
  final String productId, variantId, name;
  final int unitPriceCents, availableQuantity, epoch;
  String get key => jsonEncode([productId, variantId]);
  VariantSaleChoice({required Map<String, dynamic> scope, required this.productId,
    required this.variantId, required this.name, required this.unitPriceCents,
    required this.availableQuantity, required this.epoch}) : scope = Map.unmodifiable(scope) {
    if (productId.isEmpty || productId.contains('/') || variantId.isEmpty || variantId.contains('/') ||
        name.isEmpty || unitPriceCents <= 0 || unitPriceCents > 9007199254740991 ||
        availableQuantity < 0 || epoch <= 0) {
      throw const FormatException('Variante inválida.');
    }
  }
}
class VariantSaleLine {
  final VariantSaleChoice choice;
  final int quantity;
  VariantSaleLine(this.choice, this.quantity);
  int get subtotalCents => choice.unitPriceCents * quantity;
}

/// Uses the existing atomic sales SQLite/IndexedDB store and commercial family
/// lock. F9 command formats, namespaces and receipts are never reinterpreted.
class VariantSaleAccess {
  final SaleMutationStore store;
  final Map<String, dynamic> scope;
  final Future<Map<String, dynamic>> Function() currentScope;
  final Future<Map<String, dynamic>> Function()? localScope;
  final VariantRegistrationCall call;
  VariantSaleAccess({required this.store, required Map<String, dynamic> scope,
    required this.currentScope, required this.call, this.localScope}) : scope = Map.unmodifiable(scope) {
    requireAtomicSaleMutationStore(store);
  }
  static Future<VariantSaleAccess> open(String storeId) async {
    // Borrow the already verified HML/Auth/profile/FlutterFire composition.
    final origin = await VariantProductRegistration.open(storeId, allowCached: true);
    try {
      return VariantSaleAccess(store: await openSaleMutationStore(), scope: origin.scope,
        currentScope: origin.currentScope, localScope: origin.localScope, call: origin.call);
    } finally { await origin.close(); }
  }
  // The established suffix lets the existing no-active-checkout guard see this
  // F10 pointer, even with V2 disabled. Its command is never resumed as V2.
  String get key => 'checkout-v1:f10-variant-sale:${saleHash({'projectId': scope['projectId'], 'storeId': scope['storeId']})}:android-active-cart';
  String get family => commercialSaleFamilyKey(scope['projectId'] as String, scope['storeId'] as String);
  Future<void> _check({bool local = false}) async {
    if (!mapEquals(await (local ? localScope ?? currentScope : currentScope)(), scope)) throw StateError('Operador ou loja alterado. Venda preservada na origem.');
  }
  String _seal(Map<String, dynamic> value) => saleJson({...value, 'integrity': saleHash(value)});
  Map<String, dynamic> _decode(String raw) {
    final record = saleObject(jsonDecode(raw)), integrity = record.remove('integrity');
    if (integrity != saleHash(record) || !mapEquals(saleObject(record['scope']), scope) ||
        !['prepared', 'unknown', 'confirmed', 'rejected', 'identity-conflict', 'acknowledged'].contains(record['status'])) {
      throw StateError('Pendência inválida ou de outro operador. Retome na sessão original.');
    }
    return record;
  }
  Future<Map<String, dynamic>?> pending() async {
    await _check(local: true);
    final raw = await store.read(key);
    if (raw == null) return null;
    // An acknowledged record is history, not an active actor-owned command.
    final header = saleObject(jsonDecode(raw));
    if (header['status'] == 'acknowledged') {
      final integrity = header.remove('integrity');
      if (integrity != saleHash(header)) throw StateError('Histórico local inválido.');
      return null;
    }
    final value = _decode(raw); await _check(local: true); return value;
  }
  Future<Map<String, dynamic>> choices(String productId) async {
    await _check(local: true);
    final quoteKey = 'f10-sale-quotes:${saleHash(scope)}:${saleHash(productId)}';
    Map<String, dynamic> result;
    try {
      await _check();
      result = await call('getVariantSaleChoicesV1', {'scope': scope, 'productId': productId});
      await _check();
    } on FirebaseException catch (e) {
      if (!['unavailable', 'deadline-exceeded', 'network-request-failed'].contains(e.code)) rethrow;
      await _check(local: true);
      final raw = await store.read(quoteKey);
      if (raw == null) throw StateError('Sem opções previamente consultadas nesta sessão. Reconecte para carregar.');
      final cached = saleObject(jsonDecode(raw)), integrity = cached.remove('integrity');
      if (integrity != saleHash(cached)) throw StateError('Disponibilidade local inválida.');
      result = saleObject(cached['quote']);
      if (!mapEquals(saleObject(result['scope']), scope) || result['productId'] != productId) throw StateError('Disponibilidade de outra sessão.');
      return {...result, 'source': 'cache'};
    }
    if (result['status'] != 'available' || result['productId'] != productId ||
        !mapEquals(saleObject(result['scope']), scope) || result['admissionEpoch'] is! int) {
      throw StateError('Disponibilidade não confirmada pelo servidor.');
    }
    final before = await store.read(quoteKey);
    if (!await store.compareAndSet(quoteKey, before, _seal({'scope': scope, 'quote': result}))) {
      throw StateError('Não foi possível preservar a disponibilidade para esta sessão.');
    }
    return {...result, 'source': 'server'};
  }
  VariantSaleChoice choice(Map<String, dynamic> result, Map<String, dynamic> row) {
    if (row['status'] != 'available' || row['productId'] != result['productId']) throw StateError('Variante indisponível.');
    return VariantSaleChoice(scope: scope, productId: row['productId'] as String,
      variantId: row['variantId'] as String, name: row['name'] as String,
      unitPriceCents: row['unitPriceCents'] as int, availableQuantity: row['availableQuantity'] as int,
      epoch: result['admissionEpoch'] as int);
  }
  Future<void> prepare(List<VariantSaleLine> lines, String payment, String notes, {
    List<CartItem> simpleItems = const [], String? customerId, Map<String, dynamic>? deferred, bool offline = false, List<SalePaymentAllocation>? payments,
  }) async {
    final frozen = List<VariantSaleLine>.of(lines);
    if (frozen.isEmpty || frozen.length + simpleItems.length > 100 || notes.length > 2048 ||
        !(deferred != null ? payment == 'A prazo' && customerId != null && !offline && payments == null :
          ['Dinheiro', 'PIX', 'Cartão de crédito', 'Cartão de débito'].contains(payment) && payments == null ||
          payment == splitPaymentMethod && payments != null)) {
      throw StateError('Venda imediata inválida.');
    }
    final epoch = frozen.first.choice.epoch, seen = <String>{};
    var total = 0;
    for (final line in frozen) {
      if (!mapEquals(line.choice.scope, scope) || line.choice.epoch != epoch || !seen.add(line.choice.key) ||
          line.quantity <= 0 || line.quantity > line.choice.availableQuantity) {
        throw StateError('Revise as variantes e o contexto da venda.');
      }
      total += line.subtotalCents;
      if (total > 9007199254740991) throw StateError('Total fora do limite seguro.');
    }
    final simpleLines = <Map<String, dynamic>>[];
    for (final item in simpleItems) {
      if (!item.price.isFinite) throw StateError('Preço simples inválido.');
      final cents = (item.price * 100).round();
      if (item.variantId != null || item.quantity <= 0 || !item.price.isFinite || cents <= 0 ||
          (item.price * 100 - cents).abs() > 0.00001 || !seen.add(jsonEncode([item.productId, null]))) {
        throw StateError('Linha simples inválida.');
      }
      total += cents * item.quantity;
      if (total > 100000000000) throw StateError('Total fora do limite comercial.');
      simpleLines.add({'productId': item.productId, 'quantity': item.quantity, 'expectedUnitPriceCents': cents});
    }
    if (total <= 0 || total > 100000000000) throw StateError('Total fora do limite comercial.');
    final split = payments == null ? null : validateSplitPayments(payments, total);
    if (deferred != null) {
      final n = deferred['installmentCount'];
      if (n is! int || n < 1 || n > 12 || DateTime.tryParse('${deferred['firstDueDate']}') == null ||
          deferred['utcOffsetMinutes'] is! int || (deferred['utcOffsetMinutes'] as int).abs() > 840 ||
          (total / n).round() <= 0 || total - (total / n).round() * (n - 1) <= 0) {
        throw StateError('Plano de parcelas inválido para este total.');
      }
    }
    final id = newVariantRegistrationId();
    final command = {'schemaVersion': 4, 'requestId': id, 'saleId': id, 'scope': scope,
      'origin': offline ? 'offline' : 'online', 'saleKind': deferred == null ? 'instant' : 'deferred', 'expectedAdmissionEpoch': epoch,
      'items': [...frozen.map((l) => {'productId': l.choice.productId, 'variantId': l.choice.variantId,
        'quantity': l.quantity, 'expectedUnitPriceCents': l.choice.unitPriceCents}), ...simpleLines],
      'expectedTotalCents': total, 'paymentMethod': payment, if (split != null) 'payments': split.map((p) => p.toJson()).toList(),
      'notes': notes, 'customerId': customerId,
      'deferred': deferred, 'createdAtMs': DateTime.now().millisecondsSinceEpoch};
    await _check(local: offline);
    await requireNoActiveCommercialCheckout(scope['projectId'] as String, scope['storeId'] as String, borrowedStore: store);
    final priorRaw = await store.read(key);
    final prior = priorRaw == null ? null : saleObject(jsonDecode(priorRaw));
    final priorArchiveKey = prior == null ? null : '$key:resolved:${saleHash(prior['command'])}';
    final record = _seal({'scope': scope, 'state': 'active', 'status': 'prepared', 'command': command});
    await requireAtomicSaleMutationStore(store).transact<void>(SaleAtomicScope(namespace: 'checkout-v1:', keys: [key, family, ?priorArchiveKey]), (snapshot) {
      final before = snapshot.values[key];
      if (before != priorRaw) throw StateError('Intenção concorrente. Reabra a recuperação.');
      if (before != null && (saleObject(jsonDecode(before)))['status'] != 'acknowledged') throw StateError('Recupere a venda de variantes pendente.');
      if (before != null) {
        final previous = saleObject(jsonDecode(before)), integrity = previous.remove('integrity');
        if (integrity != saleHash(previous)) throw StateError('Histórico inválido.');
      }
      if (readCommercialSaleFamily(snapshot.values[family])?['state'] == 'active') throw StateError('Existe outra intenção comercial ativa.');
      // Older app versions acknowledged without a separate archive. Preserve
      // that original evidence too before replacing the active-cart pointer.
      if (priorArchiveKey != null && snapshot.values[priorArchiveKey] != null) {
        final archived = saleObject(jsonDecode(snapshot.values[priorArchiveKey]!)), integrity = archived.remove('integrity');
        if (integrity != saleHash(archived) || saleJson(archived['command']) != saleJson(prior!['command']) ||
            saleJson(archived['result']) != saleJson(prior['result'])) {
          throw StateError('Histórico divergente.');
        }
      }
      return SaleAtomicPlan(writes: {key: record, family: sealCommercialSaleFamily(scope, deferred == null ? 'instant' : 'deferred', id, key, 'active'),
        if (priorArchiveKey != null && snapshot.values[priorArchiveKey] == null) priorArchiveKey: before!}, value: null);
    });
    await _check(local: offline);
  }
  String _queryEndpoint(Map<String, dynamic> command) => switch (command['schemaVersion']) {
    3 => 'getVariantSaleResultV1', 4 => 'getVariantCommercialResultV2', _ => throw StateError('Protocolo de venda desconhecido. Preserve a intenção.'),
  };
  String _sendEndpoint(Map<String, dynamic> command) => switch (command['schemaVersion']) {
    3 => 'confirmVariantSaleV1', 4 => 'confirmVariantCommercialV2', _ => throw StateError('Protocolo de venda desconhecido. Nenhum envio permitido.'),
  };
  Future<Map<String, dynamic>> recover({bool allowSend = false}) async {
    await _check();
    final raw = await store.read(key);
    if (raw == null) throw StateError('Nenhuma venda de variantes pendente.');
    final saved = _decode(raw), command = saleObject(saved['command']);
    if (saved['status'] == 'acknowledged') throw StateError('Resultado já reconhecido.');
    if (['confirmed', 'rejected', 'identity-conflict'].contains(saved['status'])) return saleObject(saved['result']);
    final uncertain = _seal({...saved, 'status': 'unknown'});
    if (!await store.compareAndSet(key, raw, uncertain)) throw StateError('Outra tentativa está usando a venda original.');
    await _check();
    var result = await call(_queryEndpoint(command), command);
    await _check();
    if (result['saleId'] != command['saleId']) throw StateError('Identidade do comprovante inválida.');
    if (result['status'] == 'not-recorded' && allowSend) {
      result = await call(_sendEndpoint(command), command); await _check();
    }
    if (result['saleId'] != command['saleId'] ||
        !['confirmed', 'rejected', 'identity-conflict', 'not-recorded'].contains(result['status']) ||
        result['status'] == 'confirmed' && result['totalCents'] != command['expectedTotalCents']) {
      throw StateError('Comprovante incompatível. Consulte a venda original.');
    }
    if (result['status'] != 'not-recorded') {
      if (!await store.compareAndSet(key, uncertain, _seal({...saved, 'status': result['status'], 'result': result}))) {
        throw StateError('Resultado concorrente. Consulte novamente a venda original.');
      }
    }
    return result;
  }
  /// Read-only escalation: never confirms a sale, changes its epoch or releases
  /// the family lock. An absent receipt cannot settle an uncertain outcome.
  Future<Map<String, dynamic>> consultOriginal() async {
    await _check();
    final raw = await store.read(key);
    if (raw == null) throw StateError('Nenhuma venda de variantes pendente.');
    final saved = _decode(raw), command = saleObject(saved['command']);
    if (saved['status'] == 'acknowledged') throw StateError('Resultado já reconhecido.');
    final result = await call(_queryEndpoint(command), command);
    await _check();
    if (result['saleId'] != command['saleId'] ||
        !['confirmed', 'rejected', 'identity-conflict', 'not-recorded'].contains(result['status']) ||
        result['status'] == 'confirmed' && result['totalCents'] != command['expectedTotalCents']) {
      throw StateError('Comprovante incompatível. Preserve a venda original.');
    }
    // A previously sealed result must not be silently replaced or downgraded.
    if (['confirmed', 'rejected'].contains(saved['status'])) {
      final previous = saleObject(saved['result'])..remove('replayed');
      final observed = Map<String, dynamic>.from(result)..remove('replayed');
      if (saleJson(previous) != saleJson(observed)) throw StateError('Comprovantes divergentes. Preserve as evidências.');
    }
    final settled = ['confirmed', 'rejected'].contains(result['status']);
    final status = settled || result['status'] == 'identity-conflict' ? result['status'] :
      saved['status'] == 'identity-conflict' ? 'identity-conflict' : 'unknown';
    final next = {...saved, 'status': status, 'lastConsultation': result,
      if (result['status'] != 'not-recorded') 'result': result};
    // Preserve each observation independently of the next active-cart pointer.
    final evidenceKey = '$key:observation:${saleHash({'command': command, 'result': result})}';
    await requireAtomicSaleMutationStore(store).transact<void>(
      SaleAtomicScope(namespace: 'checkout-v1:', keys: [key, evidenceKey]), (snapshot) {
        if (snapshot.values[key] != raw) throw StateError('Resultado concorrente. Consulte novamente.');
        final evidence = _seal({'scope': scope, 'command': command, 'observation': result});
        if (snapshot.values[evidenceKey] != null && snapshot.values[evidenceKey] != evidence) {
          throw StateError('Evidência local divergente.');
        }
        return SaleAtomicPlan(writes: {key: _seal(next), evidenceKey: evidence}, value: null);
      });
    await _check();
    return result;
  }
  /// Private local evidence, not a server signature or permission to retry.
  Future<Map<String, dynamic>> inspectAuthoritativeEvidence() async {
    await _check();
    final raw = await store.read(key);
    if (raw == null) throw StateError('Nenhuma intenção pendente.');
    final saved = _decode(raw), command = saleObject(saved['command']);
    if (saved['status'] == 'acknowledged') throw StateError('Resultado já reconhecido.');
    final evidence = await call('inspectVariantSaleEvidenceV1', {'command': command, 'reviewerScope': scope,
      'evidenceId': newVariantRegistrationId()});
    await _check();
    final comparable = {...command, 'items': (command['items'] as List).map((i) => saleObject(i)).toList()
      ..sort((a, b) => jsonEncode([a['productId'], a['variantId']]).compareTo(jsonEncode([b['productId'], b['variantId']])))};
    if (saleJson(evidence['command']) != saleJson(comparable) || !mapEquals(saleObject(evidence['scope']), scope) ||
        evidence['saleId'] != command['saleId'] || !['blocked', 'conclusive'].contains(evidence['status']) ||
        evidence['evidencePath'] is! String || evidence['evidenceHash'] is! String) throw StateError('Evidência incompatível.');
    final proof = evidence['result'] == null ? null : saleObject(evidence['result']);
    if (evidence['status'] == 'conclusive' && (proof == null || !['confirmed', 'rejected'].contains(proof['status']) ||
        proof['saleId'] != command['saleId'] || proof['status'] == 'confirmed' && proof['totalCents'] != command['expectedTotalCents'])) {
      throw StateError('Conclusão incompatível com a intenção original.');
    }
    if (['confirmed', 'rejected'].contains(saved['status']) && proof != null) {
      final before = saleObject(saved['result'])..remove('replayed'), after = Map<String, dynamic>.from(proof)..remove('replayed');
      if (saleJson(before) != saleJson(after)) throw StateError('Comprovantes divergentes. Preserve a trava.');
    }
    final observation = '$key:authoritative:${saleHash(evidence)}';
    await requireAtomicSaleMutationStore(store).transact<void>(SaleAtomicScope(namespace: 'checkout-v1:', keys: [key, observation]), (snapshot) {
      if (snapshot.values[key] != raw) throw StateError('Intenção concorrente. Consulte novamente.');
      return SaleAtomicPlan(writes: {observation: _seal({'scope': scope, 'evidence': evidence}),
        key: _seal({...saved, 'authoritativeEvidence': evidence,
          if (evidence['status'] == 'conclusive') ...{'status': proof!['status'], 'result': proof}})}, value: null);
    });
    return evidence;
  }
  Future<String> recoveryEvidence() async {
    await _check();
    final snapshot = await requireAtomicSaleMutationStore(store).readSnapshot(
      SaleAtomicScope(namespace: 'checkout-v1:', keys: [key, family]));
    final raw = snapshot.values[key];
    if (raw == null) throw StateError('Nenhuma evidência de venda neste contexto.');
    final saved = _decode(raw), lock = readCommercialSaleFamily(snapshot.values[family]);
    final command = saleObject(saved['command']);
    if (lock == null || lock['identity'] != command['saleId'] || lock['reference'] != key ||
        !mapEquals(saleObject(lock['scope']), scope) ||
        lock['state'] != (saved['status'] == 'acknowledged' ? 'idle' : 'active')) {
      throw StateError('Trava comercial divergente. Preserve o armazenamento original.');
    }
    await _check();
    return _seal({'schemaVersion': 1, 'protocol': 'f10-local-recovery-evidence-v1',
      'authority': 'local-only', 'record': saved, 'family': lock});
  }
  Future<void> acknowledge() async {
    await _check();
    final pendingRecord = await pending();
    if (pendingRecord == null) throw StateError('Nenhum resultado pendente.');
    final archiveKey = '$key:resolved:${saleHash(pendingRecord['command'])}';
    await requireAtomicSaleMutationStore(store).transact<void>(SaleAtomicScope(namespace: 'checkout-v1:', keys: [key, family, archiveKey]), (snapshot) {
      final saved = _decode(snapshot.values[key] ?? '');
      if (saleJson(saved['command']) != saleJson(pendingRecord['command'])) throw StateError('Intenção concorrente.');
      if (!['confirmed', 'rejected'].contains(saved['status'])) throw StateError('Resultado desconhecido ou conflito exige recuperação.');
      final lock = readCommercialSaleFamily(snapshot.values[family]);
      final id = (saved['command'] as Map)['saleId'] as String;
      if (lock?['state'] != 'active' || lock?['identity'] != id || lock?['reference'] != key ||
          !mapEquals(saleObject(lock?['scope']), scope)) {
        throw StateError('Trava comercial divergente.');
      }
      final archived = _seal(saved);
      if (snapshot.values[archiveKey] != null && snapshot.values[archiveKey] != archived) throw StateError('Histórico divergente.');
      return SaleAtomicPlan(writes: {archiveKey: archived, key: _seal({...saved, 'state': 'idle', 'status': 'acknowledged'}),
        family: sealCommercialSaleFamily(scope, saved['command']['saleKind'] == 'deferred' ? 'deferred' : 'instant', id, key, 'idle')}, value: null);
    });
  }
  Future<void> close() => store.close();
}
