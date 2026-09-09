// ============================================================================
// STORE&CONNECT — PERFIL, SEGURANÇA E BACKUP DA LOJA
// ============================================================================
//
// Arquivo:
//   lib/screens/profile_screen.dart
//
// OBJETIVO:
//
// Centralizar as configurações de perfil e segurança do usuário,
// preservando as regras de acesso da loja e oferecendo ao administrador
// ferramentas seguras de proteção dos dados.
//
// RESPONSABILIDADES:
//
// - carregar os dados do usuário autenticado;
// - permitir edição de nome e telefone;
// - manter CPF/CNPJ imutável após o cadastro;
// - permitir alteração segura de senha;
// - permitir alteração segura de e-mail;
// - identificar o perfil de acesso do usuário;
// - exibir recursos administrativos somente para Admin;
// - permitir criação manual de backup da loja por Cloud Function.
//
// BACKUP:
//
// O Flutter NÃO cria nem manipula diretamente o snapshot.
// O aplicativo apenas solicita a operação:
//
//   Flutter
//      ↓
//   createStoreSnapshot
//      ↓
//   valida Firebase Auth
//      ↓
//   valida users/{uid}
//      ↓
//   exige role == admin
//      ↓
//   valida vínculo com a loja
//      ↓
//   backend cria o snapshot
//
// O arquivo de backup é gerado e armazenado exclusivamente pelo backend.
//
// SEGURANÇA:
//
// - CPF/CNPJ não pode ser alterado nesta tela;
// - permissões visuais não substituem validações do backend;
// - gerente e operador não podem criar backups;
// - mesmo que o Flutter seja modificado, a Cloud Function valida novamente
//   autenticação, role e storeId;
// - dados sensíveis de assinatura/Asaas não fazem parte do snapshot.
//
// FASE ATUAL:
//
// F5 — Backup / Snapshot Geral
// F5.3 — Criação segura do snapshot no backend.
//
// FUTURO:
//
// - histórico de backups;
// - backup automático diário;
// - retenção automática;
// - restauração seletiva;
// - backup redundante externo;
// - disaster recovery.
//
// ============================================================================

import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';

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

  // ---------------------------------------------------------------------------
  // BACKUP
  // ---------------------------------------------------------------------------

  bool _isCreatingBackup = false;
  bool _isCheckingBackupRetention = false;
  bool _isAdmin = false;

  final currentUser = FirebaseAuth.instance.currentUser;

  // ===========================================================================
  // INIT
  // ===========================================================================

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

  // ===========================================================================
  // CARREGA PERFIL
  // ===========================================================================

  Future<void> _loadUserProfile() async {
    if (currentUser == null) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }

      return;
    }

    try {
      final docRef = FirebaseFirestore.instance
          .collection('users')
          .doc(currentUser!.uid);

      final docSnapshot = await docRef.get();

      if (mounted && docSnapshot.exists) {
        final data = docSnapshot.data()!;

        _nameController.text = data['fullName'] ?? '';

        _documentController.text = data['documentNumber'] ?? '';

        _phoneController.text = data['phone'] ?? '';

        // ---------------------------------------------------------------------
        // PERFIL DE ACESSO
        // ---------------------------------------------------------------------

        final role = (data['role'] ?? '').toString().trim().toLowerCase();

        _isAdmin = role == 'admin';
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Erro ao carregar perfil: $e')));
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ===========================================================================
  // SALVA PERFIL
  // ===========================================================================

  Future<void> _saveProfile({File? imageFile}) async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isSaving = true;
    });

    String? newUrl;

    // -------------------------------------------------------------------------
    // 1. UPLOAD DA IMAGEM, QUANDO INFORMADA
    // -------------------------------------------------------------------------

    if (imageFile != null) {
      try {
        final ref = FirebaseStorage.instance.ref(
          'store_logos/${widget.storeId}/logo.jpg',
        );

        await ref.putFile(imageFile);

        newUrl = await ref.getDownloadURL();
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text('Erro no upload: $e')));
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. DADOS DO PERFIL
    //
    // CPF/CNPJ NÃO É ALTERADO.
    // -------------------------------------------------------------------------

    final profileData = {
      'fullName': _nameController.text,

      'phone': _phoneController.text,

      'lastUpdated': Timestamp.now(),
    };

    try {
      // -----------------------------------------------------------------------
      // ATUALIZA USERS/{UID}
      // -----------------------------------------------------------------------

      await FirebaseFirestore.instance
          .collection('users')
          .doc(currentUser!.uid)
          .set(profileData, SetOptions(merge: true));

      // -----------------------------------------------------------------------
      // ATUALIZA DADOS EDITÁVEIS DA LOJA
      // -----------------------------------------------------------------------

      final Map<String, dynamic> storeUpdate = {
        'name': _nameController.text,

        'phone': _phoneController.text,
      };

      if (newUrl != null) {
        storeUpdate['logoUrl'] = newUrl;
      }

      await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .update(storeUpdate);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Dados salvos com sucesso!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro ao salvar: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  // ===========================================================================
  // BACKUP MANUAL DA LOJA
  // ===========================================================================

  Future<void> _createStoreBackup() async {
    if (_isCreatingBackup) {
      return;
    }

    setState(() {
      _isCreatingBackup = true;
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'createStoreSnapshot',
      );

      final result = await callable.call({
        'storeId': widget.storeId,

        'reason': 'Backup manual criado pelo administrador',
      });

      final rawData = result.data;

      final Map<String, dynamic> data = rawData is Map
          ? Map<String, dynamic>.from(rawData)
          : <String, dynamic>{};

      final rawCounts = data['counts'];

      final Map<String, dynamic> counts = rawCounts is Map
          ? Map<String, dynamic>.from(rawCounts)
          : <String, dynamic>{};

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Backup criado com sucesso! '
            'Produtos: ${counts['products'] ?? 0} | '
            'Clientes: ${counts['customers'] ?? 0} | '
            'Vendas: ${counts['sales'] ?? 0}',
          ),
          backgroundColor: Colors.green,
          duration: const Duration(seconds: 6),
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.message ?? 'Não foi possível criar o backup.'),
          backgroundColor: Colors.red,
        ),
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao criar backup: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isCreatingBackup = false;
        });
      }
    }
  }

  // ===========================================================================
