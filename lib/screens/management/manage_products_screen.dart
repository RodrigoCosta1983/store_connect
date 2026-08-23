// ============================================================================
// ARQUIVO: manage_products_screen.dart
// ============================================================================
//
// OBJETIVO:
// Gerenciar o cadastro, edição, exclusão e visualização dos produtos da loja.
//
// PRINCIPAIS RESPONSABILIDADES:
// - Cadastrar e editar produtos.
// - Controlar quantidade manual ou por lotes.
// - Gerenciar validade dos lotes.
// - Fazer upload da imagem do produto.
// - Vincular categoria.
// - Controlar estoque mínimo.
// - Exibir dados fiscais exclusivamente para lojas Business.
// - Salvar NCM, CFOP, origem, unidade, CEST e tributação no mapa "fiscal".
// - Salvar os códigos IBS/CBS exigidos pela Reforma Tributária, sem assumir
//   códigos padrão que dependam do enquadramento fiscal do produto.
//
// REGRAS DE PLANO:
// - PRO/TRIAL:
//   utiliza somente os dados comerciais e de estoque.
// - BUSINESS ATIVO:
//   libera também os campos fiscais do produto.
//
// FIRESTORE:
// stores/{storeId}/products/{productId}
//
// ESTRUTURA FISCAL:
// fiscal: {
//   ncm,
//   origem,
//   cfop,
//   unidade,
//   cest,
//   icmsSituacaoTributaria,
//   pisSituacaoTributaria,
//   cofinsSituacaoTributaria,
//   ibsCbsSituacaoTributaria,
//   ibsCbsClassificacaoTributaria,
//   updatedAt
// }
//
// CUIDADOS EM FUTURAS ALTERAÇÕES:
// - Não apagar dados fiscais quando houver downgrade Business -> PRO.
// - Não quebrar a sincronização entre lotes e quantidade total.
// - Dados fiscais serão utilizados posteriormente na emissão da NFC-e.
// - O cadastro/edição comercial NÃO deve ser bloqueado por dados fiscais
//   ainda incompletos. A Cloud Function emitirNfce faz a validação fiscal
//   obrigatória antes de qualquer tentativa de emissão.
//
// ============================================================================

// lib/screens/management/manage_products_screen.dart

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:store_connect/widgets/dynamic_background.dart';
import 'package:store_connect/screens/fiscal/widgets/ncm_search_dialog.dart';

import 'package:store_connect/screens/products/import/product_import_screen.dart';

// ============================================================================
// DIÁLOGO DE CADASTRO / EDIÇÃO DE PRODUTO
// ============================================================================

class _ProductDialogState extends State<_ProductDialog> {
  final _formKey = GlobalKey<FormState>();

  // ==========================================================================
  // DADOS COMERCIAIS DO PRODUTO
  // ==========================================================================

  final _nameController = TextEditingController();
  final _priceController = TextEditingController();

  // Quantidade total.
  //
  // Se existirem lotes, este campo passa a ser somente leitura
  // e recebe automaticamente a soma dos lotes.
  final _quantidadeController = TextEditingController();

  final _loteQuantidadeController = TextEditingController();
  final _minimumStockController = TextEditingController();

  // ==========================================================================
  // DADOS FISCAIS - EXCLUSIVOS BUSINESS
  // ==========================================================================

  final _ncmController = TextEditingController();
  final _cfopController = TextEditingController();
  final _cestController = TextEditingController();

  // Reforma Tributária 2026:
  // campos obrigatórios no item fiscal da Focus NFe.
  //
  // Não definimos valor padrão porque CST IBS/CBS e cClassTrib dependem
  // da tributação real do produto/operação e devem ser confirmados pelo
  // responsável fiscal/contador.
  final _ibsCbsSituacaoTributariaController = TextEditingController();
  final _ibsCbsClassificacaoTributariaController = TextEditingController();

  // Origem padrão: mercadoria nacional.
  String _selectedOrigem = '0';

  // Unidade comercial padrão.
  String _selectedUnidade = 'UN';

  // Tributação padrão apenas para facilitar testes em homologação.
  // Em produção, os códigos devem ser confirmados com o contador.
  String _selectedIcmsSituacaoTributaria = '102';
  String _selectedPisSituacaoTributaria = '49';
  String _selectedCofinsSituacaoTributaria = '49';

  // ==========================================================================
  // ESTADO
  // ==========================================================================

  bool _isLoading = false;

  File? _selectedImageFile;
  Uint8List? _selectedImageBytes;
  String? _existingImageUrl;

  List<Map<String, dynamic>> _lotes = [];

  DateTime? _dataValidadeSelecionada;

  String? _selectedCategoryId;
  String? _selectedCategoryName;

  bool get _isEditing => widget.product != null;

  // ==========================================================================
  // ORIGENS DE MERCADORIA
  //
  // Deixamos os códigos explícitos para que depois possam ser usados
  // diretamente na montagem da NFC-e.
  // ==========================================================================

  static const Map<String, String> _origens = {
    '0': '0 - Nacional',
    '1': '1 - Estrangeira - Importação direta',
    '2': '2 - Estrangeira - Adquirida no mercado interno',
    '3': '3 - Nacional, conteúdo de importação superior a 40%',
    '4': '4 - Nacional, processos produtivos básicos',
    '5': '5 - Nacional, conteúdo de importação até 40%',
    '6': '6 - Estrangeira - Importação direta sem similar nacional',
    '7': '7 - Estrangeira - Mercado interno sem similar nacional',
    '8': '8 - Nacional, conteúdo de importação superior a 70%',
  };

  // ==========================================================================
  // UNIDADES COMERCIAIS MAIS COMUNS
  //
  // Podemos aumentar esta lista futuramente.
  // ==========================================================================

  static const Map<String, String> _unidades = {
    'UN': 'UN - Unidade',
    'PC': 'PC - Peça',
    'PAR': 'PAR - Par',
    'KIT': 'KIT - Kit',
    'CX': 'CX - Caixa',
    'PCT': 'PCT - Pacote',
    'KG': 'KG - Quilograma',
    'G': 'G - Grama',
    'M': 'M - Metro',
    'M2': 'M² - Metro quadrado',
    'LT': 'LT - Litro',
    'ML': 'ML - Mililitro',
  };

