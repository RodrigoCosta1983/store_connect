// ============================================================================
// STORE CONNECT - SETTINGS / PROTEÇÃO DO MÓDULO FISCAL
// ============================================================================
//
// Arquivo:
//   lib/screens/settings_screen.dart
//
// Objetivo:
//   Centralizar as configurações da loja e proteger o acesso à área fiscal.
//
// Proteção fiscal:
//   - o acesso à FiscalSettingsScreen exige autenticação local do aparelho;
//   - usa local_auth, já presente no pubspec do projeto;
//   - não exige senha Firebase para abrir a tela;
//   - funciona independentemente de login por senha ou Google;
//   - não altera a sessão Firebase e evita reconstruções do Auth Gate causadas
//     por reauthenticateWithCredential apenas para abrir a tela;
//   - se o usuário cancelar ou falhar a autenticação, a tela fiscal não abre.
//
// Segurança:
//   Este gate protege a interface local, mas NÃO substitui as validações das
//   Cloud Functions. O backend deve continuar validando uid, storeId, plano,
//   permissões e credenciais antes de qualquer operação fiscal crítica.
//
// Web:
//   local_auth é um mecanismo de autenticação local de dispositivo. No Web,
//   esta implementação não libera automaticamente a tela; exibe uma mensagem
//   informando que a confirmação protegida está disponível no aplicativo.
//
// Manutenção:
//   Se futuramente quisermos exigir reautenticação Firebase em uma ação de
//   alto risco (por exemplo, substituir token de produção), isso deve ser feito
//   na ação específica, tratando corretamente password/google.com.
//
// ============================================================================

// lib/screens/settings_screen.dart

import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:image_picker/image_picker.dart';
import 'package:local_auth/local_auth.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:store_connect/providers/theme_provider.dart';
import 'package:store_connect/providers/user_role_provider.dart';
import 'package:store_connect/screens/fiscal/fiscal_settings_screen.dart';
import 'package:store_connect/screens/profile/profile_screen.dart';

import 'employees/employees_screen.dart';
import 'finance/invoices_screen.dart';

class SettingsScreen extends StatefulWidget {
  final String storeId;

  const SettingsScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  // ===========================================================================
  // ESTADO GERAL
  // ===========================================================================

  final _storage = const FlutterSecureStorage();

  bool _isLoading = true;
  bool _biometricEnabled = false;

  final LocalAuthentication _localAuth = LocalAuthentication();
  bool _isValidatingFiscalAccess = false;

  // ===========================================================================
  // DADOS DA LOJA
  // ===========================================================================

  String? _storeLogoUrl;
  String? _storeName;

  // ===========================================================================
  // ASSINATURA / PLANO
  //
  // Usaremos estes campos para liberar o módulo Fiscal somente para Business.
  // ===========================================================================

  String _subscriptionType = 'free';
  String _subscriptionStatus = 'inactive';

  bool get _isBusiness =>
      _subscriptionType == 'business' &&
          _subscriptionStatus == 'active';

  // ===========================================================================
  // INIT
  // ===========================================================================

  @override
  void initState() {
    super.initState();

    _loadSettings();
    _loadStoreInfo();
  }

  // ===========================================================================
  // CARREGA DADOS DA LOJA
  //
  // Além do nome e logo, agora carrega o plano atual.
  // ===========================================================================

  Future<void> _loadStoreInfo() async {
    try {
      final doc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();

      if (!doc.exists) {
        return;
      }

      final data = doc.data() as Map<String, dynamic>;

      if (!mounted) return;

      setState(() {
        _storeName = data['name']?.toString();
        _storeLogoUrl = data['logoUrl']?.toString();

        _subscriptionType =
            data['subscriptionType']?.toString() ?? 'free';

        _subscriptionStatus =
            data['subscriptionStatus']?.toString() ?? 'inactive';
      });

      debugPrint('=== 🧾 SETTINGS / PLANO ===');
      debugPrint('Loja: $_storeName');
      debugPrint('Tipo: $_subscriptionType');
      debugPrint('Status: $_subscriptionStatus');
      debugPrint('Business: $_isBusiness');
      debugPrint('===========================');
    } catch (e) {
      debugPrint(
        '❌ Erro ao carregar dados da loja: $e',
      );
    }
  }

  // ===========================================================================
  // ATUALIZA LOGO
  // ===========================================================================

  Future<void> _updateStoreLogo() async {
    final pickedImage = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 50,
    );

    if (pickedImage == null) return;

