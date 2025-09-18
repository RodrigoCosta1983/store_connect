// lib/screens/cart/cart_screen.dart

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/widgets/payment_options_sheet.dart';
import '../../models/customer_model.dart'; // Importa o modelo
import '../../providers/cart_provider.dart';
import '../../widgets/cart_item_widget.dart';
import '../management/manage_customers_screen.dart'; // Importa a tela de clientes

class CartScreen extends StatefulWidget {
  static const routeName = '/cart';
  final String storeId;
  const CartScreen({super.key, required this.storeId});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final _notesController = TextEditingController();
  // NOVO: Variável para guardar o cliente selecionado
  Customer? _selectedCustomer;

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  // NOVO: Função para abrir a tela de seleção de cliente
  Future<void> _selectCustomer() async {
    final result = await Navigator.of(context).push<Customer>(
      MaterialPageRoute(
        // Chama a tela em modo de seleção
        builder: (ctx) => ManageCustomersScreen(isSelectionMode: true,
          storeId: widget.storeId,),
      ),
    );

    // Se um cliente foi retornado, atualiza o estado
    if (result != null) {
      setState(() {
        _selectedCustomer = result;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context);
    final cartItems = cart.items.values.toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Seu Carrinho'),
      ),
      body: Column(
        children: <Widget>[
          // ... (O Card do Total e Botão Finalizar Venda permanece quase igual) ...
          Card(
            margin: const EdgeInsets.all(15),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  const Text('Total', style: TextStyle(fontSize: 20)),
                  const Spacer(),
                  Chip(
                    label: Text(
                      'R\$${cart.totalAmount.toStringAsFixed(2)}',
                      style: TextStyle(
                        color: Theme.of(context).primaryTextTheme.titleLarge?.color,
                      ),
                    ),
                    backgroundColor: Theme.of(context).primaryColor,
                  ),
                  TextButton(
                    // Em cart_screen.dart
                    onPressed: () async { // Adicione o async
                      if (cart.itemCount == 0) return;

                      // Espera o resultado do painel de pagamento
                      final result = await showModalBottomSheet(
                        context: context,
                        // ... resto do seu código do showModalBottomSheet
                        builder: (ctx) {
                          return PaymentOptionsSheet(
                            storeId: widget.storeId,
                            notes: _notesController.text,
                          );
                        },
                      );

                      // Se o resultado for 'true' (venda concluída com sucesso), fecha a tela do carrinho
                      if (result == true && mounted) {
                        Navigator.of(context).pop();
                      }
                    },

                    child: const Text('FINALIZAR VENDA'),
                  )
                ],
              ),
            ),
          ),

          // NOVO: Card para exibir e selecionar o cliente
       /*   Card(
            margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
            child: ListTile(
              leading: Icon(Icons.person, color: Theme.of(context).primaryColor),
              title: Text(
                _selectedCustomer?.name ?? 'Selecione um cliente',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              subtitle: Text(_selectedCustomer?.phone ?? 'Nenhum cliente selecionado'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _selectCustomer,
            ),
          ),*/

          // ... (o resto da tela, com as observações e a lista, continua igual) ...
          const SizedBox(height: 10),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 15.0),
            child: TextField(
              controller: _notesController,
              decoration: InputDecoration(
                labelText: 'Adicionar observações (opcional)',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: ListView.builder(
              itemCount: cart.itemCount,
              itemBuilder: (ctx, i) {
                final cartItem = cart.items.values.toList()[i];
                final productId = cart.items.keys.toList()[i];

                // A lógica de buscar o produto foi movida para o widget de item.
                // Nós apenas passamos as informações necessárias para ele.
                return CartItemWidget(
                  productId: productId,
                  cartItem: cartItem,
                  storeId: widget.storeId, // Passa o ID da loja para o widget
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}