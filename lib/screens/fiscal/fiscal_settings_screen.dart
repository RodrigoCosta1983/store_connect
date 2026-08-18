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

      final fiscalData = {
        'ambiente': _ambiente,

        'razaoSocial': _razaoSocialController.text.trim(),

        'nomeFantasia': _nomeFantasiaController.text.trim(),

        'cnpj': _digitsOnly(_cnpjController.text),

        'inscricaoEstadual': _inscricaoEstadualController.text.trim(),

        'regimeTributario': _regimeTributario,

        'cep': _digitsOnly(_cepController.text),

        'logradouro': _logradouroController.text.trim(),

        'numero': _numeroController.text.trim(),

        'complemento': _complementoController.text.trim(),

        'bairro': _bairroController.text.trim(),

        'municipio': _municipioController.text.trim(),

        'codigoMunicipioIbge': _digitsOnly(_codigoMunicipioController.text),

        'uf': _uf,

        'certificado': {'vinculado': _certificadoVinculado},

        'configurado': true,

        'updatedAt': FieldValue.serverTimestamp(),
      };

      await storeRef.update({'perfilFiscal': fiscalData});

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
