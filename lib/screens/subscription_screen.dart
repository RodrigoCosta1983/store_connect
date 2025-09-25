// lib/screens/subscription_screen.dart

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/subscription_provider.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class SubscriptionScreen extends StatefulWidget {
  final String storeId;
  const SubscriptionScreen({super.key, required this.storeId});

  @override
  State<SubscriptionScreen> createState() => _SubscriptionScreenState();
}

class _SubscriptionScreenState extends State<SubscriptionScreen> {

  @override
  void initState() {
    super.initState();
    // Inicia a escuta por atualizações de compra assim que a tela é construída
    Provider.of<SubscriptionProvider>(context, listen: false).initStoreInfo();
  }

  @override
  Widget build(BuildContext context) {
    // Usamos um Consumer para ouvir as mudanças no SubscriptionProvider
    return Consumer<SubscriptionProvider>(
      builder: (context, subProvider, child) {
        Widget content;

        if (subProvider.isLoading) {
          content = const Center(child: CircularProgressIndicator());
        } else if (!subProvider.isAvailable) {
          content = _buildInfoCard(
            'Serviço Indisponível',
            'Não foi possível conectar à loja de aplicativos. Verifique sua conexão e a conta Google.',
            Icons.error_outline,
            Colors.red,
          );
        } else if (subProvider.products.isEmpty) {
          content = _buildInfoCard(
            'Nenhum Plano Encontrado',
            'Não encontramos nenhum plano de assinatura disponível. Tente novamente mais tarde.',
            Icons.search_off,
            Colors.orange,
          );
        } else {
          // Se encontrou produtos, mostra a tela de compra
          final product = subProvider.products.first;
          content = _buildSubscriptionCard(product, subProvider);
        }

        return Scaffold(
          appBar: AppBar(
            title: const Text('Assinatura StoreConnect'),
            actions: [
              IconButton(
                icon: const Icon(Icons.logout),
                onPressed: () {
                  FirebaseAuth.instance.signOut();
                  // Leva de volta à tela de login após o logout
                  Navigator.of(context).pushAndRemoveUntil(
                      MaterialPageRoute(builder: (ctx) => const AuthGate()),
                          (route) => false
                  );
                },
                tooltip: 'Sair',
              ),
            ],
          ),
          body: Padding(
            padding: const EdgeInsets.all(16.0),
            child: content,
          ),
        );
      },
    );
  }

  // Widget para mostrar o plano de assinatura
  Widget _buildSubscriptionCard(ProductDetails product, SubscriptionProvider provider) {
    return Center(
      child: Card(
        elevation: 4,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.workspace_premium, size: 50, color: Colors.amber),
              const SizedBox(height: 16),
              Text(
                product.title,
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                product.description,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, color: Colors.grey.shade600),
              ),
              const SizedBox(height: 24),
              Text(
                product.price,
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Theme.of(context).primaryColor),
              ),
              const Text('/mês'),
              const SizedBox(height: 32),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 15),
                  textStyle: const TextStyle(fontSize: 18),
                ),
                onPressed: () {
                  provider.buySubscription(product);
                },
                child: const Text('Assinar Agora'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // Widget genérico para mostrar mensagens de erro ou informação
  Widget _buildInfoCard(String title, String message, IconData icon, Color color) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 80, color: color),
          const SizedBox(height: 24),
          Text(
            title,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16, color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }
}