  static const Map<String, String> _icmsSituacoes = {
    '101': '101 - Tributada com permissão de crédito',
    '102': '102 - Tributada sem permissão de crédito',
    '103': '103 - Isenção para faixa de receita bruta',
    '201': '201 - Com crédito e com ST',
    '202': '202 - Sem crédito e com ST',
    '203': '203 - Isenção e com ST',
    '300': '300 - Imune',
    '400': '400 - Não tributada',
    '500': '500 - ICMS cobrado anteriormente por ST',
    '900': '900 - Outros',
  };

  static const Map<String, String> _pisCofinsSituacoes = {
    '01': '01 - Operação tributável com alíquota básica',
    '02': '02 - Operação tributável com alíquota diferenciada',
    '03': '03 - Operação tributável por unidade de medida',
    '04': '04 - Operação monofásica - alíquota zero',
    '05': '05 - Operação por substituição tributária',
    '06': '06 - Operação tributável - alíquota zero',
    '07': '07 - Operação isenta',
    '08': '08 - Operação sem incidência',
    '09': '09 - Operação com suspensão',
    '49': '49 - Outras operações de saída',
    '99': '99 - Outras operações',
  };

  // ============================================================================
  // ABRE A PESQUISA DE NCM
  // ============================================================================
  //
  // OBJETIVO:
  // - Abrir o diálogo de pesquisa.
  // - Consultar a Cloud Function "searchNcm".
  // - Receber resultados da base NCM sincronizada.
  // - Preencher o campo NCM após a seleção.
  //
  // FLUXO:
  // Produto Business
  //      ↓
  // Pesquisar NCM
  //      ↓
  // searchNcm
  //      ↓
  // Firestore / coleção ncm
  //      ↓
  // Usuário seleciona
  //      ↓
  // Campo NCM preenchido
  //
  // ============================================================================

  // ============================================================================
  // ABRE A PESQUISA DE NCM
  // ============================================================================
  //
  // OBJETIVO:
  // - Abrir o diálogo de pesquisa.
  // - Consultar a Cloud Function "searchNcm".
  // - Receber resultados da base NCM sincronizada.
  // - Preencher o campo NCM após a seleção.
  //
  // FLUXO:
  // Produto Business
  //      ↓
  // Pesquisar NCM
  //      ↓
  // searchNcm
  //      ↓
  // Firestore / coleção ncm
  //      ↓
  // Usuário seleciona
  //      ↓
  // Campo NCM preenchido
  //
  // ============================================================================

