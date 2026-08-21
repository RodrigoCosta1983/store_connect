/// ============================================================================
/// STORE CONNECT - CONFIGURAÇÃO FISCAL
/// ============================================================================
///
/// Arquivo:
///   lib/screens/.../fiscal_settings_screen.dart
///
/// Objetivo:
///   Gerenciar os dados fiscais da loja Business e a integração segura com
///   a Focus NFe.
///
/// Responsabilidades principais:
///   - carregar e salvar o perfil fiscal da loja;
///   - validar/cadastrar os dados da empresa na Focus NFe;
///   - exibir o estado do certificado digital;
///   - permitir a vinculação dos tokens individuais de homologação e produção;
///   - enviar os tokens somente para a Cloud Function saveFocusCredentials;
///   - nunca persistir token Focus em texto puro no Flutter/Firestore.
///
/// Segurança:
///   Os campos de token desta tela são temporários. Depois do envio bem-sucedido,
///   o conteúdo é apagado do controller. O backend valida o token, criptografa
///   com AES-256-GCM e armazena apenas a versão criptografada.
///
/// Atenção de manutenção:
///   O perfil fiscal NÃO pode ser sobrescrito por inteiro ao salvar os dados
///   cadastrais, pois perfilFiscal.focus contém metadados e credenciais
///   criptografadas. Por isso, este arquivo usa atualização por caminhos
///   ("perfilFiscal.campo") para preservar o bloco Focus.
///
/// Fluxo:
///   Flutter -> saveFocusCredentials -> validação Focus -> criptografia backend
///   -> Firestore (somente ciphertext/iv/authTag).
///
/// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class FiscalSettingsScreen extends StatefulWidget {
  final String storeId;

  const FiscalSettingsScreen({super.key, required this.storeId});

  @override
  State<FiscalSettingsScreen> createState() => _FiscalSettingsScreenState();
}

class _FiscalSettingsScreenState extends State<FiscalSettingsScreen> {
  final _formKey = GlobalKey<FormState>();

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isSavingFocusCredential = false;

  bool _focusHomologacaoConfigurado = false;
  bool _focusProducaoConfigurado = false;

  bool _obscureHomologacaoToken = true;
  bool _obscureProducaoToken = true;

  final _focusHomologacaoTokenController = TextEditingController();
  final _focusProducaoTokenController = TextEditingController();

  final _razaoSocialController = TextEditingController();
  final _nomeFantasiaController = TextEditingController();
  final _cnpjController = TextEditingController();
  final _inscricaoEstadualController = TextEditingController();

  final _cepController = TextEditingController();
  final _logradouroController = TextEditingController();
  final _numeroController = TextEditingController();
  final _complementoController = TextEditingController();
  final _bairroController = TextEditingController();
  final _municipioController = TextEditingController();
  final _codigoMunicipioController = TextEditingController();

  String _uf = 'RJ';
  String _regimeTributario = 'simples_nacional';
  String _ambiente = 'homologacao';

  bool _certificadoVinculado = false;

  final List<String> _ufs = const [
    'AC',
    'AL',
    'AP',
    'AM',
    'BA',
    'CE',
    'DF',
    'ES',
    'GO',
    'MA',
    'MT',
    'MS',
    'MG',
    'PA',
    'PB',
    'PR',
    'PE',
    'PI',
    'RJ',
    'RN',
    'RS',
    'RO',
    'RR',
    'SC',
    'SP',
    'SE',
    'TO',
  ];

  @override
  void initState() {
    super.initState();
    _loadFiscalProfile();
  }

  @override
  void dispose() {
    _razaoSocialController.dispose();
    _nomeFantasiaController.dispose();
    _cnpjController.dispose();
    _inscricaoEstadualController.dispose();

    _cepController.dispose();
    _logradouroController.dispose();
    _numeroController.dispose();
    _complementoController.dispose();
    _bairroController.dispose();
    _municipioController.dispose();
    _codigoMunicipioController.dispose();

    _focusHomologacaoTokenController.dispose();
    _focusProducaoTokenController.dispose();

    super.dispose();
  }

  bool _isBusiness = false;

