import 'dart:async';
import 'package:flutter/material.dart';
import '../services/variant_product_management.dart';
import '../services/variant_product_registration.dart';

class VariantProductManagementDialog extends StatefulWidget {
  final String storeId, productId;
  final Future<VariantProductManagement> Function(String)? factory;
  const VariantProductManagementDialog({super.key, required this.storeId, required this.productId, this.factory});
  @override State<VariantProductManagementDialog> createState() => _ManagementState();
}
class _ManagementState extends State<VariantProductManagementDialog> {
  VariantProductManagement? access;
  Map<String, dynamic>? state, pending;
  String? error;
  bool busy = true;
  @override void initState() { super.initState(); unawaited(load()); }
  @override void dispose() { if (access != null) unawaited(access!.close()); super.dispose(); }
  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final a = access ?? await (widget.factory ?? VariantProductManagement.open)(widget.storeId);
      if (!mounted) { await a.close(); return; }
      access = a;
      final p = await a.pending(), s = await a.load(widget.productId);
      if (mounted) setState(() { pending = p; state = s; });
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try { await action(); }
    catch (e) { if (mounted) setState(() => error = '$e'); }
    finally {
      if (mounted) {
        try { pending = await access?.pending(); } catch (_) { /* Keep original failure. */ }
        if (mounted) setState(() => busy = false);
      }
    }
  }
  Future<void> mutate(Map<String, dynamic> row, String action, Map<String, dynamic> changes, String reason) => run(() async {
    await access!.prepare(state!, row['variantId'] as String?, action, changes, reason);
    final result = await access!.recover(send: true);
    if (result['status'] != 'confirmed') throw StateError('Alteração ${result['status']}: ${result['reason'] ?? 'consulte a intenção original'}');
    await access!.acknowledge();
    final next = await access!.load(widget.productId);
    if (mounted) setState(() => state = next);
  });
  Future<void> edit(Map<String, dynamic> row, {bool stock = false}) async {
    final data = Map<String, dynamic>.from(row['data'] as Map), cfg = Map<String, dynamic>.from(row['commercial']['configuration'] as Map);
    final parent = row['variantId'] == null;
    final name = TextEditingController(text: data['name'] as String? ?? '');
    final cod = TextEditingController(text: data['cod'] as String? ?? '');
    String value(String key) => parent ? cfg[key] == null ? '' : '${(cfg[key] as num) / 100}' :
      cfg[key] is Map && cfg[key]['mode'] == 'override' ? '${(cfg[key]['value'] as num) / 100}' : '';
    final price = TextEditingController(text: value('priceCents')), cost = TextEditingController(text: value('costCents'));
    final originalPriceText = price.text, originalCostText = cost.text;
    final reason = TextEditingController(), quantity = TextEditingController(text: '${data['quantidade']}');
    final minimum = TextEditingController(text: '${cfg['minimumStock'] ?? ''}');
    final definitions = (state!['rows'][0]['data']['attributeDefinitions'] as List).map((d) => <String, dynamic>{
      ...Map<String, dynamic>.from(d as Map), 'values': (d['values'] as List).map((v) => Map<String, dynamic>.from(v as Map)).toList()}).toList();
    final selected = <String, String>{for (final p in data['attributes'] as List? ?? []) p['attributeId'] as String: p['valueId'] as String};
    final labels = <TextEditingController>[for (final d in definitions) TextEditingController(text: d['label'] as String)];
    final options = <List<TextEditingController>>[for (final d in definitions)
      [for (final v in d['values'] as List) TextEditingController(text: v['label'] as String)]];
    final lots = (data['lotes'] as List? ?? []).map((l) => Map<String, dynamic>.from(l as Map)).toList();
    final lotQuantities = [for (final l in lots) TextEditingController(text: '${l['quantidade']}')];
    final originalLotCount = lots.length;
    final dates = <int?>[for (final l in lots) int.parse('${l['validade']['seconds']}') * 1000 + (l['validade']['nanoseconds'] as int) ~/ 1000000];
    final originalDates = List<int?>.of(dates), removedLots = <int>{};
    var manualStock = lots.isEmpty;
    String? formError;
    Map<String, dynamic>? changes;
    try {
      if (!mounted) return;
      changes = await showDialog<Map<String, dynamic>>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, setForm) => AlertDialog(
        title: Text(stock ? 'Ajuste de estoque da variante' : parent ? 'Editar produto pai' : 'Editar variante'),
        content: SizedBox(width: 520, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (!stock) ...[
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Nome')),
            TextField(controller: cod, decoration: const InputDecoration(labelText: 'COD (reservas anteriores são preservadas)')),
            TextField(controller: price, decoration: InputDecoration(labelText: parent ? 'Preço base (R\$)' : 'Preço próprio (vazio: herdar)')),
            TextField(controller: cost, decoration: InputDecoration(labelText: parent ? 'Custo base (vazio: desconhecido)' : 'Custo próprio (vazio: herdar)')),
            if (!parent) TextField(controller: minimum, decoration: const InputDecoration(labelText: 'Estoque mínimo individual')),
            for (var i = 0; i < definitions.length; i++) ...[
              if (parent) ...[
                TextField(controller: labels[i], decoration: const InputDecoration(labelText: 'Nome do atributo')),
                for (var j = 0; j < options[i].length; j++) TextField(controller: options[i][j], decoration: const InputDecoration(labelText: 'Nome da opção')),
                TextButton(onPressed: () => setForm(() {
                  (definitions[i]['values'] as List).add({'valueId': newVariantRegistrationId(), 'label': ''});
                  options[i].add(TextEditingController());
                }), child: const Text('Adicionar opção ao atributo')),
              ] else DropdownButtonFormField<String>(value: selected[definitions[i]['attributeId']],
                decoration: InputDecoration(labelText: definitions[i]['label'] as String),
                items: [for (final v in definitions[i]['values'] as List) DropdownMenuItem(value: v['valueId'] as String, child: Text(v['label'] as String))],
                onChanged: (v) { if (v != null) selected[definitions[i]['attributeId'] as String] = v; }),
            ],
          ] else ...[
            SwitchListTile(value: manualStock, title: const Text('Estoque manual'), subtitle: const Text('Mudar o modo é uma conversão explícita, com saldo informado.'),
              onChanged: (v) => setForm(() => manualStock = v)),
            if (manualStock) TextField(controller: quantity, keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Novo saldo manual'))
            else ...[
              const Text('O ajuste conserva os metadados dos lotes existentes. Informe a validade de cada lote novo.'),
              for (var i = 0; i < lotQuantities.length; i++) if (!removedLots.contains(i)) Row(children: [
                Expanded(child: TextField(controller: lotQuantities[i], keyboardType: TextInputType.number,
                  decoration: InputDecoration(labelText: 'Saldo do lote ${i + 1}'))),
                TextButton(onPressed: () async {
                  final date = await showDatePicker(context: ctx, initialDate: dates[i] == null ? DateTime.now() : DateTime.fromMillisecondsSinceEpoch(dates[i]!),
                    firstDate: DateTime(2000), lastDate: DateTime(2101));
                  if (date != null) setForm(() => dates[i] = date.millisecondsSinceEpoch);
                }, child: Text(dates[i] == null ? 'Informar validade' : '${DateTime.fromMillisecondsSinceEpoch(dates[i]!).day}/${DateTime.fromMillisecondsSinceEpoch(dates[i]!).month}/${DateTime.fromMillisecondsSinceEpoch(dates[i]!).year}')),
                IconButton(onPressed: () => setForm(() => removedLots.add(i)), icon: const Icon(Icons.delete_outline)),
              ]),
              TextButton(onPressed: () => setForm(() { lotQuantities.add(TextEditingController(text: '1')); dates.add(null); }),
                child: const Text('Receber novo lote')),
            ],
          ],
          TextField(controller: reason, decoration: const InputDecoration(labelText: 'Motivo obrigatório (inclui exceção de custo)')),
          if (formError != null) Text(formError!),
        ]))),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(onPressed: () {
            try {
              if (reason.text.trim().isEmpty) throw const FormatException('Informe o motivo.');
              if (stock) {
                if (!manualStock && [for (var i = 0; i < dates.length; i++) if (!removedLots.contains(i)) dates[i]].any((v) => v == null)) {
                  throw const FormatException('Informe a validade dos lotes.');
                }
                final change = manualStock ? {'kind': originalLotCount == 0 ? 'setManualQuantity' : 'convertToManual',
                    'quantity': int.parse(quantity.text), if (originalLotCount > 0) 'acknowledgement': true} : originalLotCount == 0 ?
                  {'kind': 'convertToLots', 'lots': [for (var i = 0; i < lotQuantities.length; i++) if (!removedLots.contains(i))
                    {'quantidade': int.parse(lotQuantities[i].text), 'validadeMs': dates[i]}]} :
                  {'kind': 'editLots', 'operations': [
                    for (var i = 0; i < originalLotCount; i++) if (removedLots.contains(i)) {'op': 'remove', 'index': i}
                    else {'op': 'update', 'index': i, 'set': {'quantidade': int.parse(lotQuantities[i].text),
                      if (dates[i] != originalDates[i]) 'validadeMs': dates[i]}},
                    for (var i = originalLotCount; i < lotQuantities.length; i++) if (!removedLots.contains(i))
                      {'op': 'add', 'quantidade': int.parse(lotQuantities[i].text), 'validadeMs': dates[i]},
                  ]};
                Navigator.pop(ctx, {'stockChange': change});
              } else {
                final config = {...cfg};
                if (price.text != originalPriceText || row['isNew'] == true) {
                  config['priceCents'] = parent ? variantMoneyCents(price.text) : price.text.trim().isEmpty ? {'mode': 'inherit'} :
                    {'mode': 'override', 'value': variantMoneyCents(price.text)};
                }
                if (parent) {
                  if (cost.text != originalCostText) {
                    if (cost.text.trim().isEmpty) { config.remove('costCents'); } else { config['costCents'] = variantMoneyCents(cost.text); }
                  }
                } else {
                  if (cost.text != originalCostText || row['isNew'] == true) {
                    config['costCents'] = cost.text.trim().isEmpty ? {'mode': 'inherit'} :
                      {'mode': 'override', 'value': variantMoneyCents(cost.text), 'reason': reason.text.trim()};
                  }
                  if (minimum.text.trim().isEmpty) { config.remove('minimumStock'); } else { config['minimumStock'] = int.parse(minimum.text); }
                }
                Navigator.pop(ctx, {'name': name.text.trim().isEmpty && !parent ? (data['name'] ?? 'Variante') : name.text.trim(),
                  'cod': cod.text, 'commercial': config,
                  if (!parent) 'attributes': [for (final d in definitions) {'attributeId': d['attributeId'], 'valueId': selected[d['attributeId']]}],
                  if (parent) 'attributeDefinitions': [for (var i = 0; i < definitions.length; i++)
                    {...definitions[i], 'label': labels[i].text.trim(), 'values': [for (var j = 0; j < options[i].length; j++)
                      {...Map<String, dynamic>.from(definitions[i]['values'][j] as Map), 'label': options[i][j].text.trim()}]}]});
              }
            } catch (e) { setForm(() => formError = '$e'); }
          }, child: const Text('Salvar alteração'))]),
      ));
      if (changes != null) await mutate(row, stock ? 'stock' : parent ? 'editParent' : row['isNew'] == true ? 'addVariant' : 'editVariant', changes, reason.text.trim());
    } finally {
      for (final c in [name, cod, price, cost, reason, quantity, minimum, ...labels, ...options.expand((x) => x), ...lotQuantities]) { c.dispose(); }
    }
  }
  Future<void> lifecycle(Map<String, dynamic> row) async {
    final action = row['data']['isArchived'] == true ? 'restore' : 'archive';
    final reason = TextEditingController();
    try {
      final accepted = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
        title: Text(action == 'archive' ? 'Arquivar sem excluir estoque ou histórico' : 'Restaurar sem alterar filhas'),
        content: TextField(controller: reason, decoration: const InputDecoration(labelText: 'Motivo obrigatório')),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Confirmar'))]));
      if (accepted == true) await mutate(row, action, {}, reason.text.trim());
    } finally { reason.dispose(); }
  }
  Future<void> editFiscal(Map<String, dynamic> row) async {
    final cfg = Map<String, dynamic>.from(row['commercial']['configuration'] as Map);
    final parent = row['variantId'] == null;
    final hasPolicy = cfg['fiscal'] is Map;
    var inherit = !parent && (!cfg.containsKey('fiscal') || hasPolicy && cfg['fiscal']['mode'] == 'inherit');
    final source = parent ? cfg['fiscal'] : inherit ? state!['rows'][0]['commercial']['configuration']['fiscal'] : hasPolicy ? cfg['fiscal']['value'] : null;
    const names = {'ncm': 'NCM', 'origem': 'Origem', 'cfop': 'CFOP', 'unidade': 'Unidade', 'cest': 'CEST',
      'icmsSituacaoTributaria': 'CSOSN / ICMS', 'pisSituacaoTributaria': 'CST PIS', 'cofinsSituacaoTributaria': 'CST COFINS',
      'ibsCbsSituacaoTributaria': 'CST IBS/CBS', 'ibsCbsClassificacaoTributaria': 'Classificação IBS/CBS'};
    final inputs = {for (final k in names.keys) k: TextEditingController(text: source is Map ? '${source[k] ?? ''}' : '')};
    final reason = TextEditingController();
    try {
      final accepted = await showDialog<bool>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, setForm) => AlertDialog(
        title: const Text('Dados fiscais informados pela loja'),
        content: SizedBox(width: 500, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Informe os códigos definidos pelo responsável fiscal. O app não escolhe tributação. Vendas antigas conservam seus snapshots.'),
          if (!parent) SwitchListTile(value: inherit, title: const Text('Herdar dados fiscais do pai'), onChanged: (v) => setForm(() => inherit = v)),
          for (final k in names.keys) TextField(controller: inputs[k], enabled: !inherit, decoration: InputDecoration(labelText: names[k])),
          TextField(controller: reason, decoration: const InputDecoration(labelText: 'Motivo obrigatório da configuração / exceção')),
        ]))), actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () { if (reason.text.trim().isNotEmpty) Navigator.pop(ctx, true); }, child: const Text('Salvar dados fiscais'))])));
      if (accepted == true) {
        final fiscal = {for (final k in names.keys) if (inputs[k]!.text.trim().isNotEmpty) k: inputs[k]!.text.trim()};
        cfg['fiscal'] = parent ? fiscal : inherit ? {'mode': 'inherit'} : {'mode': 'override', 'value': fiscal, 'reason': reason.text.trim()};
        await mutate(row, parent ? 'editParent' : 'editVariant', {'commercial': cfg}, reason.text.trim());
      }
    } finally { for (final c in [...inputs.values, reason]) { c.dispose(); } }
  }
  @override Widget build(BuildContext context) => AlertDialog(title: const Text('Gestão de variantes'),
    content: SizedBox(width: 650, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Text('O pai não é vendável. Cadastro, estoque e arquivamento são operações independentes.'),
      if (busy) const LinearProgressIndicator(), if (error != null) Text(error!),
      if (pending != null) ...[
        Text('Alteração original ${pending!['command']['requestId']} · ${pending!['status']}'),
        TextButton(onPressed: busy ? null : () => run(() async { await access!.recover(send: true); }), child: const Text('Recuperar alteração original')),
        if (['confirmed', 'rejected'].contains(pending!['status'])) TextButton(onPressed: busy ? null : () => run(() async {
          await access!.acknowledge(); state = await access!.load(widget.productId);
        }), child: const Text('Reconhecer resultado')),
      ],
      if (state != null) for (final raw in state!['rows'] as List) Builder(builder: (_) {
        final row = Map<String, dynamic>.from(raw as Map), parent = row['variantId'] == null;
        return Card(child: Column(children: [ListTile(title: Text(row['data']['name'] as String? ?? 'Variante'),
          subtitle: Text('${parent ? 'Produto pai' : 'Variante'} · ${row['data']['isArchived'] == true ? 'Arquivado' : 'Ativo'}${parent ? '' : ' · Saldo ${row['data']['quantidade']}'}')),
          Wrap(children: [TextButton(onPressed: busy || pending != null ? null : () => edit(row), child: const Text('Editar cadastro')),
            TextButton(onPressed: busy || pending != null ? null : () => editFiscal(row), child: const Text('Dados fiscais')),
            if (!parent) TextButton(onPressed: busy || pending != null ? null : () => edit(row, stock: true), child: const Text('Ajustar estoque/lotes')),
            TextButton(onPressed: busy || pending != null ? null : () => lifecycle(row), child: Text(row['data']['isArchived'] == true ? 'Restaurar' : 'Arquivar'))]) ]));
      }),
      if (state != null) TextButton(onPressed: busy || pending != null ? null : () => edit({
        'variantId': newVariantRegistrationId(), 'isNew': true, 'data': {'attributes': [], 'quantidade': 0, 'lotes': [], 'isArchived': false},
        'commercial': {'configuration': {'priceCents': {'mode': 'inherit'}, 'costCents': {'mode': 'inherit'}}}}),
        child: const Text('Adicionar combinação explícita — estoque inicial zero')),
    ]))), actions: [TextButton(onPressed: busy ? null : load, child: const Text('Atualizar')),
      TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: const Text('Fechar'))]);
}
