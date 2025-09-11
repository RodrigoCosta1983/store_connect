// lib/screens/subscription_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:store_connect/screens/subscription/subscription_management_screen.dart';

class SubscriptionScreen extends StatelessWidget {
  final String storeId;
  const SubscriptionScreen({super.key, required this.storeId});

  void _manageSubscription(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        // Navega para a tela de gerenciamento, passando o ID da loja
        builder: (context) => SubscriptionManagementScreen(storeId: storeId),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Assinatura'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => FirebaseAuth.instance.signOut(),
            tooltip: 'Sair',
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.lock_clock,
                size: 80,
                color: Colors.orange.shade700,
              ),
              const SizedBox(height: 24),
              const Text(
                'Acesso à Loja Suspenso',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                'Sua assinatura para esta loja está pendente ou expirou. Por favor, regularize o pagamento para continuar usando o StoreConnect.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: Colors.grey.shade600),
              ),
              const SizedBox(height: 32),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                  textStyle: const TextStyle(fontSize: 16),
                ),
                onPressed: () => _manageSubscription(context),
                icon: const Icon(Icons.payment),
                label: const Text('Gerenciar Assinatura'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}