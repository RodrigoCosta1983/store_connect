import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

class PublicCatalogScreen extends StatefulWidget {
  const PublicCatalogScreen({
    super.key,
    required this.publicSlug,
    required this.publicToken,
  });

  final String publicSlug;
  final String publicToken;

  @override
  State<PublicCatalogScreen> createState() =>
      _PublicCatalogScreenState();
}

class _PublicCatalogScreenState
    extends State<PublicCatalogScreen>
    with WidgetsBindingObserver {
  bool _isLoading = true;
  String? _errorMessage;

  Map<String, dynamic>? _store;
  Map<String, dynamic>? _catalog;

  int _availableProducts = 0;

  List<Map<String, dynamic>> _products =
      <Map<String, dynamic>>[];

  Map<String, int> _selectedQuantities =
      <String, int>{};

  bool _isCatalogRequestInFlight = false;
  bool _refreshOnResumeArmed = false;
  bool _isManualRefreshInProgress = false;

  bool _isSummaryOpen = false;
  bool _isSubmittingSelection = false;

  bool _isSelectionMode = false;
  bool _isEnteringSelectionMode = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadCatalog();
  }

  @override
  void didChangeAppLifecycleState(
    AppLifecycleState state,
  ) {
    if (state == AppLifecycleState.resumed) {
      if (_refreshOnResumeArmed) {
        _refreshOnResumeArmed = false;

        _loadCatalog(
          showLoading: false,
        );
      }

      return;
    }

    if (
      state == AppLifecycleState.inactive ||
      state == AppLifecycleState.paused ||
      state == AppLifecycleState.hidden
    ) {
      _refreshOnResumeArmed = true;
    }
  }
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _refreshCatalogManually() async {
    if (
      !mounted ||
      _isManualRefreshInProgress
    ) {
      return;
    }

    setState(() {
      _isManualRefreshInProgress = true;
    });

    try {
      await _loadCatalog(
        showLoading: false,
      );
    } finally {
      if (mounted) {
        setState(() {
          _isManualRefreshInProgress = false;
        });
      }
    }
  }

  Future<void> _startSelectionMode() async {
    if (
      !mounted ||
      _isSelectionMode ||
      _isEnteringSelectionMode ||
      _isManualRefreshInProgress
    ) {
      return;
    }

    if (_isCatalogRequestInFlight) {
      final messenger =
          ScaffoldMessenger.maybeOf(context);

      messenger?.showSnackBar(
        const SnackBar(
          content: Text(
            'Aguarde a atualização do catálogo terminar.',
          ),
        ),
      );

      return;
    }

    setState(() {
      _isEnteringSelectionMode = true;
    });

    final refreshed =
        await _loadCatalog(
      showLoading: false,
    );

    if (!mounted) {
      return;
    }

    if (refreshed) {
      setState(() {
        _isEnteringSelectionMode = false;
        _isSelectionMode = true;
      });

      return;
    }

    setState(() {
      _isEnteringSelectionMode = false;
    });

    if (_errorMessage == null) {
      final messenger =
          ScaffoldMessenger.maybeOf(context);

      messenger?.showSnackBar(
        const SnackBar(
          content: Text(
            'Não foi possível atualizar o catálogo. Tente novamente.',
          ),
        ),
      );
    }
  }

  void _cancelSelectionMode() {
    if (
      !mounted ||
      !_isSelectionMode ||
      _isEnteringSelectionMode
    ) {
      return;
    }

    setState(() {
      _isSelectionMode = false;
      _selectedQuantities =
          <String, int>{};
    });
  }

  String _selectionProductId(
    Map<String, dynamic> product,
  ) {
    return _stringValue(
      product,
      'productId',
      '',
    ).trim();
  }

  int _selectionAvailableQuantity(
    Map<String, dynamic> product,
  ) {
    final availableRaw =
        _doubleValue(
      product['quantidade'],
    );

    if (
      !availableRaw.isFinite ||
      availableRaw <= 0
    ) {
      return 0;
    }

    return availableRaw.floor();
  }

  List<Map<String, dynamic>>
      _selectedProductsForSummary() {
    final selectedProducts =
        <Map<String, dynamic>>[];

    for (final product in _products) {
      final productId =
          _selectionProductId(product);

      if (productId.isEmpty) {
        continue;
      }

      final selectedQuantity =
          _selectedQuantities[productId] ?? 0;

      if (selectedQuantity <= 0) {
        continue;
      }

      selectedProducts.add(product);
    }

    return selectedProducts;
  }

  int _selectedUnitsCount(
    List<Map<String, dynamic>> selectedProducts,
  ) {
    var totalUnits = 0;

    for (final product in selectedProducts) {
      final productId =
          _selectionProductId(product);

      totalUnits +=
          _selectedQuantities[productId] ?? 0;
    }

    return totalUnits;
  }

  double _selectionTotalValue(
    List<Map<String, dynamic>> selectedProducts,
  ) {
    var total = 0.0;

    for (final product in selectedProducts) {
      final productId =
          _selectionProductId(product);

      final selectedQuantity =
          _selectedQuantities[productId] ?? 0;

      final price =
          _doubleValue(
        product['price'],
      );

      total +=
          price * selectedQuantity;
    }

    return total;
  }

  Future<void> _openSelectionSummary() async {
    if (
      !mounted ||
      !_isSelectionMode ||
      _selectedQuantities.isEmpty ||
      _isSummaryOpen ||
      _isCatalogRequestInFlight
    ) {
      return;
    }

    final selectedProducts =
        _selectedProductsForSummary();

    if (selectedProducts.isEmpty) {
      return;
    }

    final totalUnits =
        _selectedUnitsCount(
      selectedProducts,
    );

    final totalValue =
        _selectionTotalValue(
      selectedProducts,
    );

    // Mantem o resumo e o payload no mesmo snapshot durante o dialogo.
    final submittedQuantities =
        Map<String, int>.from(_selectedQuantities);
    var sent = false;
    var refreshAfterSubmit = false;
    String? submitError;
    Map<String, dynamic>? revalidationError;
    _isSummaryOpen = true;

    try {
      await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
        return PopScope(
          canPop: !_isSubmittingSelection,
          child: AlertDialog(
          scrollable: true,
          title: const Text(
            'Resumo da seleção',
          ),
          content: SizedBox(
            width: 560,
            child: Column(
              mainAxisSize:
                  MainAxisSize.min,
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  '${selectedProducts.length} '
                  'produto(s) • '
                  '$totalUnits unidade(s)',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium,
                ),
                const SizedBox(height: 16),
                for (
                  final product
                      in selectedProducts
                ) ...[
                  Builder(
                    builder: (context) {
                      final productId =
                          _selectionProductId(
                        product,
                      );

                      final quantity =
                          submittedQuantities[
                                productId
                              ] ??
                              0;

                      final price =
                          _doubleValue(
                        product['price'],
                      );

                      final subtotal =
                          price * quantity;

                      final name =
                          _stringValue(
                        product,
                        'name',
                        'Produto',
                      );

                      return Container(
                        width:
                            double.infinity,
                        padding:
                            const EdgeInsets.all(
                          12,
                        ),
                        decoration:
                            BoxDecoration(
                          color:
                              const Color(
                            0xFFF9FAFB,
                          ),
                          borderRadius:
                              BorderRadius.circular(
                            12,
                          ),
                          border:
                              Border.all(
                            color:
                                const Color(
                              0xFFE5E7EB,
                            ),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment
                                  .start,
                          children: [
                            Row(
                              crossAxisAlignment:
                                  CrossAxisAlignment
                                      .start,
                              children: [
                                Expanded(
                                  child: Text(
                                    name,
                                    style: Theme.of(
                                      context,
                                    )
                                        .textTheme
                                        .titleSmall
                                        ?.copyWith(
                                          fontWeight:
                                              FontWeight
                                                  .w600,
                                        ),
                                  ),
                                ),
                                const SizedBox(
                                  width: 12,
                                ),
                                Text(
                                  _formatPrice(
                                    subtotal,
                                  ),
                                  style: Theme.of(
                                    context,
                                  )
                                      .textTheme
                                      .titleSmall
                                      ?.copyWith(
                                        fontWeight:
                                            FontWeight
                                                .w700,
                                      ),
                                ),
                              ],
                            ),
                            const SizedBox(
                              height: 6,
                            ),
                            Text(
                              '$quantity × '
                              '${_formatPrice(price)}',
                              style: Theme.of(
                                context,
                              )
                                  .textTheme
                                  .bodySmall,
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 10),
                ],
                const Divider(height: 24),
                Row(
                  children: [
                    Text(
                      'Total',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(
                            fontWeight:
                                FontWeight.w700,
                          ),
                    ),
                    const Spacer(),
                    Text(
                      _formatPrice(
                        totalValue,
                      ),
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(
                            fontWeight:
                                FontWeight.w700,
                          ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'Valores e disponibilidade '
                  'serão confirmados no envio.',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(
                        color:
                            const Color(
                          0xFF6B7280,
                        ),
                      ),
                ),
                if (submitError != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    submitError!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: _isSubmittingSelection ? null : () {
                Navigator.of(
                  dialogContext,
                ).pop();
              },
              child: const Text(
                'Voltar',
              ),
            ),
            FilledButton(
              onPressed: _isSubmittingSelection ? null : () async {
                if (_isSubmittingSelection) {
                  return;
                }
                setDialogState(() {
                  _isSubmittingSelection = true;
                  submitError = null;
                });
                try {
                  final callable =
                      FirebaseFunctions.instance.httpsCallable(
                    'submitPublicCatalogSelection',
                    options: HttpsCallableOptions(
                      timeout: const Duration(seconds: 30),
                    ),
                  );
                  final response = await callable.call(
                    <String, dynamic>{
                      'publicSlug': widget.publicSlug,
                      'publicToken': widget.publicToken,
                      'items': submittedQuantities.entries.map((entry) {
                        return <String, dynamic>{
                          'productId': entry.key,
                          'quantity': entry.value,
                        };
                      }).toList(growable: false),
                    },
                  );
                  final data = response.data;
                  if (data is! Map ||
                      data['success'] != true ||
                      data['requestId'] is! String ||
                      (data['requestId'] as String).trim().isEmpty) {
                    throw const FormatException('Envio nao confirmado.');
                  }
                  if (!mounted || !dialogContext.mounted) {
                    return;
                  }
                  sent = true;
                  Navigator.of(dialogContext).pop();
                } on FirebaseFunctionsException catch (error) {
                  if (!mounted || !dialogContext.mounted) {
                    return;
                  }
                  if (error.code == 'failed-precondition' ||
                      error.code == 'not-found' ||
                      error.code == 'invalid-argument') {
                    revalidationError = _toStringDynamicMap(error.details);
                    refreshAfterSubmit = true;
                    Navigator.of(dialogContext).pop();
                  } else {
                    submitError =
                        'Não foi possível confirmar o envio. '
                        'Sua seleção foi mantida. Tente novamente.';
                  }
                } catch (_) {
                  submitError =
                      'Não foi possível confirmar o envio. '
                      'Sua seleção foi mantida. Tente novamente.';
                } finally {
                  if (!sent && !refreshAfterSubmit &&
                      mounted && dialogContext.mounted) {
                    setDialogState(() {
                      _isSubmittingSelection = false;
                    });
                  }
                }
              },
              child: _isSubmittingSelection
                  ? const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        SizedBox(width: 8),
                        Text('Enviando...'),
                      ],
                    )
                  : const Text('Enviar'),
            ),
          ],
        ),
        );
        },
      ),
    );
    } finally {
      _isSummaryOpen = false;
      _isSubmittingSelection = false;
    }

    if (!mounted) {
      return;
    }
    if (sent) {
      setState(() {
        _selectedQuantities = <String, int>{};
        _isSelectionMode = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Solicitação enviada à loja com sucesso.'),
        ),
      );
    } else if (refreshAfterSubmit) {
      _reconcileSubmissionError(revalidationError);
      await _loadCatalog(showLoading: false);
      if (!mounted || _errorMessage != null) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            revalidationError?['reason'] != null
                ? 'Os dados ou a disponibilidade mudaram. '
                    'Revise a seleção antes de enviar novamente.'
                : 'Não foi possível enviar a solicitação agora. '
                    'Revise a seleção e tente novamente.',
          ),
        ),
      );
    }
  }

  void _reconcileSubmissionError(Map<String, dynamic>? details) {
    final productId = details?['productId'];
    final reason = details?['reason'];
    if (productId is! String) {
      return;
    }
    final unavailable = reason == 'product-not-in-catalog' ||
        reason == 'product-unavailable' ||
        reason == 'product-archived' ||
        reason == 'invalid-product-data';
    final rawAvailable = details?['availableQuantity'];
    final available = rawAvailable is num &&
            rawAvailable.isFinite && rawAvailable >= 0
        ? rawAvailable.floor()
        : null;
    if (!unavailable && available == null) {
      return;
    }
    final products = <Map<String, dynamic>>[];
    for (final product in _products) {
      if (_selectionProductId(product) != productId) {
        products.add(product);
      } else if (!unavailable && available! > 0) {
        products.add({...product, 'quantidade': available});
      }
    }
    setState(() {
      _selectedQuantities = _reconcileSelectedQuantities(products);
      _products = products;
      _availableProducts = products.length;
    });
  }

  int _selectedQuantityForProduct(
    Map<String, dynamic> product,
  ) {
    final productId =
        _selectionProductId(product);

    if (productId.isEmpty) {
      return 0;
    }

    return _selectedQuantities[productId] ?? 0;
  }

  void _incrementSelectedQuantity(
    Map<String, dynamic> product,
  ) {
    if (
      !mounted ||
      !_isSelectionMode ||
      _isEnteringSelectionMode
    ) {
      return;
    }

    final productId =
        _selectionProductId(product);

    if (productId.isEmpty) {
      return;
    }

    final available =
        _selectionAvailableQuantity(product);

    if (available <= 0) {
      return;
    }

    final current =
        _selectedQuantities[productId] ?? 0;

    if (current >= available) {
      return;
    }

    final updated =
        Map<String, int>.from(
      _selectedQuantities,
    );

    updated[productId] =
        current + 1;

    setState(() {
      _selectedQuantities = updated;
    });
  }

  void _decrementSelectedQuantity(
    Map<String, dynamic> product,
  ) {
    if (
      !mounted ||
      !_isSelectionMode ||
      _isEnteringSelectionMode
    ) {
      return;
    }

    final productId =
        _selectionProductId(product);

    if (productId.isEmpty) {
      return;
    }

    final current =
        _selectedQuantities[productId] ?? 0;

    if (current <= 0) {
      return;
    }

    final updated =
        Map<String, int>.from(
      _selectedQuantities,
    );

    if (current == 1) {
      updated.remove(productId);
    }
    else {
      updated[productId] =
          current - 1;
    }

    setState(() {
      _selectedQuantities = updated;
    });
  }

  Map<String, int> _reconcileSelectedQuantities(
    List<Map<String, dynamic>> products,
  ) {
    if (_selectedQuantities.isEmpty) {
      return <String, int>{};
    }

    final availableByProductId =
        <String, int>{};

    for (final product in products) {
      final productId =
          _selectionProductId(product);

      if (productId.isEmpty) {
        continue;
      }

      final available =
          _selectionAvailableQuantity(product);

      if (available > 0) {
        availableByProductId[productId] =
            available;
      }
    }

    final reconciled =
        <String, int>{};

    _selectedQuantities.forEach(
      (productId, selectedQuantity) {
        final available =
            availableByProductId[productId];

        if (
          available == null ||
          available <= 0 ||
          selectedQuantity <= 0
        ) {
          return;
        }

        reconciled[productId] =
            selectedQuantity > available
                ? available
                : selectedQuantity;
      },
    );

    return reconciled;
  }

  Future<bool> _loadCatalog({
    bool showLoading = true,
  }) async {
    if (
      !mounted ||
      _isCatalogRequestInFlight ||
      _isSummaryOpen
    ) {
      return false;
    }

    _isCatalogRequestInFlight = true;

    final hasCurrentCatalog =
        _store != null &&
        _catalog != null;

    if (showLoading) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final callable =
          FirebaseFunctions.instance.httpsCallable(
        'getPublicCatalog',
        options: HttpsCallableOptions(
          timeout: const Duration(seconds: 30),
        ),
      );

      final response = await callable.call(
        <String, dynamic>{
          'publicSlug': widget.publicSlug,
          'publicToken': widget.publicToken,
        },
      );

      final rawData = response.data;

      if (rawData is! Map) {
        throw const FormatException(
          'Resposta pública inválida.',
        );
      }

      final data =
          Map<String, dynamic>.from(rawData);

      if (data['success'] != true) {
        throw const FormatException(
          'Catálogo não disponível.',
        );
      }

      final store =
          _toStringDynamicMap(data['store']);

      final catalog =
          _toStringDynamicMap(data['catalog']);

      final rawProducts = data['products'];

      if (
        store == null ||
        catalog == null ||
        rawProducts is! List
      ) {
        throw const FormatException(
          'Contrato público incompleto.',
        );
      }

      final products =
          rawProducts
              .whereType<Map>()
              .map(
                (product) =>
                    Map<String, dynamic>.from(
                      product,
                    ),
              )
              .toList(growable: false);

      final reconciledSelectedQuantities =
          _reconcileSelectedQuantities(
        products,
      );

      if (!mounted) {
        return false;
      }

      setState(() {
        _store = store;
        _catalog = catalog;
        _products = products;
        _selectedQuantities =
            reconciledSelectedQuantities;
        _availableProducts = products.length;
        _isLoading = false;
        _errorMessage = null;
      });

      return true;
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) {
        return false;
      }

      final catalogBecameUnavailable =
          error.code == 'invalid-argument' ||
          error.code == 'not-found' ||
          error.code == 'failed-precondition';

      if (
        showLoading ||
        !hasCurrentCatalog ||
        catalogBecameUnavailable
      ) {
        setState(() {
          _isLoading = false;
          _errorMessage =
              _messageForFunctionsError(error);
        });
      }

      return false;
    } catch (_) {
      if (!mounted) {
        return false;
      }

      if (
        showLoading ||
        !hasCurrentCatalog
      ) {
        setState(() {
          _isLoading = false;
          _errorMessage =
              'Não foi possível carregar este catálogo agora.';
        });
      }

      return false;
    } finally {
      _isCatalogRequestInFlight = false;
    }
  }
  Map<String, dynamic>? _toStringDynamicMap(
    dynamic value,
  ) {
    if (value is! Map) {
      return null;
    }

    return Map<String, dynamic>.from(value);
  }

  String _messageForFunctionsError(
    FirebaseFunctionsException error,
  ) {
    switch (error.code) {
      case 'invalid-argument':
        return 'Este link de catálogo é inválido.';

      case 'not-found':
        return 'Este catálogo não foi encontrado ou não está mais disponível.';

      case 'failed-precondition':
        return 'Este catálogo expirou ou não está mais disponível.';

      case 'deadline-exceeded':
      case 'unavailable':
        return 'Não foi possível carregar o catálogo agora. Tente novamente.';

      default:
        return 'Não foi possível carregar este catálogo agora.';
    }
  }

  String _stringValue(
    Map<String, dynamic>? data,
    String key,
    String fallback,
  ) {
    final value = data?[key];

    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }

    return fallback;
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: SafeArea(
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 20),
                Text(
                  'Carregando catálogo...',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (_errorMessage != null) {
      return Scaffold(
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(
                  maxWidth: 480,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.link_off_outlined,
                      size: 56,
                    ),
                    const SizedBox(height: 20),
                    Text(
                      _errorMessage!,
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium,
                    ),
                    const SizedBox(height: 24),
                    FilledButton.icon(
                      onPressed: _loadCatalog,
                      icon: const Icon(
                        Icons.refresh,
                      ),
                      label: const Text(
                        'Tentar novamente',
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

    final storeName = _stringValue(
      _store,
      'name',
      'Loja',
    );

    final catalogTitle = _stringValue(
      _catalog,
      'title',
      'Catálogo',
    );

    final logoUrl = _stringValue(
      _store,
      'logoUrl',
      '',
    );

    final phone = _stringValue(
      _store,
      'phone',
      '',
    );

    final expiresAt = _stringValue(
      _catalog,
      'expiresAt',
      '',
    );

    final isMobileViewport =
        MediaQuery.sizeOf(context).width < 600;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F8),
      bottomNavigationBar:
          _isSelectionMode &&
                  isMobileViewport &&
                  _selectedQuantities.isNotEmpty
              ? SafeArea(
                  top: false,
                  child: Container(
                    padding:
                        const EdgeInsets.fromLTRB(
                      16,
                      10,
                      16,
                      12,
                    ),
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      border: Border(
                        top: BorderSide(
                          color: Color(
                            0xFFE5E7EB,
                          ),
                        ),
                      ),
                    ),
                    child: SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed:
                            _openSelectionSummary,
                        icon: const Icon(
                          Icons.receipt_long_outlined,
                          size: 18,
                        ),
                        label: Text(
                          'Revisar seleção '
                          '(${_selectedQuantities.length})',
                        ),
                      ),
                    ),
                  ),
                )
              : null,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final horizontalPadding =
                constraints.maxWidth < 600
                    ? 16.0
                    : 32.0;

            return CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      horizontalPadding,
                      24,
                      horizontalPadding,
                      0,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          maxWidth: 1100,
                        ),
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.stretch,
                          children: [
                            _buildPublicHeader(
                              context: context,
                              storeName: storeName,
                              catalogTitle: catalogTitle,
                              logoUrl: logoUrl,
                              phone: phone,
                              expiresAt: expiresAt,
                            ),
                            const SizedBox(height: 24),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 20,
                                vertical: 12,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius:
                                    BorderRadius.circular(16),
                                border: Border.all(
                                  color:
                                      const Color(0xFFE5E7EB),
                                ),
                              ),
                              child: LayoutBuilder(
                                builder: (
                                  context,
                                  constraints,
                                ) {
                                  final compactRefresh =
                                      constraints.maxWidth < 460;

                                  return Row(
                                    children: [
                                      const Icon(
                                        Icons.inventory_2_outlined,
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Text(
                                          '$_availableProducts produtos disponíveis',
                                          style: Theme.of(context)
                                              .textTheme
                                              .titleMedium,
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      if (_isManualRefreshInProgress)
                                        const SizedBox(
                                          width: 40,
                                          height: 40,
                                          child: Padding(
                                            padding:
                                                EdgeInsets.all(10),
                                            child:
                                                CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          ),
                                        )
                                      else if (compactRefresh)
                                        IconButton(
                                          onPressed:
                                              _isEnteringSelectionMode
                                                  ? null
                                                  : _refreshCatalogManually,
                                          tooltip:
                                              'Atualizar catálogo',
                                          icon: const Icon(
                                            Icons.refresh,
                                          ),
                                        )
                                      else
                                        TextButton.icon(
                                          onPressed:
                                              _isEnteringSelectionMode
                                                  ? null
                                                  : _refreshCatalogManually,
                                          icon: const Icon(
                                            Icons.refresh,
                                            size: 18,
                                          ),
                                          label: const Text(
                                            'Atualizar',
                                          ),
                                        ),
                                      const SizedBox(width: 4),
                                      if (_isEnteringSelectionMode)
                                        const SizedBox(
                                          width: 40,
                                          height: 40,
                                          child: Padding(
                                            padding:
                                                EdgeInsets.all(10),
                                            child:
                                                CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          ),
                                        )
                                      else if (
                                        _isSelectionMode &&
                                        compactRefresh
                                      )
                                        IconButton(
                                          onPressed:
                                              _cancelSelectionMode,
                                          tooltip:
                                              'Cancelar seleção',
                                          icon: const Icon(
                                            Icons.close,
                                          ),
                                        )
                                      else if (_isSelectionMode)
                                        TextButton.icon(
                                          onPressed:
                                              _cancelSelectionMode,
                                          icon: const Icon(
                                            Icons.close,
                                            size: 18,
                                          ),
                                          label: const Text(
                                            'Cancelar',
                                          ),
                                        )
                                      else if (compactRefresh)
                                        IconButton(
                                          onPressed:
                                              _isManualRefreshInProgress
                                                  ? null
                                                  : _startSelectionMode,
                                          tooltip:
                                              'Selecionar produtos',
                                          icon: const Icon(
                                            Icons.check_circle_outline,
                                          ),
                                        )
                                      else
                                        TextButton.icon(
                                          onPressed:
                                              _isManualRefreshInProgress
                                                  ? null
                                                  : _startSelectionMode,
                                          icon: const Icon(
                                            Icons.check_circle_outline,
                                            size: 18,
                                          ),
                                          label: const Text(
                                            'Selecionar produtos',
                                          ),
                                        ),
                                    ],
                                  );
                                },
                              ),
                            ),
                            if (
                              _isSelectionMode &&
                              !isMobileViewport
                            ) ...[
                              const SizedBox(height: 14),
                              Align(
                                alignment:
                                    Alignment.centerRight,
                                child:
                                    FilledButton.icon(
                                  onPressed:
                                      _selectedQuantities
                                              .isEmpty
                                          ? null
                                          : _openSelectionSummary,
                                  icon: const Icon(
                                    Icons
                                        .receipt_long_outlined,
                                    size: 18,
                                  ),
                                  label: Text(
                                    'Revisar seleção '
                                    '(${_selectedQuantities.length})',
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: 24),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
                _buildProductsSliver(
                  context,
                  horizontalPadding,
                ),
                const SliverToBoxAdapter(
                  child: SizedBox(height: 24),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildProductsSliver(
    BuildContext context,
    double horizontalPadding,
  ) {
    if (_products.isEmpty) {
      return SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: horizontalPadding,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 1100,
              ),
              child: Container(
                padding: const EdgeInsets.all(32),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: const Color(0xFFE5E7EB),
                  ),
                ),
                child: const Column(
                  children: [
                    Icon(
                      Icons.inventory_2_outlined,
                      size: 44,
                    ),
                    SizedBox(height: 16),
                    Text(
                      'Nenhum produto disponível neste catálogo.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }

    return SliverLayoutBuilder(
      builder: (context, constraints) {
        final availableWidth =
            constraints.crossAxisExtent -
            (horizontalPadding * 2);

        final contentWidth =
            availableWidth > 1100
                ? 1100.0
                : availableWidth;

        final isMobile =
            constraints.crossAxisExtent < 600;

        final cardHeight =
        isMobile
            ? (_isSelectionMode ? 210.0 : 150.0)
            : (_isSelectionMode ? 360.0 : 300.0);

        final double cardWidth;

        if (contentWidth >= 900) {
          cardWidth = 220;
        } else if (contentWidth >= 600) {
          cardWidth = 220;
        } else {
          cardWidth =
              contentWidth > 360
                  ? 360
                  : contentWidth;
        }

        const spacing = 18.0;

        final calculatedColumns =
            ((contentWidth + spacing) /
                    (cardWidth + spacing))
                .floor();

        final columns =
            calculatedColumns < 1
                ? 1
                : calculatedColumns;

        final rowCount =
            (_products.length / columns).ceil();

        return SliverList(
          delegate: SliverChildBuilderDelegate(
            (context, rowIndex) {
              final startIndex =
                  rowIndex * columns;

              final calculatedEnd =
                  startIndex + columns;

              final endIndex =
                  calculatedEnd > _products.length
                      ? _products.length
                      : calculatedEnd;

              final isLastRow =
                  rowIndex == rowCount - 1;

              return Padding(
                padding: EdgeInsets.fromLTRB(
                  horizontalPadding,
                  0,
                  horizontalPadding,
                  isLastRow ? 0 : spacing,
                ),
                child: SizedBox(
                  height: cardHeight,
                  child: Center(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (
                          var productIndex = startIndex;
                          productIndex < endIndex;
                          productIndex++
                        ) ...[
                          if (productIndex > startIndex)
                            const SizedBox(
                              width: spacing,
                            ),
                          RepaintBoundary(
                            child: SizedBox(
                              width: cardWidth,
                              height: cardHeight,
                              child: _buildProductCard(
                                context,
                                _products[productIndex],
                                isMobile: isMobile,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              );
            },
            childCount: rowCount,
          ),
        );
      },
    );
  }
  Widget _buildProductCard(
    BuildContext context,
    Map<String, dynamic> product, {
    required bool isMobile,
  }) {
    final name = _stringValue(
      product,
      'name',
      'Produto',
    );

    final imageUrl = _stringValue(
      product,
      'imageUrl',
      '',
    );

    final categoryName = _stringValue(
      product,
      'categoryName',
      '',
    );

    final price = _doubleValue(
      product['price'],
    );

    final quantity = _doubleValue(
      product['quantidade'],
    );

    if (isMobile) {
      final selectedQuantity =
          _selectedQuantityForProduct(product);

      final availableQuantity =
          _selectionAvailableQuantity(product);

      final canDecrement =
          selectedQuantity > 0;

      final canIncrement =
          selectedQuantity < availableQuantity;

      return Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: const Color(0xFFE5E7EB),
          ),
        ),
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  crossAxisAlignment:
                      CrossAxisAlignment.center,
                  children: [
                    ClipRRect(
                      borderRadius:
                          BorderRadius.circular(12),
                      child: SizedBox(
                        width: 110,
                        height: 110,
                        child: _buildProductImage(
                          imageUrl,
                          fit: BoxFit.contain,
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        mainAxisAlignment:
                            MainAxisAlignment.center,
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          if (categoryName.isNotEmpty) ...[
                            Text(
                              categoryName,
                              maxLines: 1,
                              overflow:
                                  TextOverflow.ellipsis,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(
                                    color:
                                        const Color(
                                          0xFF6B7280,
                                        ),
                                  ),
                            ),
                            const SizedBox(height: 4),
                          ],
                          Text(
                            name,
                            maxLines: 2,
                            overflow:
                                TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                  fontWeight:
                                      FontWeight.w600,
                                ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _formatPrice(price),
                            style: Theme.of(context)
                                .textTheme
                                .titleLarge
                                ?.copyWith(
                                  fontWeight:
                                      FontWeight.w700,
                                ),
                          ),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              const Icon(
                                Icons.check_circle_outline,
                                size: 16,
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'Disponível: ${_formatQuantity(quantity)}',
                                  maxLines: 1,
                                  overflow:
                                      TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            if (_isSelectionMode)
              Container(
                decoration: const BoxDecoration(
                  border: Border(
                    top: BorderSide(
                      color: Color(0xFFE5E7EB),
                    ),
                  ),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                child: Row(
                  children: [
                    Text(
                      'Quantidade',
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(
                            fontWeight:
                                FontWeight.w600,
                          ),
                    ),
                    const Spacer(),
                    IconButton(
                      onPressed:
                          canDecrement
                              ? () =>
                                  _decrementSelectedQuantity(
                                    product,
                                  )
                              : null,
                      tooltip:
                          'Diminuir quantidade',
                      visualDensity:
                          VisualDensity.compact,
                      icon: const Icon(
                        Icons.remove,
                      ),
                    ),
                    SizedBox(
                      width: 36,
                      child: Text(
                        '$selectedQuantity',
                        textAlign:
                            TextAlign.center,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(
                              fontWeight:
                                  FontWeight.w700,
                            ),
                      ),
                    ),
                    IconButton(
                      onPressed:
                          canIncrement
                              ? () =>
                                  _incrementSelectedQuantity(
                                    product,
                                  )
                              : null,
                      tooltip:
                          canIncrement
                              ? 'Aumentar quantidade'
                              : 'Estoque máximo selecionado',
                      visualDensity:
                          VisualDensity.compact,
                      icon: const Icon(
                        Icons.add,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
    }

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: _buildProductImage(
              imageUrl,
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                if (categoryName.isNotEmpty) ...[
                  Text(
                    categoryName,
                    maxLines: 1,
                    overflow:
                        TextOverflow.ellipsis,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(
                          color:
                              const Color(
                                0xFF6B7280,
                              ),
                        ),
                  ),
                  const SizedBox(height: 6),
                ],
                Text(
                  name,
                  maxLines: 2,
                  overflow:
                      TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .titleMedium
                      ?.copyWith(
                        fontWeight:
                            FontWeight.w600,
                      ),
                ),
                const SizedBox(height: 14),
                Text(
                  _formatPrice(price),
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(
                        fontWeight:
                            FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    const Icon(
                      Icons.check_circle_outline,
                      size: 18,
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        'Disponível: ${_formatQuantity(quantity)}',
                        maxLines: 1,
                        overflow:
                            TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (_isSelectionMode)
            Container(
              decoration: const BoxDecoration(
                border: Border(
                  top: BorderSide(
                    color: Color(0xFFE5E7EB),
                  ),
                ),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 8,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Quantidade',
                      maxLines: 1,
                      overflow:
                          TextOverflow.ellipsis,
                      style: Theme.of(context)
                          .textTheme
                          .bodyMedium
                          ?.copyWith(
                            fontWeight:
                                FontWeight.w600,
                          ),
                    ),
                  ),
                  IconButton(
                    onPressed:
                        _selectedQuantityForProduct(
                                  product,
                                ) >
                                0
                            ? () =>
                                _decrementSelectedQuantity(
                                  product,
                                )
                            : null,
                    tooltip:
                        'Diminuir quantidade',
                    visualDensity:
                        VisualDensity.compact,
                    icon: const Icon(
                      Icons.remove,
                    ),
                  ),
                  SizedBox(
                    width: 36,
                    child: Text(
                      '${_selectedQuantityForProduct(product)}',
                      textAlign:
                          TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(
                            fontWeight:
                                FontWeight.w700,
                          ),
                    ),
                  ),
                  IconButton(
                    onPressed:
                        _selectedQuantityForProduct(
                                  product,
                                ) <
                                _selectionAvailableQuantity(
                                  product,
                                )
                            ? () =>
                                _incrementSelectedQuantity(
                                  product,
                                )
                            : null,
                    tooltip:
                        _selectedQuantityForProduct(
                                  product,
                                ) <
                                _selectionAvailableQuantity(
                                  product,
                                )
                            ? 'Aumentar quantidade'
                            : 'Estoque máximo selecionado',
                    visualDensity:
                        VisualDensity.compact,
                    icon: const Icon(
                      Icons.add,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildProductImage(
    String imageUrl, {
    BoxFit fit = BoxFit.cover,
  }) {
    if (imageUrl.isEmpty) {
      return Container(
        color: const Color(0xFFF3F4F6),
        alignment: Alignment.center,
        child: const Icon(
          Icons.image_outlined,
          size: 52,
          color: Color(0xFF9CA3AF),
        ),
      );
    }

    return Image.network(
      imageUrl,
      fit: fit,
      width: double.infinity,
      errorBuilder: (
        context,
        error,
        stackTrace,
      ) {
        return Container(
          color: const Color(0xFFF3F4F6),
          alignment: Alignment.center,
          child: const Icon(
            Icons.image_not_supported_outlined,
            size: 52,
            color: Color(0xFF9CA3AF),
          ),
        );
      },
    );
  }

  double _doubleValue(
    dynamic value,
  ) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String _formatPrice(
    double value,
  ) {
    final formatted =
        value
            .toStringAsFixed(2)
            .replaceAll('.', ',');

    return 'R\$ $formatted';
  }

  String _formatQuantity(
    double value,
  ) {
    if (value == value.truncateToDouble()) {
      return value.toInt().toString();
    }

    return value
        .toStringAsFixed(2)
        .replaceAll('.', ',');
  }
  Widget _buildPublicHeader({
    required BuildContext context,
    required String storeName,
    required String catalogTitle,
    required String logoUrl,
    required String phone,
    required String expiresAt,
  }) {
    final isHeaderMobile =
        MediaQuery.sizeOf(context).width < 600;

    return Container(
      padding: EdgeInsets.all(
        isHeaderMobile ? 16 : 24,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final isCompact =
              constraints.maxWidth < 600;

          final logo = _buildStoreLogo(
            logoUrl,
            size: isHeaderMobile ? 110 : 88,
          );

          final centerHeaderInfo =
              isCompact && !isHeaderMobile;

          final info = Column(
            crossAxisAlignment:
                centerHeaderInfo
                    ? CrossAxisAlignment.center
                    : CrossAxisAlignment.start,
            children: [
              Text(
                storeName,
                textAlign:
                    centerHeaderInfo
                        ? TextAlign.center
                        : TextAlign.start,
                style: Theme.of(context)
                    .textTheme
                    .headlineSmall
                    ?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 6),
              Text(
                catalogTitle,
                textAlign:
                    centerHeaderInfo
                        ? TextAlign.center
                        : TextAlign.start,
                style: Theme.of(context)
                    .textTheme
                    .titleLarge,
              ),
              if (phone.isNotEmpty) ...[
                const SizedBox(height: 14),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.phone_outlined,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Text(phone),
                  ],
                ),
              ],
              if (expiresAt.isNotEmpty) ...[
                const SizedBox(height: 8),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.schedule_outlined,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        _formatExpiration(
                          expiresAt,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          );

          if (isHeaderMobile) {
            return Row(
              crossAxisAlignment:
                  CrossAxisAlignment.center,
              children: [
                logo,
                const SizedBox(width: 14),
                Expanded(
                  child: info,
                ),
              ],
            );
          }

          if (isCompact) {
            return Column(
              children: [
                logo,
                const SizedBox(height: 18),
                info,
              ],
            );
          }

          return Row(
            crossAxisAlignment:
                CrossAxisAlignment.center,
            children: [
              logo,
              const SizedBox(width: 24),
              Expanded(
                child: info,
              ),
            ],
          );
        },
      ),
    );
  }

  String _formatExpiration(
    String value,
  ) {
    final parsed = DateTime.tryParse(
      value,
    );

    if (parsed == null) {
      return 'Catálogo temporário';
    }

    final localDate = parsed.toLocal();

    final day =
        localDate.day
            .toString()
            .padLeft(2, '0');

    final month =
        localDate.month
            .toString()
            .padLeft(2, '0');

    final year =
        localDate.year.toString();

    return 'Disponível até $day/$month/$year';
  }
  Widget _buildStoreLogo(
    String logoUrl, {
    double size = 88,
  }) {

    if (logoUrl.isEmpty) {
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: const Color(0xFFF3F4F6),
          borderRadius: BorderRadius.circular(18),
        ),
        child: const Icon(
          Icons.storefront_outlined,
          size: 40,
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: Image.network(
        logoUrl,
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (
          context,
          error,
          stackTrace,
        ) {
          return Container(
            width: size,
            height: size,
            color: const Color(0xFFF3F4F6),
            child: const Icon(
              Icons.storefront_outlined,
              size: 40,
            ),
          );
        },
      ),
    );
  }
}
