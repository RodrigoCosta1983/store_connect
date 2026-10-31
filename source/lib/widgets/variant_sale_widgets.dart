import 'dart:async';
import '../models/sale_payment_allocation.dart';
import 'split_payment_dialog.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/cart_provider.dart';
import '../services/variant_sale.dart';
import '../models/customer_model.dart';
import '../screens/management/manage_customers_screen.dart';

typedef VariantSaleFactory = Future<VariantSaleAccess> Function(String storeId);

class VariantParentSaleCard extends StatelessWidget {
  final String storeId, productId, name;
  final VariantSaleFactory? factory;
  final void Function(VariantSaleChoice)? onSelected;
  const VariantParentSaleCard({super.key, required this.storeId, required this.productId,
    required this.name, this.factory, this.onSelected});
  @override
  Widget build(BuildContext context) => Card(child: Padding(padding: const EdgeInsets.all(8),
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Icon(Icons.style, size: 40), Text(name, maxLines: 2, overflow: TextOverflow.ellipsis),
      const Text('Escolha cor, tamanho ou outra opção', textAlign: TextAlign.center),
      FilledButton(key: ValueKey('select-variants-$productId'), onPressed: () async {
        final cart = context.read<CartProvider>();
        final choice = await showDialog<VariantSaleChoice>(context: context,
          builder: (_) => _VariantChoiceDialog(storeId: storeId, productId: productId, name: name, factory: factory));
        if (choice != null && onSelected != null) {
          onSelected!(choice);
        } else if (choice != null && context.mounted) {
          try { cart.addVariant(choice); }
          catch (e) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
        }
      }, child: const Text('Selecionar variante')),
    ])));
}
class _VariantChoiceDialog extends StatefulWidget {
  final String storeId, productId, name;
  final VariantSaleFactory? factory;
  const _VariantChoiceDialog({required this.storeId, required this.productId, required this.name, this.factory});
  @override State<_VariantChoiceDialog> createState() => _VariantChoiceDialogState();
}
class _VariantChoiceDialogState extends State<_VariantChoiceDialog> {
  VariantSaleAccess? access;
  Map<String, dynamic>? data;
  String? error;
  bool busy = false;
  @override void initState() { super.initState(); unawaited(load()); }
  Future<void> load() async {
    setState(() { busy = true; error = null; data = null; });
    try {
      final owner = access ?? await (widget.factory ?? VariantSaleAccess.open)(widget.storeId);
      if (!mounted) { await owner.close(); return; }
      access = owner;
      final result = await owner.choices(widget.productId);
      if (mounted) setState(() => data = result);
    } catch (e) { if (mounted) setState(() => error = 'Não foi possível confirmar as variantes: $e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override void dispose() { if (access != null) unawaited(access!.close()); super.dispose(); }
  @override Widget build(BuildContext context) => AlertDialog(title: Text(widget.name),
    content: SizedBox(width: 500, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
      if (busy) const LinearProgressIndicator(),
      if (error != null) Text(error!),
      if (data != null) ...[
        Text(data!['source'] == 'cache' ? 'Última disponibilidade salva neste aparelho. Somente intenção offline; preço, estoque e permissão serão revalidados ao sincronizar.' :
          'Disponibilidade consultada no servidor. Preço e estoque serão revalidados ao concluir.'),
        if ((data!['variants'] as List).isEmpty) const Text('Nenhuma variante cadastrada.'),
        for (final raw in data!['variants'] as List) Builder(builder: (context) {
          final row = Map<String, dynamic>.from(raw as Map);
          final available = row['status'] == 'available';
          return ListTile(key: ValueKey('choose-variant-${row['variantId']}'),
            title: Text(row['name'] as String? ?? 'Variante arquivada'),
            subtitle: Text(available ? 'R\$ ${((row['unitPriceCents'] as int) / 100).toStringAsFixed(2)} · Disponível: ${row['availableQuantity']}' :
              row['status'] == 'archived' ? 'Arquivada — venda bloqueada' : 'Sem estoque — venda bloqueada'),
            enabled: available, onTap: available ? () => Navigator.pop(context, access!.choice(data!, row)) : null);
        }),
      ],
    ]))), actions: [TextButton(onPressed: busy ? null : load, child: const Text('Atualizar')),
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar'))]);
}

class VariantCartLineWidget extends StatelessWidget {
  final VariantSaleLine line;
  const VariantCartLineWidget({super.key, required this.line});
  @override Widget build(BuildContext context) {
    final cart = context.read<CartProvider>();
    return Card(child: ListTile(title: Text(line.choice.name),
      subtitle: Text('R\$ ${(line.subtotalCents / 100).toStringAsFixed(2)} · Estoque na seleção: ${line.choice.availableQuantity}'),
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(key: ValueKey('minus-${line.choice.variantId}'), icon: const Icon(Icons.remove_circle_outline),
          onPressed: () => cart.removeVariant(line.choice.key)),
        Text('${line.quantity}'),
        IconButton(key: ValueKey('plus-${line.choice.variantId}'), icon: const Icon(Icons.add_circle_outline), onPressed: () {
          try { cart.addVariant(line.choice); }
          catch (e) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
        }),
      ])));
  }
}

