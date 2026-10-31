import 'dart:async';
import 'package:flutter/material.dart';
import '../services/product_stock_edit.dart';
import 'product_stock_lots_editor.dart';

String stockChangeDescription(Map<String, dynamic>? change) {
  if (change == null) return '';
  String values(Map row) => [
    if (row.containsKey('quantidade')) 'quantidade ${row['quantidade']}',
    if (row.containsKey('validadeMs'))
      'validade ${DateTime.fromMillisecondsSinceEpoch(row['validadeMs'] as int, isUtc: true).toIso8601String()}',
  ].join(', ');
  switch (change['kind']) {
    case 'setManualQuantity':
      return 'Saldo manual solicitado: ${change['quantity']}';
    case 'convertToManual':
      return 'Conversão para manual: ${change['quantity']}. Todos os lotes e metadados serão removidos.';
    case 'convertToLots':
      return 'Conversão para lotes:\n${(change['lots'] as List).map((row) => values(row as Map)).join('\n')}';
    default:
      return (change['operations'] as List)
          .map((row) {
            if (row['op'] == 'add') {
              return 'Adicionar lote: ${values(row as Map)}';
            }
            if (row['op'] == 'remove') return 'Remover lote ${row['index']}';
            return 'Lote ${row['index']}: ${values(row['set'] as Map)}';
          })
          .join('\n');
  }
}

String stockValidityDescription(Map date) {
  final seconds = int.parse(date['seconds'] as String);
  final base = DateTime.fromMillisecondsSinceEpoch(
    seconds * 1000,
    isUtc: true,
  ).toIso8601String().split('.').first;
  return '$base.${date['nanoseconds'].toString().padLeft(9, '0')}Z';
}

class ProductStockEditDialog extends StatefulWidget {
  final ProductStockEditAccess access;
  final String productId;
  final String storeId;
  const ProductStockEditDialog({
    super.key,
    required this.access,
    required this.productId,
    required this.storeId,
  });
  @override
  State<ProductStockEditDialog> createState() => _ProductStockEditDialogState();
}

class _ProductStockEditDialogState extends State<ProductStockEditDialog> {
  late final ProductStockEditSession session;
  final quantity = TextEditingController();
  final reason = TextEditingController();
  GlobalKey<ProductStockLotsEditorState> lotsKey =
      GlobalKey<ProductStockLotsEditorState>();
  String intent = 'entry';
  bool conversion = false;
  String? inputError;
  ProductStockDraft? rendered;
  @override
  void initState() {
    super.initState();
    session = ProductStockEditSession(
      access: widget.access,
      productId: widget.productId,
      storeId: widget.storeId,
    );
    unawaited(session.open());
  }

  @override
  void dispose() {
    session.dispose();
    quantity.dispose();
    reason.dispose();
    super.dispose();
  }