  Future<void> _openNcmSearch() async {
    final result = await showDialog<NcmSearchResult>(
      context: context,
      builder: (ctx) => NcmSearchDialog(
        // Abre inicialmente com o nome do produto.
        initialQuery: _nameController.text.trim(),

        onSearch: (query) async {
          try {
            final callable = FirebaseFunctions.instance.httpsCallable(
              'searchNcm',
            );

            final response = await callable.call({
              'storeId': widget.storeId,
              'query': query,
              'limit': 20,
            });

            final data = Map<String, dynamic>.from(response.data);

            final rawResults = data['results'];

            if (rawResults is! List) {
              return <NcmSearchResult>[];
            }

            return rawResults
                .map((item) {
              final map = Map<String, dynamic>.from(item as Map);

              return NcmSearchResult(
                codigo: map['codigo']?.toString() ?? '',
                descricao: map['descricao']?.toString() ?? '',
              );
            })
                .where((item) => item.codigo.isNotEmpty)
                .toList();
          } on FirebaseFunctionsException catch (e) {
            debugPrint('=== ❌ ERRO SEARCH NCM ===');
            debugPrint('Código: ${e.code}');
            debugPrint('Mensagem: ${e.message}');
            debugPrint('Detalhes: ${e.details}');
            debugPrint('=========================');

            rethrow;
          } catch (e) {
            debugPrint('Erro inesperado na busca NCM: $e');

            rethrow;
          }
        },
      ),
    );

    // Usuário fechou sem selecionar.
    if (result == null) {
      return;
    }

    setState(() {
      _ncmController.text = result.codigo;
    });
  }

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    if (_isEditing) {
      final productData = widget.product!.data() as Map<String, dynamic>;

      // ======================================================================
      // 1. DADOS PRINCIPAIS
      // ======================================================================

      _nameController.text = productData['name'] ?? '';

      _priceController.text = productData['price']?.toString() ?? '';

      _minimumStockController.text = (productData['minimumStock'] ?? 0)
          .toString();

      // ======================================================================
      // 2. IMAGEM
      // ======================================================================

      if (productData.containsKey('imageUrl')) {
        _existingImageUrl = productData['imageUrl'];
      }

      // ======================================================================
      // 3. CATEGORIA
      // ======================================================================

      if (productData.containsKey('categoryId')) {
        _selectedCategoryId = productData['categoryId'];

        _selectedCategoryName = productData['categoryName'];
      }

      // ======================================================================
      // 4. LOTES
      // ======================================================================

      if (productData.containsKey('lotes') && productData['lotes'] is List) {
        final rawLotes = productData['lotes'] as List;

        _lotes = rawLotes
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList();
      } else {
        _lotes = [];
      }

      // ======================================================================
      // 5. QUANTIDADE
      //
      // Sem lote:
      // usa a quantidade armazenada.
      //
      // Com lote:
      // usa a soma matemática dos lotes.
      // ======================================================================

      if (_lotes.isEmpty) {
        _quantidadeController.text = (productData['quantidade'] ?? 0)
            .toString();
      } else {
        _sincronizarTotalManual();
      }

      // ======================================================================
      // 6. DADOS FISCAIS
      //
      // Só precisamos carregar se o produto já possuir o mapa fiscal.
      //
      // Mesmo que a loja tenha voltado temporariamente para PRO,
      // esses dados permanecem guardados no Firestore.
      // ======================================================================

      final rawFiscal = productData['fiscal'];

      if (rawFiscal is Map) {
        final fiscal = Map<String, dynamic>.from(rawFiscal);

        _ncmController.text = fiscal['ncm']?.toString() ?? '';

        _cfopController.text = fiscal['cfop']?.toString() ?? '';

        _cestController.text = fiscal['cest']?.toString() ?? '';

        final origem = fiscal['origem']?.toString();

        if (origem != null && _origens.containsKey(origem)) {
          _selectedOrigem = origem;
        }

        final unidade = fiscal['unidade']?.toString();

        if (unidade != null && _unidades.containsKey(unidade)) {
          _selectedUnidade = unidade;
        }

        final icmsSituacao = fiscal['icmsSituacaoTributaria']?.toString();
        if (icmsSituacao != null && _icmsSituacoes.containsKey(icmsSituacao)) {
          _selectedIcmsSituacaoTributaria = icmsSituacao;
        }

        final pisSituacao = fiscal['pisSituacaoTributaria']?.toString();
        if (pisSituacao != null &&
            _pisCofinsSituacoes.containsKey(pisSituacao)) {
          _selectedPisSituacaoTributaria = pisSituacao;
        }

        final cofinsSituacao = fiscal['cofinsSituacaoTributaria']?.toString();
        if (cofinsSituacao != null &&
            _pisCofinsSituacoes.containsKey(cofinsSituacao)) {
          _selectedCofinsSituacaoTributaria = cofinsSituacao;
        }

        _ibsCbsSituacaoTributariaController.text =
            fiscal['ibsCbsSituacaoTributaria']?.toString() ?? '';

        _ibsCbsClassificacaoTributariaController.text =
            fiscal['ibsCbsClassificacaoTributaria']?.toString() ?? '';
      }
    }
  }

  // ==========================================================================
  // SINCRONIZA QUANTIDADE TOTAL
  // ==========================================================================

  void _sincronizarTotalManual() {
    final somaLotes = _lotes.fold<int>(
      0,
          (sum, item) => sum + ((item['quantidade'] as num?)?.toInt() ?? 0),
    );

    _quantidadeController.text = somaLotes.toString();
  }

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _nameController.dispose();
    _priceController.dispose();
    _quantidadeController.dispose();
    _loteQuantidadeController.dispose();
    _minimumStockController.dispose();

    // Dados fiscais
    _ncmController.dispose();
    _cfopController.dispose();
    _cestController.dispose();
    _ibsCbsSituacaoTributariaController.dispose();
    _ibsCbsClassificacaoTributariaController.dispose();

    super.dispose();
  }

  // ==========================================================================
  // SELECIONAR DATA DO LOTE
  // ==========================================================================

  Future<void> _selecionarData(BuildContext context) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime(2035),
    );

    if (picked != null && picked != _dataValidadeSelecionada) {
      setState(() {
        _dataValidadeSelecionada = picked;
      });
    }
  }

  // ==========================================================================
  // SELECIONAR IMAGEM
  // ==========================================================================

  Future<void> _pickImage() async {
    final pickedImage = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 50,
      maxWidth: 600,
    );

    if (pickedImage == null) return;

    if (kIsWeb) {
      _selectedImageBytes = await pickedImage.readAsBytes();

      _selectedImageFile = null;
    } else {
      _selectedImageFile = File(pickedImage.path);

      _selectedImageBytes = null;
    }

    if (mounted) {
      setState(() {});
    }
  }

  // ==========================================================================
  // SALVAR PRODUTO
  // ==========================================================================

  Future<void> _saveProduct() async {
    if (!_formKey.currentState!.validate()) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Revise os campos destacados antes de salvar o produto.',
            ),
            backgroundColor: Colors.orange,
          ),
        );
      }
      return;
    }

    if (widget.storeId.isEmpty) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    // =========================================================================
    // DADOS COMERCIAIS
    // =========================================================================

    final String name = _nameController.text.trim();

    final double price = double.parse(
      _priceController.text.replaceAll(',', '.'),
    );

    final int minimumStock = int.tryParse(_minimumStockController.text) ?? 0;

    final String oldImageUrl = _existingImageUrl ?? '';

    String imageUrl = oldImageUrl;

    try {
      // =======================================================================
      // 1. UPLOAD DA IMAGEM
      // =======================================================================

      if (_selectedImageFile != null || _selectedImageBytes != null) {
        final fileName = '${DateTime.now().millisecondsSinceEpoch}.jpg';

        final path = 'product_images/${widget.storeId}/$fileName';

        final ref = FirebaseStorage.instance.ref(path);

        final metadata = SettableMetadata(contentType: 'image/jpeg');

        final TaskSnapshot snapshot = kIsWeb
            ? await ref.putData(_selectedImageBytes!, metadata)
            : await ref.putFile(_selectedImageFile!, metadata);

        imageUrl = await snapshot.ref.getDownloadURL();
      }

      // =======================================================================
      // 2. FILTRA LOTES SEM SALDO
      // =======================================================================

      final lotesFiltrados = _lotes
          .where((lote) => ((lote['quantidade'] as num?)?.toInt() ?? 0) > 0)
          .toList();

      // =======================================================================
      // 3. CALCULA QUANTIDADE FINAL
      // =======================================================================

      final int manualQuantidade =
          int.tryParse(_quantidadeController.text) ?? 0;

      final int somaLotes = lotesFiltrados.fold<int>(
        0,
            (sum, item) => sum + ((item['quantidade'] as num?)?.toInt() ?? 0),
      );

      final int finalQuantidade = _lotes.isEmpty ? manualQuantidade : somaLotes;

      // =======================================================================
      // 4. MAPA BASE DO PRODUTO
      //
      // Este continua sendo o mesmo conteúdo utilizado pelo PRO.
      // =======================================================================

      final Map<String, dynamic> productData = {
        'name': name,
        'name_lowercase': name.toLowerCase(),
        'price': price,
        'lotes': lotesFiltrados,
        'quantidade': finalQuantidade,
        'minimumStock': minimumStock,
        'imageUrl': imageUrl,
        'categoryId': _selectedCategoryId,
        'categoryName': _selectedCategoryName,
      };

      // =======================================================================
      // 5. DADOS FISCAIS - SOMENTE BUSINESS
      //
      // PRO:
      // não cria nem altera o campo fiscal.
      //
      // BUSINESS:
      // grava os dados necessários para utilização posterior na NFC-e.
      // =======================================================================

      if (widget.isBusiness) {
        final ncm = _ncmController.text.replaceAll(RegExp(r'\D'), '');

        final cfop = _cfopController.text.replaceAll(RegExp(r'\D'), '');

        final cest = _cestController.text.replaceAll(RegExp(r'\D'), '');

        final ibsCbsSituacaoTributaria = _ibsCbsSituacaoTributariaController
            .text
            .replaceAll(RegExp(r'\D'), '');

        final ibsCbsClassificacaoTributaria =
        _ibsCbsClassificacaoTributariaController.text.replaceAll(
          RegExp(r'\D'),
          '',
        );

        productData['fiscal'] = {
          'ncm': ncm,
          'origem': _selectedOrigem,
          'cfop': cfop,
          'unidade': _selectedUnidade,

          // CEST é opcional.
          'cest': cest.isEmpty ? null : cest,

          'icmsSituacaoTributaria': _selectedIcmsSituacaoTributaria,
          'pisSituacaoTributaria': _selectedPisSituacaoTributaria,
          'cofinsSituacaoTributaria': _selectedCofinsSituacaoTributaria,

          // Reforma Tributária 2026.
          //
          // Esses nomes são internos do Store Connect. Na montagem do payload
          // Focus serão convertidos para:
          // - ibs_cbs_situacao_tributaria
          // - ibs_cbs_classificacao_tributaria
          'ibsCbsSituacaoTributaria': ibsCbsSituacaoTributaria,
          'ibsCbsClassificacaoTributaria': ibsCbsClassificacaoTributaria,

          // Ajuda futuramente em auditoria / sincronização.
          'updatedAt': Timestamp.now(),
        };
      }

      // =======================================================================
      // 6. SALVA / ATUALIZA
      // =======================================================================

      if (_isEditing) {
        await FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('products')
            .doc(widget.product!.id)
            .update(productData);
      } else {
        productData['createdAt'] = Timestamp.now();

        await FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .collection('products')
            .add(productData);
      }

      if (!mounted) return;

      Navigator.of(context).pop();

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Produto salvo com sucesso!'),
          backgroundColor: Colors.green,
        ),
      );
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao salvar: $error'),
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

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    ImageProvider? provider;

    if (_selectedImageBytes != null) {
      provider = MemoryImage(_selectedImageBytes!);
    } else if (_selectedImageFile != null) {
      provider = FileImage(_selectedImageFile!);
    } else if (_existingImageUrl != null && _existingImageUrl!.isNotEmpty) {
      provider = NetworkImage(_existingImageUrl!);
    }

    return AlertDialog(
      title: Text(_isEditing ? 'Editar Produto' : 'Adicionar Produto'),

      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // ============================================================
                // IMAGEM
                // ============================================================
                Center(
                  child: GestureDetector(
                    onTap: _pickImage,
                    child: CircleAvatar(
                      radius: 40,
                      backgroundColor: Colors.grey.shade200,
                      backgroundImage: provider,
                      child: provider == null
                          ? const Icon(
                        Icons.add_a_photo,
                        size: 40,
                        color: Colors.grey,
                      )
                          : null,
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                // ============================================================
                // NOME
                // ============================================================
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Nome do Produto',
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Campo obrigatório.';
                    }

                    return null;
                  },
                ),

                const SizedBox(height: 16),

                // ============================================================
                // CATEGORIA
                // ============================================================
                StreamBuilder<QuerySnapshot>(
                  stream: FirebaseFirestore.instance
                      .collection('stores')
                      .doc(widget.storeId)
                      .collection('categories')
                      .orderBy('name')
                      .snapshots(),
                  builder: (context, snapshot) {
                    if (!snapshot.hasData) {
                      return const Center(child: CircularProgressIndicator());
                    }

                    final categories = snapshot.data!.docs;

                    String? safeValue = _selectedCategoryId;

                    if (safeValue != null &&
                        !categories.any((doc) => doc.id == safeValue)) {
                      safeValue = null;
                    }

                    return DropdownButtonFormField<String>(
                      value: safeValue,

                      // Evita overflow
                      // em telas pequenas.
                      isExpanded: true,

                      decoration: const InputDecoration(labelText: 'Categoria'),
                      items: categories
                          .map(
                            (doc) => DropdownMenuItem<String>(
                          value: doc.id,
                          child: Text(
                            doc['name'].toString(),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      )
                          .toList(),
                      onChanged: (value) {
                        if (value == null) {
                          return;
                        }

                        final selectedCat = categories.firstWhere(
                              (doc) => doc.id == value,
                        );

                        setState(() {
                          _selectedCategoryId = value;

                          _selectedCategoryName = selectedCat['name']
                              .toString();
                        });
                      },
                    );
                  },
                ),

                const SizedBox(height: 16),

                // ============================================================
                // PREÇO
                // ============================================================
                TextFormField(
                  controller: _priceController,
                  decoration: const InputDecoration(
                    labelText: 'Preço',
                    prefixText: 'R\$ ',
                  ),
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Informe o preço.';
                    }

                    final parsed = double.tryParse(value.replaceAll(',', '.'));

                    if (parsed == null || parsed < 0) {
                      return 'Preço inválido.';
                    }

                    return null;
                  },
                ),

                const SizedBox(height: 16),

                // ============================================================
                // QUANTIDADE
                // ============================================================
                TextFormField(
                  controller: _quantidadeController,
                  decoration: InputDecoration(
                    labelText: _lotes.isNotEmpty
                        ? 'Quantidade (Soma automática dos lotes)'
                        : 'Quantidade Manual',
                    filled: _lotes.isNotEmpty,
                    fillColor: _lotes.isNotEmpty
                        ? Colors.grey.withOpacity(0.1)
                        : null,
                  ),
                  readOnly: _lotes.isNotEmpty,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Campo obrigatório.';
                    }

                    if (int.tryParse(value) == null || int.parse(value) < 0) {
                      return 'Número inválido.';
                    }

                    return null;
                  },
                ),

                // ============================================================
                // LOTES
                // ============================================================
                const Divider(height: 32),

                const Text(
                  'Gerenciar Lotes',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),

                const SizedBox(height: 8),

                Row(
                  children: [
                    TextButton.icon(
                      onPressed: () => _selecionarData(context),
                      icon: const Icon(Icons.calendar_today),
                      label: Text(
                        _dataValidadeSelecionada == null
                            ? 'Data'
                            : DateFormat(
                          'dd/MM/yyyy',
                        ).format(_dataValidadeSelecionada!),
                      ),
                    ),

                    const SizedBox(width: 8),

                    Expanded(
                      child: TextFormField(
                        controller: _loteQuantidadeController,
                        decoration: const InputDecoration(
                          labelText: 'Quantidade',
                        ),
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                        ],
                      ),
                    ),

                    IconButton(
                      icon: const Icon(
                        Icons.add_circle,
                        color: Colors.blue,
                        size: 32,
                      ),
                      onPressed: () {
                        final qtd = int.tryParse(
                          _loteQuantidadeController.text,
                        );

                        if (qtd != null &&
                            qtd > 0 &&
                            _dataValidadeSelecionada != null) {
                          setState(() {
                            _lotes.add({
                              'quantidade': qtd,
                              'validade': Timestamp.fromDate(
                                _dataValidadeSelecionada!,
                              ),
                            });

                            _sincronizarTotalManual();
                          });

                          _loteQuantidadeController.clear();

                          _dataValidadeSelecionada = null;
                        } else {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Informe a Qtd e a Validade!'),
                              backgroundColor: Colors.orange,
                            ),
                          );
                        }
                      },
                    ),
                  ],
                ),

                const SizedBox(height: 10),

                Column(
                  children: _lotes.asMap().entries.map((entry) {
                    final index = entry.key;

                    final lote = entry.value;

                    final validadeRaw = lote['validade'];

                    DateTime? validade;

                    if (validadeRaw is Timestamp) {
                      validade = validadeRaw.toDate();
                    } else if (validadeRaw is DateTime) {
                      validade = validadeRaw;
                    }

                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        validade != null
                            ? 'Qtd: ${lote['quantidade']} | Vence: ${DateFormat('dd/MM/yyyy').format(validade)}'
                            : 'Qtd: ${lote['quantidade']}',
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete, color: Colors.red),
                        onPressed: () {
                          setState(() {
                            _lotes.removeAt(index);

                            _sincronizarTotalManual();
                          });
                        },
                      ),
                    );
                  }).toList(),
                ),

                const SizedBox(height: 16),

                // ============================================================
                // ESTOQUE MÍNIMO
                // ============================================================
                TextFormField(
                  controller: _minimumStockController,
                  decoration: const InputDecoration(
                    labelText: 'Estoque Mínimo para Alerta',
                  ),
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                ),

                // ============================================================
                // DADOS FISCAIS
                //
                // EXCLUSIVO BUSINESS
                // ============================================================
                if (widget.isBusiness) ...[
                  const SizedBox(height: 24),

                  const Divider(),

                  const SizedBox(height: 8),

                  // ==========================================================
                  // CABEÇALHO
                  // ==========================================================
                  Row(
                    children: [
                      const Icon(
                        Icons.receipt_long_outlined,
                        color: Colors.deepPurple,
                      ),

                      const SizedBox(width: 8),

                      const Expanded(
                        child: Text(
                          'Dados Fiscais',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),

                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.deepPurple.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text(
                          'BUSINESS',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: Colors.deepPurple,
                          ),
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 6),

                  Text(
                    'Informações utilizadas na emissão fiscal do produto.',
                    style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
                  ),

                  const SizedBox(height: 20),

                  // ==========================================================
                  // NCM
                  // ==========================================================
                  TextFormField(
                    controller: _ncmController,
                    decoration: InputDecoration(
                      labelText: 'NCM',
                      hintText: 'Ex.: 61091000',
                      helperText: 'Classificação fiscal do produto - 8 dígitos',
                      prefixIcon: const Icon(Icons.tag_outlined),

                      suffixIcon: IconButton(
                        tooltip: 'Pesquisar NCM',
                        onPressed: _openNcmSearch,
                        icon: const Icon(Icons.search),
                      ),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(8),
                    ],
                    validator: (value) {
                      if (!widget.isBusiness) {
                        return null;
                      }

                      final clean = (value ?? '').replaceAll(RegExp(r'\D'), '');

                      // O produto pode ser salvo com o fiscal ainda pendente.
                      // A emissão NFC-e fará a validação obrigatória depois.
                      if (clean.isEmpty) {
                        return null;
                      }

                      if (clean.length != 8) {
                        return 'O NCM deve possuir 8 dígitos.';
                      }

                      return null;
                    },
                  ),

                  const SizedBox(height: 16),

                  // ==========================================================
                  // ORIGEM
                  // ==========================================================
                  DropdownButtonFormField<String>(
                    value: _selectedOrigem,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Origem da Mercadoria',
                      prefixIcon: Icon(Icons.public_outlined),
                    ),
                    items: _origens.entries
                        .map(
                          (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                        .toList(),
                    onChanged: (value) {
                      if (value == null) {
                        return;
                      }

                      setState(() {
                        _selectedOrigem = value;
                      });
                    },
                  ),

                  const SizedBox(height: 16),

                  // ==========================================================
                  // CFOP
                  // ==========================================================
                  TextFormField(
                    controller: _cfopController,
                    decoration: const InputDecoration(
                      labelText: 'CFOP',
                      hintText: 'Ex.: 5102',
                      helperText: 'Código fiscal utilizado na operação',
                      prefixIcon: Icon(Icons.numbers_outlined),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(4),
                    ],
                    validator: (value) {
                      if (!widget.isBusiness) {
                        return null;
                      }

                      final clean = (value ?? '').replaceAll(RegExp(r'\D'), '');

                      if (clean.isEmpty) {
                        return null;
                      }

                      if (clean.length != 4) {
                        return 'O CFOP deve possuir 4 dígitos.';
                      }

                      return null;
                    },
                  ),

                  const SizedBox(height: 16),

                  // ==========================================================
                  // UNIDADE COMERCIAL
                  // ==========================================================
                  DropdownButtonFormField<String>(
                    value: _selectedUnidade,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Unidade Comercial',
                      prefixIcon: Icon(Icons.straighten_outlined),
                    ),
                    items: _unidades.entries
                        .map(
                          (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                        .toList(),
                    onChanged: (value) {
                      if (value == null) {
                        return;
                      }

                      setState(() {
                        _selectedUnidade = value;
                      });
                    },
                  ),

                  const SizedBox(height: 16),

                  // ==========================================================
                  // CEST
                  //
                  // Opcional, pois nem todo produto exige.
                  // ==========================================================
                  TextFormField(
                    controller: _cestController,
                    decoration: const InputDecoration(
                      labelText: 'CEST',
                      hintText: 'Opcional',
                      helperText: 'Preencha quando aplicável ao produto',
                      prefixIcon: Icon(Icons.description_outlined),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(7),
                    ],
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return null;
                      }

                      final clean = value.replaceAll(RegExp(r'\D'), '');

                      if (clean.length != 7) {
                        return 'O CEST deve possuir 7 dígitos.';
                      }

                      return null;
                    },
                  ),

                  const SizedBox(height: 20),

                  DropdownButtonFormField<String>(
                    value: _selectedIcmsSituacaoTributaria,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'CSOSN / ICMS',
                      helperText: 'Situação tributária do ICMS',
                      prefixIcon: Icon(Icons.account_balance_outlined),
                    ),
                    items: _icmsSituacoes.entries
                        .map(
                          (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                        .toList(),
                    onChanged: (value) {
                      if (value != null)
                        setState(() => _selectedIcmsSituacaoTributaria = value);
                    },
                  ),

                  const SizedBox(height: 16),

                  DropdownButtonFormField<String>(
                    value: _selectedPisSituacaoTributaria,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'CST PIS',
                      helperText: 'Situação tributária do PIS',
                      prefixIcon: Icon(Icons.receipt_outlined),
                    ),
                    items: _pisCofinsSituacoes.entries
                        .map(
                          (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                        .toList(),
                    onChanged: (value) {
                      if (value != null)
                        setState(() => _selectedPisSituacaoTributaria = value);
                    },
                  ),

                  const SizedBox(height: 16),

                  DropdownButtonFormField<String>(
                    value: _selectedCofinsSituacaoTributaria,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'CST COFINS',
                      helperText: 'Situação tributária da COFINS',
                      prefixIcon: Icon(Icons.receipt_long_outlined),
                    ),
                    items: _pisCofinsSituacoes.entries
                        .map(
                          (entry) => DropdownMenuItem<String>(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                        .toList(),
                    onChanged: (value) {
                      if (value != null)
                        setState(
                              () => _selectedCofinsSituacaoTributaria = value,
                        );
                    },
                  ),

                  const SizedBox(height: 20),

                  // ==========================================================
                  // IBS / CBS - REFORMA TRIBUTÁRIA 2026
                  //
                  // Não oferecemos valores padrão. Os dois códigos precisam
                  // corresponder ao enquadramento fiscal real do produto.
                  // ==========================================================
                  TextFormField(
                    controller: _ibsCbsSituacaoTributariaController,
                    decoration: const InputDecoration(
                      labelText: 'CST IBS/CBS',
                      hintText: '3 dígitos',
                      helperText:
                      'Obrigatório para emitir NFC-e; pode ficar pendente no cadastro',
                      prefixIcon: Icon(Icons.account_balance_wallet_outlined),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(3),
                    ],
                    validator: (value) {
                      if (!widget.isBusiness) {
                        return null;
                      }

                      final clean = (value ?? '').replaceAll(RegExp(r'\D'), '');

                      if (clean.isEmpty) {
                        return null;
                      }

                      if (clean.length != 3) {
                        return 'O CST IBS/CBS deve possuir 3 dígitos.';
                      }

                      return null;
                    },
                  ),

                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _ibsCbsClassificacaoTributariaController,
                    decoration: const InputDecoration(
                      labelText: 'Classificação Tributária IBS/CBS',
                      hintText: 'cClassTrib - 6 dígitos',
                      helperText: 'Obrigatório para emitir NFC-e; pode ficar pendente no cadastro',
                      prefixIcon: Icon(Icons.rule_folder_outlined),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(6),
                    ],
                    validator: (value) {
                      if (!widget.isBusiness) {
                        return null;
                      }

                      final clean = (value ?? '').replaceAll(RegExp(r'\D'), '');

                      if (clean.isEmpty) {
                        return null;
                      }

                      if (clean.length != 6) {
                        return 'A classificação tributária deve possuir 6 dígitos.';
                      }

                      return null;
                    },
                  ),

                  const SizedBox(height: 12),

                  // ==========================================================
                  // AVISO
                  // ==========================================================
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.amber.withOpacity(0.10),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: Colors.amber.withOpacity(0.35)),
                    ),
                    child: const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.info_outline, size: 20, color: Colors.amber),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Você pode salvar o produto com dados fiscais pendentes. Para emitir NFC-e, NCM, CFOP, CST IBS/CBS, cClassTrib e os demais campos fiscais deverão estar válidos.',
                            style: TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),

      // ======================================================================
      // AÇÕES
      // ======================================================================
      actions: [
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),

        ElevatedButton(
          onPressed: _isLoading ? null : _saveProduct,
          child: _isLoading
              ? const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
              : const Text('Salvar'),
        ),
      ],
    );
  }
}

