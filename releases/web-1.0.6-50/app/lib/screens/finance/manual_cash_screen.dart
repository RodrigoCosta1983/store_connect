import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/cash_flow_provider.dart';

/// Web compatibility: the existing append-only cash_flow contract has four
/// fields. Do not show F9-only category/date/receipt controls as if persisted.
class ManualCashScreen extends StatefulWidget {
  final String storeId;
  const ManualCashScreen({super.key, required this.storeId});
  @override
  State<ManualCashScreen> createState() => _ManualCashScreenState();
}

class _ManualCashScreenState extends State<ManualCashScreen> {
  final _amount = TextEditingController(), _reason = TextEditingController();
  String _type = 'Entrada', _message = '';
  bool _busy = false, _uncertain = false;
  @override
  void dispose() { _amount.dispose(); _reason.dispose(); super.dispose(); }

  Future<void> _submit() async {
    if (_busy || _uncertain) return;
    final amount = double.tryParse(_amount.text.replaceAll(',', '.'));
    if (amount == null || !amount.isFinite || amount <= 0 ||
        (amount * 100 - (amount * 100).round()).abs() > .00001 || _reason.text.trim().isEmpty) {
      setState(() => _message = 'Informe um valor positivo com até dois decimais e o motivo.');
      return;
    }
    setState(() { _busy = true; _message = ''; });
    try {
      await context.read<CashFlowProvider>().addCashFlowEntry(description: _reason.text.trim(),
          amount: amount, type: _type, storeId: widget.storeId);
      if (!mounted) return;
      _amount.clear(); _reason.clear();
      setState(() => _message = 'Movimentação registrada!');
    } catch (_) {
      if (mounted) setState(() {
        _uncertain = true;
        _message = 'Resultado não confirmado. Confira o histórico antes de registrar novamente.';
      });
    } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Caixa — movimentações')),
    body: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('Lançamento manual', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
      const Text('Recebimentos de fiado são registrados automaticamente pela conta do cliente.'),
      DropdownButtonFormField<String>(value: _type, decoration: const InputDecoration(labelText: 'Tipo'),
        items: const [DropdownMenuItem(value: 'Entrada', child: Text('Entrada')),
          DropdownMenuItem(value: 'Saída', child: Text('Saída'))],
        onChanged: _busy || _uncertain ? null : (v) => setState(() => _type = v!)),
      TextField(key: const Key('cash-amount'), controller: _amount, enabled: !_busy && !_uncertain,
        keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Valor (R\$)')),
      TextField(key: const Key('cash-reason'), controller: _reason, enabled: !_busy && !_uncertain,
        decoration: const InputDecoration(labelText: 'Motivo')),
      if (_busy) const LinearProgressIndicator(),
      if (_message.isNotEmpty) Text(_message),
      ElevatedButton(onPressed: _busy || _uncertain ? null : _submit, child: const Text('Registrar movimentação')),
      const Divider(), const Text('Últimos lançamentos'),
      StreamBuilder<QuerySnapshot>(stream: FirebaseFirestore.instance.collection('stores').doc(widget.storeId)
          .collection('cash_flow').orderBy('createdAt', descending: true).limit(100).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) return const Text('Não foi possível consultar o histórico.');
          if (!snapshot.hasData) return const LinearProgressIndicator();
          return Column(children: snapshot.data!.docs.map((doc) {
            final data = doc.data() as Map<String, dynamic>;
            final amount = (data['amount'] as num?)?.toDouble() ?? 0;
            return ListTile(title: Text('${data['type']} — R\$ ${amount.toStringAsFixed(2)}'),
              subtitle: Text('${data['description'] ?? ''}'));
          }).toList());
        }),
    ]),
  );
}
