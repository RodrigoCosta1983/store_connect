// ============================================================================
// ARQUIVO: cart_screen.dart
// ============================================================================
//
// RESPONSABILIDADE DESTE ARQUIVO:
//
// Exibir e gerenciar o carrinho da venda.
//
// PRINCIPAIS RESPONSABILIDADES:
//
// • Exibir os produtos adicionados ao carrinho
// • Exibir o valor total da venda
// • Permitir adicionar observações
// • Abrir as opções de pagamento
// • Finalizar a venda
// • Permitir selecionar cliente quando necessário
// • Exibir avisos relacionados à assinatura / cobrança
//
// INTEGRAÇÕES:
//
// • CartProvider
// • PaymentOptionsSheet
// • CartItemWidget
// • WarningBanner
// • ManageCustomersScreen
//
// FLUXO:
//
// Produtos
//    ↓
// Carrinho
//    ↓
// Revisar itens
//    ↓
// Observações
//    ↓
// Finalizar venda
//    ↓
// PaymentOptionsSheet
//    ↓
// Venda concluída
//
// RESPONSIVIDADE:
//
// • Mobile:
//   utiliza normalmente a largura disponível.
//
// • Web / Desktop:
//   o conteúdo principal fica centralizado com largura máxima de 1100px.
//
// CUIDADOS EM FUTURAS ALTERAÇÕES:
//
// • Não alterar o fechamento do carrinho após venda concluída.
// • Não remover o CartProvider.
// • Manter PaymentOptionsSheet como responsável pela escolha do pagamento.
// • O cliente selecionado ainda não está sendo enviado ao pagamento neste
//   arquivo porque o card de seleção permanece desativado.
// • Se o vínculo de cliente voltar a ser ativado, revisar a integração com
//   PaymentOptionsSheet e SalesProvider.
// • Manter a lista de itens dentro de Expanded para evitar overflow.
//
// ============================================================================

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/widgets/payment_options_sheet.dart';

import '../../models/customer_model.dart';
import '../../providers/cart_provider.dart';
import '../../widgets/cart_item_widget.dart';
import '../../widgets/warning_banner.dart';

import '../management/manage_customers_screen.dart';

// ============================================================================
// TELA DO CARRINHO
// ============================================================================

class CartScreen extends StatefulWidget {
  static const routeName = '/cart';

  final String storeId;

  const CartScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<CartScreen> createState() =>
      _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  // ==========================================================================
  // OBSERVAÇÕES DA VENDA
  // ==========================================================================

  final _notesController =
  TextEditingController();

  // ==========================================================================
  // CLIENTE SELECIONADO
  //
  // Atualmente mantido preparado para uso futuro.
  // O card de seleção está comentado mais abaixo.
  // ==========================================================================

  Customer? _selectedCustomer;

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _notesController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // SELECIONAR CLIENTE
  // ==========================================================================