    setState(() => _isLoading = true);

    try {
      final ref = FirebaseStorage.instance.ref(
        'store_logos/${widget.storeId}/logo.jpg',
      );

      await ref.putFile(
        File(pickedImage.path),
      );

      final newUrl =
      await ref.getDownloadURL();

      await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .update({
        'logoUrl': newUrl,
      });

      if (mounted) {
        setState(() {
          _storeLogoUrl = newUrl;
        });
      }
    } catch (e) {
      debugPrint(
        'Erro ao subir logo: $e',
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ===========================================================================
  // CONFIGURAÇÕES LOCAIS
  // ===========================================================================

  Future<void> _loadSettings() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final pref =
      await _storage.read(
        key: 'biometricsEnabled',
      );

      if (mounted) {
        setState(() {
          _biometricEnabled =
              pref == 'true';
        });
      }
    } catch (e) {
      debugPrint(
        '⚠️ Erro crítico no SecureStorage '
            '(resetando dados): $e',
      );

      try {
        await _storage.deleteAll();
      } catch (_) {}

      if (mounted) {
        setState(() {
          _biometricEnabled = false;
        });
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
  // BIOMETRIA
  // ===========================================================================

  Future<void> _saveBiometricPreference(
      bool value,
      ) async {
    try {
      final hasCredentials =
          await _storage.read(
            key: 'email',
          ) !=
              null;

      if (value && !hasCredentials) {
        if (!mounted) return;

        ScaffoldMessenger.of(context)
            .showSnackBar(
          const SnackBar(
            content: Text(
              'Para ativar, faça login uma vez com a opção '
                  '"Lembrar dados" marcada.',
            ),
            backgroundColor:
            Colors.orange,
          ),
        );

        return;
      }

      await _storage.write(
        key: 'biometricsEnabled',
        value: value.toString(),
      );

      if (!mounted) return;

      setState(() {
        _biometricEnabled = value;
      });

      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            value
                ? 'Acesso com biometria ativado.'
                : 'Acesso com biometria desativado.',
          ),
          backgroundColor:
          Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context)
          .showSnackBar(
        const SnackBar(
          content: Text(
            'Erro ao salvar preferência. '
                'Tente reinstalar o app.',
          ),
        ),
      );
    }
  }

  // ===========================================================================
  // PAGAMENTOS DA LOJA
  // ===========================================================================

  void _openPayments() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (ctx) =>
            PaymentSettingsScreen(
              storeId: widget.storeId,
            ),
      ),
    );
  }

  // ===========================================================================
  // ASSINATURA
  //
  // Mantido para preservar a lógica existente do projeto.
  // ===========================================================================

  Future<void> _openMySubscription() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final storeDoc =
      await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();

      final storeData =
      storeDoc.data()
      as Map<String, dynamic>?;

      final asaasCustomerId =
      storeData?['asaasCustomerId']
      as String?;

      final trialEndDateStr =
      storeData?['trialEndDate']
      as String?;

      if (asaasCustomerId != null &&
          asaasCustomerId.isNotEmpty) {
        await _callFinanceFunction(
          'getAsaasPortalUrl',
        );
      } else {
        setState(() {
          _isLoading = false;
        });

        _showTrialPopup(
          trialEndDateStr,
        );
      }
    } catch (e) {
      debugPrint(
        'Erro ao verificar status da loja: $e',
      );

      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(
          const SnackBar(
            content: Text(
              'Erro ao acessar dados da loja. '
                  'Tente novamente.',
            ),
            backgroundColor:
            Colors.red,
          ),
        );

        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ===========================================================================
  // POPUP DO TRIAL
  // ===========================================================================

  void _showTrialPopup(
      String? trialEndString,
      ) {
    String formattedDate =
        'alguns dias';

    if (trialEndString != null &&
        trialEndString.isNotEmpty) {
      try {
        // Remove eventual espaço vindo de registros antigos.
        var normalized =
        trialEndString.trim();

        // Compatibilidade com datas antigas contendo 6 casas decimais.
        normalized =
            normalized.replaceFirstMapped(
              RegExp(r'(\.\d{3})\d+'),
                  (match) =>
              match.group(1)!,
            );

        final date =
        DateTime.parse(
          normalized,
        );

        formattedDate =
        '${date.day.toString().padLeft(2, '0')}/'
            '${date.month.toString().padLeft(2, '0')}/'
            '${date.year}';
      } catch (_) {}
    }

    showDialog(
      context: context,
      builder: (ctx) =>
          AlertDialog(
            shape:
            RoundedRectangleBorder(
              borderRadius:
              BorderRadius.circular(16),
            ),
            title: const Row(
              children: [
                Text(
                  '🎉 ',
                  style: TextStyle(
                    fontSize: 24,
                  ),
                ),
                Expanded(
                  child: Text(
                    'Período de Testes!',
                    style: TextStyle(
                      fontWeight:
                      FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            content: Text(
              'Fique tranquilo, você ainda tem acesso gratuito '
                  'ao Store&Connect até o dia $formattedDate. '
                  'Não é necessário realizar nenhum pagamento agora.\n\n'
                  'Mas, se você já quiser deixar sua assinatura ativa '
                  'e garantir que sua loja não tenha nenhuma interrupção '
                  'após o fim do teste, você pode gerar sua assinatura '
                  'agora mesmo.',
              style: const TextStyle(
                fontSize: 15,
              ),
            ),
            actionsAlignment:
            MainAxisAlignment.center,
            actionsPadding:
            const EdgeInsets.only(
              bottom: 20,
              left: 16,
              right: 16,
            ),
            actions: [
              Column(
                crossAxisAlignment:
                CrossAxisAlignment.stretch,
                children: [
                  ElevatedButton(
                    style:
                    ElevatedButton.styleFrom(
                      backgroundColor:
                      Colors.red.shade700,
                      foregroundColor:
                      Colors.white,
                      padding:
                      const EdgeInsets
                          .symmetric(
                        vertical: 14,
                      ),
                      shape:
                      RoundedRectangleBorder(
                        borderRadius:
                        BorderRadius.circular(
                          8,
                        ),
                      ),
                    ),
                    onPressed: () {
                      Navigator.of(ctx)
                          .pop();

                      _callFinanceFunction(
                        'createAsaasSubscription',
                      );
                    },
                    child: const Text(
                      'Quero Assinar Agora 🚀',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight:
                        FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(
                    height: 8,
                  ),
                  TextButton(
                    style:
                    TextButton.styleFrom(
                      foregroundColor:
                      Colors.grey.shade700,
                    ),
                    onPressed: () =>
                        Navigator.of(ctx)
                            .pop(),
                    child: const Text(
                      'Entendi, vou continuar testando',
                      style: TextStyle(
                        fontSize: 15,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
    );
  }

  // ===========================================================================
  // CLOUD FUNCTIONS FINANCEIRAS
  // ===========================================================================

  Future<void> _callFinanceFunction(
      String functionName,
      ) async {
    setState(() {
      _isLoading = true;
    });

    try {
      await FirebaseAuth
          .instance.currentUser
          ?.getIdToken(true);

      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(
          const SnackBar(
            content: Text(
              'O banco está gerando seu boleto. '
                  'Isso pode levar alguns segundos...',
            ),
            duration:
            Duration(seconds: 10),
          ),
        );
      }

      final HttpsCallable callable =
      FirebaseFunctions.instance
          .httpsCallable(
        functionName,
      );

      final response =
      await callable.call(
        <String, dynamic>{
          'storeId': widget.storeId,
        },
      );

      final portalUrl =
      response.data['portalUrl']
      as String?;

      if (portalUrl != null &&
          portalUrl.isNotEmpty) {
        final uri =
        Uri.parse(portalUrl);

        try {
          await launchUrl(
            uri,
            mode: LaunchMode
                .externalApplication,
          );
        } catch (e) {
          throw 'O celular impediu a abertura '
              'do navegador: $e';
        }
      } else {
        throw 'URL não retornada pelo servidor.';
      }
    } catch (e) {
      debugPrint(
        'Erro na função $functionName: $e',
      );

      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(
          const SnackBar(
            content: Text(
              'Erro ao acessar o portal financeiro. '
                  'Tente novamente.',
            ),
            backgroundColor:
            Colors.red,
          ),
        );
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
  // MODAL DE TEMA
  //
  // RESTAURADO A PARTIR DO CÓDIGO ANTIGO.
  // ===========================================================================

  void _showThemeDialog() {
    final themeProvider =
    Provider.of<ThemeProvider>(
      context,
      listen: false,
    );

    showDialog(
      context: context,
      builder: (ctx) =>
          AlertDialog(
            title: const Text(
              'Escolher Tema',
            ),
            content: Column(
              mainAxisSize:
              MainAxisSize.min,
              children: [
                RadioListTile<ThemeMode>(
                  title:
                  const Text('Claro'),
                  value: ThemeMode.light,
                  groupValue:
                  themeProvider.themeMode,
                  onChanged: (value) {
                    if (value != null) {
                      themeProvider
                          .setTheme(value);
                    }

                    Navigator.of(ctx)
                        .pop();
                  },
                ),
                RadioListTile<ThemeMode>(
                  title:
                  const Text('Escuro'),
                  value: ThemeMode.dark,
                  groupValue:
                  themeProvider.themeMode,
                  onChanged: (value) {
                    if (value != null) {
                      themeProvider
                          .setTheme(value);
                    }

                    Navigator.of(ctx)
                        .pop();
                  },
                ),
                RadioListTile<ThemeMode>(
                  title: const Text(
                    'Padrão do Sistema',
                  ),
                  value: ThemeMode.system,
                  groupValue:
                  themeProvider.themeMode,
                  onChanged: (value) {
                    if (value != null) {
                      themeProvider
                          .setTheme(value);
                    }

                    Navigator.of(ctx)
                        .pop();
                  },
                ),
              ],
            ),
          ),
    );
  }

  // ===========================================================================
  // MODAL DE CONFIGURAÇÃO DE ESTOQUE
  //
  // RESTAURADO A PARTIR DO CÓDIGO ANTIGO.
  // ===========================================================================

  void _showStockSettingsDialog() {
    showDialog(
      context: context,
      builder: (ctx) {
        final stockController =
        TextEditingController();

        final expiryController =
        TextEditingController();

        return FutureBuilder<
            DocumentSnapshot>(
          future:
          FirebaseFirestore.instance
              .collection('stores')
              .doc(widget.storeId)
              .get(),
          builder: (context, snap) {
            if (snap.connectionState ==
                ConnectionState.waiting) {
              return const AlertDialog(
                content: SizedBox(
                  height: 80,
                  child: Center(
                    child:
                    CircularProgressIndicator(),
                  ),
                ),
              );
            }

            int currentStock = 5;
            int currentExpiry = 30;

            if (snap.hasData &&
                snap.data!.exists) {
              final data =
              snap.data!.data()
              as Map<String,
                  dynamic>?;

              if (data != null) {
                currentStock =
                    (data['lowStockThreshold']
                    as num? ??
                        5)
                        .toInt();

                currentExpiry =
                    (data['expiryThreshold']
                    as num? ??
                        30)
                        .toInt();
              }
            }

            stockController.text =
                currentStock.toString();

            expiryController.text =
                currentExpiry.toString();

            return AlertDialog(
              title: const Text(
                'Alertas de Estoque',
              ),
              content: Column(
                mainAxisSize:
                MainAxisSize.min,
                children: [
                  TextField(
                    controller:
                    stockController,
                    keyboardType:
                    TextInputType
                        .number,
                    decoration:
                    const InputDecoration(
                      labelText:
                      'Alertar estoque baixo (≤)',
                    ),
                  ),
                  const SizedBox(
                    height: 12,
                  ),
                  TextField(
                    controller:
                    expiryController,
                    keyboardType:
                    TextInputType
                        .number,
                    decoration:
                    const InputDecoration(
                      labelText:
                      'Alertar validade faltando (dias)',
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () =>
                      Navigator.of(ctx)
                          .pop(),
                  child: const Text(
                    'Cancelar',
                  ),
                ),
                ElevatedButton(
                  onPressed: () async {
                    final newStock =
                    int.tryParse(
                      stockController.text,
                    );

                    final newExpiry =
                    int.tryParse(
                      expiryController.text,
                    );

                    if (newStock == null ||
                        newExpiry == null) {
                      ScaffoldMessenger.of(
                        context,
                      ).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Informe valores válidos.',
                          ),
                          backgroundColor:
                          Colors.red,
                        ),
                      );

                      return;
                    }

                    await FirebaseFirestore
                        .instance
                        .collection('stores')
                        .doc(widget.storeId)
                        .set(
                      {
                        'lowStockThreshold':
                        newStock,
                        'expiryThreshold':
                        newExpiry,
                      },
                      SetOptions(
                        merge: true,
                      ),
                    );

                    if (!ctx.mounted) {
                      return;
                    }

                    Navigator.of(ctx)
                        .pop();

                    if (!context.mounted) {
                      return;
                    }

                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Configurações salvas!',
                        ),
                        backgroundColor:
                        Colors.green,
                      ),
                    );
                  },
                  child: const Text(
                    'Salvar',
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  // ===========================================================================
  // ACESSO PROTEGIDO À CONFIGURAÇÃO FISCAL
  // ===========================================================================

  Future<void> _openFiscalSettingsProtected() async {
    if (_isValidatingFiscalAccess) {
      return;
    }

    if (kIsWeb) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'A confirmação protegida da área fiscal está disponível '
                'no aplicativo instalado.',
          ),
          backgroundColor: Colors.orange,
        ),
      );

      return;
    }

    setState(() {
      _isValidatingFiscalAccess = true;
    });

    try {
      final canCheckBiometrics = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();

      if (!canCheckBiometrics && !isDeviceSupported) {
        if (!mounted) return;

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Este aparelho não possui um método de autenticação '
                  'local configurado.',
            ),
            backgroundColor: Colors.orange,
          ),
        );

        return;
      }

      final authenticated = await _localAuth.authenticate(
        localizedReason:
        'Confirme sua identidade para acessar as configurações fiscais.',
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
          useErrorDialogs: true,
        ),
      );

      if (!authenticated || !mounted) {
        return;
      }

      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (ctx) => FiscalSettingsScreen(
            storeId: widget.storeId,
          ),
        ),
      );
    } catch (e) {
      debugPrint(
        '❌ Erro ao autenticar acesso fiscal: $e',
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Não foi possível confirmar sua identidade. '
                'A área fiscal continua bloqueada.',
          ),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isValidatingFiscalAccess = false;
        });
      }
    }
  }

  // ===========================================================================
  // BUILD
  // ===========================================================================

  @override
  Widget build(
      BuildContext context,
      ) {
    final themeProvider =
    Provider.of<ThemeProvider>(
      context,
    );

    final authProvider =
    Provider.of<UserRoleProvider>(
      context,
    );

    String currentThemeName;

    switch (themeProvider.themeMode) {
      case ThemeMode.light:
        currentThemeName =
        'Claro';
        break;

      case ThemeMode.dark:
        currentThemeName =
        'Escuro';
        break;

      default:
        currentThemeName =
        'Padrão do Sistema';
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Configurações',
        ),
      ),

      body: _isLoading
          ? const Center(
        child:
        CircularProgressIndicator(),
      )
          : Center(
        child: ConstrainedBox(
          constraints:
          const BoxConstraints(
            maxWidth: 700,
          ),
          child: ListView(
            children: [
              // =========================================================
              // MINHA CONTA
              // =========================================================

              ListTile(
                leading:
                const Icon(
                  Icons
                      .person_outline,
                ),
                title:
                const Text(
                  'Minha Conta',
                ),
                subtitle:
                const Text(
                  'Editar perfil e alterar senha',
                ),
                onTap: () =>
                    Navigator.of(
                      context,
                    ).push(
                      MaterialPageRoute(
                        builder: (ctx) =>
                            ProfileScreen(
                              storeId:
                              widget
                                  .storeId,
                            ),
                      ),
                    ),
              ),

              // =========================================================
              // ASSINATURA
              //
              // SOMENTE ADMIN.
              // =========================================================

              if (authProvider.isAdmin) ...[
                ListTile(
                  leading:
                  const Icon(
                    Icons
                        .receipt_long_outlined,
                    color:
                    Colors.blue,
                  ),
                  title:
                  const Text(
                    'Minha Assinatura / 2ª Via',
                  ),
                  subtitle:
                  const Text(
                    'Acessar faturas ou gerenciar plano',
                  ),
                  trailing:
                  const Icon(
                    Icons
                        .chevron_right,
                  ),
                  onTap: () {
                    Navigator.of(
                      context,
                    ).push(
                      MaterialPageRoute(
                        builder:
                            (ctx) =>
                            InvoicesScreen(
                              storeId:
                              widget
                                  .storeId,
                            ),
                      ),
                    );
                  },
                ),

                const Divider(),
              ],

              // =========================================================
              // FUNCIONÁRIOS / PAGAMENTOS
              //
              // ADMIN E GERENTE.
              // =========================================================

              if (authProvider
                  .canAccessSettings) ...[
                ListTile(
                  leading:
                  const Icon(
                    Icons.people_alt,
                    color:
                    Colors.blue,
                  ),
                  title:
                  const Text(
                    'Gerenciar Funcionários',
                  ),
                  subtitle:
                  const Text(
                    'Adicionar caixas e vendedores',
                  ),
                  trailing:
                  const Icon(
                    Icons
                        .chevron_right,
                  ),
                  onTap: () {
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder:
                            (context) =>
                            EmployeesScreen(
                              storeId:
                              widget
                                  .storeId,
                            ),
                      ),
                    );
                  },
                ),

                const Divider(),

                ListTile(
                  leading:
                  const Icon(
                    Icons
                        .payment_outlined,
                  ),
                  title:
                  const Text(
                    'Pagamentos da Loja',
                  ),
                  subtitle:
                  const Text(
                    'Configurar meios de pagamento e vendas',
                  ),
                  trailing:
                  const Icon(
                    Icons
                        .chevron_right,
                  ),
                  onTap:
                  _openPayments,
                ),

                const Divider(),
              ],

              // =========================================================
              // SEGURANÇA
              // =========================================================

              const Padding(
                padding:
                EdgeInsets
                    .symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                child: Text(
                  'Segurança',
                  style:
                  TextStyle(
                    fontWeight:
                    FontWeight
                        .bold,
                    fontSize: 16,
                  ),
                ),
              ),

              if (!kIsWeb)
                SwitchListTile(
                  title:
                  const Text(
                    'Acesso com Biometria',
                  ),
                  subtitle:
                  const Text(
                    'Use sua digital ou rosto para entrar no app.',
                  ),
                  value:
                  _biometricEnabled,
                  onChanged:
                  _saveBiometricPreference,
                  secondary:
                  const Icon(
                    Icons
                        .fingerprint,
                  ),
                ),

              const Divider(),

              // =========================================================
              // APARÊNCIA
              // =========================================================

              const Padding(
                padding:
                EdgeInsets
                    .symmetric(
                  horizontal: 16,
                  vertical: 8,
                ),
                child: Text(
                  'Aparência',
                  style:
                  TextStyle(
                    fontWeight:
                    FontWeight
                        .bold,
                    fontSize: 16,
                  ),
                ),
              ),

              ListTile(
                title:
                const Text(
                  'Tema do Aplicativo',
                ),
                subtitle: Text(
                  currentThemeName,
                ),
                trailing:
                const Icon(
                  Icons
                      .palette_outlined,
                ),

                // Código original restaurado.
                onTap:
                _showThemeDialog,
              ),

              const Divider(),

              // =========================================================
              // ESTOQUE
              //
              // ADMIN E GERENTE.
              // =========================================================

              if (authProvider
                  .canAccessSettings) ...[
                const Padding(
                  padding:
                  EdgeInsets
                      .symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  child: Text(
                    'Estoque',
                    style:
                    TextStyle(
                      fontWeight:
                      FontWeight
                          .bold,
                      fontSize: 16,
                    ),
                  ),
                ),

                ListTile(
                  leading:
                  const Icon(
                    Icons
                        .inventory_2_outlined,
                  ),
                  title:
                  const Text(
                    'Configurações de Estoque',
                  ),
                  subtitle:
                  const Text(
                    'Definir limites de alerta '
                        '(baixa quantidade e validade)',
                  ),
                  trailing:
                  const Icon(
                    Icons
                        .chevron_right,
                  ),

                  // Código original restaurado.
                  onTap:
                  _showStockSettingsDialog,
                ),
              ],

              // =========================================================
              // FISCAL
              //
              // EXCLUSIVO BUSINESS ATIVO
              // + usuário com permissão administrativa.
              // =========================================================

              if (authProvider
                  .canAccessSettings &&
                  _isBusiness) ...[
                const Divider(),

                const Padding(
                  padding:
                  EdgeInsets
                      .symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  child: Text(
                    'Fiscal',
                    style:
                    TextStyle(
                      fontWeight:
                      FontWeight
                          .bold,
                      fontSize: 16,
                    ),
                  ),
                ),

                ListTile(
                  leading:
                  const Icon(
                    Icons
                        .receipt_long_outlined,
                  ),
                  title:
                  const Text(
                    'NFC-e e Configuração Fiscal',
                  ),
                  subtitle:
                  const Text(
                    'Dados fiscais, certificado digital '
                        'e emissão de notas',
                  ),
                  trailing: _isValidatingFiscalAccess
                      ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                      : const Icon(Icons.chevron_right),
                  onTap: _isValidatingFiscalAccess
                      ? null
                      : _openFiscalSettingsProtected,
                ),
              ],

              const SizedBox(
                height: 30,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ===========================================================================
// CONFIGURAÇÕES DE PAGAMENTO DA LOJA
// ===========================================================================

class PaymentSettingsScreen
    extends StatefulWidget {
  final String storeId;

  const PaymentSettingsScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<PaymentSettingsScreen>
  createState() =>
      _PaymentSettingsScreenState();
}

class _PaymentSettingsScreenState
    extends State<
        PaymentSettingsScreen> {
  bool _isLoading = true;

  String? _pixQrCodeUrl;
  String? _pixQrCodePath;

  bool _fiadoEnabled = false;

  @override
  void initState() {
    super.initState();

    _loadAll();
  }

  @override
  void dispose() {
    super.dispose();
  }

  // =========================================================================
  // CARREGA DADOS
  // =========================================================================

  Future<void> _loadAll() async {
    setState(() {
      _isLoading = true;
    });

    await Future.wait([
      _loadPixQrCodeUrl(),
      _loadSalesSettings(),
    ]);

    if (mounted) {
      setState(() {
        _isLoading = false;
      });
    }
  }

  // =========================================================================
  // PIX
  // =========================================================================

  Future<void>
  _loadPixQrCodeUrl() async {
    try {
      final doc =
      await FirebaseFirestore
          .instance
          .collection('stores')
          .doc(widget.storeId)
          .get();

      if (doc.exists) {
        final data = doc.data();

        if (data != null) {
          _pixQrCodeUrl =
          data['pixQrCodeUrl']
          as String?;

          _pixQrCodePath =
          data['pixQrCodePath']
          as String?;
        }
      }
    } catch (e) {
      debugPrint(
        'Erro ao carregar pixQrCodeUrl: $e',
      );
    }
  }

  // =========================================================================
  // VENDA A CRÉDITO
  // =========================================================================

  Future<void>
  _loadSalesSettings() async {
    try {
      final prefs =
      await SharedPreferences
          .getInstance();

      _fiadoEnabled =
          prefs.getBool(
            'fiado_enabled',
          ) ??
              false;
    } catch (e) {
      debugPrint(
        'Erro ao carregar configurações '
            'de vendas: $e',
      );
    }
  }

  Future<void>
  _saveFiadoPreference(
      bool value,
      ) async {
    final prefs =
    await SharedPreferences
        .getInstance();

    await prefs.setBool(
      'fiado_enabled',
      value,
    );

    if (mounted) {
      setState(() {
        _fiadoEnabled = value;
      });
    }

    if (!mounted) return;

    ScaffoldMessenger.of(context)
        .showSnackBar(
      SnackBar(
        content: Text(
          value
              ? 'Venda a crédito habilitada'
              : 'Venda a crédito desabilitada',
        ),
        backgroundColor:
        Colors.green,
      ),
    );
  }

  // =========================================================================
  // ATUALIZA QR CODE PIX
  // =========================================================================

  Future<void>
  _updatePixQrCode() async {
    final pickedImage =
    await ImagePicker()
        .pickImage(
      source: ImageSource.gallery,
      imageQuality: 90,
    );

    if (pickedImage == null) return;

    setState(() {
      _isLoading = true;
    });

    final storesRef =
    FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId);

    String? oldUrl;
    String? oldStoragePath;

    try {
      final doc =
      await storesRef.get();

      if (doc.exists) {
        final data =
        doc.data();

        oldUrl =
        data?['pixQrCodeUrl']
        as String?;

        oldStoragePath =
        data?['pixQrCodePath']
        as String?;
      }

      final timestamp =
          DateTime.now()
              .millisecondsSinceEpoch;

      final ext =
          pickedImage.name
              .split('.')
              .last;

      final fileName =
          'qrcode_$timestamp.$ext';

      final storagePath =
          'pix_qrcodes/${widget.storeId}/$fileName';

      final storageRef =
      FirebaseStorage.instance
          .ref()
          .child(storagePath);

      final metadata =
      SettableMetadata(
        contentType:
        'image/$ext',
        cacheControl:
        'public, max-age=3600',
      );

      final bytes =
      await pickedImage
          .readAsBytes();

      await storageRef.putData(
        bytes,
        metadata,
      );

      final newUrl =
      await storageRef
          .getDownloadURL();

      await storesRef.set(
        {
          'pixQrCodeUrl':
          newUrl,
          'pixQrCodePath':
          storagePath,
          'pixQrCodeUpdatedAt':
          FieldValue
              .serverTimestamp(),
        },
        SetOptions(
          merge: true,
        ),
      );

      // =====================================================================
      // REMOVE QR CODE ANTIGO
      // =====================================================================

      if (oldStoragePath != null &&
          oldStoragePath.isNotEmpty) {
        try {
          await FirebaseStorage
              .instance
              .ref()
              .child(
            oldStoragePath,
          )
              .delete();
        } catch (_) {}
      } else if (oldUrl != null &&
          oldUrl.isNotEmpty) {
        try {
          await FirebaseStorage
              .instance
              .refFromURL(
            oldUrl,
          )
              .delete();
        } catch (_) {}
      }

      try {
        imageCache.clear();
        imageCache
            .clearLiveImages();
      } catch (_) {}

      if (!mounted) return;

      setState(() {
        _pixQrCodeUrl =
            newUrl;

        _pixQrCodePath =
            storagePath;
      });

      ScaffoldMessenger.of(context)
          .showSnackBar(
        const SnackBar(
          content: Text(
            'Imagem do PIX QR Code atualizada!',
          ),
          backgroundColor:
          Colors.green,
        ),
      );
    } catch (e) {
      debugPrint(
        'Erro ao atualizar QR Code: $e',
      );

      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(
          SnackBar(
            content: Text(
              'Erro ao atualizar imagem: $e',
            ),
            backgroundColor:
            Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // =========================================================================
  // BUILD
  // =========================================================================

  @override
  Widget build(
      BuildContext context,
      ) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Pagamentos',
        ),
      ),
      body: _isLoading
          ? const Center(
        child:
        CircularProgressIndicator(),
      )
          : Center(
        child: ConstrainedBox(
          constraints:
          const BoxConstraints(
            maxWidth: 700,
          ),
          child: ListView(
            children: [
              // =========================================================
              // PIX
              // =========================================================

              const Padding(
                padding:
                EdgeInsets
                    .symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Text(
                  'Pagamentos',
                  style:
                  TextStyle(
                    fontSize: 18,
                    fontWeight:
                    FontWeight
                        .bold,
                  ),
                ),
              ),

              ListTile(
                leading:
                CircleAvatar(
                  radius: 20,
                  backgroundColor:
                  Colors.grey
                      .shade200,
                  backgroundImage:
                  _pixQrCodeUrl !=
                      null
                      ? NetworkImage(
                    _pixQrCodeUrl!,
                  )
                      : null,
                  child:
                  _pixQrCodeUrl ==
                      null
                      ? const Icon(
                    Icons
                        .qr_code,
                    color:
                    Colors.grey,
                  )
                      : null,
                ),
                title:
                const Text(
                  'PIX QR Code',
                ),
                subtitle:
                const Text(
                  'Definir imagem para recebimentos',
                ),
                trailing:
                IconButton(
                  icon:
                  const Icon(
                    Icons
                        .edit_outlined,
                  ),
                  onPressed:
                  _updatePixQrCode,
                ),
                onTap: () {
                  showDialog(
                    context:
                    context,
                    builder:
                        (ctx) =>
                        AlertDialog(
                          title:
                          const Text(
                            'PIX QR Code',
                          ),
                          content:
                          _pixQrCodeUrl !=
                              null
                              ? Image.network(
                            _pixQrCodeUrl!,
                            fit: BoxFit
                                .contain,
                          )
                              : const Text(
                            'Nenhuma imagem de QR Code configurada.',
                          ),
                          actions: [
                            TextButton(
                              onPressed:
                                  () =>
                                  Navigator.of(
                                    ctx,
                                  ).pop(),
                              child:
                              const Text(
                                'Fechar',
                              ),
                            ),
                            ElevatedButton(
                              onPressed:
                                  () {
                                Navigator.of(
                                  ctx,
                                ).pop();

                                _updatePixQrCode();
                              },
                              child:
                              const Text(
                                'Alterar Imagem',
                              ),
                            ),
                          ],
                        ),
                  );
                },
              ),

              const Divider(),

              // =========================================================
              // VENDAS
              // =========================================================

              const Padding(
                padding:
                EdgeInsets
                    .symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Text(
                  'Vendas',
                  style:
                  TextStyle(
                    fontSize: 18,
                    fontWeight:
                    FontWeight
                        .bold,
                  ),
                ),
              ),

              SwitchListTile(
                title:
                const Text(
                  'Habilitar Venda a Crédito',
                ),
                subtitle:
                const Text(
                  'Permite registrar vendas a prazo para clientes.',
                ),
                value:
                _fiadoEnabled,
                onChanged:
                _saveFiadoPreference,
                secondary:
                const Icon(
                  Icons
                      .credit_score_outlined,
                ),
              ),

              const SizedBox(
                height: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
