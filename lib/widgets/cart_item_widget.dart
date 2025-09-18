// lib/widgets/cart_item_widget.dart

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/providers/cart_provider.dart';

class CartItemWidget extends StatelessWidget {
  final String productId;
  final CartItem cartItem;
  final String storeId;

  const CartItemWidget({
    super.key,
    required this.productId,
    required this.cartItem,
    required this.storeId,
  });

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context, listen: false);
    final totalItem = cartItem.price * cartItem.quantity;

    // Usamos um FutureBuilder para buscar os dados do produto no Firestore
    return FutureBuilder<DocumentSnapshot>(
      future: FirebaseFirestore.instance.collection('stores').doc(storeId).collection('products').doc(productId).get(),
      builder: (context, snapshot) {

        // Enquanto busca, mostramos uma versão simplificada
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
            child: ListTile(
              title: Text(cartItem.name),
              trailing: const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)),
            ),
          );
        }

        // Se der erro ou não encontrar o produto, mostra um aviso
        if (snapshot.hasError || !snapshot.hasData || !snapshot.data!.exists) {
          return Card(
            color: Colors.red.shade100,
            margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
            child: ListTile(
              title: Text(cartItem.name),
              subtitle: const Text('Produto indisponível ou com erro'),
            ),
          );
        }

        // Se encontrou o produto, constrói o widget completo com os botões
        final product = Product.fromFirestore(snapshot.data!);

        return Dismissible(
          key: ValueKey(cartItem.productId),
          direction: DismissDirection.endToStart,
          background: Container(
            color: Theme.of(context).colorScheme.error,
            alignment: Alignment.centerRight,
            padding: const EdgeInsets.only(right: 20),
            margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
            child: const Icon(Icons.delete, color: Colors.white, size: 30),
          ),
          onDismissed: (direction) {
            cart.removeItem(cartItem.productId);
          },
          child: Card(
            margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: ListTile(
                leading: CircleAvatar(
                  backgroundColor: Theme.of(context).primaryColor.withOpacity(0.5),
                  child: Padding(
                    padding: const EdgeInsets.all(5),
                    child: FittedBox(child: Text('R\$${cartItem.price.toStringAsFixed(2)}')),
                  ),
                ),
                title: Text(cartItem.name),
                subtitle: Text('Total: R\$${totalItem.toStringAsFixed(2)}'),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.remove_circle_outline),
                      onPressed: () {
                        cart.removeSingleItem(productId);
                      },
                    ),
                    Text('${cartItem.quantity}', style: const TextStyle(fontSize: 16)),
                    IconButton(
                      icon: const Icon(Icons.add_circle_outline),
                      onPressed: () {
                        // Passa o objeto 'product' completo que acabamos de buscar
                        cart.addItem(product);
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}