  Future<void> _selectCustomer() async {
    final result =
    await Navigator.of(context).push<Customer>(
      MaterialPageRoute(
        builder: (ctx) =>
            ManageCustomersScreen(
              isSelectionMode: true,
              storeId: widget.storeId,
            ),
      ),
    );

    if (result != null) {
      setState(() {
        _selectedCustomer = result;
      });
    }
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    final cart =
    Provider.of<CartProvider>(
      context,
    );

    return Scaffold(
      // ======================================================================
      // APP BAR
      // ======================================================================

      appBar: AppBar(
        title:
        const Text(
          'Seu Carrinho',
        ),
      ),

      // ======================================================================
      // CONTEÚDO CENTRALIZADO
      //
      // MOBILE:
      // utiliza toda a largura disponível.
      //
      // WEB / DESKTOP:
      // limita o conteúdo principal a 1100px.
      // ======================================================================

      body: Center(
        child: ConstrainedBox(
          constraints:
          const BoxConstraints(
            maxWidth: 1100,
          ),

          child: Column(
            children: <Widget>[
              // ==============================================================
              // AVISO DE ASSINATURA
              // ==============================================================

              WarningBanner(
                storeId:
                widget.storeId,
              ),

              // ==============================================================
              // TOTAL + FINALIZAR VENDA
              // ==============================================================

              Card(
                margin:
                const EdgeInsets.all(
                  15,
                ),

                child: Padding(
                  padding:
                  const EdgeInsets.all(
                    8,
                  ),

                  child: Row(
                    children: <Widget>[
                      const Text(
                        'Total',
                        style:
                        TextStyle(
                          fontSize: 20,
                        ),
                      ),

                      const Spacer(),

                      Chip(
                        label: Text(
                          'R\$${cart.totalAmount.toStringAsFixed(2)}',

                          style:
                          TextStyle(
                            color:
                            Theme.of(
                              context,
                            )
                                .primaryTextTheme
                                .titleLarge
                                ?.color,
                          ),
                        ),

                        backgroundColor:
                        Theme.of(
                          context,
                        ).primaryColor,
                      ),

                      const SizedBox(
                        width: 8,
                      ),

                      TextButton(
                        onPressed: () async {
                          if (cart.itemCount ==
                              0) {
                            return;
                          }

                          // ==================================================
                          // ABRE OPÇÕES DE PAGAMENTO
                          // ==================================================

                          final result =
                          await showModalBottomSheet(
                            context:
                            context,

                            builder: (ctx) {
                              return PaymentOptionsSheet(
                                storeId:
                                widget.storeId,

                                notes:
                                _notesController
                                    .text,
                              );
                            },
                          );

                          // ==================================================
                          // VENDA CONCLUÍDA
                          //
                          // Fecha a tela do carrinho somente quando o painel
                          // de pagamento retorna true.
                          // ==================================================

                          if (result ==
                              true &&
                              mounted) {
                            Navigator.of(
                              context,
                            ).pop();
                          }
                        },

                        child:
                        const Text(
                          'FINALIZAR VENDA',
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // ==============================================================
              // CLIENTE
              //
              // Mantido desativado por enquanto.
              //
              // Quando retomarmos esta funcionalidade, precisamos também
              // encaminhar o cliente selecionado para o fluxo de pagamento.
              // ==============================================================

              /*
              Card(
                margin: const EdgeInsets.symmetric(
                  horizontal: 15,
                  vertical: 4,
                ),
                child: ListTile(
                  leading: Icon(
                    Icons.person,
                    color: Theme.of(context).primaryColor,
                  ),
                  title: Text(
                    _selectedCustomer?.name ??
                        'Selecione um cliente',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  subtitle: Text(
                    _selectedCustomer?.phone ??
                        'Nenhum cliente selecionado',
                  ),
                  trailing: const Icon(
                    Icons.chevron_right,
                  ),
                  onTap: _selectCustomer,
                ),
              ),
              */

              const SizedBox(
                height: 10,
              ),

              // ==============================================================
              // OBSERVAÇÕES
              // ==============================================================

              Padding(
                padding:
                const EdgeInsets.symmetric(
                  horizontal: 15,
                ),

                child: TextField(
                  controller:
                  _notesController,

                  decoration:
                  InputDecoration(
                    labelText:
                    'Adicionar observações (opcional)',

                    border:
                    OutlineInputBorder(
                      borderRadius:
                      BorderRadius.circular(
                        12,
                      ),
                    ),
                  ),

                  textCapitalization:
                  TextCapitalization
                      .sentences,
                ),
              ),

              const SizedBox(
                height: 10,
              ),

              // ==============================================================
              // ITENS DO CARRINHO
              // ==============================================================

              Expanded(
                child:
                ListView.builder(
                  padding:
                  const EdgeInsets.fromLTRB(
                    8,
                    0,
                    8,
                    16,
                  ),

                  itemCount:
                  cart.itemCount,

                  itemBuilder: (
                      ctx,
                      i,
                      ) {
                    final cartItem =
                    cart.items
                        .values
                        .toList()[i];

                    final productId =
                    cart.items
                        .keys
                        .toList()[i];

                    return CartItemWidget(
                      productId:
                      productId,

                      cartItem:
                      cartItem,

                      storeId:
                      widget.storeId,
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}