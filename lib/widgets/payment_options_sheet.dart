import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/widgets/confirm_fiado_dialog.dart';

class PaymentOptionsSheet extends StatefulWidget {
  final String storeId;
  final String notes;

  const PaymentOptionsSheet({super.key, required this.storeId, required this.notes});

  @override
  State<PaymentOptionsSheet> createState() => _PaymentOptionsSheetState();
}

class _PaymentOptionsSheetState extends State<PaymentOptionsSheet> {
  var _isLoading = false;
  bool _fiadoIsEnabled = false;

  @override
  void initState() {
    super.initState();
    _loadFiadoPreference();
  }

  Future<void> _loadFiadoPreference() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() {
        _fiadoIsEnabled = prefs.getBool('fiado_enabled') ?? false;
      });
    }
  }

  Future<void> _handleInstantSale(String paymentMethod) async {
    if (_isLoading) return;
    setState(() => _isLoading = true);

    final cart = Provider.of<CartProvider>(context, listen: false);
    final firestore = FirebaseFirestore.instance;

    try {
      final batch = firestore.batch();
      final saleDocRef = firestore.collection('stores').doc(widget.storeId).collection('sales').doc();
      final customer = cart.selectedCustomer;

      batch.set(saleDocRef, {
        'totalAmount': cart.totalAmount,
        'products': cart.items.values.map((item) => item.toMap()).toList(),
        'createdAt': Timestamp.now(),
        'storeId': widget.storeId,
        'notes': widget.notes,
        'paymentMethod': paymentMethod,
        'isPaid': true,
        'customerId': customer?.id,
        'customerName': customer?.name,
      });

      for (final cartItem in cart.items.values) {
        final productRef = firestore.collection('stores').doc(widget.storeId).collection('products').doc(cartItem.productId);
        batch.update(productRef, {'quantidade': FieldValue.increment(-cartItem.quantity)});
      }

      await batch.commit();

      cart.clear();
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Venda finalizada e estoque atualizado!'), backgroundColor: Colors.green),
        );
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

  void _showPixDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Pagar com PIX'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Aponte a câmera para o QR Code para pagar.'),
            const SizedBox(height: 20),
            Image.asset('assets/images/pix_qrcode.png', height: 150, width: 150),
          ],
        ),
        actions: [
          TextButton(
            child: const Text("Cancelar"),
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
          ElevatedButton(
            child: const Text("Pagamento Concluído"),
            onPressed: () {
              Navigator.of(dialogContext).pop();
              _handleInstantSale('PIX');
            },
          ),
        ],
      ),
    );
  }

  // --- FUNÇÃO CENTRAL PARA O PROCESSO FIADO ---
  Future<void> _startFiadoProcess(Customer customer) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => ConfirmFiadoDialog(
        storeId: widget.storeId,
        customer: customer,
        notes: widget.notes,
      ),
    );

    if (result == true && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  // --- FUNÇÃO PARA SELECIONAR CLIENTE ---
  void _selectCustomerForFiado() {
    showDialog(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Selecionar Cliente para Fiado'),
          content: SizedBox(
            width: double.maxFinite,
            child: StreamBuilder<QuerySnapshot>(
              stream: FirebaseFirestore.instance.collection('stores').doc(widget.storeId).collection('customers').orderBy('name').snapshots(),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
                  return const Center(child: Text('Nenhum cliente cadastrado.'));
                }
                final customersDocs = snapshot.data!.docs;
                return ListView.builder(
                  shrinkWrap: true,
                  itemCount: customersDocs.length,
                  itemBuilder: (context, index) {
                    final customer = Customer.fromFirestore(customersDocs[index]);
                    return ListTile(
                      title: Text(customer.name),
                      onTap: () {
                        Navigator.of(ctx).pop(); // Fecha o diálogo de seleção
                        _startFiadoProcess(customer); // Chama a função central
                      },
                    );
                  },
                );
              },
            ),
          ),
          actions: [
            TextButton(
              child: const Text('Cancelar'),
              onPressed: () => Navigator.of(ctx).pop(),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const SizedBox(
        height: 300,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final cart = Provider.of<CartProvider>(context, listen: false);

    return Container(
      padding: const EdgeInsets.all(20),
      child: Wrap(
        runSpacing: 10,
        children: <Widget>[
          const Text('Escolha a forma de pagamento', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10, width: double.infinity),
          ListTile(
            leading: const Icon(Icons.money, size: 30, color: Colors.green),
            title: const Text('Dinheiro', style: TextStyle(fontSize: 18)),
            onTap: () => _handleInstantSale('Dinheiro'),
          ),
          ListTile(
            leading: const Icon(Icons.credit_card, size: 30, color: Colors.blueAccent),
            title: const Text('Cartão', style: TextStyle(fontSize: 18)),
            onTap: () => _handleInstantSale('Cartão'),
          ),
          ListTile(
            leading: const Icon(Icons.pix, size: 30, color: Colors.cyan),
            title: const Text('PIX', style: TextStyle(fontSize: 18)),
            onTap: _showPixDialog,
          ),
          if (_fiadoIsEnabled) ...[
            const Divider(),
            ListTile(
              leading: const Icon(Icons.person_add_alt_1, size: 30, color: Colors.orange),
              title: const Text('Fiado / A Prazo', style: TextStyle(fontSize: 18)),
              // --- LÓGICA CORRIGIDA E SIMPLIFICADA ---
              onTap: () {
                final selectedCustomer = cart.selectedCustomer;

                if (selectedCustomer != null) {
                  _startFiadoProcess(selectedCustomer);
                } else {
                  _selectCustomerForFiado();
                }
              },
            ),
          ],
        ],
      ),
    );
  }
}