// ============================================================================
// WIDGET DO DIÁLOGO
// ============================================================================

class _ProductDialog extends StatefulWidget {
  final String storeId;
  final DocumentSnapshot? product;

  // Informa se a loja possui Business ativo.
  final bool isBusiness;

  const _ProductDialog({
    required this.storeId,
    required this.isBusiness,
    this.product,
  });

  @override
  State<_ProductDialog> createState() => _ProductDialogState();
}

// ============================================================================
// TELA GERENCIAR PRODUTOS
// ============================================================================

class ManageProductsScreen extends StatefulWidget {
  final String storeId;

  const ManageProductsScreen({super.key, required this.storeId});

  @override
  State<ManageProductsScreen> createState() => _ManageProductsScreenState();
}

class _ManageProductsScreenState extends State<ManageProductsScreen> {
  final _searchController = TextEditingController();

  // ==========================================================================
  // PLANO DA LOJA
  //
  // Escutamos o documento da loja em tempo real.
  // Se a assinatura mudar de PRO para Business com esta tela aberta,
  // a permissão é atualizada automaticamente.
  // ==========================================================================

  StreamSubscription<DocumentSnapshot>? _storeSubscription;

  bool _isBusiness = false;
  bool _planLoaded = false;

  // ==========================================================================
  // INIT
  // ==========================================================================

