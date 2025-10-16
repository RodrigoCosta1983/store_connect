// lib/widgets/order_item_widget.dart

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/models/sale_order_model.dart';
import 'package:store_connect/providers/cash_flow_provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/services/pdf_receipt_service.dart';

class OrderItemWidget extends StatelessWidget {
  final SaleOrder order;
  final String storeId;

  const OrderItemWidget({super.key, required this.order, required this.storeId});

  // --- LÓGICA REESTRUTURADA ---

  // Função 1: Executa a ação do PDF (ver ou compartilhar) e gerencia o "carregando"
  // Ela usa o 'mainContext' que é o contexto principal da tela, que nunca "morre".
  Future<void> _runPdfAction(BuildContext mainContext, Future<void> Function() pdfAction) async {
    showDialog(
      context: mainContext,
      barrierDismissible: false,
      builder: (ctx) => const Center(child: CircularProgressIndicator()),
    );
    try {
      await pdfAction();
    } catch (e) {
      ScaffoldMessenger.of(mainContext).showSnackBar(
        SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red),
      );
    } finally {
      // Usamos o mainContext para fechar o "carregando". Como ele sempre existe,
      // o app não se perde mais.
      if (Navigator.of(mainContext).canPop()) {
        Navigator.of(mainContext).pop();
      }
    }
  }

  // Função 2: Mostra o menu de opções
  // Usa o 'mainContext' para se apresentar
  void _showReceiptOptions(BuildContext mainContext) {
    showDialog(
      context: mainContext,
      builder: (BuildContext dialogContext) { // 'dialogContext' só serve para fechar este menu
        return AlertDialog(
          title: const Text('Opções do Recibo'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              ListTile(
                leading: const Icon(Icons.picture_as_pdf_outlined),
                title: const Text('Ver e Salvar PDF'),
                onTap: () {
                  Navigator.of(dialogContext).pop(); // 1. Fecha o menu de opções
                  _runPdfAction(mainContext, () => PdfReceiptService().viewAndSavePdf(order)); // 2. Executa a ação
                },
              ),
              ListTile(
                leading: const Icon(Icons.share_outlined),
                title: const Text('Compartilhar'),
                onTap: () {
                  Navigator.of(dialogContext).pop(); // 1. Fecha o menu de opções
                  _runPdfAction(mainContext, () => PdfReceiptService().sharePdf(order, mainContext)); // 2. Executa a ação
                },
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(
              child: const Text('Cancelar'),
              onPressed: () {
                Navigator.of(dialogContext).pop();
              },
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;
    final salesProvider = Provider.of<SalesProvider>(context, listen: false);
    final cashFlowProvider = Provider.of<CashFlowProvider>(context, listen: false);

    bool isOverdue = !order.isPaid && order.dueDate != null && order.dueDate!.isBefore(DateTime.now());
    IconData statusIcon;
    Color statusColor;

    if (isOverdue) {
      statusIcon = Icons.warning_amber_rounded;
      statusColor = Colors.red.shade700;
    } else if (order.isPaid) {
      statusIcon = Icons.check_circle;
      statusColor = Colors.green.shade700;
    } else {
      statusIcon = Icons.receipt_long;
      statusColor = Colors.orange.shade800;
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 8),
      elevation: 3,
      shape: RoundedRectangleBorder(
          side: isOverdue ? BorderSide(color: statusColor, width: 1.5) : BorderSide.none,
          borderRadius: BorderRadius.circular(12)
      ),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        leading: CircleAvatar(
          backgroundColor: statusColor,
          child: Icon(statusIcon, color: Colors.white, size: 20),
        ),
        title: Text(order.customerName ?? 'Venda Rápida', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('ID: ${order.id.substring(0, 6)}...'),
        trailing: Text('R\$ ${order.totalAmount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Divider(),
                _buildDetailRow(Icons.calendar_today, 'Data:', DateFormat('dd/MM/yyyy \'às\' HH:mm').format(order.createdAt)),
                _buildDetailRow(Icons.payment, 'Pagamento:', '${order.paymentMethod} (${order.isPaid ? "Pago" : "Pendente"})'),
                if (order.dueDate != null)
                  _buildDetailRow(Icons.event_busy, 'Vencimento:', DateFormat('dd/MM/yyyy').format(order.dueDate!)),
                const SizedBox(height: 10),
                Text(
                  'Itens do Pedido:',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: isDarkMode ? Colors.white70 : Colors.black54,
                  ),
                ),
                const SizedBox(height: 4),
                ...order.products.map(
                      (prod) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.inventory_2_outlined, size: 18),
                    title: Text('${prod.quantity}x ${prod.name}'),
                    trailing: Text('R\$ ${(prod.price * prod.quantity).toStringAsFixed(2)}'),
                  ),
                ),
                const Divider(),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    if (!order.isPaid && order.paymentMethod == 'Fiado')
                      ElevatedButton.icon(
                        icon: const Icon(Icons.check, size: 18),
                        label: const Text('Marcar Pago'),
                        style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
                        onPressed: () {
                          salesProvider.markOrderAsPaid(order.id, order.totalAmount, cashFlowProvider);
                        },
                      ),

                    if (order.isPaid || order.paymentMethod != 'Fiado') const Spacer(),

                    OutlinedButton.icon(
                      icon: const Icon(Icons.receipt_long_outlined, size: 18),
                      label: const Text('Recibo'),
                      onPressed: () => _showReceiptOptions(context), // O botão chama a função do menu
                    ),
                  ],
                ),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildDetailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        children: [
          Icon(icon, size: 16, color: Colors.grey.shade600),
          const SizedBox(width: 8),
          Text('$label ', style: const TextStyle(fontWeight: FontWeight.bold)),
          Expanded(child: Text(value, textAlign: TextAlign.end, style: const TextStyle(color: Colors.grey))),
        ],
      ),
    );
  }
}