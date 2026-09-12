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
    extends State<PublicCatalogScreen> {
  bool _isLoading = true;
  String? _errorMessage;

  Map<String, dynamic>? _store;
  Map<String, dynamic>? _catalog;

  int _availableProducts = 0;

  List<Map<String, dynamic>> _products =
      <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
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

      if (!mounted) {
        return;
      }

      setState(() {
        _store = store;
        _catalog = catalog;
        _products = products;
        _availableProducts = products.length;
        _isLoading = false;
        _errorMessage = null;
      });
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
        _errorMessage =
            _messageForFunctionsError(error);
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
        _errorMessage =
            'Não foi possível carregar este catálogo agora.';
      });
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

    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F8),
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
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius:
                                    BorderRadius.circular(16),
                                border: Border.all(
                                  color:
                                      const Color(0xFFE5E7EB),
                                ),
                              ),
                              child: Row(
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
                                ],
                              ),
                            ),
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
                  height: 300,
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
                              height: 300,
                              child: _buildProductCard(
                                context,
                                _products[productIndex],
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
    Map<String, dynamic> product,
  ) {
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
        ],
      ),
    );
  }

  Widget _buildProductImage(
    String imageUrl,
  ) {
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
      fit: BoxFit.cover,
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
    return Container(
      padding: const EdgeInsets.all(24),
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
          );

          final info = Column(
            crossAxisAlignment:
                isCompact
                    ? CrossAxisAlignment.center
                    : CrossAxisAlignment.start,
            children: [
              Text(
                storeName,
                textAlign:
                    isCompact
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
                    isCompact
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
    String logoUrl,
  ) {
    const size = 88.0;

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
