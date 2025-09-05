import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class ProfileScreen extends StatefulWidget {
  final String storeId;
  const ProfileScreen({super.key, required this.storeId});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _documentController = TextEditingController();
  final _phoneController = TextEditingController();

  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadStoreProfile();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _documentController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadStoreProfile() async {
    if (widget.storeId.isEmpty) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }
    try {
      final docRef = FirebaseFirestore.instance.collection('stores').doc(widget.storeId);
      final docSnapshot = await docRef.get();
      if (mounted && docSnapshot.exists) {
        final data = docSnapshot.data()!;
        _nameController.text = data['storeName'] ?? '';
        _documentController.text = data['documentNumber'] ?? '';
        _phoneController.text = data['phone'] ?? '';
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao carregar perfil: $e')));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _saveProfile() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _isSaving = true);

    final profileData = {
      'storeName': _nameController.text,
      'documentNumber': _documentController.text,
      'phone': _phoneController.text,
      'lastUpdated': Timestamp.now(),
    };
    try {
      await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).update(profileData);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Dados salvos com sucesso!'), backgroundColor: Colors.green));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar dados: $e'), backgroundColor: Colors.red));
      }
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  // A lógica de segurança (alterar senha/email) não muda, pois está ligada ao usuário.
  void _showChangePasswordDialog(BuildContext context) { /* ...código sem alterações... */ }
  void _showChangeEmailDialog(BuildContext context) { /* ...código sem alterações... */ }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Perfil e Segurança'),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
          _buildSectionHeader('Dados da Loja', Icons.storefront_outlined),
          const SizedBox(height: 8),
          Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Form(
                key: _formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: _nameController,
                      decoration: const InputDecoration(labelText: 'Nome da Loja / Razão Social'),
                      validator: (value) => value!.isEmpty ? 'Este campo é obrigatório.' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _documentController,
                      decoration: const InputDecoration(labelText: 'CPF / CNPJ'),
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _phoneController,
                      decoration: const InputDecoration(labelText: 'Telefone / WhatsApp'),
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 24),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        minimumSize: const Size(double.infinity, 45),
                      ),
                      onPressed: _isSaving ? null : _saveProfile,
                      child: _isSaving
                          ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : const Text('Salvar Dados do Perfil'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          _buildSectionHeader('Segurança da Conta', Icons.security_rounded),
          const SizedBox(height: 8),
          Card(
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.email_outlined),
                  title: const Text('E-mail de Login'),
                  subtitle: Text(FirebaseAuth.instance.currentUser?.email ?? 'Não foi possível carregar o e-mail'),
                ),
                ListTile(
                  leading: const Icon(Icons.password),
                  title: const Text('Alterar Senha'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _showChangePasswordDialog(context),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: Theme.of(context).primaryColor),
        const SizedBox(width: 8),
        Text(
          title,
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}