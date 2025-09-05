import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class ReportsHubScreen extends StatelessWidget {
  final String storeId;
  const ReportsHubScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        // Usamos um StreamBuilder para buscar o nome da loja
        title: StreamBuilder<DocumentSnapshot>(
          stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting || !snapshot.hasData || !snapshot.data!.exists) {
              return const Text('Relatórios');
            }
            final storeData = snapshot.data!.data() as Map<String, dynamic>;
            final storeName = storeData['storeName'] ?? 'Sua Loja';
            // Exibe "Relatórios - Nome da Loja"
            return Text('Relatórios - $storeName');
          },
        ),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Aqui ficará a lista de relatórios disponíveis.',
              style: TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 10),
            Text(
              '(ID da Loja: $storeId)',
              style: const TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}