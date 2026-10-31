import 'package:flutter/material.dart';
import '../services/variant_preview_state.dart';
import 'product_stock_lots_editor.dart';

String _phaseLabel(VariantPreviewPhase phase) => switch (phase) {
  VariantPreviewPhase.loading => 'Carregando',
  VariantPreviewPhase.ready => 'Pronta',
  VariantPreviewPhase.prepared => 'Intenção preparada',
  VariantPreviewPhase.conflict => 'Conflito',
  VariantPreviewPhase.replay => 'Resultado repetido (replay)',
  VariantPreviewPhase.success => 'Sucesso',
  VariantPreviewPhase.error => 'Erro',
  VariantPreviewPhase.denied => 'Permissão negada',
};

/// Isolated fixture preview. Deliberately absent from operational navigation.
class VariantPreviewPanel extends StatefulWidget {
  final VariantPreviewSession session;
  const VariantPreviewPanel({super.key, required this.session});
  @override
  State<VariantPreviewPanel> createState() => _VariantPreviewPanelState();
}

class _VariantPreviewPanelState extends State<VariantPreviewPanel> {
  final quantity = TextEditingController();
  final reason = TextEditingController();
  String? error;
  String mode = 'setManualQuantity';
  bool conversionConfirmed = false;
  GlobalKey<ProductStockLotsEditorState> lotsKey = GlobalKey();
  VariantPreviewSession get session => widget.session;
  @override
  void dispose() {
    quantity.dispose();
    reason.dispose();
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

  String attributes(Map<String, dynamic> row) => session.fixture.definitions
      .map((d) {
        final value = (row['attributes'] as Map)[d['attributeId']];
        final option = (d['values'] as List).firstWhere(
          (v) => v['valueId'] == value,
        );
        return '${d['label']}: ${option['label']}';
      })
      .join(' · ');
  void select(Map<String, dynamic> row) {
    session.select(
      VariantIdentity(session.fixture.productId, row['variantId'] as String),
    );
    setState(() {
      mode = (row['lotes'] as List? ?? []).isEmpty
          ? 'setManualQuantity'
          : 'editLots';
      quantity.clear();
      reason.clear();
      conversionConfirmed = false;
      lotsKey = GlobalKey();
      error = null;
    });
  }

  Future<void> confirmArchive() async {
    final identity = session.selected!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Arquivar esta variante?'),
        content: Text(
          'Variante ${identity.variantId}. Estoque, lotes, histórico e COD serão preservados. '
          'Novos ajustes ficarão bloqueados. Esta prévia apenas prepara a intenção.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirmar arquivamento'),
          ),
        ],
      ),
    );
    if (!mounted || confirmed != true) return;
    perform(() => session.prepareArchive(reason.text, confirmed: true));
  }

  void prepareStock() => perform(() {
    Map<String, dynamic> change;
    if (mode == 'editLots') {
      change = {'kind': mode, 'operations': lotsKey.currentState!.command()};
    } else if (mode == 'convertToLots') {
      if (!conversionConfirmed) {
        throw const FormatException('Confirme a conversão.');
      }
      change = {'kind': mode, 'lots': lotsKey.currentState!.command()};
    } else {
      if (mode == 'convertToManual' && !conversionConfirmed) {
        throw const FormatException('Confirme a conversão.');
      }
      change = {
        'kind': mode,
        'quantity': int.parse(quantity.text),
        if (mode == 'convertToManual') 'acknowledgement': true,
      };
    }
    session.prepareStock(change, reason.text);
  });
  Widget section(String title, List<Widget> children) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          ...children.map(
            (w) =>
                Padding(padding: const EdgeInsets.only(bottom: 12), child: w),
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: session,
    builder: (context, _) {
      final fixture = session.fixture;
      final enabled = session.canPrepare;
      final selected = session.selected == null
          ? null
          : fixture.variant(session.selected!);
      final archived = selected?['isArchived'] == true;
      return Scaffold(
        appBar: AppBar(title: const Text('Prévia de variantes')),
        body: session.phase == VariantPreviewPhase.loading
            ? const Center(
                child: CircularProgressIndicator(
                  semanticsLabel: 'Carregando fixture sintética',
                ),
              )
            : SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Dados sintéticos · Sem envio ou persistência',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      fixture.name,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    Text(
                      'Produto principal · Não vendável · ${fixture.archived ? 'Arquivado' : 'Ativo'}',
                    ),
                    if (fixture.data.containsKey('cod'))
                      Text('COD principal: ${fixture.data['cod']}'),
                    Text('Baseline do produto: ${fixture.baseline.exact}'),
                    const Text(
                      'Preço, imagens, barcode, custo e fiscal: indisponíveis nesta etapa.',
                    ),
                    const SizedBox(height: 16),
                    LayoutBuilder(
                      builder: (context, constraints) => Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          for (final row in fixture.variants)
                            SizedBox(
                              width: constraints.maxWidth > 850
                                  ? (constraints.maxWidth - 24) / 3
                                  : constraints.maxWidth,
                              child: Card(
                                key: ValueKey(
                                  VariantIdentity(
                                    fixture.productId,
                                    row['variantId'] as String,
                                  ).key,
                                ),
                                child: ListTile(
                                  selected:
                                      session.selected?.variantId ==
                                      row['variantId'],
                                  title: Text(
                                    row['name'] as String? ?? fixture.name,
                                  ),
                                  subtitle: Text(
                                    '${attributes(row)}\n${row.containsKey('cod') ? 'COD: ${row['cod']}\n' : ''}'
                                    'Estoque individual: ${row['quantidade']} · ${(row['lotes'] as List? ?? []).isEmpty ? 'Manual' : 'Lotes'}\n'
                                    '${row['isArchived'] == true ? 'Arquivada' : 'Ativa'}',
                                  ),
                                  trailing: const Icon(Icons.chevron_right),
                                  onTap: () => select(row),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    section('Criar variante · rascunho cadastral', [
                      TextField(
                        key: const ValueKey('variant-name'),
                        enabled: enabled,
                        decoration: const InputDecoration(
                          labelText: 'Nome opcional da variante',
                        ),
                        onChanged: (v) => session.draftName = v,
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Informar COD opcional'),
                        value: session.codSupplied,
                        onChanged: enabled
                            ? (v) => setState(() => session.codSupplied = v!)
                            : null,
                      ),
                      if (session.codSupplied)
                        TextField(
                          key: const ValueKey('variant-cod'),
                          enabled: enabled,
                          decoration: const InputDecoration(
                            labelText: 'COD da variante',
                          ),
                          onChanged: (v) => session.draftCod = v,
                        ),
                      for (final d in fixture.definitions)
                        DropdownButtonFormField<String>(
                          key: ValueKey('attribute-${d['attributeId']}'),
                          value: session.selections[d['attributeId']],
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: d['label'] as String,
                          ),
                          items: [
                            for (final v in d['values'] as List)
                              DropdownMenuItem<String>(
                                value: v['valueId'] as String,
                                child: Text(v['label'] as String),
                              ),
                          ],
                          onChanged: enabled
                              ? (v) => setState(
                                  () =>
                                      session.selections[d['attributeId']
                                              as String] =
                                          v!,
                                )
                              : null,
                        ),
                      const Text(
                        'Selecione todos os atributos. Sem geração automática. Estoque inicial: zero, sem lotes.',
                      ),
                      FilledButton(
                        onPressed: enabled
                            ? () => perform(session.prepareCreation)
                            : null,
                        child: const Text('Preparar criação'),
                      ),
                    ]),
                    if (selected != null)
                      section('Estoque e arquivamento · variante selecionada', [
                        Text(
                          '${selected['name']} · ${session.selected!.variantId}',
                        ),
                        Text(
                          'Baseline da variante: ${VariantBaseline(Map<String, dynamic>.from(selected['baseline'] as Map)).exact}',
                        ),
                        Text(
                          'Saldo atual da fixture: ${selected['quantidade']}',
                        ),
                        if (archived)
                          const Text(
                            'Variante arquivada: novos ajustes bloqueados.',
                          ),
                        DropdownButtonFormField<String>(
                          key: ValueKey(
                            'stock-mode-${session.selected!.key}-$mode',
                          ),
                          value: mode,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Tipo de ajuste explícito',
                          ),
                          items: [
                            for (final entry
                                in ((selected['lotes'] as List? ?? []).isEmpty
                                        ? {
                                            'setManualQuantity':
                                                'Definir saldo manual',
                                            'convertToLots':
                                                'Converter para lotes',
                                          }
                                        : {
                                            'editLots': 'Editar lotes',
                                            'convertToManual':
                                                'Converter para manual',
                                          })
                                    .entries)
                              DropdownMenuItem(
                                value: entry.key,
                                child: Text(entry.value),
                              ),
                          ],
                          onChanged: enabled && !archived
                              ? (v) => setState(() {
                                  mode = v!;
                                  conversionConfirmed = false;
                                  lotsKey = GlobalKey();
                                })
                              : null,
                        ),
                        if (mode == 'setManualQuantity' ||
                            mode == 'convertToManual')
                          TextField(
                            key: const ValueKey('variant-quantity'),
                            controller: quantity,
                            enabled: enabled && !archived,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'Quantidade solicitada',
                            ),
                          ),
                        if (mode == 'editLots' || mode == 'convertToLots')
                          ProductStockLotsEditor(
                            key: lotsKey,
                            lots: [
                              for (
                                var i = 0;
                                i < (selected['lotes'] as List).length;
                                i++
                              )
                                {
                                  ...Map<String, dynamic>.from(
                                    (selected['lotes'] as List)[i] as Map,
                                  ),
                                  'index': i,
                                },
                            ],
                            conversion: mode == 'convertToLots',
                            enabled: enabled && !archived,
                          ),
                        if (mode.startsWith('convert'))
                          CheckboxListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              mode == 'convertToManual'
                                  ? 'Confirmo remover os lotes e seus metadados nesta intenção'
                                  : 'Confirmo a conversão explícita para lotes',
                            ),
                            value: conversionConfirmed,
                            onChanged: enabled && !archived
                                ? (v) =>
                                      setState(() => conversionConfirmed = v!)
                                : null,
                          ),
                        TextField(
                          key: const ValueKey('variant-reason'),
                          controller: reason,
                          enabled: enabled && !archived,
                          decoration: const InputDecoration(
                            labelText: 'Motivo da operação',
                          ),
                        ),
                        Wrap(
                          spacing: 12,
                          runSpacing: 8,
                          children: [
                            FilledButton(
                              onPressed: enabled && !archived
                                  ? prepareStock
                                  : null,
                              child: const Text('Preparar ajuste'),
                            ),
                            OutlinedButton(
                              onPressed:
                                  enabled &&
                                      !archived &&
                                      session.role == 'admin'
                                  ? confirmArchive
                                  : null,
                              child: const Text('Preparar arquivamento'),
                            ),
                          ],
                        ),
                      ]),
                    if (error != null)
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          error!,
                          key: const ValueKey('preview-error'),
                        ),
                      ),
                    section('Estado local da prévia', [
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          'Estado: ${_phaseLabel(session.phase)}',
                          key: const ValueKey('preview-phase'),
                        ),
                      ),
                      if (!session.permitted)
                        const Text('Permissão simulada negada.'),
                      if (session.message != null) Text(session.message!),
                      if (session.pending != null) ...[
                        SelectableText(
                          'Intenção ${session.pending!.requestId}\nConteúdo congelado para retomada; nenhum envio.',
                        ),
                        OutlinedButton(
                          onPressed: session.permitted
                              ? () => perform(session.retry)
                              : null,
                          child: const Text('Retomar a mesma intenção'),
                        ),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final phase in [
                              VariantPreviewPhase.conflict,
                              VariantPreviewPhase.replay,
                              VariantPreviewPhase.success,
                              VariantPreviewPhase.error,
                              VariantPreviewPhase.denied,
                            ])
                              TextButton(
                                onPressed: () => session.simulate(phase),
                                child: Text('Simular ${_phaseLabel(phase)}'),
                              ),
                          ],
                        ),
                      ],
                    ]),
                  ],
                ),
              ),
      );
    },
  );
}