  @override
  void initState() {
    super.initState();

    _listenStorePlan();
  }

  // ==========================================================================
  // ESCUTA O PLANO DA LOJA
  // ==========================================================================

  void _listenStorePlan() {
    _storeSubscription = FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .snapshots()
        .listen(
          (snapshot) {
        if (!snapshot.exists) {
          if (mounted) {
            setState(() {
              _isBusiness = false;
              _planLoaded = true;
            });
          }

          return;
        }

        final data = snapshot.data() as Map<String, dynamic>;

        final type = data['subscriptionType']?.toString() ?? 'free';

        final status = data['subscriptionStatus']?.toString() ?? 'inactive';

        final business = type == 'business' && status == 'active';

        if (mounted) {
          setState(() {
            _isBusiness = business;

            _planLoaded = true;
          });
        }

        debugPrint('=== 📦 PRODUTOS / PLANO ===');

        debugPrint('Tipo: $type');

        debugPrint('Status: $status');

        debugPrint('Business: $business');

        debugPrint('============================');
      },
      onError: (error) {
        debugPrint('Erro ao consultar plano da loja: $error');

        if (mounted) {
          setState(() {
            _isBusiness = false;

            _planLoaded = true;
          });
        }
      },
    );
  }

  // ==========================================================================
  // DISPOSE
  // ==========================================================================

