// ============================================================================
// STORE CONNECT - CRIAÇÃO INICIAL DA LOJA / BOOTSTRAP SEGURO
// ============================================================================
//
// Arquivo:
//   lib/screens/auth/create_store_screen.dart
//
// Objetivo:
//   Coletar os dados mínimos do negócio e solicitar ao backend a criação da
//   primeira loja do usuário.
//
// P6 - AUTORIDADE:
//
// Este arquivo NÃO cria mais diretamente:
//   - stores/{storeId};
//   - role = admin;
//   - ownerId;
//   - subscriptionStatus;
//   - subscriptionType;
//   - trialEndDate;
//   - cpfs_cadastrados/{documento}.
//
// A autoridade desses campos pertence à Cloud Function `bootstrapStore`.
//
// Fluxo:
//   usuário autenticado
//       -> preenche nome + CPF/CNPJ + WhatsApp
//       -> Flutter chama bootstrapStore
//       -> backend valida CPF/CNPJ
//       -> backend cria loja + vínculo do usuário + trial em transação
//       -> retorna storeId
//       -> SalesProvider recebe storeId
//       -> AuthGate assume o roteamento
//
// Segurança:
//   - o Flutter não escolhe storeId;
//   - o Flutter não escolhe role;
//   - o Flutter não calcula o fim do trial;
//   - a consulta pública/direta a cpfs_cadastrados foi removida;
//   - erros de autorização/duplicidade vêm do backend.
//
// Compatibilidade:
//   - funciona para cadastro por e-mail, cujo users/{uid} já existe;
//   - funciona para cadastro novo via Google, mesmo sem users/{uid} prévio.
//
// Manutenção:
//   - não reintroduzir batch/set direto para criação da loja;
//   - não voltar a consultar cpfs_cadastrados diretamente pelo cliente;
//   - não usar DateTime.now() para definir autoridade do trial.
// ============================================================================

import 'package:brasil_fields/brasil_fields.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/screens/auth/auth_gate.dart';

class CreateStoreScreen extends StatefulWidget {
  const CreateStoreScreen({super.key});

  @override
  State<CreateStoreScreen> createState() => _CreateStoreScreenState();
}

class _CreateStoreScreenState extends State<CreateStoreScreen> {
  final _formKey = GlobalKey<FormState>();

  final _storeNameController = TextEditingController();
  final _phoneController = TextEditingController();

  String _enteredDocument = '';

  bool _isLoading = false;

  @override
  void dispose() {
    _storeNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _showError(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(content: Text(message), backgroundColor: Colors.red),
      );
  }

  String _friendlyFunctionError(FirebaseFunctionsException error) {
    switch (error.code) {
      case 'already-exists':
        return error.message ??
            'Este CPF/CNPJ ou usuário já possui uma loja cadastrada.';

      case 'permission-denied':
        return error.message ??
            'Você não possui permissão para criar esta loja.';

      case 'unauthenticated':
        return 'Sua sessão expirou. Entre novamente.';

      case 'invalid-argument':
        return error.message ??
            'Confira os dados informados e tente novamente.';

      default:
        return error.message ?? 'Não foi possível criar a loja.';
    }
  }

  Future<void> _submitCreateStore() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    _formKey.currentState!.save();

    setState(() {
      _isLoading = true;
    });

    final user = FirebaseAuth.instance.currentUser;

    if (user == null) {
      if (!mounted) return;

      Navigator.of(
        context,
      ).pushReplacement(MaterialPageRoute(builder: (ctx) => const AuthGate()));

      return;
    }

    try {
      final cleanDocument = _enteredDocument.replaceAll(RegExp(r'[^0-9]'), '');

      final cleanPhone = UtilBrasilFields.removeCaracteres(
        _phoneController.text,
      );

      // Garante que a Function receba um token atual da sessão.
      await user.getIdToken(true);

      final callable = FirebaseFunctions.instance.httpsCallable(
        'bootstrapStore',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      );

      final response = await callable.call(<String, dynamic>{
        'name': _storeNameController.text.trim(),
        'phone': cleanPhone,
        'document': cleanDocument,
      });

      final rawData = response.data;

      if (rawData is! Map) {
        throw Exception('Resposta inválida ao criar a loja.');
      }

      final data = Map<String, dynamic>.from(rawData);

      final storeId = data['storeId']?.toString().trim() ?? '';

      if (storeId.isEmpty) {
        throw Exception('O servidor não retornou o identificador da loja.');
      }

      if (!mounted) return;

      Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeId);

      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (ctx) => const AuthGate()),
        (route) => false,
      );
    } on FirebaseFunctionsException catch (e) {
      _showError(_friendlyFunctionError(e));
    } catch (e) {
      _showError('Erro ao criar loja: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurar Loja'),
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sair',
            onPressed: () async {
              await FirebaseAuth.instance.signOut();

              if (!context.mounted) {
                return;
              }

              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (ctx) => const AuthGate()),
                (route) => false,
              );
            },
          ),
        ],
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(
                    Icons.storefront,
                    size: 64,
                    color: Colors.deepPurple,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Dados do seu Negócio',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Precisamos de alguns dados para configurar sua loja e liberar seus 7 dias de acesso grátis.',
                    style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),

                  // ------------------------------------------------------------
                  // NOME DA LOJA
                  // ------------------------------------------------------------
                  TextFormField(
                    controller: _storeNameController,
                    decoration: InputDecoration(
                      labelText: 'Nome da Loja',
                      prefixIcon: const Icon(Icons.shopping_bag_outlined),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    textInputAction: TextInputAction.next,
                    validator: (value) {
                      final text = value?.trim() ?? '';

                      if (text.isEmpty) {
                        return 'O nome da loja é obrigatório.';
                      }

                      if (text.length > 120) {
                        return 'O nome da loja é muito longo.';
                      }

                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  // ------------------------------------------------------------
                  // CPF / CNPJ
                  // ------------------------------------------------------------
                  TextFormField(
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(14),
                    ],
                    decoration: InputDecoration(
                      labelText: 'CPF ou CNPJ do Proprietário',
                      prefixIcon: const Icon(Icons.badge_outlined),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    textInputAction: TextInputAction.next,
                    validator: (value) {
                      final clean = (value ?? '').replaceAll(
                        RegExp(r'[^0-9]'),
                        '',
                      );

                      if (clean.isEmpty) {
                        return 'Campo obrigatório.';
                      }

                      if (clean.length != 11 && clean.length != 14) {
                        return 'Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos.';
                      }

                      return null;
                    },
                    onSaved: (value) {
                      _enteredDocument = value ?? '';
                    },
                  ),
                  const SizedBox(height: 16),

                  // ------------------------------------------------------------
                  // WHATSAPP
                  // ------------------------------------------------------------
                  TextFormField(
                    controller: _phoneController,
                    decoration: InputDecoration(
                      labelText: 'WhatsApp',
                      prefixIcon: const Icon(Icons.phone_android),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    keyboardType: TextInputType.phone,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      TelefoneInputFormatter(),
                    ],
                    textInputAction: TextInputAction.done,
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'O WhatsApp é obrigatório.';
                      }

                      return null;
                    },
                  ),
                  const SizedBox(height: 32),

                  if (_isLoading)
                    const Center(child: CircularProgressIndicator())
                  else
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        backgroundColor: Colors.deepPurple,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      onPressed: _submitCreateStore,
                      child: const Text(
                        'Concluir Cadastro',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
