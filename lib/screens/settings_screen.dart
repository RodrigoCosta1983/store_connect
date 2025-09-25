// lib/screens/settings_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:store_connect/screens/profile/profile_screen.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/theme_provider.dart';

class SettingsScreen extends StatefulWidget {
  final String storeId;
  const SettingsScreen({super.key, required this.storeId});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _storage = const FlutterSecureStorage();
  bool _isLoading = true;
  bool _fiadoEnabled = false;
  bool _biometricEnabled = false;
  int _lowStockThreshold = 5;
  final _thresholdController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _thresholdController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    setState(() => _isLoading = true);
    final prefs = await SharedPreferences.getInstance();
    _fiadoEnabled = prefs.getBool('fiado_enabled') ?? false;
    await _loadBiometricPreference();
    await _loadStockThresholdFromFirestore();
    setState(() => _isLoading = false);
  }

  Future<void> _loadBiometricPreference() async {
    final pref = await _storage.read(key: 'biometricsEnabled');
    if (mounted) {
      setState(() => _biometricEnabled = pref == 'true');
    }
  }

  Future<void> _saveBiometricPreference(bool value) async {
    final hasCredentials = await _storage.read(key: 'email') != null;
    if (value && !hasCredentials) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Para ativar, faça login uma vez com a opção "Lembrar dados" marcada.'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }
    await _storage.write(key: 'biometricsEnabled', value: value.toString());
    if (mounted) {
      setState(() => _biometricEnabled = value);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(value ? 'Acesso com biometria ativado.' : 'Acesso com biometria desativado.'),
          backgroundColor: Colors.green,
        ),
      );
    }
  }

  Future<void> _loadStockThresholdFromFirestore() async {
    try {
      final doc = await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).get();
      if (doc.exists && doc.data()!.containsKey('lowStockThreshold')) {
        _lowStockThreshold = doc.data()!['lowStockThreshold'];
      }
    } catch (e) {
      print('Erro ao carregar limite de estoque: $e');
    }
    _thresholdController.text = _lowStockThreshold.toString();
  }

  Future<void> _saveFiadoPreference(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('fiado_enabled', value);
    setState(() => _fiadoEnabled = value);
  }

  void _showEditThresholdDialog() {
    _thresholdController.text = _lowStockThreshold.toString();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Definir Alerta de Estoque'),
        content: TextField(
          controller: _thresholdController,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Alertar quando estoque for ≤ a'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(onPressed: () => _saveThresholdToFirestore(ctx), child: const Text('Salvar')),
        ],
      ),
    );
  }

  Future<void> _saveThresholdToFirestore(BuildContext dialogContext) async {
    final newThreshold = int.tryParse(_thresholdController.text);
    if (newThreshold == null || newThreshold < 0) return;
    try {
      await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).set({
        'lowStockThreshold': newThreshold,
      }, SetOptions(merge: true));
      setState(() => _lowStockThreshold = newThreshold);
      Navigator.of(dialogContext).pop();
    } catch(e) {
      ScaffoldMessenger.of(dialogContext).showSnackBar(SnackBar(content: Text('Erro ao salvar: $e')));
    }
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
              title: const Text('Claro'), value: ThemeMode.light, groupValue: themeProvider.themeMode,
              onChanged: (value) { if (value != null) themeProvider.setTheme(value); Navigator.of(ctx).pop(); },
            ),
            RadioListTile<ThemeMode>(
              title: const Text('Escuro'), value: ThemeMode.dark, groupValue: themeProvider.themeMode,
              onChanged: (value) { if (value != null) themeProvider.setTheme(value); Navigator.of(ctx).pop(); },
            ),
            RadioListTile<ThemeMode>(
              title: const Text('Padrão do Sistema'), value: ThemeMode.system, groupValue: themeProvider.themeMode,
              onChanged: (value) { if (value != null) themeProvider.setTheme(value); Navigator.of(ctx).pop(); },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final themeProvider = Provider.of<ThemeProvider>(context);
    String currentThemeName;
    switch(themeProvider.themeMode) {
      case ThemeMode.light: currentThemeName = 'Claro'; break;
      case ThemeMode.dark: currentThemeName = 'Escuro'; break;
      case ThemeMode.system: currentThemeName = 'Padrão do Sistema'; break;
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Configurações')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.person_outline),
            title: const Text('Minha Conta'),
            subtitle: const Text('Editar perfil e alterar senha'),
            // --- LINHA CORRIGIDA ---
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (ctx) => ProfileScreen(storeId: widget.storeId))),
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Segurança', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          SwitchListTile(
            title: const Text('Acesso com Biometria'),
            subtitle: const Text('Use sua digital ou rosto para entrar no app.'),
            value: _biometricEnabled,
            onChanged: _saveBiometricPreference,
            secondary: const Icon(Icons.fingerprint),
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Aparência', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          ListTile(
            title: const Text('Tema do Aplicativo'),
            subtitle: Text(currentThemeName),
            trailing: const Icon(Icons.palette_outlined),
            onTap: _showThemeDialog,
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Vendas', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          SwitchListTile(
            title: const Text('Habilitar Venda "Fiado"'),
            subtitle: const Text('Permite registrar vendas a prazo para clientes.'),
            value: _fiadoEnabled,
            onChanged: _saveFiadoPreference,
            secondary: const Icon(Icons.credit_score_outlined),
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Estoque', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          ListTile(
            title: const Text('Alerta de Estoque Baixo'),
            subtitle: Text('Alertar quando a quantidade for ≤ $_lowStockThreshold'),
            trailing: const Icon(Icons.edit_outlined),
            onTap: _showEditThresholdDialog,
          ),
        ],
      ),
    );
  }
}