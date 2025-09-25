// lib/screens/profile_screen.dart

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
  final currentUser = FirebaseAuth.instance.currentUser;

  @override
  void initState() {
    super.initState();
    _loadUserProfile();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _documentController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _loadUserProfile() async {
    if (currentUser == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }
    try {
      final docRef = FirebaseFirestore.instance.collection('users').doc(currentUser!.uid);
      final docSnapshot = await docRef.get();
      if (mounted && docSnapshot.exists) {
        final data = docSnapshot.data()!;
        _nameController.text = data['fullName'] ?? '';
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
    // Garante que o formulário é válido antes de prosseguir
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    if (currentUser == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Usuário não encontrado.')));
      setState(() => _isSaving = false);
      return;
    }

    final profileData = {
      'fullName': _nameController.text,
      'documentNumber': _documentController.text,
      'phone': _phoneController.text,
      'lastUpdated': Timestamp.now(),
    };

    try {
      // Garante que está salvando na coleção 'users', que é a correta para dados de perfil
      await FirebaseFirestore.instance.collection('users').doc(currentUser!.uid).set(profileData, SetOptions(merge: true));
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

  // --- FUNÇÃO DE ALTERAR SENHA PREENCHIDA ---
  void _showChangePasswordDialog(BuildContext context) {
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Alterar Senha'),
        content: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(controller: currentPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Senha Atual'), validator: (value) => value!.isEmpty ? 'Campo obrigatório' : null),
                TextFormField(controller: newPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Nova Senha'), validator: (value) { if (value == null || value.isEmpty) return 'Campo obrigatório'; if (value.length < 6) return 'A senha deve ter no mínimo 6 caracteres.'; return null; }),
                TextFormField(controller: confirmPasswordController, obscureText: true, decoration: const InputDecoration(labelText: 'Confirmar Nova Senha'), validator: (value) { if (value != newPasswordController.text) return 'As senhas não coincidem.'; return null; }),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(
            child: const Text('Salvar'),
            onPressed: () async {
              if (formKey.currentState!.validate()) {
                final user = FirebaseAuth.instance.currentUser;
                final cred = EmailAuthProvider.credential(email: user!.email!, password: currentPasswordController.text);
                try {
                  await user.reauthenticateWithCredential(cred);
                  await user.updatePassword(newPasswordController.text);
                  if (context.mounted) {
                    Navigator.of(ctx).pop();
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Senha alterada com sucesso!'), backgroundColor: Colors.green));
                  }
                } on FirebaseAuthException catch (e) {
                  String errorMessage = 'Ocorreu um erro.';
                  if (e.code == 'wrong-password') {
                    errorMessage = 'A senha atual está incorreta.';
                  } else if (e.code == 'weak-password') {
                    errorMessage = 'A nova senha é muito fraca.';
                  }
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage), backgroundColor: Colors.red));
                  }
                }
              }
            },
          ),
        ],
      ),
    );
  }

  // --- FUNÇÃO DE ALTERAR E-MAIL PREENCHIDA ---
  void _showChangeEmailDialog(BuildContext context) {
    final newEmailController = TextEditingController();
    final passwordController = TextEditingController();
    final formKey = GlobalKey<FormState>();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Alterar E-mail'),
        content: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(controller: newEmailController, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Novo E-mail'), validator: (value) { if (value == null || !value.contains('@')) return 'Insira um e-mail válido.'; return null; }),
                TextFormField(controller: passwordController, obscureText: true, decoration: const InputDecoration(labelText: 'Senha Atual'), validator: (value) => value!.isEmpty ? 'Campo obrigatório' : null),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancelar')),
          ElevatedButton(
            child: const Text('Salvar'),
            onPressed: () async {
              if (formKey.currentState!.validate()) {
                final user = FirebaseAuth.instance.currentUser;
                final cred = EmailAuthProvider.credential(email: user!.email!, password: passwordController.text);
                try {
                  await user.reauthenticateWithCredential(cred);
                  await user.verifyBeforeUpdateEmail(newEmailController.text);
                  if (context.mounted) {
                    Navigator.of(ctx).pop();
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link de verificação enviado para o novo e-mail!'), backgroundColor: Colors.green));
                  }
                } on FirebaseAuthException catch (e) {
                  String errorMessage = 'Ocorreu um erro.';
                  if (e.code == 'wrong-password') {
                    errorMessage = 'A senha está incorreta.';
                  } else if (e.code == 'email-already-in-use') {
                    errorMessage = 'Este e-mail já está sendo usado por outra conta.';
                  } else if (e.code == 'invalid-email') {
                    errorMessage = 'O novo e-mail fornecido é inválido.';
                  }
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorMessage), backgroundColor: Colors.red));
                  }
                }
              }
            },
          ),
        ],
      ),
    );
  }

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
          _buildSectionHeader('Dados da Loja', Icons.store),
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
                  subtitle: Text(
                    // Pega o email do usuário logado diretamente da autenticação
                    FirebaseAuth.instance.currentUser?.email ?? 'Não foi possível carregar o e-mail',
                  ),
                ),
                ListTile(
                  leading: const Icon(Icons.password),
                  title: const Text('Alterar Senha'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _showChangePasswordDialog(context),
                ),
                const Divider(height: 1, indent: 16, endIndent: 16),
                ListTile(
                  leading: const Icon(Icons.alternate_email),
                  title: const Text('Alterar E-mail'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _showChangeEmailDialog(context),
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