import 'package:flutter/material.dart';
import '../services/product_variants_form_draft.dart';
import '../services/product_variants_read_state.dart';
import '../services/variant_product_registration.dart';

class ProductVariantsForm extends StatefulWidget {
  final ProductVariantsFormDraft draft;
  final String Function() parentCod;
  final VoidCallback? onModeChanged;
  final bool enabled;
  final ProductVariantsReadState? readState;
  const ProductVariantsForm({
    super.key,
    required this.draft,
    required this.parentCod,
    this.onModeChanged,
    this.enabled = true,
    this.readState,
  });
  @override
  State<ProductVariantsForm> createState() => _ProductVariantsFormState();
}

class _ProductVariantsFormState extends State<ProductVariantsForm> {
  final attribute = TextEditingController();
  final options = TextEditingController();
  final name = TextEditingController();
  final cod = TextEditingController();
  final price = TextEditingController();
  final quantity = TextEditingController(text: '0');
  final minimum = TextEditingController();
  final lotsText = TextEditingController();
  final selected = <String, String>{};
  int? editing;
  String? error;
  final _unavailableRead = ProductVariantsReadState();
  @override
  void dispose() {
    _unavailableRead.dispose();
    attribute.dispose();
    options.dispose();
    name.dispose();
    cod.dispose();
    price.dispose();
    quantity.dispose();
    minimum.dispose();
    lotsText.dispose();
    super.dispose();
  }

  void perform(VoidCallback action) {
    try {
      action();
      setState(() => error = null);
    } on FormatException catch (e) {
      setState(() => error = e.message);
    } on StateError catch (e) {
      setState(() => error = e.message);
    }
  }

