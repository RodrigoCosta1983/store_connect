import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';





class ConfirmFiadoDialog extends StatefulWidget {
  final String storeId;
  final Customer customer;
  final String notes;

  const ConfirmFiadoDialog({
    super.key,
    required this.storeId,
    required this.customer,
    required this.notes,
  });

  @override
  State<ConfirmFiadoDialog> createState() => _ConfirmFiadoDialogState();
}

class _ConfirmFiadoDialogState extends State<ConfirmFiadoDialog> {
  DateTime? _selectedDate;
  var _isLoading = false;

  void _presentDatePicker() {
    showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime(2101),
    ).then((pickedDate) {
      if (pickedDate == null) return;
      setState(() {
        _selectedDate = pickedDate;
      });
    });
  }

  // dentro da classe _ConfirmFiadoDialogState

  Future<void> _submitFiadoSale() async {
    if (_selectedDate == null) return;
    setState(() => _isLoading = true);

    final cart = Provider.of<CartProvider>(context, listen: false);
    final firestore = FirebaseFirestore.instance;

    try {
      // 1. Inicia um Batched Write
      final batch = firestore.batch();

      // 2. Prepara a criação do documento de venda
      final saleDocRef = firestore.collection('stores').doc(widget.storeId).collection('sales').doc();
      batch.set(saleDocRef, {
        'totalAmount': cart.totalAmount,
        'products': cart.items.values.map((item) => item.toMap()).toList(),
        'createdAt': Timestamp.now(),
        'storeId': widget.storeId,
        'notes': widget.notes,
        'paymentMethod': 'Fiado',
        'isPaid': false,
        'dueDate': Timestamp.fromDate(_selectedDate!),
        'customerId': widget.customer.id,
        'customerName': widget.customer.name,
      });

      // 3. Prepara a atualização do estoque para cada produto
      for (final cartItem in cart.items.values) {
        final productRef = firestore.collection('stores').doc(widget.storeId).collection('products').doc(cartItem.productId);
        batch.update(productRef, {'quantidade': FieldValue.increment(-cartItem.quantity)});
      }

      // 4. Executa todas as operações
      await batch.commit();

      cart.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Venda (Fiado) finalizada e estoque atualizado!'),
            backgroundColor: Colors.green,
          ),
        );
        // Fecha o diálogo de confirmação e retorna 'true' para indicar sucesso
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('ERRO: ${e.toString()}'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context, listen: false);

    return AlertDialog(
      title: const Text('Confirmar Venda Fiado'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Cliente: ${widget.customer.name}',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            'Valor Total: R\$ ${cart.totalAmount.toStringAsFixed(2)}',
            style: const TextStyle(fontSize: 16),
          ),
          const Divider(height: 24),
          const Text('Definir data de vencimento:'),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Text(
                _selectedDate == null
                    ? 'Nenhuma data'
                    : DateFormat('dd/MM/yyyy').format(_selectedDate!),
              ),
              TextButton(
                onPressed: _presentDatePicker,
                child: const Text('Escolher Data'),
              ),
            ],
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        ElevatedButton(
          onPressed: (_selectedDate == null || _isLoading) ? null : _submitFiadoSale,
          child: _isLoading
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Confirmar Venda'),
        ),
      ],
    );
  }
}