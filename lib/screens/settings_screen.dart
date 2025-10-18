// settings_screen.dart

import 'dart:io';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
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
  bool _biometricEnabled = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    setState(() => _isLoading = true);
    final pref = await _storage.read(key: 'biometricsEnabled');
    if (mounted) setState(() => _biometricEnabled = pref == 'true');
    setState(() => _isLoading = false);
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

  void _openPayments() {
    Navigator.of(context).push(MaterialPageRoute(builder: (ctx) => PaymentSettingsScreen(storeId: widget.storeId)));
  }

  @override
  Widget build(BuildContext context) {
    final themeProvider = Provider.of<ThemeProvider>(context);
    String currentThemeName;
    switch (themeProvider.themeMode) {
      case ThemeMode.light:
        currentThemeName = 'Claro';
        break;
      case ThemeMode.dark:
        currentThemeName = 'Escuro';
        break;
      default:
        currentThemeName = 'Padrão do Sistema';
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
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (ctx) => ProfileScreen(storeId: widget.storeId))),
          ),
          const Divider(),
          // Pagamentos -> agora abre tela que contém Pagamentos + Vendas (conforme pedido)
          ListTile(
            leading: const Icon(Icons.payment_outlined),
            title: const Text('Pagamentos'),
            subtitle: const Text('Configurar meios de pagamento e vendas'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _openPayments,
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
            onTap: () {
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
            },
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('Estoque', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ),
          ListTile(
            title: const Text('Alerta de Estoque Baixo'),
            subtitle: const Text('Configurar alerta de estoque (uso geral)'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              // Reaproveitamos a tela de pagamentos para edição do threshold? Mantemos o diálogo simples:
              showDialog(
                context: context,
                builder: (ctx) {
                  final _controller = TextEditingController();
                  return FutureBuilder<DocumentSnapshot>(
                    future: FirebaseFirestore.instance.collection('stores').doc(widget.storeId).get(),
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
                      int current = 5;
                      if (snap.hasData && snap.data!.exists) {
                        final data = snap.data!.data() as Map<String, dynamic>?;
                        if (data != null && data.containsKey('lowStockThreshold')) {
                          current = data['lowStockThreshold'] as int;
                        }
                      }
                      _controller.text = current.toString();
                      return AlertDialog(
                        title: const Text('Definir Alerta de Estoque'),
                        content: TextField(
                          controller: _controller,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(labelText: 'Alertar quando a quantidade for ≤'),
                        ),
                        actions: [
                          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
                          ElevatedButton(
                            onPressed: () async {
                              final newVal = int.tryParse(_controller.text);
                              if (newVal == null) return;
                              await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).set({
                                'lowStockThreshold': newVal,
                              }, SetOptions(merge: true));
                              Navigator.of(ctx).pop();
                              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Limite de estoque atualizado.'), backgroundColor: Colors.green));
                            },
                            child: const Text('Salvar'),
                          ),
                        ],
                      );
                    },
                  );
                },
              );
            },
          ),
        ],
      ),
    );
  }
}

/// PaymentSettingsScreen: contém Pagamentos (PIX QR Code) e Vendas (Fiado + Alerta)
class PaymentSettingsScreen extends StatefulWidget {
  final String storeId;
  const PaymentSettingsScreen({super.key, required this.storeId});

  @override
  State<PaymentSettingsScreen> createState() => _PaymentSettingsScreenState();
}

class _PaymentSettingsScreenState extends State<PaymentSettingsScreen> {
  bool _isLoading = true;

  // PIX QR
  String? _pixQrCodeUrl;
  String? _pixQrCodePath;

