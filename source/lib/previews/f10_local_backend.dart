import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import '../data/local/sale_mutation_store.dart';
import '../data/local/sale_mutation_store_native.dart';
import '../data/local/variant_intent_store.dart';
import '../services/product_variants_form_draft.dart';
import '../services/sale_mutation_command.dart';
import '../services/variant_product_management.dart';
import '../services/variant_product_registration.dart';
import '../services/variant_sale.dart';

// Preview composition only. No SDK instance, credentials, network or real store.
// This simulator is NOT a substitute for the backend's authorization/transactions.
Map<String, dynamic> copyMap(dynamic value) => Map<String, dynamic>.from(jsonDecode(jsonEncode(value)) as Map);
const previewScope = {'projectId': 'demo-f10-preview', 'uid': 'demo-operator', 'storeId': 'demo-clothing'};
const previewStore = 'demo-clothing';

class _IntentAdapter implements VariantIntentStore {
  final SaleMutationStore delegate;
  _IntentAdapter(this.delegate);
  @override Future<String?> read(String key) => delegate.read(key);
  @override Future<List<String>> keys(String prefix) => delegate.keys(prefix);
  @override Future<bool> compareAndSet(String key, String? expected, String value) => delegate.compareAndSet(key, expected, value);
  @override Future<void> close() => delegate.close();
}

