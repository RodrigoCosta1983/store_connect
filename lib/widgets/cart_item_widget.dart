// ============================================================================
// ARQUIVO: cart_item_widget.dart
// ============================================================================
//
// RESPONSABILIDADE DESTE ARQUIVO:
//
// Exibir um item do carrinho e permitir alterar sua quantidade sem ultrapassar
// o estoque efetivamente disponível no aparelho.
//
// FLUXO DE ESTOQUE:
//
// 1. O Firestore fornece o último estoque conhecido do produto.
// 2. OfflineSalesRepository informa quanto desse produto já está reservado em
//    vendas locais ainda não sincronizadas (pending/syncing/failed).
// 3. O widget calcula:
//
//      estoque efetivo = estoque Firestore - reservas offline
//
// 4. O botão "+" somente incrementa quando a quantidade atual do carrinho é
//    menor que esse estoque efetivo.
// 5. Ao atingir o limite, o clique é bloqueado imediatamente e o usuário recebe
//    um aviso visível na própria tela do carrinho.
//
// CAMADAS DE SEGURANÇA:
//
// • Este widget é a camada de UX: evita que o usuário monte um carrinho inválido.
// • validateStockAndSaveSale() continua sendo a camada de integridade local no
//   fechamento da venda.
// • O backend continua sendo a autoridade definitiva para conflitos entre
//   dispositivos diferentes.
//
// IMPORTANTE:
//
// • Não remover a validação do fechamento offline só porque este widget bloqueia
//   o botão "+". As duas proteções têm finalidades diferentes.
// • Quantidades continuam sendo inteiras.
// • As reservas locais incluem pending, syncing e failed.
// • Este widget usa AppDatabase.instance indiretamente através do repository;
//   não criar uma segunda instância do banco Drift.
// • O Firestore é lido normalmente. Quando offline, o SDK pode fornecer o último
//   documento disponível no cache local.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/data/local/offline_sales_repository.dart';
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

    final offlineSalesRepository = OfflineSalesRepository();

    final totalItem = cartItem.price * cartItem.quantity;

    return FutureBuilder<DocumentSnapshot>(
      future: FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .collection('products')
          .doc(productId)
          .get(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 4),
            child: ListTile(
              title: Text(cartItem.name),
              trailing: const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }

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

        final firestoreProduct = Product.fromFirestore(snapshot.data!);

        return StreamBuilder<Map<String, int>>(
          stream: offlineSalesRepository.watchReservedQuantitiesByProduct(),
          initialData: const <String, int>{},
          builder: (context, reservationSnapshot) {
            final reservedQuantity = reservationSnapshot.data?[productId] ?? 0;

            final effectiveStock =
                firestoreProduct.quantidade - reservedQuantity;

            final safeEffectiveStock = effectiveStock < 0 ? 0 : effectiveStock;

            final effectiveProduct = Product.fromMap(firestoreProduct.id, {
              ...snapshot.data!.data() as Map<String, dynamic>,
              'quantidade': safeEffectiveStock,
            });

            final hasReachedStockLimit =
                cartItem.quantity >= safeEffectiveStock;

            final stockLabel = safeEffectiveStock == 1
                ? '1 unidade'
                : '$safeEffectiveStock unidades';

            void showStockLimitMessage() {
              final messenger = ScaffoldMessenger.of(context);

              messenger
                ..hideCurrentSnackBar()
                ..showSnackBar(
                  SnackBar(
                    content: Text(
                      'Estoque máximo disponível para '
                      '${cartItem.name}: $stockLabel.',
                    ),
                    backgroundColor: Colors.orange.shade800,
                    duration: const Duration(seconds: 3),
                  ),
                );
            }

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
                      backgroundColor: Theme.of(
                        context,
                      ).primaryColor.withValues(alpha: 0.5),
                      child: Padding(
                        padding: const EdgeInsets.all(5),
                        child: FittedBox(
                          child: Text(
                            'R\$${cartItem.price.toStringAsFixed(2)}',
                          ),
                        ),
                      ),
                    ),
                    title: Text(cartItem.name),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Total: R\$${totalItem.toStringAsFixed(2)}'),
                        Text(
                          'Disponível: $stockLabel',
                          style: TextStyle(
                            fontSize: 12,
                            color: hasReachedStockLimit
                                ? Colors.orange.shade800
                                : Theme.of(context).textTheme.bodySmall?.color,
                          ),
                        ),
                      ],
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.remove_circle_outline),
                          onPressed: () {
                            cart.removeSingleItem(productId);
                          },
                        ),
                        Text(
                          '${cartItem.quantity}',
                          style: const TextStyle(fontSize: 16),
                        ),
                        IconButton(
                          icon: Icon(
                            Icons.add_circle_outline,
                            color: hasReachedStockLimit ? Colors.grey : null,
                          ),
                          onPressed: () {
                            if (hasReachedStockLimit) {
                              showStockLimitMessage();
                              return;
                            }

                            cart.addItem(effectiveProduct);
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
      },
    );
  }
}
