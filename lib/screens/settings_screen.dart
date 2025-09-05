// lib/screens/settings_screen.dart

import 'package:flutter/material.dart';

// A classe DEVE ter o "final String storeId"
// e o construtor DEVE ter o "required this.storeId"
class SettingsScreen extends StatefulWidget {
  final String storeId;
  const SettingsScreen({super.key, required this.storeId});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurações'),
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Página de Configurações',
              style: TextStyle(fontSize: 22),
            ),
            const SizedBox(height: 20),
            // Este texto confirma que o storeId foi recebido com sucesso
            Text(
              'Dados da Loja ID: ${widget.storeId}',
              style: const TextStyle(fontSize: 16, color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}