  String describe(Map<String, dynamic> fields) {
    final raw = fields['attributes'];
    final pairs = raw is Map
        ? raw
        : {for (final p in raw as List) p['attributeId']: p['valueId']};
    return widget.draft.definitions
        .map((d) {
          final matches = (d['values'] as List).where(
            (v) => v['valueId'] == pairs[d['attributeId']],
          );
          return '${d['label']}: ${matches.isEmpty ? 'Indisponível' : matches.first['label']}';
        })
        .join(' · ');
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: Listenable.merge([
      widget.draft,
      widget.readState ?? _unavailableRead,
    ]),
    builder: (context, _) {
      final draft = widget.draft;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SwitchListTile(
            key: const ValueKey('product-variants-toggle'),
            contentPadding: EdgeInsets.zero,
            title: const Text('Produto com variantes'),
            subtitle: const Text(
              'Cor, tamanho, modelo ou outros atributos. Opcional.',
            ),
            value: draft.enabled,
            onChanged: draft.existingProduct || !widget.enabled
                ? null
                : (value) {
                    draft.setEnabled(value);
                    widget.onModeChanged?.call();
                  },
          ),
          if (draft.existingProduct && !draft.enabled)
            const Text(
              'A conversão de produtos existentes para variantes ainda está indisponível.',
            ),
          if (!draft.enabled && draft.entries.isNotEmpty)
            const Text(
              'Rascunhos preservados. Este produto será salvo sem variantes.',
            ),
          Visibility(
            visible: draft.enabled,
            maintainState: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Selecione as combinações desejadas e salve o cadastro completo. '
                  'Após o primeiro envio, a intenção fica preservada para recuperação.',
                ),
                const Text(
                  'Cada variante terá estoque próprio. O produto pai não pode ser vendido e não recebe estoque.',
                ),
                if (draft.dataError != null) Text(draft.dataError!),
                for (final d in draft.definitions)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text(
                      '${d['label']}: ${(d['values'] as List).map((v) => v['label']).join(', ')}',
                    ),
                  ),
                if (draft.existingProduct) ...[
                  const Text(
                    'A edição cadastral de variantes gravadas ainda está indisponível.',
                  ),
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      (widget.readState ?? _unavailableRead).message,
                      key: const ValueKey('product-variants-read-status'),
                    ),
                  ),
                  if ((widget.readState ?? _unavailableRead).status ==
                      ProductVariantsReadStatus.loading)
                    const LinearProgressIndicator(),
                  if (draft.existingVariants != null)
                    const Text(
                      'Dados de apresentação, sem confirmação de leitura autoritativa.',
                    ),
                  for (final row
                      in draft.existingVariants ?? <Map<String, dynamic>>[])
                    ListTile(
                      title: Text(row['name'] as String? ?? 'Variante'),
                      subtitle: Text(
                        '${describe(row)}\nCOD: ${row['cod'] ?? 'Não informado'}'
                        '\nEstoque individual: ${row['quantidade'] ?? 'Indisponível'}'
                        '\n${row['isArchived'] == true ? 'Arquivada' : 'Ativa'}',
                      ),
                    ),
                ] else ...[
                  TextField(
                    key: const ValueKey('attribute-label'),
                    controller: attribute,
                    enabled: draft.entries.isEmpty,
                    decoration: const InputDecoration(
                      labelText: 'Atributo',
                      hintText: 'Ex.: Cor, tamanho ou modelo',
                    ),
                  ),
                  TextField(
                    key: const ValueKey('attribute-options'),
                    controller: options,
                    enabled: draft.entries.isEmpty,
                    decoration: const InputDecoration(
                      labelText: 'Opções separadas por vírgula',
                      hintText: 'Ex.: Azul, Verde',
                    ),
                  ),
                  TextButton.icon(
                    onPressed: draft.entries.isEmpty
                        ? () => perform(() {
                            draft.addAttribute(attribute.text, options.text);
                            attribute.clear();
                            options.clear();
                          })
                        : null,
                    icon: const Icon(Icons.add),
                    label: const Text('Adicionar atributo'),
                  ),
                  if (draft.entries.isNotEmpty)
                    const Text(
                      'Os atributos permanecem fixos enquanto houver variantes no rascunho.',
                    ),
                  for (final entry in draft.entries)
                    Card(
                      key: ValueKey('variant-draft-${entry.key}'),
                      child: Padding(
                        padding: const EdgeInsets.all(8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              entry.fields['name'] as String? ??
                                  'Variante sem nome',
                            ),
                            Text(describe(entry.fields)),
                            Text(
                              'COD: ${entry.fields['cod'] ?? 'Não informado'}',
                            ),
                            Text(entry.initialStock['kind'] == 'convertToLots'
                              ? 'Rascunho local · ${(entry.initialStock['lots'] as List).length} lotes iniciais'
                              : 'Rascunho local · Estoque inicial: ${entry.initialStock['quantity']}'),
                            Wrap(
                              children: [
                                TextButton(
                                  onPressed: () => setState(() {
                                    editing = entry.key;
                                    name.text =
                                        entry.fields['name'] as String? ?? '';
                                    cod.text =
                                        entry.fields['cod'] as String? ?? '';
                                    final config = entry.commercial;
                                    final policy = config['priceCents'] as Map;
                                    price.text = policy['mode'] == 'override' ?
                                      ((policy['value'] as int) / 100).toStringAsFixed(2) : '';
                                    minimum.text = config['minimumStock']?.toString() ?? '';
                                    final stock = entry.initialStock;
                                    quantity.text = stock['quantity']?.toString() ?? '0';
                                    lotsText.text = stock['lots'] == null ? '' : (stock['lots'] as List).map((l) =>
                                      '${l['quantidade']}@${DateTime.fromMillisecondsSinceEpoch(l['validadeMs'] as int).toIso8601String().substring(0, 10)}').join('\n');
                                    selected
                                      ..clear()
                                      ..addAll(draft.selections(entry.fields));
                                    error = null;
                                  }),
                                  child: const Text('Editar rascunho'),
                                ),
                                TextButton(
                                  onPressed: () => setState(() {
                                    draft.remove(entry.key);
                                    if (editing == entry.key) editing = null;
                                  }),
                                  child: const Text('Remover rascunho'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  for (final d in draft.definitions)
                    DropdownButtonFormField<String>(
                      key: ValueKey(
                        'variant-select-${d['attributeId']}-${editing ?? 'new'}',
                      ),
                      value: selected[d['attributeId']],
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: d['label'] as String,
                      ),
                      items: [
                        for (final v in d['values'] as List)
                          DropdownMenuItem(
                            value: v['valueId'] as String,
                            child: Text(v['label'] as String),
                          ),
                      ],
                      onChanged: (value) => setState(
                        () => selected[d['attributeId'] as String] = value!,
                      ),
                    ),
                  TextField(
                    key: const ValueKey('variant-form-name'),
                    controller: name,
                    decoration: const InputDecoration(
                      labelText: 'Nome da variante (opcional)',
                    ),
                  ),
                  TextField(
                    key: const ValueKey('variant-form-cod'),
                    controller: cod,
                    decoration: const InputDecoration(
                      labelText: 'COD da variante (opcional)',
                    ),
                  ),
                  const Text(
                    'A disponibilidade do COD na loja precisa ser confirmada ao salvar.',
                  ),
                  TextField(key: const ValueKey('variant-form-price'), controller: price,
                    decoration: const InputDecoration(labelText: 'Preço próprio (vazio herda preço base)')),
                  TextField(key: const ValueKey('variant-form-quantity'), controller: quantity,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Estoque inicial manual (sem lotes)')),
                  TextField(key: const ValueKey('variant-form-minimum'), controller: minimum,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Estoque mínimo individual (opcional)')),
                  TextField(key: const ValueKey('variant-form-lots'), controller: lotsText, maxLines: 3,
                    decoration: const InputDecoration(labelText: 'Lotes iniciais: quantidade@AAAA-MM-DD, um por linha',
                      helperText: 'Com lotes, o saldo é a soma dos lotes; o campo manual é ignorado.')),
                  FilledButton(
                    onPressed: () => perform(() {
                      final lots = <Map<String, dynamic>>[];
                      for (final line in lotsText.text.split('\n').where((v) => v.trim().isNotEmpty)) {
                        final parts = line.trim().split('@');
                        final n = parts.length == 2 ? int.tryParse(parts[0]) : null;
                        final date = parts.length == 2 ? DateTime.tryParse(parts[1]) : null;
                        if (n == null || n <= 0 || date == null ||
                            !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(parts[1]) ||
                            date.toIso8601String().substring(0, 10) != parts[1]) {
                          throw const FormatException('Lote inválido. Use quantidade@AAAA-MM-DD.');
                        }
                        lots.add({'quantidade': n, 'validadeMs': date.millisecondsSinceEpoch});
                      }
                      final n = int.tryParse(quantity.text);
                      final min = minimum.text.trim().isEmpty ? null : int.tryParse(minimum.text);
                      if ((lots.isEmpty && n == null) || (minimum.text.trim().isNotEmpty && min == null)) {
                        throw const FormatException('Informe quantidades inteiras.');
                      }
                      draft.apply(
                        selected,
                        name.text,
                        cod.text,
                        editingKey: editing,
                        parentCod: widget.parentCod(),
                        priceCents: price.text.trim().isEmpty ? null : variantMoneyCents(price.text),
                        quantity: lots.isEmpty ? n! : 0, minimumStock: min, lots: lots,
                      );
                      editing = null;
                      name.clear();
                      cod.clear();
                      price.clear(); quantity.text = '0'; minimum.clear(); lotsText.clear();
                      selected.clear();
                    }),
                    child: Text(
                      editing == null
                          ? 'Adicionar variante ao rascunho'
                          : 'Aplicar alteração no rascunho',
                    ),
                  ),
                ],
                if (error != null)
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      error!,
                      key: const ValueKey('variant-form-error'),
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ],
      );
    },
  );
}