  // Vendas
  bool _fiadoEnabled = false;
  int _lowStockThreshold = 5;
  final _thresholdController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  @override
  void dispose() {
    _thresholdController.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() => _isLoading = true);
    await Future.wait([
      _loadPixQrCodeUrl(),
      _loadSalesSettings(),
    ]);
    if (mounted) setState(() => _isLoading = false);
  }

  Future<void> _loadPixQrCodeUrl() async {
    try {
      final doc = await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).get();
      if (doc.exists) {
        final data = doc.data();
        if (data != null) {
          _pixQrCodeUrl = data['pixQrCodeUrl'] as String?;
          _pixQrCodePath = data['pixQrCodePath'] as String?;
        }
      }
    } catch (e) {
      debugPrint('Erro ao carregar pixQrCodeUrl: $e');
    }
  }

  Future<void> _loadSalesSettings() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _fiadoEnabled = prefs.getBool('fiado_enabled') ?? false;

      final doc = await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).get();
      if (doc.exists && doc.data()!.containsKey('lowStockThreshold')) {
        _lowStockThreshold = doc.data()!['lowStockThreshold'];
      }
    } catch (e) {
      debugPrint('Erro ao carregar configurações de vendas: $e');
    }
  }

  Future<void> _saveFiadoPreference(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('fiado_enabled', value);
    if (mounted) setState(() => _fiadoEnabled = value);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(value ? 'Venda a crédito habilitada' : 'Venda a crédito desabilitada'), backgroundColor: Colors.green),
    );
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
          decoration: const InputDecoration(labelText: 'Alertar quando a quantidade for ≤'),
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Limite de estoque atualizado.'), backgroundColor: Colors.green),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar: $e')));
    }
  }

  // Método robusto: upload com filename único, metadata, salvar path no Firestore e deletar antigo.
  Future<void> _updatePixQrCode() async {
    final pickedImage = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
    );
    if (pickedImage == null) return;

    setState(() => _isLoading = true);

    final storesRef = FirebaseFirestore.instance.collection('stores').doc(widget.storeId);
    String? oldUrl;
    String? oldStoragePath;

    try {
      // 0) Obter dados antigos (url e storagePath) para poder deletar depois
      final doc = await storesRef.get();
      if (doc.exists) {
        final data = doc.data();
        oldUrl = data?['pixQrCodeUrl'] as String?;
        oldStoragePath = data?['pixQrCodePath'] as String?;
      }

      // 1) Gerar nome único
      final timestamp = DateTime.now().millisecondsSinceEpoch;
      final fileName = 'qrcode_$timestamp.jpg';
      final storagePath = 'pix_qrcodes/${widget.storeId}/$fileName';
      final storageRef = FirebaseStorage.instance.ref().child(storagePath);

      // 2) Fazer upload com metadata (defina cacheControl conforme sua necessidade)
      final metadata = SettableMetadata(
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=3600',
      );

      if (kIsWeb) {
        final bytes = await pickedImage.readAsBytes();
        await storageRef.putData(bytes, metadata);
      } else {
        await storageRef.putFile(File(pickedImage.path), metadata);
      }

      // 3) Obter download URL
      final newUrl = await storageRef.getDownloadURL();

      // 4) Salvar novo URL e storagePath no Firestore (merge)
      await storesRef.set({
        'pixQrCodeUrl': newUrl,
        'pixQrCodePath': storagePath,
        'pixQrCodeUpdatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      // 5) Tentar deletar o arquivo antigo (se existir)
      if (oldStoragePath != null && oldStoragePath.isNotEmpty) {
        try {
          final oldRef = FirebaseStorage.instance.ref().child(oldStoragePath);
          await oldRef.delete();
          debugPrint('Arquivo antigo deletado: $oldStoragePath');
        } catch (e) {
          debugPrint('Falha ao deletar arquivo antigo (path): $e');
        }
      } else if (oldUrl != null && oldUrl.isNotEmpty) {
        try {
          final oldRef = FirebaseStorage.instance.refFromURL(oldUrl);
          await oldRef.delete();
          debugPrint('Arquivo antigo deletado por URL.');
        } catch (e) {
          debugPrint('Falha ao deletar por URL antiga: $e');
        }
      }

      // 6) Limpar cache local
      try {
        imageCache.clear();
        imageCache.clearLiveImages();
      } catch (_) {}

      // 7) Atualiza UI
      if (mounted) {
        setState(() {
          _pixQrCodeUrl = newUrl;
          _pixQrCodePath = storagePath;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Imagem do PIX QR Code atualizada!'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      debugPrint('Erro ao atualizar QR Code: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao atualizar imagem: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pagamentos')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
        children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text('Pagamentos', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          ),
          // PIX QR
          ListTile(
            leading: CircleAvatar(
              radius: 20,
              backgroundColor: Colors.grey.shade200,
              backgroundImage: _pixQrCodeUrl != null ? NetworkImage(_pixQrCodeUrl!) : null,
              child: _pixQrCodeUrl == null ? const Icon(Icons.qr_code, color: Colors.grey) : null,
            ),
            title: const Text('PIX QR Code'),
            subtitle: const Text('Definir imagem para recebimentos'),
            trailing: IconButton(
              icon: const Icon(Icons.edit_outlined),
              onPressed: _updatePixQrCode,
            ),
            onTap: () {
              showDialog(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('PIX QR Code'),
                  content: _pixQrCodeUrl != null
                      ? Image.network(_pixQrCodeUrl!, fit: BoxFit.contain)
                      : const Text('Nenhuma imagem de QR Code configurada.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Fechar')),
                    ElevatedButton(
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        _updatePixQrCode();
                      },
                      child: const Text('Alterar Imagem'),
                    ),
                  ],
                ),
              );
            },
          ),
          const Divider(),
          // Vendas (dentro de Pagamentos)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text('Vendas', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          ),
          SwitchListTile(
            title: const Text('Habilitar Venda a Crédito'),
            subtitle: const Text('Permite registrar vendas a prazo para clientes.'),
            value: _fiadoEnabled,
            onChanged: _saveFiadoPreference,
            secondary: const Icon(Icons.credit_score_outlined),
          ),

          const SizedBox(height: 20),
        ],
      ),
    );
  }
}