  Future<void> _loadFiscalProfile() async {
    try {
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();

      if (!storeDoc.exists) {
        throw Exception('Loja não encontrada.');
      }

      final data = storeDoc.data()!;

      // ===============================================================
      // 🔐 PROTEÇÃO BUSINESS
      // ===============================================================

      final subscriptionType = data['subscriptionType']?.toString() ?? 'free';

      final subscriptionStatus =
          data['subscriptionStatus']?.toString() ?? 'inactive';

      _isBusiness =
          subscriptionType == 'business' && subscriptionStatus == 'active';

      if (!_isBusiness) {
        if (!mounted) return;

        setState(() {
          _isLoading = false;
        });

        return;
      }

      // ===============================================================
      // PERFIL FISCAL
      // ===============================================================

      final fiscal = data['perfilFiscal'] as Map<String, dynamic>?;

      if (fiscal != null) {
        _razaoSocialController.text = fiscal['razaoSocial']?.toString() ?? '';

        _nomeFantasiaController.text = fiscal['nomeFantasia']?.toString() ?? '';

        _cnpjController.text = fiscal['cnpj']?.toString() ?? '';

        _inscricaoEstadualController.text =
            fiscal['inscricaoEstadual']?.toString() ?? '';

        _cepController.text = fiscal['cep']?.toString() ?? '';

        _logradouroController.text = fiscal['logradouro']?.toString() ?? '';

        _numeroController.text = fiscal['numero']?.toString() ?? '';

        _complementoController.text = fiscal['complemento']?.toString() ?? '';

        _bairroController.text = fiscal['bairro']?.toString() ?? '';

        _municipioController.text = fiscal['municipio']?.toString() ?? '';

        _codigoMunicipioController.text =
            fiscal['codigoMunicipioIbge']?.toString() ?? '';

        _uf = fiscal['uf']?.toString() ?? 'RJ';

        _regimeTributario =
            fiscal['regimeTributario']?.toString() ?? 'simples_nacional';

        _ambiente = fiscal['ambiente']?.toString() ?? 'homologacao';

        final certificado = fiscal['certificado'] as Map<String, dynamic>?;

        _certificadoVinculado = certificado?['vinculado'] == true;

        final focus = fiscal['focus'] is Map
            ? Map<String, dynamic>.from(fiscal['focus'] as Map)
            : <String, dynamic>{};

        final credentials = focus['credentials'] is Map
            ? Map<String, dynamic>.from(focus['credentials'] as Map)
            : <String, dynamic>{};

        final homologacao = credentials['homologacao'] is Map
            ? Map<String, dynamic>.from(credentials['homologacao'] as Map)
            : <String, dynamic>{};

        final producao = credentials['producao'] is Map
            ? Map<String, dynamic>.from(credentials['producao'] as Map)
            : <String, dynamic>{};

        _focusHomologacaoConfigurado =
            homologacao['validado'] == true ||
                (homologacao['ciphertext']?.toString().isNotEmpty ?? false);

        _focusProducaoConfigurado =
            producao['validado'] == true ||
                (producao['ciphertext']?.toString().isNotEmpty ?? false);
      } else {
        _nomeFantasiaController.text = data['name']?.toString() ?? '';

        final document = data['document']?.toString() ?? '';

        if (document.length == 14) {
          _cnpjController.text = document;
        }
      }
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao carregar configuração fiscal: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted && _isLoading) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _validateWithFocus() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'registerFocusCompany',
      );

      final result = await callable.call({
        'storeId': widget.storeId,
        'dryRun': true,
      });

