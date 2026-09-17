import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

class CatalogRequestsScreen extends StatefulWidget {
  const CatalogRequestsScreen({super.key});

  @override
  State<CatalogRequestsScreen> createState() =>
      _CatalogRequestsScreenState();
}

class _CatalogRequestsScreenState extends State<CatalogRequestsScreen> {
  bool _isLoading = true;
  String? _errorMessage;

  List<Map<String, dynamic>> _requests =
      <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _loadRequests();
  }

  Future<void> _loadRequests() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final callable =
          FirebaseFunctions.instance.httpsCallable(
        'listCatalogRequests',
        options: HttpsCallableOptions(
          timeout: const Duration(seconds: 30),
        ),
      );

      final response = await callable.call();

      final rawData = response.data;

      if (rawData is! Map) {
        throw const FormatException(
          'Resposta inválida ao carregar solicitações.',
        );
      }

      if (rawData['success'] != true) {
        throw const FormatException(
          'O backend não confirmou a listagem das solicitações.',
        );
      }

      final rawRequests = rawData['requests'];

      if (rawRequests is! List) {
        throw const FormatException(
          'Lista de solicitações não encontrada na resposta.',
        );
      }

      final requests = rawRequests
          .whereType<Map>()
          .map(
            (request) =>
                Map<String, dynamic>.from(request),
          )
          .toList();

      if (!mounted) {
        return;
      }

      setState(() {
        _requests = requests;
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
        '[CatalogRequestsScreen] '
        'Erro ao carregar solicitacoes: $error',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage =
            'Não foi possível carregar as solicitações.';
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
            'visualizar as solicitações desta loja.';

      case 'failed-precondition':
        return 'Não foi possível identificar '
            'a loja vinculada à sua conta.';

      case 'not-found':
        return 'A loja vinculada à sua conta '
            'não foi encontrada.';

      case 'deadline-exceeded':
      case 'unavailable':
        return 'Não foi possível concluir a comunicação '
            'com o servidor. Tente novamente.';

      default:
        return 'Não foi possível carregar as solicitações.';
    }
  }

  String _formatDateTime(dynamic value) {
    final raw = value?.toString().trim() ?? '';

    if (raw.isEmpty) {
      return 'Data não disponível';
    }

    final parsed = DateTime.tryParse(raw)?.toLocal();

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
    Map<String, dynamic> request,
    String field,
  ) {
    final value = request[field];

    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return 0;
  }

  Widget _buildRequestCard(
    Map<String, dynamic> request,
  ) {
    final itemCount =
        _readInt(request, 'itemCount');

    final totalUnits =
        _readInt(request, 'totalUnits');

    final totalAmount =
        request['totalAmount'];

    final createdAt =
        _formatDateTime(request['createdAt']);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
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
                    Icons.shopping_bag_outlined,
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
                          fontSize: 16,
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        createdAt,
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
                _InfoChip(
                  icon:
                      Icons.inventory_2_outlined,
                  label: itemCount == 1
                      ? '1 produto'
                      : '$itemCount produtos',
                ),
                _InfoChip(
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
                  _formatCurrency(totalAmount),
                  style: const TextStyle(
                    fontSize: 19,
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

  Widget _buildEmptyState() {
    return RefreshIndicator(
      onRefresh: _loadRequests,
      child: ListView(
        physics:
            const AlwaysScrollableScrollPhysics(),
        padding:
            const EdgeInsets.fromLTRB(32, 120, 32, 32),
        children: [
          Icon(
            Icons.inbox_outlined,
            size: 72,
            color: Colors.grey.shade400,
          ),
          const SizedBox(height: 20),
          const Text(
            'Nenhuma solicitação recebida',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Quando um cliente selecionar produtos '
            'no catálogo e enviar a solicitação, '
            'ela aparecerá aqui.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.grey.shade600,
              height: 1.4,
            ),
          ),
        ],
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
                      'as solicitações.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _loadRequests,
              icon: const Icon(Icons.refresh),
              label:
                  const Text('Tentar novamente'),
            ),
          ],
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

    if (_requests.isEmpty) {
      return _buildEmptyState();
    }

    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints:
            const BoxConstraints(maxWidth: 900),
        child: RefreshIndicator(
          onRefresh: _loadRequests,
          child: ListView.builder(
            physics:
                const AlwaysScrollableScrollPhysics(),
            padding:
                const EdgeInsets.fromLTRB(
              16,
              16,
              16,
              32,
            ),
            itemCount: _requests.length,
            itemBuilder: (context, index) {
              return _buildRequestCard(
                _requests[index],
              );
            },
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title:
            const Text('Solicitações recebidas'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed:
                _isLoading ? null : _loadRequests,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({
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
        borderRadius: BorderRadius.circular(20),
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