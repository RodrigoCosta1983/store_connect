// lib/screens/home_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:store_connect/screens/sales/new_sale_screen.dart';

class HomeScreen extends StatelessWidget {
  final String storeId;

  const HomeScreen({super.key, required this.storeId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: StreamBuilder<DocumentSnapshot>(
            stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(),
            builder: (context, snapshot) {
              if (snapshot.hasData && snapshot.data!.exists) {
                final storeData = snapshot.data!.data() as Map<String, dynamic>;
                // LÓGICA ATUALIZADA: Tenta ler 'name', se não existir, tenta ler 'storeName'
                final storeName = storeData['name'] ?? storeData['storeName'] ?? 'Minha Loja';
                return Text(storeName);
              }
              return const Text('StoreConnect'); // Título padrão enquanto carrega
            }
        ),
        actions: [
          IconButton(
            tooltip: 'Sair',
            icon: const Icon(Icons.logout),
            onPressed: () {
              FirebaseAuth.instance.signOut();
            },
          )
        ],
      ),
      body: StreamBuilder<DocumentSnapshot>(
        stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (!snapshot.hasData || !snapshot.data!.exists) {
            return const Center(child: Text('Loja não encontrada.'));
          }

          final storeData = snapshot.data!.data() as Map<String, dynamic>;
          // LÓGICA ATUALIZADA: Tenta ler 'name', se não existir, tenta ler 'storeName'
          final storeName = storeData['name'] ?? storeData['storeName'] ?? 'Nome da Loja Indisponível';

          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'Bem-vindo à',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  storeName,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 32),
                ElevatedButton.icon(
                  icon: const Icon(Icons.storefront),
                  label: const Text('Gerenciar Loja'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                    textStyle: const TextStyle(fontSize: 18),
                  ),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (ctx) => NewSaleScreen(storeId: storeId),
                      ),
                    );
                  },
                )
              ],
            ),
          );
        },
      ),
    );
  }
}