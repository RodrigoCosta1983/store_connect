import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';

import '../screens/auth/auth_gate.dart';

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
  bool _isLoading = false;

  // Quantidade de parcelas escolhida
  int _numberOfInstallments = 1;

  // Lista usada somente para a prévia visual nesta etapa
  List<Map<String, dynamic>> _previewInstallments = [];

  // --------------------------------------------------------------------------
  // ESCOLHA DA DATA DA PRIMEIRA PARCELA
  // --------------------------------------------------------------------------

  void _presentDatePicker() {
    showDatePicker(
      context: context,
      initialDate: _selectedDate ?? DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime(2101),
    ).then((pickedDate) {
      if (pickedDate == null) return;

      setState(() {
        _selectedDate = pickedDate;
      });

      final cart = Provider.of<CartProvider>(context, listen: false);

      _generateInstallments(cart.totalAmount);
    });
  }

  // --------------------------------------------------------------------------
  // ADICIONA MESES CORRETAMENTE
  //
  // Exemplo:
  // 10/09 -> 10/10 -> 10/11
  //
  // Também trata meses que não possuem determinado dia.
  // Exemplo:
  // 31/01 -> 28/02 -> 31/03
  // --------------------------------------------------------------------------

  DateTime _addMonths(DateTime date, int monthsToAdd) {
    final targetMonth = date.month + monthsToAdd;

    final firstDayOfTargetMonth = DateTime(
      date.year,
      targetMonth,
      1,
    );

    final lastDayOfTargetMonth = DateTime(
      firstDayOfTargetMonth.year,
      firstDayOfTargetMonth.month + 1,
      0,
    );

    final day = date.day > lastDayOfTargetMonth.day
        ? lastDayOfTargetMonth.day
        : date.day;

    return DateTime(
      firstDayOfTargetMonth.year,
      firstDayOfTargetMonth.month,
      day,
    );
  }

  // --------------------------------------------------------------------------
  // GERA A PRÉVIA DAS PARCELAS
  // --------------------------------------------------------------------------

  void _generateInstallments(double totalAmount) {
    if (_selectedDate == null) {
      setState(() {
        _previewInstallments = [];
      });
      return;
    }

    // Valor base da parcela.
    //
    // Exemplo:
    // R$ 100 / 3 = 33,333...
    //
    // Arredondamos para 2 casas e depois colocamos eventual diferença
    // na última parcela.
    final baseAmount =
    double.parse((totalAmount / _numberOfInstallments).toStringAsFixed(2));

    final installments = <Map<String, dynamic>>[];

    double accumulatedAmount = 0;

    for (int i = 0; i < _numberOfInstallments; i++) {
      double amount;

      if (i == _numberOfInstallments - 1) {
        // A última parcela recebe a diferença dos centavos.
        amount = double.parse(
          (totalAmount - accumulatedAmount).toStringAsFixed(2),
        );
      } else {
        amount = baseAmount;
      }

      final dueDate = _addMonths(_selectedDate!, i);

      installments.add({
        'number': i + 1,
        'amount': amount,
        'dueDate': dueDate,
      });

      accumulatedAmount += amount;
    }

    setState(() {
      _previewInstallments = installments;
    });
  }

  // --------------------------------------------------------------------------
  // ENVIA A VENDA
  //
  // IMPORTANTE:
  // Nesta ETAPA 3A ainda NÃO estamos gravando as parcelas no Firestore.
  // A venda continua sendo salva exatamente como era antes.
  // --------------------------------------------------------------------------

  Future<void> _submitFiadoSale() async {
    if (_selectedDate == null) return;

    setState(() => _isLoading = true);

    try {
      // ----------------------------------------------------------------------
      // TRAVA DE SEGURANÇA DA ASSINATURA
      // ----------------------------------------------------------------------

      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get(const GetOptions(source: Source.server));

      if (!storeDoc.exists) {
        throw Exception("Loja não encontrada.");
      }

      final storeData = storeDoc.data() as Map<String, dynamic>;
      final status = storeData['subscriptionStatus'];

      if (status != 'active' &&
          status != 'trial' &&
          status != 'overdue') {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                "Venda bloqueada! Sua assinatura está inativa ou expirada.",
              ),
              backgroundColor: Colors.red,
              duration: Duration(seconds: 8),
            ),
          );

          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(
              builder: (ctx) => const AuthGate(),
            ),
                (route) => false,
          );
        }

        return;
      }

      // ----------------------------------------------------------------------
      // SALVAMENTO DA VENDA
      //
      // ATENÇÃO:
      // Ainda usamos a estrutura antiga.
      // A estrutura com "installments" será feita na próxima etapa.
      // ----------------------------------------------------------------------

      final cart = Provider.of<CartProvider>(
        context,
        listen: false,
      );

      final firestore = FirebaseFirestore.instance;

      final batch = firestore.batch();

      final saleDocRef = firestore
          .collection('stores')
          .doc(widget.storeId)
          .collection('sales')
          .doc();

      batch.set(saleDocRef, {
        'totalAmount': cart.totalAmount,
        'products': cart.items.values
            .map((item) => item.toMap())
            .toList(),
        'createdAt': Timestamp.now(),
        'storeId': widget.storeId,
        'notes': widget.notes,
        'paymentMethod': 'A prazo',
        'isPaid': false,

        // Mantemos o campo antigo por compatibilidade
        'dueDate': Timestamp.fromDate(_selectedDate!),

        // ------------------------------------------------------------
        // NOVA ESTRUTURA DE PARCELAMENTO - ETAPA 3B
        // ------------------------------------------------------------
        'installmentCount': _numberOfInstallments,

        'installments': _previewInstallments.map((installment) {
          return {
            'number': installment['number'],
            'amount': installment['amount'],
            'paidAmount': 0.0,
            'isPaid': false,
            'dueDate': Timestamp.fromDate(
              installment['dueDate'] as DateTime,
            ),
            'paidAt': null,
          };
        }).toList(),

        'customerId': widget.customer.id,
        'customerName': widget.customer.name,
      });

      // ----------------------------------------------------------------------
      // ATUALIZA ESTOQUE
      // ----------------------------------------------------------------------

      for (final cartItem in cart.items.values) {
        final productRef = firestore
            .collection('stores')
            .doc(widget.storeId)
            .collection('products')
            .doc(cartItem.productId);

        batch.update(
          productRef,
          {
            'quantidade': FieldValue.increment(-cartItem.quantity),
          },
        );
      }

      // ----------------------------------------------------------------------
      // EXECUTA TUDO
      // ----------------------------------------------------------------------

      await batch.commit();

      cart.clear();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Venda a prazo concluída! Estoque atualizado.',
            ),
            backgroundColor: Colors.green,
          ),
        );

        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('ERRO: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  // --------------------------------------------------------------------------
  // INTERFACE
  // --------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(
      context,
      listen: false,
    );

    return AlertDialog(
      title: const Text('Confirmar Venda a Prazo'),

      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            // ----------------------------------------------------------------
            // CLIENTE
            // ----------------------------------------------------------------

            Text(
              'Cliente: ${widget.customer.name}',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),

            const SizedBox(height: 8),

            // ----------------------------------------------------------------
            // VALOR TOTAL
            // ----------------------------------------------------------------

            Text(
              'Valor Total: R\$ ${cart.totalAmount.toStringAsFixed(2)}',
              style: const TextStyle(
                fontSize: 16,
              ),
            ),

            const Divider(height: 24),

            // ----------------------------------------------------------------
            // QUANTIDADE DE PARCELAS
            // ----------------------------------------------------------------

            const Text(
              'Quantidade de parcelas:',
              style: TextStyle(
                fontWeight: FontWeight.bold,
              ),
            ),

            const SizedBox(height: 8),

            DropdownButtonFormField<int>(
              value: _numberOfInstallments,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.format_list_numbered),
              ),
              items: List.generate(
                12,
                    (index) {
                  final number = index + 1;

                  return DropdownMenuItem<int>(
                    value: number,
                    child: Text(
                      '$number ${number == 1 ? 'parcela' : 'parcelas'}',
                    ),
                  );
                },
              ),
              onChanged: _isLoading
                  ? null
                  : (value) {
                if (value == null) return;

                setState(() {
                  _numberOfInstallments = value;
                });

                _generateInstallments(
                  cart.totalAmount,
                );
              },
            ),

            const SizedBox(height: 18),

            // ----------------------------------------------------------------
            // DATA DA PRIMEIRA PARCELA
            // ----------------------------------------------------------------

            const Text(
              'Primeiro vencimento:',
              style: TextStyle(
                fontWeight: FontWeight.bold,
              ),
            ),

            const SizedBox(height: 6),

            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Expanded(
                  child: Text(
                    _selectedDate == null
                        ? 'Nenhuma data selecionada'
                        : DateFormat(
                      'dd/MM/yyyy',
                    ).format(_selectedDate!),
                  ),
                ),

                TextButton.icon(
                  onPressed: _isLoading
                      ? null
                      : _presentDatePicker,
                  icon: const Icon(Icons.calendar_month),
                  label: const Text('Escolher'),
                ),
              ],
            ),

            // ----------------------------------------------------------------
            // PRÉVIA DAS PARCELAS
            // ----------------------------------------------------------------

            if (_previewInstallments.isNotEmpty) ...[
              const Divider(height: 24),

              const Text(
                'Resumo das parcelas:',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                ),
              ),

              const SizedBox(height: 8),

              Container(
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Colors.grey.shade300,
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: _previewInstallments.map(
                        (installment) {
                      final number =
                      installment['number'] as int;

                      final amount =
                      installment['amount'] as double;

                      final dueDate =
                      installment['dueDate'] as DateTime;

                      return ListTile(
                        dense: true,
                        leading: CircleAvatar(
                          radius: 15,
                          child: Text(
                            '$number',
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        title: Text(
                          '$number/${_numberOfInstallments}ª parcela',
                        ),
                        subtitle: Text(
                          DateFormat(
                            'dd/MM/yyyy',
                          ).format(dueDate),
                        ),
                        trailing: Text(
                          'R\$ ${amount.toStringAsFixed(2)}',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      );
                    },
                  ).toList(),
                ),
              ),

              const SizedBox(height: 8),

              // ----------------------------------------------------------------
              // TOTAL DA PRÉVIA
              // ----------------------------------------------------------------

              Row(
                mainAxisAlignment:
                MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Total:',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    'R\$ ${_previewInstallments.fold<double>(
                      0,
                          (sum, item) =>
                      sum + (item['amount'] as double),
                    ).toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),

      // ----------------------------------------------------------------------
      // BOTÕES
      // ----------------------------------------------------------------------

      actions: <Widget>[
        TextButton(
          onPressed: _isLoading
              ? null
              : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),

        ElevatedButton(
          onPressed:
          (_selectedDate == null || _isLoading)
              ? null
              : _submitFiadoSale,
          child: _isLoading
              ? const SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
            ),
          )
              : const Text('Confirmar Venda'),
        ),
      ],
    );
  }
}