// lib/screens/subscription_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

class SubscriptionScreen extends StatelessWidget {
  final String storeId;
  const SubscriptionScreen({super.key, required this.storeId});

  void _manageSubscription(BuildContext context) {
    // TODO: Adicionar o link de pagamento do Mercado Pago aqui na Fase 2
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('A integração com o pagamento será adicionada em breve!')),
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