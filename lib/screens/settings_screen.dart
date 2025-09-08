// lib/screens/settings_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/screens/profile/profile_screen.dart';
import 'package:provider/provider.dart'; // NOVO: Importe o Provider
import 'package:store_connect/providers/theme_provider.dart';
class SettingsScreen extends StatefulWidget {
  final String storeId;
  const SettingsScreen({super.key, required this.storeId});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _isLoading = true;
  bool _fiadoEnabled = false;
  int _lowStockThreshold = 5; // Valor padrão
  final _thresholdController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  // Carrega as configurações de duas fontes: local (SharedPreferences) e nuvem (Firestore)
  Future<void> _loadSettings() async {
    setState(() => _isLoading = true);

    // Carrega a preferência de 'fiado' do armazenamento local
    final prefs = await SharedPreferences.getInstance();
    _fiadoEnabled = prefs.getBool('fiado_enabled') ?? false;

    // Carrega o limite de estoque baixo do documento da loja no Firestore
    try {
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();
      if (storeDoc.exists && storeDoc.data()!.containsKey('lowStockThreshold')) {
        _lowStockThreshold = storeDoc.data()!['lowStockThreshold'];
      }
    } catch (e) {
      print('Erro ao carregar limite de estoque: $e');
    }

    setState(() => _isLoading = false);
  }

  // Salva a preferência de 'fiado' localmente
  Future<void> _saveFiadoPreference(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('fiado_enabled', value);
    setState(() {
      _fiadoEnabled = value;
    });
  }

  // Salva o novo limite de estoque baixo no Firestore
  Future<void> _saveThresholdToFirestore() async {
    final newValue = int.tryParse(_thresholdController.text);
    if (newValue == null || newValue < 0) return;

    try {
      await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .update({'lowStockThreshold': newValue});

      setState(() {
        _lowStockThreshold = newValue;
      });

      if (mounted) Navigator.of(context).pop(); // Fecha o diálogo
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao salvar: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // Mostra o diálogo para editar o limite de estoque
  void _showEditThresholdDialog() {
    _thresholdController.text = _lowStockThreshold.toString();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Definir Alerta de Estoque'),
        content: TextField(
          controller: _thresholdController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Alertar quando estoque for <= a',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(onPressed: _saveThresholdToFirestore, child: const Text('Salvar')),
        ],
      ),
    );
  }

  void _showThemeDialog() {
    final themeProvider = Provider.of<ThemeProvider>(context, listen: false);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Escolher Tema'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RadioListTile<ThemeMode>(
              title: const Text('Claro'),
              value: ThemeMode.light,
              groupValue: themeProvider.themeMode,
              onChanged: (value) {
                if (value != null) themeProvider.setTheme(value);
                Navigator.of(ctx).pop();
              },
            ),
            RadioListTile<ThemeMode>(
              title: const Text('Escuro'),
              value: ThemeMode.dark,
              groupValue: themeProvider.themeMode,
              onChanged: (value) {
                if (value != null) themeProvider.setTheme(value);
                Navigator.of(ctx).pop();
              },
            ),
            RadioListTile<ThemeMode>(
              title: const Text('Padrão do Sistema'),
              value: ThemeMode.system,
              groupValue: themeProvider.themeMode,
              onChanged: (value) {
                if (value != null) themeProvider.setTheme(value);
                Navigator.of(ctx).pop();
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // NOVO: Pega a instância do ThemeProvider para exibir o nome do tema atual
    final themeProvider = Provider.of<ThemeProvider>(context);
    String currentThemeName;
    switch(themeProvider.themeMode) {
      case ThemeMode.light:
        currentThemeName = 'Claro';
        break;
      case ThemeMode.dark:
        currentThemeName = 'Escuro';
        break;
      case ThemeMode.system:
        currentThemeName = 'Padrão do Sistema';
        break;
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurações'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.account_circle),
            title: const Text('Minha Conta'),
            subtitle: const Text('Dados pessoais e Segurança'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (ctx) => const ProfileScreen(),
                ),
              );
            },
          ),
          const Divider(),

          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Aparência', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          ListTile(
            title: const Text('Tema do Aplicativo'),
            subtitle: Text(currentThemeName),
            trailing: const Icon(Icons.palette),
            onTap: _showThemeDialog,
          ),

          const Divider(),

          // Seção de Vendas
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Vendas', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          SwitchListTile(
            title: const Text('Habilitar Venda "Fiado"'),
            subtitle: const Text('Permite registrar vendas a prazo para clientes.'),
            value: _fiadoEnabled,
            onChanged: _saveFiadoPreference,
          ),
          const Divider(),

          // Seção de Estoque
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Estoque', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          ListTile(
            title: const Text('Alerta de Estoque Baixo'),
            subtitle: Text('Alertar quando a quantidade for menor ou igual a $_lowStockThreshold'),
            trailing: const Icon(Icons.edit),
            onTap: _showEditThresholdDialog,
          ),

        ],
      ),
    );
  }
}