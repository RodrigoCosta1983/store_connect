import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../services/product_cadastral_edit.dart';
import 'product_category_groups.dart';

List<ProductCategoryOption> cadastralCategoryOptions(
  List<QueryDocumentSnapshot<Map<String, dynamic>>> documents,
) {
  final rows = {for (final doc in documents) doc.id: doc.data()};
  return documents.map((doc) {
    final data = doc.data();
    final parent = data['parentCategoryId'];
    final validRoot = parent == null;
    final validChild =
        parent is String &&
        parent.isNotEmpty &&
        parent != doc.id &&
        rows.containsKey(parent) &&
        rows[parent]!['parentCategoryId'] == null;
    return ProductCategoryOption(
      doc.id,
      data['name'] is String
          ? data['name'] as String
          : 'Categoria indisponível',
      parentId: validChild ? parent : null,
      invalidHierarchy:
          (!validRoot && !validChild) ||
          data['name'] is! String ||
          (data['name'] as String).trim().isEmpty,
    );
  }).toList();
}

class ProductCadastralEditDialog extends StatefulWidget {
  final ProductCadastralEditAccess access;
  final String productId;
  final String storeId;
  final bool isBusiness;
  final Stream<List<ProductCategoryOption>>? categories;
  const ProductCadastralEditDialog({
    super.key,
    required this.access,
    required this.productId,
    required this.storeId,
    required this.isBusiness,
    this.categories,
  });
  @override
  State<ProductCadastralEditDialog> createState() =>
      _ProductCadastralEditDialogState();
}

