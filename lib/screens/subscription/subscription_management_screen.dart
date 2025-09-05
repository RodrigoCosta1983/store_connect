import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';

class SubscriptionManagementScreen extends StatelessWidget {
  final String storeId;

  const SubscriptionManagementScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gerenciar Assinatura'),
      ),
      body: StreamBuilder<DocumentSnapshot>(
        stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError || !snapshot.data!.exists) {
            return const Center(child: Text('Não foi possível carregar os dados da loja.'));
          }

          final storeData = snapshot.data!.data() as Map<String, dynamic>;
          final status = storeData['subscriptionStatus'] ?? 'pendente';
          final monthlyFee = (storeData['monthlyFee'] as num?)?.toDouble() ?? 0.0;
          final lastPaymentTimestamp = storeData['lastPaymentDate'] as Timestamp?;

          final currencyFormat = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');
          final dateFormat = DateFormat('dd/MM/yyyy');

          final isPaid = status == 'active';

          return Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  storeData['storeName'] ?? 'Sua Loja',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 24),

                Card(
                  elevation: 2,
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      children: [
                        ListTile(
                          leading: Icon(
                            isPaid ? Icons.check_circle : Icons.error,
                            color: isPaid ? Colors.green : Colors.orange,
                          ),
                          title: const Text('Status da Assinatura'),
                          trailing: Text(
                            isPaid ? 'Ativa' : 'Pendente',
                            style: TextStyle(
                                fontWeight: FontWeight.bold,
                                color: isPaid ? Colors.green : Colors.orange,
                                fontSize: 16
                            ),
                          ),
                        ),
                        const Divider(),
                        ListTile(
                          leading: const Icon(Icons.price_change_outlined),
                          title: const Text('Valor da Mensalidade'),
                          trailing: Text(
                            currencyFormat.format(monthlyFee),
                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                          ),
                        ),
                        if (lastPaymentTimestamp != null)
                          ListTile(
                            leading: const Icon(Icons.calendar_today_outlined),
                            title: const Text('Último Pagamento'),
                            trailing: Text(
                              dateFormat.format(lastPaymentTimestamp.toDate()),
                              style: const TextStyle(fontSize: 16),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),

                const Spacer(),

                if (!isPaid)
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      icon: const Icon(Icons.payment),
                      label: const Text('Pagar Mensalidade'),
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      onPressed: () {
                        // Nosso próximo passo será aqui!
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('TODO: Chamar Mercado Pago')),
                        );
                      },
                    ),
                  ),
                const SizedBox(height: 20),
              ],
            ),
          );
        },
      ),
    );
  }
}