  Future<void> preview() async {
    try {
      if (intent == 'entry' || intent == 'exit' || intent == 'set') {
        session.manual(intent, int.parse(quantity.text), reason.text);
      } else if (intent == 'convertToManual') {
        session.selectChange(
          {
            'kind': intent,
            'quantity': int.parse(quantity.text),
            'acknowledgement': conversion,
          },
          reason.text,
          conversionConfirmed: conversion,
        );
      } else {
        final rows = lotsKey.currentState!.command();
        session.selectChange(
          {'kind': intent, intent == 'editLots' ? 'operations' : 'lots': rows},
          reason.text,
          conversionConfirmed: conversion,
        );
      }
      if (session.errorFor('stock') != null ||
          !session.canEdit ||
          session.draft?.change == null) {
        return;
      }
      final draft = session.draft!;
      if (reason.text.trim().isEmpty) {
        throw const FormatException('Motivo obrigatório.');
      }
      final accepted = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Confirmar ajuste de estoque'),
          content: SingleChildScrollView(
            child: Text(
              'Atual: ${draft.quantity}\nSolicitado: ${draft.requestedQuantity}\nAlteração: ${draft.requestedQuantity! - draft.quantity}\nMotivo: ${reason.text.trim()}\n${stockChangeDescription(draft.change)}',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Revisar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Confirmar ajuste'),
            ),
          ],
        ),
      );
      if (accepted == true && mounted) await session.confirm();
    } on FormatException catch (e) {
      setState(() => inputError = e.message);
    }
  }

  String message(StockEditStatus status) => switch (status) {
    StockEditStatus.confirmed => 'Ajuste confirmado pelo servidor.',
    StockEditStatus.versionConflict =>
      'Conflito de versão. Revise o estoque atual antes de criar outra intenção.',
    StockEditStatus.unknown =>
      'Resultado desconhecido. Consulte ou repita o mesmo comando com segurança.',
    StockEditStatus.persistenceFailure =>
      'Falha de persistência, corrupção ou operação incompatível pendente. Envio bloqueado; consulte a pendência original.',
    StockEditStatus.scopeChanged =>
      'Conta, loja ou projeto mudou. Operação suspensa.',
    StockEditStatus.disabled =>
      'Disponível somente no Emulator explicitamente configurado.',
    StockEditStatus.rejected => 'Ajuste rejeitado: ${session.rejectionReason}',
    StockEditStatus.identityConflict =>
      'Identidade da operação em conflito. Reconciliação necessária.',
    StockEditStatus.readFailure =>
      'Não foi possível ler o estoque autoritativo.',
    StockEditStatus.validationError => 'Revise os dados e o motivo.',
    StockEditStatus.editing => 'Ajuste independente do cadastro.',
    StockEditStatus.noChanges => 'Nenhuma alteração solicitada.',
    _ => 'Aguarde: ${status.name}',
  };
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: session,
    builder: (context, _) {
      final draft = session.draft;
      if (draft != null && !identical(draft, rendered)) {
        rendered = draft;
        quantity.clear();
        reason.clear();
        lotsKey = GlobalKey<ProductStockLotsEditorState>();
        conversion = false;
        intent = draft.valid && draft.lots.isNotEmpty ? 'editLots' : 'entry';
      }
      final editable = session.canEdit && draft!.valid;
      return PopScope(
        canPop: !session.busy,
        child: AlertDialog(
          title: const Text('Ajustar estoque — local'),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(message(session.status)),
                  if (draft != null) ...[
                    Text(
                      '${session.frozenCommand == null ? 'Quantidade atual' : 'Quantidade antes do ajuste'}: ${draft.baseline.product['quantidade']}',
                    ),
                    if (!draft.valid)
                      const Text(
                        'Estoque legado inválido ou produto arquivado. Ajuste bloqueado.',
                      ),
                    if (draft.valid) ...[
                      for (final lot in draft.lots)
                        Text(
                          'Lote ${lot['index']}: ${lot['quantidade']} — validade ${stockValidityDescription(lot['validade'] as Map)}',
                        ),
                      DropdownButtonFormField<String>(
                        isExpanded: true,
                        value: intent,
                        items: [
                          if (draft.lots.isEmpty) ...[
                            const DropdownMenuItem(
                              value: 'entry',
                              child: Text('Entrada'),
                            ),
                            const DropdownMenuItem(
                              value: 'exit',
                              child: Text('Saída manual'),
                            ),
                            const DropdownMenuItem(
                              value: 'set',
                              child: Text('Definir quantidade'),
                            ),
                            const DropdownMenuItem(
                              value: 'convertToLots',
                              child: Text('Converter para lotes'),
                            ),
                          ] else ...[
                            const DropdownMenuItem(
                              value: 'editLots',
                              child: Text('Editar lotes'),
                            ),
                            const DropdownMenuItem(
                              value: 'convertToManual',
                              child: Text('Converter para manual'),
                            ),
                          ],
                        ],
                        onChanged: editable
                            ? (v) => setState(() {
                                intent = v!;
                                conversion = false;
                                inputError = null;
                                lotsKey =
                                    GlobalKey<ProductStockLotsEditorState>();
                              })
                            : null,
                      ),
                      if (intent == 'editLots' || intent == 'convertToLots')
                        ProductStockLotsEditor(
                          key: lotsKey,
                          lots: draft.lots,
                          conversion: intent == 'convertToLots',
                          enabled: editable,
                        )
                      else
                        TextField(
                          controller: quantity,
                          enabled: editable,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Quantidade solicitada',
                          ),
                        ),
                      TextField(
                        controller: reason,
                        enabled: editable,
                        decoration: const InputDecoration(
                          labelText: 'Motivo obrigatório',
                        ),
                      ),
                      if (intent.startsWith('convert'))
                        CheckboxListTile(
                          value: conversion,
                          onChanged: editable
                              ? (v) => setState(() => conversion = v!)
                              : null,
                          title: Text(
                            intent == 'convertToManual'
                                ? 'Confirmo remover todos os lotes e seus metadados.'
                                : 'Confirmo converter estoque manual para lotes.',
                          ),
                        ),
                    ],
                  ],
                  if (session.frozenCommand != null)
                    Text(
                      'Ajuste persistido: ${stockChangeDescription(session.frozenCommand!['stockChange'] as Map<String, dynamic>)}\nMotivo: ${session.frozenCommand!['reason']}',
                    ),
                  if (inputError != null || session.errorFor('stock') != null)
                    Text(inputError ?? session.errorFor('stock')!),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: session.busy ? null : () => Navigator.pop(context),
              child: const Text('Fechar'),
            ),
            if (editable)
              FilledButton(
                onPressed: () {
                  setState(() => inputError = null);
                  unawaited(preview());
                },
                child: const Text('Revisar ajuste'),
              ),
            if (!session.busy &&
                {
                  StockEditStatus.unknown,
                  StockEditStatus.persistenceFailure,
                  StockEditStatus.readFailure,
                }.contains(session.status))
              TextButton(
                onPressed: session.checkResult,
                child: const Text('Consultar resultado'),
              ),
            if (!session.busy && session.status == StockEditStatus.unknown)
              TextButton(
                onPressed: session.retrySameCommand,
                child: const Text('Retry seguro'),
              ),
            if (!session.busy &&
                {
                  StockEditStatus.confirmed,
                  StockEditStatus.rejected,
                  StockEditStatus.versionConflict,
                }.contains(session.status))
              TextButton(
                onPressed: session.reviewCurrentState,
                child: const Text('Revisar dados atuais'),
              ),
          ],
        ),
      );
    },
  );
}