      final data = Map<String, dynamic>.from(result.data);

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['message']?.toString() ??
                'Dados fiscais validados com sucesso.',
          ),
          backgroundColor: Colors.green,
        ),
      );

      await _loadFiscalProfile();
    } on FirebaseFunctionsException catch (e) {
      debugPrint('Erro Focus: ${e.code}');
      debugPrint('Mensagem: ${e.message}');
      debugPrint('Detalhes: ${e.details}');

      if (!mounted) return;

      String message = e.message ?? 'Erro ao validar dados fiscais.';

      if (e.details is Map) {
        final details = Map<String, dynamic>.from(e.details);

        final focusError = details['focusError'];

        if (focusError != null) {
          message = '$message\n\nDetalhes Focus: $focusError';
        }
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 8),
        ),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro inesperado: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ============================================================================
  // SINCRONIZA TABELA NCM - SOMENTE DESENVOLVIMENTO
  //
  // IMPORTANTE:
  // Este método é temporário.
  // Depois da primeira sincronização, removeremos o botão da interface.
  // ============================================================================

  Future<void> _syncNcmTable() async {
    setState(() {
      _isLoading = true;
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable('syncNcmTable');

      final result = await callable.call({'storeId': widget.storeId});

      final data = Map<String, dynamic>.from(result.data);

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['message']?.toString() ?? 'Tabela NCM sincronizada.',
          ),
          backgroundColor: Colors.green,
          duration: const Duration(seconds: 8),
        ),
      );

      debugPrint('=== 📚 SINCRONIZAÇÃO NCM ===');
      debugPrint('Resultado: $data');
      debugPrint('===========================');
    } on FirebaseFunctionsException catch (e) {
      debugPrint('=== ❌ ERRO SYNC NCM ===');
      debugPrint('Código: ${e.code}');
      debugPrint('Mensagem: ${e.message}');
      debugPrint('Detalhes: ${e.details}');
      debugPrint('========================');

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.message ?? 'Erro ao sincronizar tabela NCM.'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 10),
        ),
      );
    } catch (e) {
      debugPrint('Erro inesperado ao sincronizar NCM: $e');

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro inesperado: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String _digitsOnly(String value) {
    return value.replaceAll(RegExp(r'[^0-9]'), '');
  }

  Future<void> _saveFiscalProfile() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      final storeRef = FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId);

      // IMPORTANTE:
      // Não substituímos "perfilFiscal" inteiro. O bloco perfilFiscal.focus
      // contém o vínculo com a Focus e as credenciais criptografadas.
      // Atualizar o mapa inteiro apagaria esses dados.
      await storeRef.update({
        'perfilFiscal.ambiente': _ambiente,
        'perfilFiscal.razaoSocial': _razaoSocialController.text.trim(),
        'perfilFiscal.nomeFantasia': _nomeFantasiaController.text.trim(),
        'perfilFiscal.cnpj': _digitsOnly(_cnpjController.text),
        'perfilFiscal.inscricaoEstadual':
        _inscricaoEstadualController.text.trim(),
        'perfilFiscal.regimeTributario': _regimeTributario,
        'perfilFiscal.cep': _digitsOnly(_cepController.text),
        'perfilFiscal.logradouro': _logradouroController.text.trim(),
        'perfilFiscal.numero': _numeroController.text.trim(),
        'perfilFiscal.complemento': _complementoController.text.trim(),
        'perfilFiscal.bairro': _bairroController.text.trim(),
        'perfilFiscal.municipio': _municipioController.text.trim(),
        'perfilFiscal.codigoMunicipioIbge':
        _digitsOnly(_codigoMunicipioController.text),
        'perfilFiscal.uf': _uf,
        'perfilFiscal.certificado.vinculado': _certificadoVinculado,
        'perfilFiscal.configurado': true,
        'perfilFiscal.updatedAt': FieldValue.serverTimestamp(),
      });

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Configuração fiscal salva com sucesso.'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao salvar configuração fiscal: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  Future<void> _saveFocusCredential(String ambiente) async {
    final controller = ambiente == 'homologacao'
        ? _focusHomologacaoTokenController
        : _focusProducaoTokenController;

    final token = controller.text.trim();

    if (token.isEmpty) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            ambiente == 'homologacao'
                ? 'Informe o token de homologação da Focus NFe.'
                : 'Informe o token de produção da Focus NFe.',
          ),
          backgroundColor: Colors.orange,
        ),
      );

      return;
    }

    setState(() {
      _isSavingFocusCredential = true;
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'saveFocusCredentials',
      );

      final result = await callable.call({
        'storeId': widget.storeId,
        'ambiente': ambiente,
        'token': token,
      });

      final data = Map<String, dynamic>.from(result.data);

      controller.clear();

      if (!mounted) return;

      setState(() {
        if (ambiente == 'homologacao') {
          _focusHomologacaoConfigurado = true;
        } else {
          _focusProducaoConfigurado = true;
        }
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['message']?.toString() ??
                'Credencial Focus salva com segurança.',
          ),
          backgroundColor: Colors.green,
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      debugPrint('Erro saveFocusCredentials: ${e.code}');
      debugPrint('Mensagem: ${e.message}');
      debugPrint('Detalhes: ${e.details}');

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.message ?? 'Não foi possível validar a credencial Focus.',
          ),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 8),
        ),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro inesperado ao salvar credencial Focus: $e'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSavingFocusCredential = false;
        });
      }
    }
  }

  Widget _buildFocusCredentialField({
    required String ambiente,
    required String label,
    required TextEditingController controller,
    required bool configurado,
    required bool obscureText,
    required VoidCallback onToggleVisibility,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  configurado
                      ? Icons.verified_user_outlined
                      : Icons.key_outlined,
                  color: configurado ? Colors.green : Colors.orange,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Text(
                  configurado ? 'Configurado' : 'Não configurado',
                  style: TextStyle(
                    color: configurado ? Colors.green : Colors.orange,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              obscureText: obscureText,
              enableSuggestions: false,
              autocorrect: false,
              decoration: _inputDecoration(
                configurado
                    ? 'Novo token (preencha somente para substituir)'
                    : 'Token Focus',
                icon: Icons.password_outlined,
              ).copyWith(
                suffixIcon: IconButton(
                  onPressed: onToggleVisibility,
                  icon: Icon(
                    obscureText ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                  ),
                  tooltip: obscureText ? 'Mostrar token' : 'Ocultar token',
                ),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _isSavingFocusCredential
                  ? null
                  : () => _saveFocusCredential(ambiente),
              icon: _isSavingFocusCredential
                  ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
                  : const Icon(Icons.lock_outline),
              label: Text(
                configurado
                    ? 'SUBSTITUIR CREDENCIAL'
                    : 'VINCULAR CREDENCIAL',
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(top: 24, bottom: 12),
      child: Text(
        title,
        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
      ),
    );
  }

  InputDecoration _inputDecoration(String label, {IconData? icon}) {
    return InputDecoration(
      labelText: label,
      prefixIcon: icon != null ? Icon(icon) : null,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
    );
  }

  Widget _buildBusinessRequired() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.workspace_premium,
              size: 72,
              color: Colors.amber.shade800,
            ),

            const SizedBox(height: 20),

            const Text(
              'Recurso exclusivo Business',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),

            const SizedBox(height: 10),

            Text(
              'A configuração fiscal e a emissão de NFC-e '
                  'estão disponíveis no Plano Store Connect Business.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 15,
                color: Colors.grey.shade700,
                height: 1.4,
              ),
            ),

            const SizedBox(height: 24),

            OutlinedButton.icon(
              onPressed: () {
                Navigator.of(context).pop();
              },
              icon: const Icon(Icons.arrow_back),
              label: const Text('VOLTAR'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Configuração Fiscal')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : !_isBusiness
          ? _buildBusinessRequired()
          : Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.08),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Configure os dados fiscais da empresa. '
                          'Enquanto estivermos em implantação, mantenha o ambiente em homologação.',
                    ),
                  ),
                ],
              ),
            ),

            _sectionTitle('Ambiente'),

            DropdownButtonFormField<String>(
              value: _ambiente,
              isExpanded: true,
              decoration: _inputDecoration(
                'Ambiente fiscal',
                icon: Icons.cloud_outlined,
              ),
              items: const [
                DropdownMenuItem(
                  value: 'homologacao',
                  child: Text('Homologação'),
                ),
                DropdownMenuItem(
                  value: 'producao',
                  child: Text('Produção'),
                ),
              ],
              onChanged: (value) {
                if (value == null) {
                  return;
                }

                setState(() {
                  _ambiente = value;
                });
              },
            ),

            _sectionTitle('Dados da empresa'),

            TextFormField(
              controller: _razaoSocialController,
              decoration: _inputDecoration(
                'Razão Social',
                icon: Icons.business,
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Informe a razão social.';
                }

                return null;
              },
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _nomeFantasiaController,
              decoration: _inputDecoration(
                'Nome Fantasia',
                icon: Icons.storefront,
              ),
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _cnpjController,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(14),
              ],
              decoration: _inputDecoration(
                'CNPJ',
                icon: Icons.badge_outlined,
              ),
              validator: (value) {
                final cnpj = _digitsOnly(value ?? '');

                if (cnpj.length != 14) {
                  return 'Informe um CNPJ válido.';
                }

                return null;
              },
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _inscricaoEstadualController,
              decoration: _inputDecoration(
                'Inscrição Estadual',
                icon: Icons.numbers,
              ),
              validator: (value) {
                if (_regimeTributario == 'mei') {
                  return null;
                }

                if (value == null || value.trim().isEmpty) {
                  return 'Informe a inscrição estadual.';
                }

                return null;
              },
            ),

            const SizedBox(height: 14),

            DropdownButtonFormField<String>(
              value: _regimeTributario,
              isExpanded: true,
              decoration: _inputDecoration(
                'Regime Tributário',
                icon: Icons.account_balance,
              ),
              items: const [
                DropdownMenuItem(
                  value: 'mei',
                  child: Text(
                    'MEI',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem(
                  value: 'simples_nacional',
                  child: Text(
                    'Simples Nacional',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem(
                  value: 'simples_excesso',
                  child: Text(
                    'Simples Nacional - excesso de sublimite',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                DropdownMenuItem(
                  value: 'regime_normal',
                  child: Text(
                    'Regime Normal',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
              onChanged: (value) {
                if (value == null) return;

                setState(() {
                  _regimeTributario = value;
                });
              },
            ),

            _sectionTitle('Endereço fiscal'),

            TextFormField(
              controller: _cepController,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(8),
              ],
              decoration: _inputDecoration(
                'CEP',
                icon: Icons.location_on_outlined,
              ),
              validator: (value) {
                if (_digitsOnly(value ?? '').length != 8) {
                  return 'Informe um CEP válido.';
                }

                return null;
              },
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _logradouroController,
              decoration: _inputDecoration('Logradouro'),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Informe o logradouro.'
                  : null,
            ),

            const SizedBox(height: 14),

            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    controller: _numeroController,
                    decoration: _inputDecoration('Número'),
                    validator: (value) =>
                    value == null || value.trim().isEmpty
                        ? 'Obrigatório'
                        : null,
                  ),
                ),

                const SizedBox(width: 12),

                Expanded(
                  flex: 3,
                  child: TextFormField(
                    controller: _complementoController,
                    decoration: _inputDecoration('Complemento'),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _bairroController,
              decoration: _inputDecoration('Bairro'),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Informe o bairro.'
                  : null,
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _municipioController,
              decoration: _inputDecoration('Município'),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Informe o município.'
                  : null,
            ),

            const SizedBox(height: 14),

            TextFormField(
              controller: _codigoMunicipioController,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: _inputDecoration('Código IBGE do Município'),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Informe o código IBGE.';
                }

                return null;
              },
            ),

            const SizedBox(height: 14),

            DropdownButtonFormField<String>(
              value: _uf,
              isExpanded: true,
              decoration: _inputDecoration('UF'),
              items: _ufs
                  .map(
                    (uf) => DropdownMenuItem(value: uf, child: Text(uf)),
              )
                  .toList(),
              onChanged: (value) {
                if (value == null) {
                  return;
                }

                setState(() {
                  _uf = value;
                });
              },
            ),

            _sectionTitle('Certificado Digital'),

            Card(
              child: ListTile(
                leading: Icon(
                  _certificadoVinculado
                      ? Icons.verified_user
                      : Icons.gpp_maybe_outlined,
                  color: _certificadoVinculado
                      ? Colors.green
                      : Colors.orange,
                ),
                title: Text(
                  _certificadoVinculado
                      ? 'Certificado vinculado'
                      : 'Certificado ainda não vinculado',
                ),
                subtitle: const Text(
                  'O certificado A1 será configurado na próxima etapa.',
                ),
              ),
            ),

            _sectionTitle('Credenciais Focus NFe'),

            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.06),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.security_outlined),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Os tokens são enviados diretamente para o backend. '
                          'Depois de validados, são criptografados e nunca são '
                          'salvos em texto puro no aplicativo.',
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 12),

            _buildFocusCredentialField(
              ambiente: 'homologacao',
              label: 'Token de Homologação',
              controller: _focusHomologacaoTokenController,
              configurado: _focusHomologacaoConfigurado,
              obscureText: _obscureHomologacaoToken,
              onToggleVisibility: () {
                setState(() {
                  _obscureHomologacaoToken =
                  !_obscureHomologacaoToken;
                });
              },
            ),

            const SizedBox(height: 10),

            _buildFocusCredentialField(
              ambiente: 'producao',
              label: 'Token de Produção',
              controller: _focusProducaoTokenController,
              configurado: _focusProducaoConfigurado,
              obscureText: _obscureProducaoToken,
              onToggleVisibility: () {
                setState(() {
                  _obscureProducaoToken = !_obscureProducaoToken;
                });
              },
            ),

            const SizedBox(height: 28),

            SizedBox(
              height: 52,
              child: ElevatedButton.icon(
                onPressed: _isSaving ? null : _saveFiscalProfile,
                icon: _isSaving
                    ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
                    : const Icon(Icons.save_outlined),
                label: Text(
                  _isSaving
                      ? 'Salvando...'
                      : 'SALVAR CONFIGURAÇÃO FISCAL',
                ),
              ),
            ),
            const SizedBox(height: 16),

            OutlinedButton.icon(
              onPressed: _validateWithFocus,
              icon: const Icon(Icons.verified_outlined),
              label: const Text('VALIDAR DADOS NA FOCUS NFE'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
            ),

            const SizedBox(height: 16),

            // ============================================================================
            // SINCRONIZAÇÃO NCM - SOMENTE DESENVOLVIMENTO
            //
            // Este botão será removido depois da primeira sincronização da base oficial.
            // O cliente final Business NÃO terá acesso a esta operação.
            // ============================================================================
            /**OutlinedButton.icon(
                onPressed: _isLoading ? null : _syncNcmTable,
                icon: const Icon(Icons.sync),
                label: const Text('SINCRONIZAR TABELA NCM - DEV'),
                style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                ),
             */
          ],
        ),
      ),
    );
  }
}
