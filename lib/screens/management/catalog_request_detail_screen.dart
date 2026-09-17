import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

class CatalogRequestDetailScreen extends StatefulWidget {
  const CatalogRequestDetailScreen({
    super.key,
    required this.requestId,
  });

  final String requestId;

  @override
  State<CatalogRequestDetailScreen> createState() =>
      _CatalogRequestDetailScreenState();
}

class _CatalogRequestDetailScreenState
    extends State<CatalogRequestDetailScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  Map<String, dynamic>? _request;

  @override
  void initState() {
    super.initState();
    _loadRequest();
  }

  Future<void> _loadRequest() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final callable =
          FirebaseFunctions.instance.httpsCallable(
        'getCatalogRequest',
        options: HttpsCallableOptions(
          timeout: const Duration(seconds: 30),
        ),
      );

      final response = await callable.call({
        'requestId': widget.requestId,
      });

      final rawData = response.data;

      if (rawData is! Map) {
        throw const FormatException(
          'Resposta inválida ao carregar a solicitação.',
        );
      }

      if (rawData['success'] != true) {
        throw const FormatException(
          'O backend não confirmou a solicitação.',
        );
      }

      final rawRequest = rawData['request'];

      if (rawRequest is! Map) {
        throw const FormatException(
          'Dados da solicitação não encontrados.',
        );
      }

      final request =
          Map<String, dynamic>.from(rawRequest);

      final returnedRequestId =
          request['requestId']?.toString().trim() ?? '';

      if (returnedRequestId != widget.requestId) {
        throw const FormatException(
          'Identificador da solicitação inválido.',
        );
      }

      final rawItems = request['items'];

      if (rawItems is! List) {
        throw const FormatException(
          'Itens da solicitação não encontrados.',
        );
      }

      final items = rawItems
          .whereType<Map>()
          .map(
            (item) =>
                Map<String, dynamic>.from(item),
          )
          .toList();

      if (items.length != rawItems.length) {
        throw const FormatException(
          'Um ou mais itens da solicitação são inválidos.',
        );
      }

      request['items'] = items;

      if (!mounted) {
        return;
      }

      setState(() {
        _request = request;
      });
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage =
            _messageForFunctionsError(error);
      });
    } catch (error) {
      debugPrint(
        '[CatalogRequestDetailScreen] '
        'Erro ao carregar detalhe: $error',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage =
            'Não foi possível carregar a solicitação.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String _messageForFunctionsError(
    FirebaseFunctionsException error,
  ) {
    switch (error.code) {
      case 'unauthenticated':
        return 'Sua sessão expirou. '
            'Entre novamente e tente outra vez.';

      case 'permission-denied':
        return 'Você não possui permissão para '
            'visualizar esta solicitação.';

      case 'failed-precondition':
        return 'Não foi possível identificar '
            'a loja vinculada à sua conta.';

      case 'invalid-argument':
        return 'A solicitação informada é inválida.';

      case 'not-found':
        return 'Esta solicitação não foi encontrada.';

      case 'deadline-exceeded':
      case 'unavailable':
        return 'Não foi possível concluir a comunicação '
            'com o servidor. Tente novamente.';

      default:
        return 'Não foi possível carregar a solicitação.';
    }
  }

  String _formatDateTime(dynamic value) {
    final raw = value?.toString().trim() ?? '';

    if (raw.isEmpty) {
      return 'Data não disponível';
    }

    final parsed =
        DateTime.tryParse(raw)?.toLocal();

    if (parsed == null) {
      return 'Data não disponível';
    }

    String two(int number) =>
        number.toString().padLeft(2, '0');

    return '${two(parsed.day)}/'
        '${two(parsed.month)}/'
        '${parsed.year} às '
        '${two(parsed.hour)}:'
        '${two(parsed.minute)}';
  }

  String _formatCurrency(dynamic value) {
    if (value is! num || !value.isFinite) {
      return 'R\$ —';
    }

    return 'R\$ '
        '${value.toDouble().toStringAsFixed(2).replaceAll('.', ',')}';
  }

  int _readInt(
    Map<String, dynamic> data,
    String field,
  ) {
    final value = data[field];

    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return 0;
  }

  Widget _buildSummaryCard(
    Map<String, dynamic> request,
  ) {
    final itemCount =
        _readInt(request, 'itemCount');

    final totalUnits =
        _readInt(request, 'totalUnits');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: Theme.of(context)
                        .colorScheme
                        .primaryContainer,
                    borderRadius:
                        BorderRadius.circular(12),
                  ),
                  child: Icon(
                    Icons.receipt_long_outlined,
                    color: Theme.of(context)
                        .colorScheme
                        .onPrimaryContainer,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Solicitação recebida',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _formatDateTime(
                          request['createdAt'],
                        ),
                        style: TextStyle(
                          color:
                              Colors.grey.shade600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                _DetailInfoChip(
                  icon:
                      Icons.inventory_2_outlined,
                  label: itemCount == 1
                      ? '1 produto'
                      : '$itemCount produtos',
                ),
                _DetailInfoChip(
                  icon:
                      Icons.format_list_numbered,
                  label: totalUnits == 1
                      ? '1 unidade'
                      : '$totalUnits unidades',
                ),
              ],
            ),
            const SizedBox(height: 18),
            const Divider(height: 1),
            const SizedBox(height: 14),
            Row(
              children: [
                Text(
                  'Total',
                  style: TextStyle(
                    color: Colors.grey.shade700,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                Text(
                  _formatCurrency(
                    request['totalAmount'],
                  ),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildItemCard(
    Map<String, dynamic> item,
  ) {
    final rawName =
        item['name']?.toString().trim() ?? '';

    final name = rawName.isEmpty
        ? 'Produto'
        : rawName;

    final quantity =
        _readInt(item, 'quantity');

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight:
                          FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Text(
                  _formatCurrency(
                    item['subtotal'],
                  ),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '$quantity × '
              '${_formatCurrency(item['price'])}',
              style: TextStyle(
                color: Colors.grey.shade700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment:
              MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.error_outline,
              size: 56,
              color: Colors.red,
            ),
            const SizedBox(height: 16),
            Text(
              _errorMessage ??
                  'Não foi possível carregar '
                      'a solicitação.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _loadRequest,
              icon: const Icon(Icons.refresh),
              label:
                  const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRequestBody(
    Map<String, dynamic> request,
  ) {
    final items =
        List<Map<String, dynamic>>.from(
      request['items'] as List,
    );

    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints:
            const BoxConstraints(maxWidth: 900),
        child: RefreshIndicator(
          onRefresh: _loadRequest,
          child: ListView(
            physics:
                const AlwaysScrollableScrollPhysics(),
            padding:
                const EdgeInsets.fromLTRB(
              16,
              16,
              16,
              32,
            ),
            children: [
              _buildSummaryCard(request),
              const SizedBox(height: 24),
              const Text(
                'Produtos selecionados',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),
              for (final item in items) ...[
                _buildItemCard(item),
                const SizedBox(height: 10),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    if (_errorMessage != null) {
      return _buildErrorState();
    }

    final request = _request;

    if (request == null) {
      return const Center(
        child: Text(
          'Solicitação não disponível.',
        ),
      );
    }

    return _buildRequestBody(request);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title:
            const Text('Detalhes da solicitação'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed:
                _isLoading ? null : _loadRequest,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }
}

class _DetailInfoChip extends StatelessWidget {
  const _DetailInfoChip({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 7,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context)
            .colorScheme
            .surfaceContainerHighest,
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 16,
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}