class _ProductCadastralEditDialogState
    extends State<ProductCadastralEditDialog> {
  late final ProductCadastralEditSession _session;
  final Map<String, TextEditingController> _controllers = {};
  ProductCadastralDraft? _renderedDraft;
  static const labels = {
    'name': 'Nome do Produto',
    'price': 'Preço',
    'cod': 'COD',
    'barcode': 'Código de barras',
    'costPrice': 'Preço de custo',
    'minimumStock': 'Estoque mínimo',
    'imageUrl': 'URL da imagem',
    'ncm': 'NCM',
    'origem': 'Origem',
    'cfop': 'CFOP',
    'unidade': 'Unidade',
    'cest': 'CEST',
    'icmsSituacaoTributaria': 'Situação ICMS',
    'pisSituacaoTributaria': 'CST PIS',
    'cofinsSituacaoTributaria': 'CST COFINS',
    'ibsCbsSituacaoTributaria': 'CST IBS/CBS',
    'ibsCbsClassificacaoTributaria': 'Classificação Tributária IBS/CBS',
  };
  @override
  void initState() {
    super.initState();
    _session = ProductCadastralEditSession(
      access: widget.access,
      productId: widget.productId,
      storeId: widget.storeId,
      allowFiscal: widget.isBusiness,
    );
    unawaited(_session.open());
  }

  @override
  void dispose() {
    _session.dispose();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _syncDraft() {
    final draft = _session.draft;
    if (draft == null || identical(draft, _renderedDraft)) return;
    _renderedDraft = draft;
    for (final field in cadastralFields) {
      (_controllers[field] ??= TextEditingController()).text =
          draft.value(field)?.toString() ?? '';
    }
    for (final field in editableFiscalFields) {
      (_controllers['fiscal.$field'] ??= TextEditingController()).text =
          draft.value(field, fiscal: true)?.toString() ?? '';
    }
  }

  Widget _field(String field, {bool fiscal = false}) {
    final draft = _session.draft!;
    final path = fiscal ? 'fiscal.$field' : field;
    final locked =
        !_session.canEdit ||
        (fiscal && draft.fiscalLocked) ||
        (field == 'cod' && draft.baseline.product['isArchived'] == true);
    final intent = draft.intent(field, fiscal: fiscal);
    final helper = {
      'preserve': 'Preservado',
      'set': 'Valor modificado',
      'null': 'Valor null explícito',
      'remove': 'Remoção explícita',
    }[intent];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: TextField(
              key: ValueKey('cadastral-$path'),
              controller: _controllers[path],
              enabled: !locked,
              keyboardType:
                  {'price', 'costPrice', 'minimumStock'}.contains(field)
                  ? const TextInputType.numberWithOptions(decimal: true)
                  : TextInputType.text,
              decoration: InputDecoration(
                labelText: labels[field],
                helperText: helper,
                errorText: _session.errorFor(path),
              ),
              onChanged: (value) =>
                  _session.setText(field, value, fiscal: fiscal),
            ),
          ),
          PopupMenuButton<String>(
            key: ValueKey('actions-$path'),
            enabled: !locked,
            tooltip: 'Ações para ${labels[field]}',
            onSelected: (action) {
              _session.fieldAction(field, action, fiscal: fiscal);
              _controllers[path]!.text =
                  draft.value(field, fiscal: fiscal)?.toString() ?? '';
            },
            itemBuilder: (_) => [
              const PopupMenuItem(
                value: 'reset',
                child: Text('Desfazer alteração'),
              ),
              if (fiscal)
                const PopupMenuItem(value: 'null', child: Text('Definir null')),
              if (fiscal || removableCadastralFields.contains(field))
                const PopupMenuItem(
                  value: 'remove',
                  child: Text('Remover campo'),
                ),
            ],
          ),
        ],
      ),
    );
  }

  String get _message => switch (_session.status) {
    CadastralEditStatus.loading => 'Carregando estado atual do produto…',
    CadastralEditStatus.editing => 'Revise os campos que deseja alterar.',
    CadastralEditStatus.noChanges => 'Nenhuma alteração cadastral para enviar.',
    CadastralEditStatus.validationError => 'Revise os campos destacados.',
    CadastralEditStatus.persisting =>
      'Guardando a tentativa neste dispositivo…',
    CadastralEditStatus.sending => 'Enviando a tentativa guardada…',
    CadastralEditStatus.checking => 'Consultando o resultado da tentativa…',
    CadastralEditStatus.confirmed =>
      'Operação confirmada. Cadastro salvo com segurança.',
    CadastralEditStatus.rejected =>
      _session.rejectionReason == 'duplicate-product-cod'
          ? 'Alteração rejeitada definitivamente: este COD já está sendo usado por outro produto.'
          : 'Alteração rejeitada definitivamente. Revise os dados antes de uma nova tentativa.',
    CadastralEditStatus.versionConflict =>
      'Conflito de versão: o produto mudou em outro acesso. Carregue os dados atuais e revise sua alteração.',
    CadastralEditStatus.unknown =>
      'Resultado ainda desconhecido. A tentativa foi preservada. Consulte o resultado ou repita a mesma tentativa.',
    CadastralEditStatus.identityConflict =>
      'A identidade da tentativa está em conflito com outro comando. A edição permanece bloqueada para reconciliação.',
    CadastralEditStatus.persistenceFailure =>
      'Falha no armazenamento local ou dados locais corrompidos. A tentativa foi bloqueada; verifique o armazenamento antes de continuar.',
    CadastralEditStatus.scopeChanged =>
      'Edição suspensa: a conta, loja ou projeto mudou. Feche esta janela.',
    CadastralEditStatus.readFailure =>
      'Não foi possível carregar o estado atual. Tente carregar novamente.',
    CadastralEditStatus.disabled => 'Edição cadastral local desabilitada.',
  };
  Future<void> _review() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revisar dados atuais'),
        content: const Text(
          'O formulário será carregado com os dados atuais. As alterações da tentativa anterior deverão ser revisadas e informadas novamente.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Carregar para revisão'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) await _session.reviewCurrentState();
  }

  Widget _categories() {
    final draft = _session.draft!;
    return StreamBuilder<List<ProductCategoryOption>>(
      stream: widget.categories,
      builder: (context, snapshot) {
        final options = snapshot.data ?? const <ProductCategoryOption>[];
        final selected = draft.categoryIds;
        final absent = selected
            .where((id) => !options.any((o) => o.id == id))
            .toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Categorias',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            if (draft.categoriesLocked)
              const Text(
                'Taxonomia inválida: associações preservadas e edição bloqueada.',
              ),
            if (snapshot.hasError)
              const Text(
                'Opções indisponíveis. As associações atuais foram preservadas.',
              ),
            ProductCategoryGroups(
              options: options,
              selectedIds: selected,
              locked: !_session.canEdit || draft.categoriesLocked,
              onChanged: (id, enabled) {
                final option = options.firstWhere((o) => o.id == id);
                if (enabled && option.invalidHierarchy) return;
                final ids = List<String>.of(selected);
                if (enabled) {
                  ids.add(id);
                } else {
                  ids.remove(id);
                }
                _session.selectCategories(ids);
              },
            ),
            for (final id in absent)
              InputChip(
                label: Text('Categoria indisponível ($id)'),
                onDeleted: _session.canEdit && !draft.categoriesLocked
                    ? () => _session.selectCategories(
                        List<String>.of(selected)..remove(id),
                      )
                    : null,
              ),
            if (_session.errorFor('categories') != null)
              Text(_session.errorFor('categories')!),
            const SizedBox(height: 16),
          ],
        );
      },
    );
  }

  Widget _frozenSummary() {
    final changes = _session.frozenCommand!['changes'] as Map;
    final set = changes['set'] as Map? ?? {};
    final fiscal = changes['fiscal'] as Map? ?? {};
    final fiscalSet = fiscal['set'] as Map? ?? {};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Alterações da tentativa guardada',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        for (final field in set.keys) Text('${labels[field]}: ${set[field]}'),
        for (final field in (changes['remove'] as List? ?? []))
          Text('Remover ${labels[field]}'),
        for (final field in fiscalSet.keys)
          Text('${labels[field]}: ${fiscalSet[field] ?? 'null'}'),
        for (final field in (fiscal['remove'] as List? ?? []))
          Text('Remover ${labels[field]}'),
        if (changes['categories'] is Map)
          Text(
            'Categorias: ${(changes['categories']['ids'] as List).join(', ')}',
          ),
        const SizedBox(height: 12),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _session,
    builder: (context, _) {
      _syncDraft();
      final status = _session.status;
      final hidden = {
        CadastralEditStatus.scopeChanged,
        CadastralEditStatus.disabled,
      }.contains(status);
      final terminal = {
        CadastralEditStatus.confirmed,
        CadastralEditStatus.rejected,
        CadastralEditStatus.versionConflict,
      }.contains(status);
      return PopScope(
        canPop: !_session.busy,
        child: AlertDialog(
          title: const Text('Editar cadastro do produto'),
          content: SizedBox(
            width: 600,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      _message,
                      key: const ValueKey('cadastral-status'),
                      style: TextStyle(
                        color: status == CadastralEditStatus.confirmed
                            ? Colors.green.shade700
                            : {
                                CadastralEditStatus.unknown,
                                CadastralEditStatus.versionConflict,
                              }.contains(status)
                            ? Colors.orange.shade800
                            : null,
                      ),
                    ),
                  ),
                  if (_session.busy) const LinearProgressIndicator(),
                  const SizedBox(height: 16),
                  if (!hidden && _session.frozenCommand != null)
                    _frozenSummary(),
                  if (!hidden && _session.draft != null) ...[
                    if (_session.draft!.baseline.product['isArchived'] == true)
                      const Text(
                        'Produto arquivado. O COD permanece protegido.',
                      ),
                    for (final field in [
                      'name',
                      'price',
                      'cod',
                      'barcode',
                      'costPrice',
                      'minimumStock',
                      'imageUrl',
                    ])
                      _field(field),
                    _categories(),
                    const Text(
                      'Estoque e lotes serão gerenciados em uma ação própria.',
                    ),
                    if (widget.isBusiness) ...[
                      const Divider(),
                      const Text(
                        'Dados fiscais',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      if (_session.draft!.fiscalLocked)
                        const Text(
                          'Dados fiscais incompatíveis: preservados; edição fiscal bloqueada.',
                        ),
                      for (final field in editableFiscalFields)
                        _field(field, fiscal: true),
                    ],
                  ] else if (!hidden && _session.frozenCommand != null)
                    const Text(
                      'Uma tentativa anterior foi retomada. O comando guardado permanece bloqueado para edição.',
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: _session.busy ? null : () => Navigator.pop(context),
              child: const Text('Fechar'),
            ),
            if (_session.canEdit)
              FilledButton(
                onPressed: _session.save,
                child: const Text('Salvar cadastro'),
              ),
            if (terminal)
              TextButton(
                onPressed: _session.busy ? null : _review,
                child: const Text('Revisar dados atuais'),
              ),
            if ({
              CadastralEditStatus.unknown,
              CadastralEditStatus.persistenceFailure,
            }.contains(status))
              TextButton(
                onPressed: _session.busy ? null : _session.checkResult,
                child: const Text('Consultar tentativa'),
              ),
            if (status == CadastralEditStatus.unknown)
              FilledButton(
                onPressed: _session.busy ? null : _session.retrySameCommand,
                child: const Text('Repetir mesma tentativa'),
              ),
            if (status == CadastralEditStatus.readFailure)
              TextButton(
                onPressed: _session.busy ? null : _session.open,
                child: const Text('Carregar novamente'),
              ),
          ],
        ),
      );
    },
  );
}
