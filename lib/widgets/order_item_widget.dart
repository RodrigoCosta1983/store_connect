// lib/widgets/order_item_widget.dart

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/models/sale_order_model.dart';

class OrderItemWidget extends StatelessWidget {
  final SaleOrder order;
  final String storeId;

  const OrderItemWidget({super.key, required this.order, required this.storeId});

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;
    final statusColor = order.isPaid ? Colors.green.shade700 : Colors.orange.shade800;
    final statusIcon = order.isPaid ? Icons.check_circle : Icons.hourglass_top;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 15, vertical: 8),
      elevation: 3,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        // CABEÇALHO DO CARD (VISÍVEL QUANDO FECHADO)
        leading: CircleAvatar(
          backgroundColor: statusColor,
          child: Icon(statusIcon, color: Colors.white, size: 20),
        ),
        title: Text(
          order.customerName ?? 'Cliente não informado',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text('ID da Venda: ${order.id.substring(0, 6)}...'),
        trailing: Text(
          'R\$ ${order.totalAmount.toStringAsFixed(2)}',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
        ),
        // CONTEÚDO DO CARD (VISÍVEL QUANDO EXPANDIDO)
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Divider(),
                // Detalhes da venda
                _buildDetailRow(
                  Icons.calendar_today,
                  'Data:',
                  DateFormat('dd/MM/yyyy \'às\' HH:mm').format(order.createdAt),
                ),
                _buildDetailRow(
                  Icons.payment,
                  'Pagamento:',
                  '${order.paymentMethod} (${order.isPaid ? "Pago" : "Pendente"})',
                ),
                if (order.dueDate != null)
                  _buildDetailRow(
                    Icons.event_busy,
                    'Vencimento:',
                    DateFormat('dd/MM/yyyy').format(order.dueDate!),
                  ),

                const SizedBox(height: 10),
                Text(
                  'Itens do Pedido:',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: isDarkMode ? Colors.white70 : Colors.black54,
                  ),
                ),
                const SizedBox(height: 4),
                // Lista de produtos
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
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () {
                      // TODO: Adicionar lógica para ver detalhes ou reimprimir
                    },
                    child: const Text('MAIS DETALHES'),
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  // Widget auxiliar para criar linhas de detalhe
  Widget _buildDetailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        children: [
          Icon(icon, size: 16, color: Colors.grey.shade600),
          const SizedBox(width: 8),
          Text('$label ', style: const TextStyle(fontWeight: FontWeight.bold)),
          Expanded(child: Text(value, textAlign: TextAlign.end)),
        ],
      ),
    );
  }
}