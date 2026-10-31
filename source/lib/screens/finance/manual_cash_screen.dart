import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/cash_flow_provider.dart';

class ManualCashScreen extends StatefulWidget {
  final String storeId;
  const ManualCashScreen({super.key, required this.storeId});
  @override
  State<ManualCashScreen> createState() => _ManualCashScreenState();
}

class _ManualCashScreenState extends State<ManualCashScreen> {
  final _amount = TextEditingController(),
      _category = TextEditingController(text: 'Outros'),
      _reason = TextEditingController();
  String _type = 'Entrada';
  DateTime _date = DateTime.now();
  bool _busy = false, _completed = false;
  String _message = '';
  @override
  void dispose() {
    _amount.dispose();
    _category.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(CashFlowProvider) action) async {
    if (_busy) return;
    final provider = context.read<CashFlowProvider>();
    setState(() => _busy = true);
    try {
      await action(provider);
    } catch (e) {
      if (mounted) setState(() => _message = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() => _run((provider) async {
    final amount = double.tryParse(_amount.text.replaceAll(',', '.'));
    if (amount == null) throw ArgumentError('Informe o valor.');
    final storeId = widget.storeId;
    final result = await provider.addCashFlowEntry(
      description: _reason.text,
      amount: amount,
      type: _type,
      storeId: storeId,
      category: _category.text,
      occurredAt: _date,
    );
    if (mounted && widget.storeId == storeId) {
      setState(() {
        _completed = true;
        _message = 'Movimentação confirmada: ${result['cashFlowId']}';
      });
    }
  });
  Future<void> _recover() => _run((provider) async {
    final storeId = widget.storeId,
        result = await provider.recover(widget.storeId);
    if (mounted && widget.storeId == storeId) {
      setState(() {
        _completed = {'confirmed', 'rejected'}.contains(result['status']);
        _message =
            'Resultado original: ${result['status']} — ${result['requestId']}';
      });
    }
  });
  Future<void> _next() => _run((provider) async {
    await provider.beginNew(widget.storeId);
    if (mounted) {
      setState(() {
        _completed = false;
        _amount.clear();
        _reason.clear();
        _date = DateTime.now();
        _message = 'Nova movimentação';
      });
    }
  });
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Caixa — movimentações'),
      actions: [
        IconButton(
          tooltip: 'Consultar movimentação',
          onPressed: _busy ? null : _recover,
          icon: const Icon(Icons.history),
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'Lançamento manual',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
        ),
        const Text(
          'Recebimentos de fiado são registrados automaticamente pela conta do cliente.',
        ),
        DropdownButtonFormField<String>(
          value: _type,
          items: const [
            DropdownMenuItem(value: 'Entrada', child: Text('Entrada')),
            DropdownMenuItem(value: 'Saída', child: Text('Saída')),
          ],
          onChanged: _busy || _completed
              ? null
              : (v) => setState(() => _type = v!),
          decoration: const InputDecoration(labelText: 'Tipo'),
        ),
        TextField(
          key: const Key('cash-amount'),
          controller: _amount,
          enabled: !_busy && !_completed,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Valor (R\$)'),
        ),
        TextField(
          key: const Key('cash-category'),
          controller: _category,
          enabled: !_busy && !_completed,
          decoration: const InputDecoration(labelText: 'Categoria'),
        ),
        TextField(
          key: const Key('cash-reason'),
          controller: _reason,
          enabled: !_busy && !_completed,
          decoration: const InputDecoration(labelText: 'Motivo'),
        ),
        TextButton(
          onPressed: _busy || _completed
              ? null
              : () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _date,
                    firstDate: DateTime(2000),
                    lastDate: DateTime(2101),
                  );
                  if (picked != null && mounted) setState(() => _date = picked);
                },
          child: Text('Data: ${_date.day}/${_date.month}/${_date.year}'),
        ),
        if (_busy) const LinearProgressIndicator(),
        if (_message.isNotEmpty) Text(_message),
        if (!_completed)
          ElevatedButton(
            onPressed: _busy ? null : _submit,
            child: const Text('Registrar movimentação'),
          ),
        if (_completed)
          ElevatedButton(
            onPressed: _busy ? null : _next,
            child: const Text('Nova movimentação'),
          ),
        const Divider(),
        const Text('Últimos lançamentos — histórico preservado'),
        StreamBuilder<QuerySnapshot>(
          stream: FirebaseFirestore.instance
              .collection('stores')
              .doc(widget.storeId)
              .collection('cash_flow')
              .orderBy('createdAt', descending: true)
              .limit(100)
              .snapshots(),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Text('Não foi possível consultar o histórico.');
            }
            if (!snapshot.hasData) return const LinearProgressIndicator();
            return Column(
              children: snapshot.data!.docs.map((doc) {
                final data = doc.data() as Map<String, dynamic>;
                return ListTile(
                  title: Text('${data['type']} — R\$ ${data['amount']}'),
                  subtitle: Text(
                    '${data['description'] ?? ''}\n${data['category'] ?? 'Histórico'} — ${data['operatorUid'] ?? 'Operador não registrado no legado'}',
                  ),
                );
              }).toList(),
            );
          },
        ),
      ],
    ),
  );
}