// PREVIEW / DRY RUN DA RETENÇÃO DE BACKUPS
// ===========================================================================
//
// Apenas consulta o backend.
//
// NÃO exclui:
// - Firestore;
// - Storage;
// - snapshots;
// - dailyRuns;
// - auditLogs.
//
// ===========================================================================

  Future<void> _previewBackupRetention() async {
    if (_isCheckingBackupRetention) {
      return;
    }

    setState(() {
      _isCheckingBackupRetention = true;
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'previewBackupRetention',
      );

      final result = await callable.call({
        'storeId': widget.storeId,
      });

      final rawData = result.data;

      final Map<String, dynamic> data = rawData is Map
          ? Map<String, dynamic>.from(rawData)
          : <String, dynamic>{};

      final rawCounts = data['counts'];

      final Map<String, dynamic> counts = rawCounts is Map
          ? Map<String, dynamic>.from(rawCounts)
          : <String, dynamic>{};

      final rawKeep = data['keep'];

      final Map<String, dynamic> keep = rawKeep is Map
          ? Map<String, dynamic>.from(rawKeep)
          : <String, dynamic>{};

      List<Map<String, dynamic>> toMapList(dynamic value) {
        if (value is! List) {
          return [];
        }

        return value
            .whereType<Map>()
            .map(
              (item) => Map<String, dynamic>.from(item),
        )
            .toList();
      }

      final daily = toMapList(keep['daily']);
      final weekly = toMapList(keep['weekly']);
      final monthly = toMapList(keep['monthly']);
      final deleteCandidates = toMapList(
        data['deleteCandidates'],
      );

      // -----------------------------------------------------------------------
      // LOG COMPLETO PARA VALIDAÇÃO DA F5.6
      // -----------------------------------------------------------------------

      debugPrint('');
      debugPrint(
        '============================================================',
      );
      debugPrint(
        'F5.6 — DRY RUN REAL DA RETENÇÃO',
      );
      debugPrint(
        '============================================================',
      );

      debugPrint('storeId: ${data['storeId']}');
      debugPrint('dryRun: ${data['dryRun']}');
      debugPrint('totalSnapshots: ${data['totalSnapshots']}');

      debugPrint('');
      debugPrint('CONTADORES:');
      debugPrint('eligible: ${counts['eligible']}');
      debugPrint('keepDaily: ${counts['keepDaily']}');
      debugPrint('keepWeekly: ${counts['keepWeekly']}');
      debugPrint('keepMonthly: ${counts['keepMonthly']}');
      debugPrint('keepTotal: ${counts['keepTotal']}');
      debugPrint(
        'deleteCandidates: ${counts['deleteCandidates']}',
      );

      void printGroup(
          String title,
          List<Map<String, dynamic>> backups,
          ) {
        debugPrint('');
        debugPrint(title);

        if (backups.isEmpty) {
          debugPrint('  nenhum');
          return;
        }

        for (final backup in backups) {
          debugPrint(
            '  ${backup['createdAt']}'
                ' | ${backup['backupId']}'
                ' | week=${backup['weekKey']}'
                ' | month=${backup['monthKey']}',
          );
        }
      }

      printGroup(
        '📅 DAILY',
        daily,
      );

      printGroup(
        '📆 WEEKLY',
        weekly,
      );

      printGroup(
        '🗓️ MONTHLY',
        monthly,
      );

      printGroup(
        '🗑️ DELETE CANDIDATES — SOMENTE PREVIEW',
        deleteCandidates,
      );

      debugPrint('');
      debugPrint(
        '============================================================',
      );
      debugPrint(
        '✅ DRY RUN FINALIZADO — NENHUM BACKUP FOI EXCLUÍDO',
      );
      debugPrint(
        '============================================================',
      );
      debugPrint('');

      if (!mounted) {
        return;
      }

      showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text(
              'Preview da Retenção',
            ),
            content: Text(
              'Dry run concluído.\n\n'
                  'Snapshots encontrados: '
                  '${data['totalSnapshots'] ?? 0}\n'
                  'Elegíveis: ${counts['eligible'] ?? 0}\n\n'
                  'Mantidos:\n'
                  '• Diários: ${counts['keepDaily'] ?? 0}\n'
                  '• Semanais: ${counts['keepWeekly'] ?? 0}\n'
                  '• Mensais: ${counts['keepMonthly'] ?? 0}\n\n'
                  'Candidatos à exclusão: '
                  '${counts['deleteCandidates'] ?? 0}\n\n'
                  'Nenhum backup foi excluído.',
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(
                    dialogContext,
                  ).pop();
                },
                child: const Text('OK'),
              ),
            ],
          );
        },
      );
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message ??
                'Não foi possível consultar a retenção.',
          ),
          backgroundColor: Colors.red,
        ),
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Erro ao consultar retenção: $e',
          ),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingBackupRetention = false;
        });
      }
    }
  }

  // ===========================================================================
  // ALTERAR SENHA
  // ===========================================================================

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
                TextFormField(
                  controller: currentPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Senha Atual'),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Campo obrigatório';
                    }

                    return null;
                  },
                ),

                TextFormField(
                  controller: newPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Nova Senha'),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Campo obrigatório';
                    }

                    if (value.length < 6) {
                      return 'A senha deve ter no mínimo 6 caracteres.';
                    }

                    return null;
                  },
                ),

                TextFormField(
                  controller: confirmPasswordController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Confirmar Nova Senha',
                  ),
                  validator: (value) {
                    if (value != newPasswordController.text) {
                      return 'As senhas não coincidem.';
                    }

                    return null;
                  },
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
            },
            child: const Text('Cancelar'),
          ),

          ElevatedButton(
            child: const Text('Salvar'),
            onPressed: () async {
              if (!formKey.currentState!.validate()) {
                return;
              }

              final user = FirebaseAuth.instance.currentUser;

              if (user == null || user.email == null) {
                return;
              }

              final cred = EmailAuthProvider.credential(
                email: user.email!,
                password: currentPasswordController.text,
              );

              try {
                await user.reauthenticateWithCredential(cred);

                await user.updatePassword(newPasswordController.text);

                if (context.mounted) {
                  Navigator.of(ctx).pop();

                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Senha alterada com sucesso!'),
                      backgroundColor: Colors.green,
                    ),
                  );
                }
              } on FirebaseAuthException catch (e) {
                String errorMessage = 'Ocorreu um erro.';

                if (e.code == 'wrong-password') {
                  errorMessage = 'A senha atual está incorreta.';
                } else if (e.code == 'weak-password') {
                  errorMessage = 'A nova senha é muito fraca.';
                }

                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(errorMessage),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              }
            },
          ),
        ],
      ),
    );
  }

  // ===========================================================================
  // ALTERAR E-MAIL
  // ===========================================================================

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
                TextFormField(
                  controller: newEmailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: const InputDecoration(labelText: 'Novo E-mail'),
                  validator: (value) {
                    if (value == null || !value.contains('@')) {
                      return 'Insira um e-mail válido.';
                    }

                    return null;
                  },
                ),

                TextFormField(
                  controller: passwordController,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Senha Atual'),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Campo obrigatório';
                    }

                    return null;
                  },
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
            },
            child: const Text('Cancelar'),
          ),

          ElevatedButton(
            child: const Text('Salvar'),
            onPressed: () async {
              if (!formKey.currentState!.validate()) {
                return;
              }

              final user = FirebaseAuth.instance.currentUser;

              if (user == null || user.email == null) {
                return;
              }

              final cred = EmailAuthProvider.credential(
                email: user.email!,
                password: passwordController.text,
              );

              try {
                await user.reauthenticateWithCredential(cred);

                await user.verifyBeforeUpdateEmail(newEmailController.text);

                if (context.mounted) {
                  Navigator.of(ctx).pop();

                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Link de verificação enviado para o novo e-mail!',
                      ),
                      backgroundColor: Colors.green,
                    ),
                  );
                }
              } on FirebaseAuthException catch (e) {
                String errorMessage = 'Ocorreu um erro.';

                if (e.code == 'wrong-password') {
                  errorMessage = 'A senha está incorreta.';
                } else if (e.code == 'email-already-in-use') {
                  errorMessage =
                      'Este e-mail já está sendo usado por outra conta.';
                } else if (e.code == 'invalid-email') {
                  errorMessage = 'O novo e-mail fornecido é inválido.';
                }

                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(errorMessage),
                      backgroundColor: Colors.red,
                    ),
                  );
                }
              }
            },
          ),
        ],
      ),
    );
  }

  // ===========================================================================
  // BUILD
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil e Segurança')),

      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16.0),
              children: [
                // =============================================================
                // DADOS DA LOJA
                // =============================================================
                _buildSectionHeader('Dados da Loja', Icons.store),

                const SizedBox(height: 8),

                Card(
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        children: [
                          TextFormField(
                            controller: _nameController,
                            decoration: const InputDecoration(
                              labelText: 'Nome da Loja / Razão Social',
                            ),
                            validator: (value) {
                              if (value == null || value.trim().isEmpty) {
                                return 'Este campo é obrigatório.';
                              }

                              return null;
                            },
                          ),

                          const SizedBox(height: 16),

                          TextFormField(
                            controller: _documentController,
                            readOnly: true,
                            decoration: const InputDecoration(
                              labelText: 'CPF / CNPJ',
                              helperText:
                                  'O CPF/CNPJ não pode ser alterado após o cadastro.',
                              suffixIcon: Icon(Icons.lock_outline),
                            ),
                            keyboardType: TextInputType.number,
                          ),

                          const SizedBox(height: 16),

                          TextFormField(
                            controller: _phoneController,
                            decoration: const InputDecoration(
                              labelText: 'Telefone / WhatsApp',
                            ),
                            keyboardType: TextInputType.phone,
                          ),

                          const SizedBox(height: 24),

                          ElevatedButton(
                            style: ElevatedButton.styleFrom(
                              minimumSize: const Size(double.infinity, 45),
                            ),
                            onPressed: _isSaving ? null : _saveProfile,
                            child: _isSaving
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Salvar Dados do Perfil'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 24),

                // =============================================================
                // SEGURANÇA DA CONTA
                // =============================================================
                _buildSectionHeader(
                  'Segurança da Conta',
                  Icons.security_rounded,
                ),

                const SizedBox(height: 8),

                Card(
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    children: [
                      ListTile(
                        leading: const Icon(Icons.email_outlined),
                        title: const Text('E-mail de Login'),
                        subtitle: Text(
                          FirebaseAuth.instance.currentUser?.email ??
                              'Não foi possível carregar o e-mail',
                        ),
                      ),

                      ListTile(
                        leading: const Icon(Icons.password),
                        title: const Text('Alterar Senha'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () {
                          _showChangePasswordDialog(context);
                        },
                      ),

                      const Divider(height: 1, indent: 16, endIndent: 16),

                      ListTile(
                        leading: const Icon(Icons.alternate_email),
                        title: const Text('Alterar E-mail'),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () {
                          _showChangeEmailDialog(context);
                        },
                      ),
                    ],
                  ),
                ),

                // =============================================================
                // BACKUP E RECUPERAÇÃO — SOMENTE ADMIN
                // =============================================================
                if (_isAdmin) ...[
                  const SizedBox(height: 24),

                  _buildSectionHeader(
                    'Backup e Recuperação',
                    Icons.backup_outlined,
                  ),

                  const SizedBox(height: 8),

                  Card(
                    elevation: 2,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const Text(
                            'Proteja os dados da sua loja criando '
                            'uma cópia de segurança.',
                          ),

                          const SizedBox(height: 16),

                          ElevatedButton.icon(
                            onPressed: _isCreatingBackup
                                ? null
                                : _createStoreBackup,
                            icon: _isCreatingBackup
                                ? const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.cloud_upload_outlined),
                            label: Text(
                              _isCreatingBackup
                                  ? 'Criando backup...'
                                  : 'Criar Backup Agora',
                            ),
                          ),
                          const SizedBox(height: 12),

                          OutlinedButton.icon(
                            onPressed: _isCheckingBackupRetention
                                ? null
                                : _previewBackupRetention,
                            icon: _isCheckingBackupRetention
                                ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                                : const Icon(
                              Icons.policy_outlined,
                            ),
                            label: Text(
                              _isCheckingBackupRetention
                                  ? 'Analisando retenção...'
                                  : 'Testar Política de Retenção',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
    );
  }

  // ===========================================================================
  // CABEÇALHO DAS SEÇÕES
  // ===========================================================================

  Widget _buildSectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, color: Theme.of(context).primaryColor),

        const SizedBox(width: 8),

        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}
