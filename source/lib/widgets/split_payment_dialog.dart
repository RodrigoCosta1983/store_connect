import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/sale_payment_allocation.dart';

class SplitPaymentDialog extends StatefulWidget {
  final int totalCents;
  final String? pixQrCodeUrl;
  const SplitPaymentDialog({super.key, required this.totalCents, this.pixQrCodeUrl});
  @override
  State<SplitPaymentDialog> createState() => _SplitPaymentDialogState();
}

class _PaymentRow {
  String method;
  final TextEditingController amount = TextEditingController();
  _PaymentRow(this.method);
}

class _SplitPaymentDialogState extends State<SplitPaymentDialog> {
  final rows = [_PaymentRow('Dinheiro'), _PaymentRow('Cartão de crédito')];
  final removedControllers = <TextEditingController>[];

  @override
  void dispose() {
    for (final row in rows) { row.amount.dispose(); }
    for (final controller in removedControllers) { controller.dispose(); }
    super.dispose();
  }

  int get allocated => rows.fold(0, (sum, row) => sum + (parsePaymentCents(row.amount.text) ?? 0));
  List<SalePaymentAllocation>? get valid {
    try {
      return validateSplitPayments(rows.map((row) => SalePaymentAllocation(
        row.method, parsePaymentCents(row.amount.text) ?? 0)).toList(), widget.totalCents);
    } on FormatException { return null; }
  }

  @override
  Widget build(BuildContext context) {
    final remaining = widget.totalCents - allocated;
    final payments = valid;
    return AlertDialog(
      title: const Text('Dividir pagamento'),
      content: SizedBox(width: 420, child: SingleChildScrollView(child: Column(
        mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Total da venda: ${paymentMoney(widget.totalCents)}',
            style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Informe os valores recebidos em cada forma de pagamento.'),
          for (final row in rows) Padding(
            key: ObjectKey(row), padding: const EdgeInsets.only(top: 16),
            child: Column(children: [
              DropdownButtonFormField<String>(
                value: row.method, isExpanded: true,
                decoration: const InputDecoration(labelText: 'Forma de pagamento'),
                items: instantPaymentMethods.where((method) => method == row.method ||
                  !rows.any((other) => other.method == method)).map((method) =>
                    DropdownMenuItem(value: method, child: Text(method))).toList(),
                onChanged: (method) { if (method != null) setState(() => row.method = method); },
              ),
              Row(children: [
                Expanded(child: TextField(
                  key: ValueKey('split-amount-${row.method}'), controller: row.amount,
                  decoration: const InputDecoration(labelText: 'Valor (R\$)'),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9,.]'))],
                  onChanged: (_) => setState(() {}),
                )),
                IconButton(tooltip: 'Preencher restante', icon: const Icon(Icons.calculate_outlined),
                  onPressed: remaining > 0 ? () => setState(() {
                    final value = (parsePaymentCents(row.amount.text) ?? 0) + remaining;
                    row.amount.text = '${value ~/ 100},${(value % 100).toString().padLeft(2, '0')}';
                  }) : null),
                if (rows.length > 2) IconButton(tooltip: 'Remover forma', icon: const Icon(Icons.close),
                  onPressed: () => setState(() { rows.remove(row); removedControllers.add(row.amount); })),
              ]),
            ]),
          ),
          if (rows.length < instantPaymentMethods.length) TextButton.icon(
            onPressed: () => setState(() => rows.add(_PaymentRow(instantPaymentMethods.firstWhere(
              (method) => !rows.any((row) => row.method == method))))),
            icon: const Icon(Icons.add), label: const Text('Adicionar forma de pagamento')),
          if (rows.any((row) => row.method == 'PIX')) ...[
            if (widget.pixQrCodeUrl?.isNotEmpty == true) TextButton.icon(
              icon: const Icon(Icons.pix), label: const Text('Ver QR Code PIX da loja'),
              onPressed: () => showDialog<void>(context: context, builder: (ctx) => AlertDialog(
                title: const Text('PIX da loja'),
                content: SizedBox(width: 260, height: 280, child: Column(mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Valor: ${paymentMoney(parsePaymentCents(rows.firstWhere((row) => row.method == 'PIX').amount.text) ?? 0)}'),
                    const SizedBox(height: 8),
                    Expanded(child: Image.network(widget.pixQrCodeUrl!, fit: BoxFit.contain,
                      errorBuilder: (_, _, _) => const Text('QR Code indisponível. Utilize a chave PIX da loja.'))),
                  ])),
                actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Voltar'))],
              )),
            ) else const Text('Utilize o PIX da loja e confira o valor recebido antes de confirmar.'),
          ],
          const SizedBox(height: 12),
          Text(remaining < 0 ? 'Valor excedente: ${paymentMoney(-remaining)}' :
            'Falta distribuir: ${paymentMoney(remaining)}',
            style: TextStyle(fontWeight: FontWeight.bold,
              color: remaining < 0 ? Theme.of(context).colorScheme.error : null)),
        ],
      ))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: payments == null ? null : () => Navigator.pop(context, payments),
          child: const Text('Confirmar pagamento')),
      ],
    );
  }
}