class F10LocalBackend extends ChangeNotifier {
  final String directory;
  final SqliteSaleMutationStore database;
  Map<String, dynamic> state;
  F10LocalBackend._(this.directory, this.database, this.state);
  static Future<F10LocalBackend> open() async {
    final dir = await getApplicationSupportDirectory();
    await dir.create(recursive: true);
    final db = SqliteSaleMutationStore('${dir.path}/f10_preview_world.sqlite');
    final raw = await db.read('preview:world');
    final initial = seed();
    if (raw == null && !await db.compareAndSet('preview:world', null, jsonEncode(initial))) {
      throw StateError('Outra sessão está preparando a demonstração. Reabra.');
    }
    return F10LocalBackend._(dir.path, db, raw == null ? initial : copyMap(jsonDecode(raw)));
  }
  static Map<String, dynamic> seed() {
    final definitions = [
      {'attributeId': 'color', 'label': 'Cor', 'values': [{'valueId': 'blue', 'label': 'Azul'}, {'valueId': 'black', 'label': 'Preto'}]},
      {'attributeId': 'size', 'label': 'Tamanho', 'values': [{'valueId': 'p', 'label': 'P'}, {'valueId': 'm', 'label': 'M'}, {'valueId': 'g', 'label': 'G'}]},
    ];
    final rows = <Map<String, dynamic>>[
      {'variantId': null, 'data': {'name': 'Camiseta', 'cod': 'DEMO-CAM', 'productKind': 'variantParent',
        'attributeDefinitions': definitions, 'isArchived': false},
        'commercial': {'configuration': {'priceCents': 4290, 'costCents': 2200}}},
      for (final v in [('blue-p', 'Azul / P', 'blue', 'p', 5), ('blue-m', 'Azul / M', 'blue', 'm', 8), ('black-g', 'Preto / G', 'black', 'g', 3)])
        {'variantId': v.$1, 'data': {'name': v.$2, 'cod': 'DEMO-${v.$1}', 'productId': 'demo-shirt',
          'attributes': [{'attributeId': 'color', 'valueId': v.$3}, {'attributeId': 'size', 'valueId': v.$4}],
          'quantidade': v.$5, 'lotes': [], 'isArchived': false},
          'commercial': {'configuration': {'priceCents': {'mode': 'inherit'}, 'costCents': {'mode': 'inherit'}}}},
    ];
    return {'schemaVersion': 1, 'authority': 'preview-local-only', 'revision': 1,
      'products': {'demo-shirt': rows}, 'simpleStock': 20, 'receipts': {}, 'sales': [], 'requests': [], 'audit': []};
  }
  List<Map<String, dynamic>> rows(String id) => (state['products'][id] as List).map(copyMap).toList();
  List<String> get productIds => (state['products'] as Map).keys.cast<String>().toList();
  int effective(Map row, Map parent, String field) {
    final policy = row['commercial']['configuration'][field];
    return (policy is Map && policy['mode'] == 'override' ? policy['value'] : parent['commercial']['configuration'][field]) as int;
  }
  List<Map<String, dynamic>> attributes(Map row, Map parent) => [for (final pair in row['data']['attributes'] as List)
    {'attributeId': pair['attributeId'], 'valueId': pair['valueId'],
      'attributeLabel': (parent['data']['attributeDefinitions'] as List).firstWhere((d) => d['attributeId'] == pair['attributeId'])['label'],
      'valueLabel': ((parent['data']['attributeDefinitions'] as List).firstWhere((d) => d['attributeId'] == pair['attributeId'])['values'] as List)
        .firstWhere((v) => v['valueId'] == pair['valueId'])['label']}];
  String displayName(Map row, Map parent) => '${parent['data']['name']} · ${attributes(row, parent).map((a) => a['valueLabel']).join(' / ')}';
  Future<void> save(Map<String, dynamic> next) async {
    next['revision'] = (state['revision'] as int) + 1;
    if (!await database.compareAndSet('preview:world', jsonEncode(state), jsonEncode(next))) {
      throw StateError('Conflito local de demonstração. Reabra a prévia.');
    }
    state = next;
    notifyListeners();
  }
  SqliteSaleMutationStore clientStore([String name = 'operational']) => SqliteSaleMutationStore('$directory/f10_preview_$name.sqlite');
  Future<VariantSaleAccess> saleAccess(String storeId) async {
    if (storeId != previewStore) throw StateError('Somente loja fictícia.');
    return VariantSaleAccess(store: clientStore(), scope: previewScope,
      currentScope: () async => previewScope, localScope: () async => previewScope, call: call);
  }
  Future<VariantProductManagement> managementAccess(String storeId) async {
    if (storeId != previewStore) throw StateError('Somente loja fictícia.');
    return VariantProductManagement(VariantProductRegistration(store: _IntentAdapter(clientStore('management')),
      scope: previewScope, currentScope: () async => previewScope, call: call));
  }
  Future<Map<String, dynamic>> call(String endpoint, Map<String, dynamic> command) async {
    if (saleJson(command['scope'] ?? command['reviewerScope']) != saleJson(previewScope)) throw StateError('Escopo de demonstração inválido.');
    if (endpoint == 'getVariantSaleChoicesV1') {
      final list = rows(command['productId'] as String), parent = list.first;
      return {'status': 'available', 'scope': previewScope, 'productId': command['productId'], 'admissionEpoch': 1,
        'variants': [for (final row in list.skip(1)) {'productId': command['productId'], 'variantId': row['variantId'],
          'status': parent['data']['isArchived'] == true || row['data']['isArchived'] == true ? 'archived' :
            (row['data']['quantidade'] as int) <= 0 ? 'out-of-stock' : 'available',
          'name': displayName(row, parent), 'unitPriceCents': effective(row, parent, 'priceCents'), 'availableQuantity': row['data']['quantidade']}]};
    }
    if (endpoint == 'getVariantProductManagementStateV1') return {'status': 'available', 'scope': previewScope,
      'productId': command['productId'], 'admissionEpoch': 1, 'fingerprint': saleHash(rows(command['productId'] as String)), 'rows': rows(command['productId'] as String)};
    final identity = command['saleId'] ?? command['requestId'];
    final key = '$endpoint:$identity';
    final receipts = state['receipts'] as Map;
    if (endpoint == 'getVariantProductManagementResultV1') return copyMap(receipts['management:$identity'] ?? {'status': 'not-recorded', 'requestId': identity});
    if (endpoint == 'getVariantCommercialResultV2') return copyMap(receipts['sale:$identity'] ?? {'status': 'not-recorded', 'saleId': identity});
    if (endpoint == 'inspectVariantSaleEvidenceV1') return evidence(command['command'], previewScope,
      receipts['sale:${command['command']['saleId']}'] as Map?);
    if (!['manageVariantProductV1', 'confirmVariantCommercialV2'].contains(endpoint)) throw UnsupportedError('Sem implementação local para $endpoint. Nenhum envio remoto.');
    final receiptKey = '${endpoint == 'manageVariantProductV1' ? 'management' : 'sale'}:$identity';
    if (receipts.containsKey(receiptKey)) {
      if (saleJson(receipts[receiptKey]['command']) != saleJson(command)) return {'status': 'identity-conflict', 'requestId': identity, 'saleId': identity};
      return copyMap(receipts[receiptKey]);
    }
    final next = copyMap(state);
    Map<String, dynamic> result;
    try {
      if (endpoint == 'manageVariantProductV1') {
        manage(next, command);
        result = {'status': 'confirmed', 'requestId': identity};
      } else {
        sell(next, command);
        result = {'status': 'confirmed', 'saleId': identity, 'totalCents': command['expectedTotalCents']};
      }
    } on FormatException catch (e) {
      // No partial inventory edits survive a rejection.
      next.clear(); next.addAll(copyMap(state));
      result = {'status': 'rejected', 'requestId': identity, 'saleId': identity, 'reason': e.message};
    }
    result.addAll({'reason': result['reason'] ?? 'SIMULAÇÃO LOCAL — nenhuma operação real', 'command': copyMap(command)});
    next['receipts'][receiptKey] = result;
    (next['audit'] as List).add({'operation': key, 'result': result['status'], 'localOnly': true});
    await save(next);
    return copyMap(result);
  }
  void manage(Map next, Map command) {
    final list = (next['products'][command['productId']] as List).cast<Map>();
    if (command['expectedFingerprint'] != saleHash(list)) throw const FormatException('Cadastro alterado. Atualize antes de editar.');
    final action = command['action'], changes = copyMap(command['changes']);
    if ((command['reason'] as String).trim().isEmpty) throw const FormatException('Informe o motivo.');
    if (action == 'addVariant') {
      list.add({'variantId': command['variantId'], 'data': {'name': changes['name'], 'attributes': changes['attributes'],
        'quantidade': 0, 'lotes': [], 'isArchived': false}, 'commercial': {'configuration': changes['commercial']}});
    }
    final row = list.firstWhere((r) => r['variantId'] == command['variantId']);
    if (action == 'archive' || action == 'restore') row['data']['isArchived'] = action == 'archive';
    else if (action == 'stock') {
      if (row['variantId'] == null || row['data']['isArchived'] == true || list.first['data']['isArchived'] == true) throw const FormatException('Ajuste bloqueado para pai ou opção arquivada.');
      applyStock(row['data'], changes['stockChange']);
    } else {
      for (final field in ['name', 'cod', 'attributes', 'attributeDefinitions']) if (changes.containsKey(field)) row['data'][field] = changes[field];
      if (changes.containsKey('commercial')) row['commercial']['configuration'] = changes['commercial'];
    }
    final seen = <String>{}, cods = <String>{};
    final parent = list.first;
    if ((parent['data']['name'] as String).trim().isEmpty || parent['commercial']['configuration']['priceCents'] is! int || parent['commercial']['configuration']['priceCents'] <= 0) throw const FormatException('Nome e preço base válidos são obrigatórios.');
    for (final r in list) {
      final cod = '${r['data']['cod'] ?? ''}'.trim().toUpperCase();
      if (cod.isNotEmpty && !cods.add(cod)) throw const FormatException('COD duplicado.');
      if (r['variantId'] == null) continue;
      final attrs = (r['data']['attributes'] as List).map((a) => Map<String, dynamic>.from(a as Map)).toList()..sort((a,b) => '${a['attributeId']}'.compareTo('${b['attributeId']}'));
      if (!seen.add(saleJson(attrs))) throw const FormatException('Combinação já cadastrada, inclusive arquivada.');
      final defs = parent['data']['attributeDefinitions'] as List;
      if (attrs.length != defs.length || attrs.map((a) => a['attributeId']).toSet().length != defs.length || attrs.any((a) => !defs.any((d) => d['attributeId'] == a['attributeId'] && (d['values'] as List).any((v) => v['valueId'] == a['valueId'])))) throw const FormatException('Selecione uma opção válida de cada atributo.');
      if (effective(r, parent, 'priceCents') <= 0) throw const FormatException('Preço inválido.');
    }
  }
  void applyStock(Map data, Map change) {
    final kind = change['kind'];
    Map<String, dynamic> lot(Map raw) {
      final ms = raw['validadeMs'] as int;
      return {'quantidade': raw['quantidade'], 'validade': {'seconds': '${ms ~/ 1000}', 'nanoseconds': (ms % 1000) * 1000000}};
    }
    if (kind == 'setManualQuantity' || kind == 'convertToManual') { data['quantidade'] = change['quantity']; data['lotes'] = []; }
    else if (kind == 'convertToLots') { data['lotes'] = (change['lots'] as List).map((l) => lot(l as Map)).toList(); }
    else if (kind == 'editLots') {
      final lots = (data['lotes'] as List).map(copyMap).toList(), removed = <int>{};
      for (final op in change['operations'] as List) {
        if (op['op'] == 'add') { lots.add(lot(op)); }
        else if (op['op'] == 'remove') { removed.add(op['index'] as int); }
        else {
          final existing = lots[op['index'] as int], set = op['set'] as Map;
          existing['quantidade'] = set['quantidade'];
          if (set.containsKey('validadeMs')) existing['validade'] = lot({'quantidade': 0, 'validadeMs': set['validadeMs']})['validade'];
        }
      }
      data['lotes'] = [for (var i = 0; i < lots.length; i++) if (!removed.contains(i)) lots[i]];
    } else { throw const FormatException('Operação de estoque não suportada na prévia.'); }
    if ((data['lotes'] as List).isNotEmpty) data['quantidade'] = (data['lotes'] as List).fold<int>(0, (s,l) => s + (l['quantidade'] as int));
    else if (kind != 'setManualQuantity' && kind != 'convertToManual') data['quantidade'] = 0;
    if (data['quantidade'] is! int || data['quantidade'] < 0 || (data['lotes'] as List).any((l) => l['quantidade'] is! int || l['quantidade'] < 0)) throw const FormatException('Saldo inválido.');
  }
  void sell(Map next, Map command) {
    var total = 0;
    final snapshots = <Map<String, dynamic>>[];
    for (final item in command['items'] as List) {
      final q = item['quantity'] as int;
      if (q <= 0) throw const FormatException('Quantidade inválida.');
      if (item['variantId'] == null) {
        if (item['productId'] != 'demo-belt' || item['expectedUnitPriceCents'] != 1590 || next['simpleStock'] < q) throw const FormatException('Produto simples indisponível ou preço divergente.');
        next['simpleStock'] -= q; total += q * 1590;
        snapshots.add({'productId': 'demo-belt', 'name': 'Cinto sintético', 'price': 15.90, 'quantity': q, 'unitPriceCents': 1590});
        continue;
      }
      final list = next['products'][item['productId']] as List?;
      if (list == null) throw const FormatException('Pai inválido.');
      final parent = list.first as Map;
      final matches = list.where((r) => r['variantId'] == item['variantId']);
      if (matches.isEmpty) throw const FormatException('Filha inválida.');
      final row = matches.first as Map, data = row['data'] as Map;
      final cents = effective(row, parent, 'priceCents');
      if (parent['data']['isArchived'] == true || data['isArchived'] == true || cents != item['expectedUnitPriceCents'] || data['quantidade'] < q) throw const FormatException('Opção arquivada, preço alterado ou estoque insuficiente.');
      data['quantidade'] -= q;
      var remaining = q;
      final lots = data['lotes'] as List;
      lots.sort((a,b) => int.parse('${a['validade']['seconds']}').compareTo(int.parse('${b['validade']['seconds']}')));
      for (final lot in lots) { final used = remaining < lot['quantidade'] ? remaining : lot['quantidade'] as int; lot['quantidade'] -= used; remaining -= used; }
      total += cents * q;
      final baseCost = parent['commercial']['configuration']['costCents'];
      final policy = row['commercial']['configuration']['costCents'];
      final cost = policy is Map && policy['mode'] == 'override' ? policy['value'] : baseCost;
      snapshots.add({'schemaVersion': 4, 'productId': item['productId'], 'variantId': item['variantId'],
        'name': displayName(row, parent), 'parentName': parent['data']['name'], 'variantName': data['name'],
        'attributes': attributes(row, parent), 'cod': data['cod'], 'price': cents / 100, 'unitPriceCents': cents,
        'quantity': q, 'subtotalCents': cents * q, if (cost is int) 'costCents': cost});
    }
    if (total != command['expectedTotalCents'] || command['expectedAdmissionEpoch'] != 1) throw const FormatException('Total ou epoch divergente.');
    final deferred = command['deferred'] as Map?;
    final n = deferred?['installmentCount'] as int? ?? 0;
    (next['sales'] as List).add({'saleId': command['saleId'], 'items': snapshots, 'totalCents': total,
      'localOnly': true, 'paymentMethod': command['paymentMethod'], 'origin': command['origin'],
      'installments': [for (var i = 0; i < n; i++) {'number': i + 1, 'amountCents': total ~/ n + (i < total % n ? 1 : 0),
        'paid': false, 'firstDueDate': deferred!['firstDueDate']}]});
  }
  Future<String> register(String name, String cod, int price, int? cost, ProductVariantsFormDraft draft) async {
    if (!draft.enabled || draft.entries.isEmpty || name.trim().isEmpty || price <= 0) throw const FormatException('Informe nome, preço e ao menos uma combinação.');
    final id = 'demo-${newVariantRegistrationId()}', next = copyMap(state);
    next['products'][id] = [
      {'variantId': null, 'data': {'name': name.trim(), 'cod': cod, 'productKind': 'variantParent',
        'attributeDefinitions': draft.definitions, 'isArchived': false}, 'commercial': {'configuration': {'priceCents': price, if (cost != null) 'costCents': cost}}},
      for (final entry in draft.entries) {'variantId': 'demo-${entry.key}', 'data': {...entry.fields, 'isArchived': false, 'quantidade': 0, 'lotes': []},
        'commercial': {'configuration': entry.commercial}},
    ];
    final list = next['products'][id] as List;
    for (var i = 0; i < draft.entries.length; i++) { applyStock(list[i + 1]['data'], draft.entries[i].initialStock); }
    await save(next); return id;
  }
  Future<void> receive(int saleIndex, int installment) async {
    final next = copyMap(state), plan = next['sales'][saleIndex]['installments'] as List;
    plan[installment]['paid'] = true; // Boolean receipt: repeating has no second credit.
    await save(next);
  }
  Future<void> request(List<Map<String, dynamic>> items) async {
    final next = copyMap(state); var total = 0;
    final frozen = <Map<String, dynamic>>[];
    for (final item in items) {
      final list = rows(item['productId'] as String), parent = list.first;
      final row = list.firstWhere((r) => r['variantId'] == item['variantId']);
      if (parent['data']['isArchived'] == true || row['data']['isArchived'] == true) throw const FormatException('Opção arquivada.');
      final price = effective(row, parent, 'priceCents');
      if (item['unitPriceCents'] != price) throw const FormatException('Preço alterado. Selecione novamente.');
      total += price * (item['quantity'] as int);
      frozen.add({...item, 'name': displayName(row, parent), 'attributes': attributes(row, parent)});
    }
    if (frozen.isEmpty) throw const FormatException('Selecione opções.');
    (next['requests'] as List).add({'requestId': 'demo-${newVariantRegistrationId()}', 'items': frozen, 'totalCents': total, 'localOnly': true});
    await save(next); // Does not sell, reserve, or decrement stock.
  }
  Map<String, dynamic> evidence(dynamic raw, Map scope, Map? result) {
    final command = copyMap(raw);
    (command['items'] as List).sort((a,b) => jsonEncode([a['productId'], a['variantId']]).compareTo(jsonEncode([b['productId'], b['variantId']])));
    return {'status': result != null && ['confirmed', 'rejected'].contains(result['status']) ? 'conclusive' : 'blocked',
      'scope': scope, 'command': command, 'saleId': command['saleId'], 'evidencePath': 'preview-local-only/${command['saleId']}',
      'evidenceHash': saleHash(command), 'result': result, 'authority': 'SIMULAÇÃO LOCAL',
      'records': {'receipt': result == null ? 'inconclusivo' : result['status'], 'sales': 'fixture local', 'f9Identity': 'fixture local — sem consulta remota'}};
  }
  Future<VariantSaleAccess> recoveryFixture(String status) async {
    final scope = {...previewScope, 'uid': 'demo-recovery-$status'};
    Future<Map<String, dynamic>> fixtureCall(String endpoint, Map<String, dynamic> payload) async {
      final command = endpoint == 'inspectVariantSaleEvidenceV1' ? copyMap(payload['command']) : payload;
      final result = {'status': status == 'unknown' ? 'not-recorded' : status, 'saleId': command['saleId'],
        'totalCents': command['expectedTotalCents'], 'reason': 'FIXTURE SIMULADA — sem prova remota'};
      return endpoint == 'inspectVariantSaleEvidenceV1' ? evidence(command, scope, status == 'unknown' || status == 'identity-conflict' ? null : result) : result;
    }
    final access = VariantSaleAccess(store: clientStore('recovery_$status'), scope: scope, currentScope: () async => scope, call: fixtureCall);
    if (await access.pending() == null) {
      await access.prepare([VariantSaleLine(VariantSaleChoice(scope: scope, productId: 'demo-shirt', variantId: 'blue-p', name: 'Camiseta Azul / P — fixture',
        unitPriceCents: 4290, availableQuantity: 5, epoch: 1), 1)], 'Dinheiro', 'SIMULAÇÃO');
      await access.recover();
    }
    return access;
  }
  Map<String, dynamic> catalogData() => {'store': {'name': 'Loja fictícia F10'}, 'catalog': {'name': 'Roupas — demonstração'},
    'products': [for (final id in productIds) for (final row in rows(id).skip(1)) if (row['data']['isArchived'] != true && rows(id).first['data']['isArchived'] != true)
      {'productId': id, 'variantId': row['variantId'], 'name': displayName(row, rows(id).first), 'description': 'Opção sintética — sem publicação',
        'price': effective(row, rows(id).first, 'priceCents') / 100, 'unitPriceCents': effective(row, rows(id).first, 'priceCents'),
        'quantidade': row['data']['quantidade'], 'availableQuantity': row['data']['quantidade']}], 'dynamicSections': []};
}