  @override
  void dispose() {
    _searchController.dispose();

    _storeSubscription?.cancel();

    super.dispose();
  }

  // ==========================================================================
  // ABRE O CADASTRO / EDIÇÃO
  // ==========================================================================

  void _showProductDialog({DocumentSnapshot? product}) {
    // Ainda não sabemos o plano.
    if (!_planLoaded) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Carregando informações da assinatura...'),
        ),
      );

      return;
    }

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _ProductDialog(
        storeId: widget.storeId,
        product: product,
        isBusiness: _isBusiness,
      ),
    );
  }

  // ==========================================================================
  // EXCLUIR PRODUTO
  // ==========================================================================

  void _deleteProduct(String productId) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirmar Exclusão'),
        content: const Text(
          'Tem certeza que deseja excluir este produto? '
              'A imagem associada será removida permanentemente.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            onPressed: () async {
              await FirebaseFirestore.instance
                  .collection('stores')
                  .doc(widget.storeId)
                  .collection('products')
                  .doc(productId)
                  .delete();

              if (!ctx.mounted) {
                return;
              }

              Navigator.of(ctx).pop();
            },
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // BUILD
  // ==========================================================================

  @override
  Widget build(BuildContext context) {
    final isDarkMode = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      extendBodyBehindAppBar: true,

      body: Stack(
        children: [
          const DynamicBackground(),

          SafeArea(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1100),
                child: Column(
                  children: [
                    _buildCustomHeader(isDarkMode),

                    Expanded(
                      child: StreamBuilder<QuerySnapshot>(
                        stream: FirebaseFirestore.instance
                            .collection('stores')
                            .doc(widget.storeId)
                            .collection('products')
                            .orderBy('name_lowercase')
                            .snapshots(),
                        builder: (context, snapshot) {
                          if (snapshot.connectionState ==
                              ConnectionState.waiting) {
                            return const Center(
                              child: CircularProgressIndicator(),
                            );
                          }

                          if (snapshot.hasError) {
                            return const Center(
                              child: Text('Ocorreu um erro.'),
                            );
                          }

                          final allProducts = snapshot.data?.docs ?? [];

                          final query = _searchController.text
                              .trim()
                              .toLowerCase();

                          final filteredProducts = allProducts.where((doc) {
                            final data = doc.data() as Map<String, dynamic>;

                            final name =
                            (data['name_lowercase'] as String? ?? '')
                                .toLowerCase();

                            return name.contains(query);
                          }).toList();

                          if (filteredProducts.isEmpty) {
                            return Center(
                              child: Text(
                                _searchController.text.isEmpty
                                    ? 'Nenhum produto cadastrado.'
                                    : 'Nenhum produto encontrado.',
                                style: TextStyle(
                                  color: isDarkMode
                                      ? Colors.white70
                                      : Colors.black54,
                                  fontSize: 16,
                                ),
                              ),
                            );
                          }

                          return LayoutBuilder(
                            builder: (context, constraints) {
                              if (constraints.maxWidth > 768) {
                                return _buildProductDataTable(
                                  filteredProducts,
                                  isDarkMode,
                                  constraints,
                                );
                              }

                              return _buildProductListView(
                                filteredProducts,
                                isDarkMode,
                              );
                            },
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),

      floatingActionButton: FloatingActionButton(
        onPressed: _planLoaded ? () => _showProductDialog() : null,
        tooltip: 'Adicionar Produto',
        child: _planLoaded
            ? const Icon(Icons.add)
            : const SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );
  }

  // ==========================================================================
  // LISTA MOBILE
  // ==========================================================================

  Widget _buildProductListView(
      List<QueryDocumentSnapshot> products,
      bool isDarkMode,
      ) {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 80),
      itemCount: products.length,
      itemBuilder: (ctx, index) {
        final productDoc = products[index];

        final productData = productDoc.data() as Map<String, dynamic>;

        return _buildProductCard(productDoc, productData, isDarkMode);
      },
    );
  }

  // ==========================================================================
  // TABELA DESKTOP / WEB
  // ==========================================================================

  Widget _buildProductDataTable(
      List<QueryDocumentSnapshot> products,
      bool isDarkMode,
      BoxConstraints constraints,
      ) {
    final formatCurrency = NumberFormat.currency(
      locale: 'pt_BR',
      symbol: 'R\$',
    );

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: ConstrainedBox(
        constraints: BoxConstraints(minWidth: constraints.maxWidth),
        child: DataTable(
          columnSpacing: 24,
          headingRowColor: MaterialStateProperty.all(
            Theme.of(context).splashColor,
          ),
          columns: const [
            DataColumn(label: Text('Produto')),
            DataColumn(label: Text('Estoque (Mín.)'), numeric: true),
            DataColumn(label: Text('Preço'), numeric: true),
            DataColumn(label: Text('Ações')),
          ],
          rows: products.map((productDoc) {
            final productData = productDoc.data() as Map<String, dynamic>;

            final imageUrl = productData['imageUrl'] as String?;

            final quantidade = (productData['quantidade'] as num? ?? 0).toInt();

            final minimumStock = (productData['minimumStock'] as num? ?? 0)
                .toInt();

            final price = (productData['price'] as num? ?? 0).toDouble();

            final bool needsRestock = quantidade <= minimumStock;

            return DataRow(
              color: MaterialStateProperty.resolveWith<Color?>((
                  Set<MaterialState> states,
                  ) {
                if (needsRestock) {
                  return Colors.red.withOpacity(0.2);
                }

                return null;
              }),
              cells: [
                DataCell(
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: Colors.grey.shade700,
                        backgroundImage: imageUrl != null && imageUrl.isNotEmpty
                            ? NetworkImage(imageUrl)
                            : null,
                        child: imageUrl == null || imageUrl.isEmpty
                            ? const Icon(
                          Icons.inventory_2,
                          color: Colors.white,
                          size: 20,
                        )
                            : null,
                      ),
                      const SizedBox(width: 16),
                      Text(
                        productData['name'] ?? 'Sem nome',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),

                DataCell(
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (needsRestock)
                        const Icon(
                          Icons.warning_amber_rounded,
                          color: Colors.redAccent,
                          size: 18,
                        ),
                      if (needsRestock) const SizedBox(width: 8),
                      Text(
                        '$quantidade ($minimumStock)',
                        style: TextStyle(
                          color: needsRestock ? Colors.red.shade800 : null,
                          fontWeight: needsRestock
                              ? FontWeight.bold
                              : FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                ),

                DataCell(Text(formatCurrency.format(price))),

                DataCell(
                  Row(
                    children: [
                      IconButton(
                        icon: const Icon(Icons.edit, color: Colors.blueAccent),
                        onPressed: () =>
                            _showProductDialog(product: productDoc),
                        tooltip: 'Editar',
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete, color: Colors.red),
                        onPressed: () => _deleteProduct(productDoc.id),
                        tooltip: 'Excluir',
                      ),
                    ],
                  ),
                ),
              ],
            );
          }).toList(),
        ),
      ),
    );
  }

  // ==========================================================================
  // CABEÇALHO
  // ==========================================================================

  Widget _buildCustomHeader(bool isDarkMode) {
    final headerColor = isDarkMode ? Colors.white : Colors.black;

    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
      child: Column(
        children: [
          Row(
            children: [
              // ================================================================
              // VOLTAR
              // ================================================================
              IconButton(
                icon: Icon(Icons.arrow_back, color: headerColor),
                onPressed: () => Navigator.of(context).pop(),
              ),

              // ================================================================
              // TÍTULO
              // ================================================================
              Expanded(
                child: Text(
                  'Gerenciar Produtos',
                  style: TextStyle(
                    color: headerColor,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),

              // ================================================================
              // IMPORTAR PRODUTOS
              //
              // Disponível tanto para PRO quanto para BUSINESS.
              // Abre o assistente de importação XLSX / CSV.
              // ================================================================
              IconButton(
                tooltip: 'Importar produtos',
                icon: Icon(Icons.upload_file_outlined, color: headerColor),
                onPressed: _planLoaded
                    ? () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => ProductImportScreen(
                        storeId: widget.storeId,
                        isBusiness: _isBusiness,
                      ),
                    ),
                  );
                }
                    : null,
              ),

              // ================================================================
              // INDICADOR BUSINESS
              // ================================================================
              if (_isBusiness)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.deepPurple.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'BUSINESS',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                      color: Colors.deepPurple,
                    ),
                  ),
                )
              else
                const SizedBox(width: 8),
            ],
          ),

          const SizedBox(height: 8),

          TextField(
            controller: _searchController,
            onChanged: (value) => setState(() {}),
            style: TextStyle(color: isDarkMode ? Colors.white : Colors.black),
            decoration: InputDecoration(
              hintText: 'Buscar por nome...',
              hintStyle: TextStyle(
                color: isDarkMode ? Colors.white70 : Colors.black54,
              ),
              prefixIcon: Icon(
                Icons.search,
                color: isDarkMode ? Colors.white70 : Colors.black54,
              ),
              filled: true,
              fillColor: Theme.of(
                context,
              ).cardColor.withOpacity(isDarkMode ? 0.1 : 0.5),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(vertical: 0),
            ),
          ),
        ],
      ),
    );
  }

  // ==========================================================================
  // CARD MOBILE
  // ==========================================================================

  Widget _buildProductCard(
      DocumentSnapshot productDoc,
      Map<String, dynamic> productData,
      bool isDarkMode,
      ) {
    final imageUrl = productData['imageUrl'] as String?;

    final quantidade = (productData['quantidade'] as num? ?? 0).toInt();

    final minimumStock = (productData['minimumStock'] as num? ?? 0).toInt();

    final bool needsRestock = quantidade <= minimumStock;

    // Verifica apenas para mostrar um pequeno indicador.
    final fiscal = productData['fiscal'];

    final bool hasFiscalData =
        fiscal is Map &&
            fiscal['ncm'] != null &&
            fiscal['ncm'].toString().isNotEmpty;

    return Card(
      color: isDarkMode
          ? Colors.black.withOpacity(0.6)
          : Colors.white.withOpacity(0.8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(15),
        side: BorderSide(
          color: needsRestock
              ? Colors.redAccent.withOpacity(0.8)
              : Colors.transparent,
          width: 2,
        ),
      ),
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
        leading: CircleAvatar(
          radius: 25,
          backgroundColor: Colors.grey.shade700,
          backgroundImage: imageUrl != null && imageUrl.isNotEmpty
              ? NetworkImage(imageUrl)
              : null,
          child: imageUrl == null || imageUrl.isEmpty
              ? const Icon(Icons.inventory_2, color: Colors.white)
              : null,
        ),
        title: Text(
          productData['name'] ?? 'Sem nome',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Em estoque: $quantidade (Mín: $minimumStock)',
              style: TextStyle(
                color: needsRestock
                    ? Colors.amber.shade600
                    : Theme.of(context).textTheme.bodySmall?.color,
                fontWeight: needsRestock ? FontWeight.bold : FontWeight.normal,
              ),
            ),

            // Somente Business vê indicação fiscal.
            if (_isBusiness)
              Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(
                  hasFiscalData
                      ? 'Fiscal configurado ✓'
                      : 'Dados fiscais pendentes',
                  style: TextStyle(
                    fontSize: 11,
                    color: hasFiscalData ? Colors.green : Colors.orange,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (needsRestock)
              const Icon(Icons.warning_amber_rounded, color: Colors.redAccent),

            IconButton(
              icon: const Icon(Icons.edit, color: Colors.blueAccent),
              onPressed: () => _showProductDialog(product: productDoc),
            ),

            IconButton(
              icon: const Icon(Icons.delete, color: Colors.red),
              onPressed: () => _deleteProduct(productDoc.id),
            ),
          ],
        ),
      ),
    );
  }
}
