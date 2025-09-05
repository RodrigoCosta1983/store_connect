import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/cart_provider.dart';

class CartItemWidget extends StatelessWidget {
  final String productId;
  final String title;
  final int quantity;
  final double price;

  const CartItemWidget({
    super.key,
    required this.productId,
    required this.title,
    required this.quantity,
    required this.price,
  });

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context, listen: false);

    return Dismissible(
      key: ValueKey(productId),
      background: Container(
        color: Theme.of(context).colorScheme.error,
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
        child: const Icon(Icons.delete, color: Colors.white, size: 40),
      ),
      direction: DismissDirection.endToStart,
      confirmDismiss: (direction) {
        return showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Você tem certeza?'),
            content: const Text('Deseja remover o item do carrinho?'),
            actions: <Widget>[
              TextButton(
                child: const Text('Não'),
                onPressed: () => Navigator.of(ctx).pop(false),
              ),
              TextButton(
                child: const Text('Sim'),
                onPressed: () => Navigator.of(ctx).pop(true),
              ),
            ],
          ),
        );
      },
      onDismissed: (direction) {
        cart.removeItem(productId);
      },
      child: Card(
        margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
        child: ListTile(
          leading: CircleAvatar(
            backgroundColor: Theme.of(context).primaryColor,
            radius: 30,
            child: Padding(
              padding: const EdgeInsets.all(5),
              child: FittedBox(
                child: Text(
                  'R\$${price.toStringAsFixed(2)}',
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),
          title: Text(title),
          subtitle: Text('Total: R\$${(price * quantity).toStringAsFixed(2)}'),
          trailing: Text('x $quantity', style: const TextStyle(fontSize: 18)),
        ),
      ),
    );
  }
}