class VariantSalePayment extends StatefulWidget {
  final String storeId, notes;
  final VariantSaleFactory? factory;
  final bool recovery;
  final Future<Customer?> Function(BuildContext, String)? customerPicker;
  const VariantSalePayment({super.key, required this.storeId, required this.notes, this.factory, this.recovery = false, this.customerPicker});
  @override State<VariantSalePayment> createState() => _VariantSalePaymentState();
}
class _VariantSalePaymentState extends State<VariantSalePayment> {
  VariantSaleAccess? access;
  Map<String, dynamic>? pending, result;
  String? error;
  bool busy = true;
  @override void initState() { super.initState(); unawaited(load()); }
  Future<void> load() async {
    setState(() { busy = true; error = null; });
    try {
      final owner = access ?? await (widget.factory ?? VariantSaleAccess.open)(widget.storeId);
      if (!mounted) { await owner.close(); return; }
      access = owner;
      final saved = await owner.pending();
      if (mounted) setState(() { pending = saved; result = saved?['result'] == null ? null : Map<String, dynamic>.from(saved!['result'] as Map); });
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> confirm(String payment, {bool offline = false, String? customerId, Map<String, dynamic>? deferred, List<SalePaymentAllocation>? payments}) async {
    if (busy || access == null) return;
    final cart = context.read<CartProvider>(), revision = context.read<CartProvider>().revision;
    final isNew = pending == null;
    setState(() { busy = true; error = null; });
    try {
      if (isNew) {
        if (widget.recovery || !cart.hasVariants) throw StateError('Selecione ao menos uma variante.');
        await access!.prepare(cart.variantItems, payment, widget.notes,
          simpleItems: cart.simpleItems.values.toList(), customerId: customerId, deferred: deferred, offline: offline, payments: payments);
        if (offline) {
          final saved = await access!.pending();
          if (mounted) setState(() { pending = saved; result = null; });
          return; // Pending intent is not a confirmed sale or stock reservation.
        }
      }
      final proof = await access!.recover(allowSend: true);
      if (!mounted) return;
      result = proof;
      if (proof['status'] == 'confirmed' && isNew && cart.clearIfCurrent(revision)) {
        await access!.acknowledge();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Venda de variantes confirmada: ${proof['saleId']}')));
        Navigator.pop(context, true);
      } else {
        final saved = await access!.pending();
        if (mounted) setState(() { pending = saved; result = proof; });
      }
    } catch (e) {
      if (!mounted) return;
      Map<String, dynamic>? saved = pending;
      try { saved = await access!.pending(); } catch (_) { /* Preserve original failure. */ }
      if (mounted) setState(() { error = '$e'; pending = saved; });
    } finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> splitPayment() async {
    if (busy || access == null || pending != null) return;
    final cart = context.read<CartProvider>(), revision = context.read<CartProvider>().revision;
    final payments = await showDialog<List<SalePaymentAllocation>>(context: context,
      builder: (_) => SplitPaymentDialog(totalCents: (cart.totalAmount * 100).round()));
    if (!mounted || payments == null) return;
    if (cart.revision != revision) {
      setState(() => error = 'O carrinho mudou. Confira os valores antes de finalizar.');
      return;
    }
    await confirm(splitPaymentMethod, payments: payments);
  }
  Future<void> deferredPayment() async {
    if (busy) return;
    final customer = widget.customerPicker != null ? await widget.customerPicker!(context, widget.storeId) :
      await Navigator.of(context).push<Customer>(MaterialPageRoute(builder: (_) =>
        ManageCustomersScreen(isSelectionMode: true, storeId: widget.storeId)));
    if (customer == null || !mounted) return;
    final count = TextEditingController(text: '1'), date = TextEditingController();
    Map<String, dynamic>? plan;
    try {
      plan = await showDialog<Map<String, dynamic>>(context: context, builder: (ctx) => AlertDialog(
        title: Text('Venda a prazo — ${customer.name}'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: count, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Parcelas (1 a 12)')),
          TextField(controller: date, readOnly: true, decoration: const InputDecoration(labelText: 'Primeiro vencimento'), onTap: () async {
            final value = await showDatePicker(context: ctx, initialDate: DateTime.now(), firstDate: DateTime(2000), lastDate: DateTime(2101));
            if (value != null) date.text = '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';
          }),
        ]), actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancelar')),
          FilledButton(onPressed: () {
            final n = int.tryParse(count.text);
            if (n == null || n < 1 || n > 12 || date.text.isEmpty) return;
            Navigator.pop(ctx, {'installmentCount': n, 'firstDueDate': date.text, 'utcOffsetMinutes': DateTime.now().timeZoneOffset.inMinutes});
          }, child: const Text('Confirmar plano'))]));
      if (plan != null) await confirm('A prazo', customerId: customer.id, deferred: plan);
    } finally { count.dispose(); date.dispose(); }
  }
  Future<void> consult() async {
    if (busy || access == null) return;
    setState(() { busy = true; error = null; });
    try {
      final proof = await access!.consultOriginal();
      final saved = await access!.pending();
      if (mounted) setState(() { pending = saved; result = proof; });
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> evidence() async {
    if (busy || access == null) return;
    setState(() { busy = true; error = null; });
    try {
      final value = await access!.recoveryEvidence();
      if (!mounted) return;
      await showDialog<void>(context: context, builder: (context) => AlertDialog(
        title: const Text('Evidência privada de recuperação'),
        content: SizedBox(width: 600, child: SingleChildScrollView(child: Column(
          mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('Guarde no atendimento privado da loja. Esta cópia local não autoriza outra venda nem comprova ausência de venda no servidor.'),
            SelectableText(value, key: const ValueKey('variant-recovery-evidence')),
          ]))),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Fechar'))]));
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override void dispose() { if (access != null) unawaited(access!.close()); super.dispose(); }
  @override Widget build(BuildContext context) => SafeArea(child: SingleChildScrollView(child: Padding(
    padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('Venda com variantes', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
      const Text('Produtos simples e variantes são revalidados juntos. Uma intenção offline só vira venda após confirmação do servidor.'),
      if (busy) const LinearProgressIndicator(),
      if (error != null) Text(error!, key: const ValueKey('variant-sale-error')),
      if (result != null) Text('Resultado: ${result!['status']} · ${result!['reason'] ?? ''}\nVenda: ${result!['saleId']}\nCarrinho atual preservado.'),
      if (pending != null) ...[
        if (pending!['command']['origin'] == 'offline') const Text('Intenção offline preservada. Nenhuma confirmação de venda ou reserva global de estoque. Reconecte e sincronize a intenção original.'),
        Text('Venda original preservada: ${pending!['command']['saleId']} · ${pending!['status']}. Nenhuma troca de item no retry.'),
        FilledButton(key: const ValueKey('recover-variant-sale'), onPressed: busy ? null :
          pending!['status'] == 'identity-conflict' ? consult : () => confirm(''), child: const Text('Consultar / recuperar venda original')),
        TextButton(key: const ValueKey('consult-only-variant-sale'), onPressed: busy ? null : consult,
          child: const Text('Somente consultar, sem reenviar')),
        TextButton(key: const ValueKey('variant-sale-evidence'), onPressed: busy ? null : evidence,
          child: const Text('Exibir evidência de recuperação')),
        TextButton(onPressed: busy ? null : () async {
          setState(() { busy = true; error = null; });
          try {
            final proof = await access!.inspectAuthoritativeEvidence();
            final saved = await access!.pending();
            if (mounted) setState(() { pending = saved; result = saved?['result'] == null ? null : Map<String, dynamic>.from(saved!['result'] as Map);
              if (proof['status'] != 'conclusive') error = 'Evidências inconclusivas. Preserve a intenção e encaminhe a evidência privada ao suporte.'; });
          } catch (e) { if (mounted) setState(() => error = '$e'); }
          finally { if (mounted) setState(() => busy = false); }
        }, child: const Text('Revisar evidências do servidor — admin/gerente')),
        if (pending!['status'] == 'identity-conflict') const Text(
          'Conflito de identidade: mantenha a venda original e procure suporte. Não crie outra venda para substituir esta pendência.'),
        if (['confirmed', 'rejected'].contains(result?['status'])) TextButton(onPressed: busy ? null : () async {
          try { await access!.acknowledge(); if (context.mounted) Navigator.pop(context, false); }
          catch (e) { if (mounted) setState(() => error = '$e'); }
        }, child: const Text('Reconhecer resultado e revisar carrinho')),
      ] else if (!widget.recovery && access != null) ...[
        for (final payment in ['Dinheiro', 'PIX', 'Cartão de crédito', 'Cartão de débito'])
          ListTile(title: Text(payment), enabled: !busy, onTap: busy ? null : () => confirm(payment)),
        ListTile(title: const Text('Dividir pagamento'), subtitle: const Text('Combine dinheiro, PIX e cartões'),
          enabled: !busy, onTap: busy ? null : splitPayment),
        ListTile(title: const Text('Fiado / parcelamento'), enabled: !busy, onTap: busy ? null : deferredPayment),
        ListTile(title: const Text('Guardar intenção offline — dinheiro'), subtitle: const Text('Uma intenção pendente por loja. Sincronização explícita ao reconectar.'),
          enabled: !busy, onTap: busy ? null : () => confirm('Dinheiro', offline: true)),
      ] else if (!busy && error == null) const Text('Nenhuma venda de variantes pendente neste contexto.'),
      if (error != null) TextButton(onPressed: busy ? null : load, child: const Text('Tentar leitura novamente')),
      TextButton(onPressed: busy ? null : () => Navigator.pop(context, false), child: const Text('Fechar')),
    ]))));
}
