import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'catalog_request_detail_screen.dart';

class CatalogRequestsScreen extends StatefulWidget {
  const CatalogRequestsScreen({super.key});

  @override
  State<CatalogRequestsScreen> createState() => _CatalogRequestsScreenState();
}

class _CatalogRequestsScreenState extends State<CatalogRequestsScreen> {
  bool _isLoading = false;
  String? _selectedStatus;
  final Set<String> _expandedRequestIds = <String>{};
  final Set<String> _transitioningRequestIds = <String>{};
  String? _errorMessage;

  List<Map<String, dynamic>> _requests = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _loadRequests();
  }

  Future<void> _loadRequests() async {
    if (_isLoading) return;
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'listCatalogRequests',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
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
          .map((request) => Map<String, dynamic>.from(request))
          .toList();

      if (!mounted) {
        return;
      }

      setState(() {
        _requests = requests;
        final ids = requests.map(_requestId).toSet();
        _expandedRequestIds.removeWhere((id) => !ids.contains(id));
      });
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = _messageForFunctionsError(error);
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
        _errorMessage = 'Não foi possível carregar as solicitações.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  String _messageForFunctionsError(FirebaseFunctionsException error) {
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

    String two(int number) => number.toString().padLeft(2, '0');

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

  int _readInt(Map<String, dynamic> request, String field) {
    final value = request[field];

    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return 0;
  }

  Future<void> _openRequestDetail(Map<String, dynamic> request) async {
    final requestId = request['requestId']?.toString().trim() ?? '';

    if (requestId.isEmpty) {
      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          const SnackBar(
            content: Text('Não foi possível abrir esta solicitação.'),
          ),
        );
      return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => CatalogRequestDetailScreen(requestId: requestId),
      ),
    );
  }

  void _showMessage(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(content: Text(message)),
      );
  }

  String _formatCustomerPhone(String phone) {
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');

    if (digits.length == 13 && digits.startsWith('55')) {
      return '+55 (${digits.substring(2, 4)}) '
          '${digits.substring(4, 9)}-${digits.substring(9)}';
    }

    if (digits.length == 12 && digits.startsWith('55')) {
      return '+55 (${digits.substring(2, 4)}) '
          '${digits.substring(4, 8)}-${digits.substring(8)}';
    }

    if (digits.length == 11) {
      return '(${digits.substring(0, 2)}) '
          '${digits.substring(2, 7)}-${digits.substring(7)}';
    }

    if (digits.length == 10) {
      return '(${digits.substring(0, 2)}) '
          '${digits.substring(2, 6)}-${digits.substring(6)}';
    }

    return phone.trim();
  }

  Future<void> _openWhatsApp(String phone) async {
    final digits = phone.replaceAll(RegExp(r'[^0-9]'), '');

    if (digits.isEmpty) {
      _showMessage('WhatsApp não disponível para este cliente.');
      return;
    }

    final uri = Uri.parse('https://wa.me/$digits');

    try {
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        _showMessage('Não foi possível abrir o WhatsApp.');
      }
    } catch (error) {
      debugPrint(
        '[CatalogRequestsScreen] '
        'Erro ao abrir WhatsApp: $error',
      );
      _showMessage('Não foi possível abrir o WhatsApp.');
    }
  }

  String _messageForTransitionError(FirebaseFunctionsException error) {
    switch (error.code) {
      case 'unauthenticated':
        return 'Sua sessão expirou. Entre novamente e tente outra vez.';

      case 'permission-denied':
        return 'Você não possui permissão para alterar esta solicitação.';

      case 'failed-precondition':
      case 'aborted':
        return 'Esta solicitação foi atualizada por outro atendimento. '
            'Atualize e tente novamente.';

      case 'not-found':
        return 'Esta solicitação não foi encontrada.';

      case 'deadline-exceeded':
      case 'unavailable':
        return 'Não foi possível concluir a comunicação com o servidor. '
            'Tente novamente.';

      default:
        return 'Não foi possível atualizar esta solicitação.';
    }
  }

  Future<void> _transitionRequest(
    Map<String, dynamic> request,
    String action,
  ) async {
    final requestId = _requestId(request);

    if (requestId.isEmpty || _transitioningRequestIds.contains(requestId)) {
      return;
    }

    setState(() {
      _transitioningRequestIds.add(requestId);
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'transitionCatalogRequest',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      );

      final response = await callable.call(
        <String, dynamic>{
          'requestId': requestId,
          'action': action,
        },
      );

      final rawData = response.data;

      if (rawData is! Map ||
          rawData['success'] != true ||
          rawData['requestId']?.toString().trim() != requestId ||
          (rawData['status']?.toString().trim().isEmpty ?? true)) {
        throw const FormatException(
          'Resposta inválida ao atualizar solicitação.',
        );
      }

      await _loadRequests();

      if (!mounted) {
        return;
      }

      _showMessage(
        action == 'start'
            ? 'Atendimento iniciado.'
            : 'Solicitação cancelada.',
      );
    } on FirebaseFunctionsException catch (error) {
      _showMessage(_messageForTransitionError(error));
    } catch (error) {
      debugPrint(
        '[CatalogRequestsScreen] '
        'Erro ao atualizar solicitacao: $error',
      );
      _showMessage('Não foi possível atualizar esta solicitação.');
    } finally {
      if (mounted) {
        setState(() {
          _transitioningRequestIds.remove(requestId);
        });
      }
    }
  }

  Future<void> _confirmCancelRequest(
    Map<String, dynamic> request,
  ) async {
    final requestId = _requestId(request);

    if (requestId.isEmpty) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancelar solicitação?'),
        content: const Text(
          'Esta solicitação será marcada como cancelada. '
          'Essa ação não poderá ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Voltar'),
          ),
          FilledButton(
            key: ValueKey('confirm-cancel-$requestId'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Confirmar cancelamento'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      await _transitionRequest(request, 'cancel');
    }
  }

  String _requestId(Map<String, dynamic> request) =>
      request['requestId']?.toString().trim() ?? '';

  String? _optionalText(dynamic value) =>
      value is String && value.trim().isNotEmpty ? value.trim() : null;

  Widget _buildSummary(Map<String, dynamic> request) {
    final products = _readInt(request, 'itemCount');
    final units = _readInt(request, 'totalUnits');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            _InfoChip(
              icon: Icons.inventory_2_outlined,
              label: products == 1 ? '1 produto' : '$products produtos',
            ),
            _InfoChip(
              icon: Icons.format_list_numbered,
              label: units == 1 ? '1 unidade' : '$units unidades',
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          'Total: ${_formatCurrency(request['totalAmount'])}',
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }

  List<Widget> _buildLifecycle(Map<String, dynamic> request) {
    final lines = <String>[];
    void addDate(String field, String label) {
      final raw = _optionalText(request[field]);
      if (raw != null && DateTime.tryParse(raw) != null) {
        lines.add('$label ${_formatDateTime(raw)}');
      }
    }

    switch (request['status']) {
      case 'in_progress':
        final name = _optionalText(request['attendedByName']);
        if (name != null) lines.add('Atendido por $name');
        addDate('attendedAt', 'Atendimento em');
        break;
      case 'completed':
        addDate('completedAt', 'Finalizada em');
        break;
      case 'cancelled':
        addDate('cancelledAt', 'Cancelada em');
        break;
    }
    return lines
        .map(
          (line) => Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(line, style: Theme.of(context).textTheme.bodyMedium),
          ),
        )
        .toList();
  }

  Widget _buildRequestCard(Map<String, dynamic> request) {
    final id = _requestId(request);
    final expanded = id.isNotEmpty && _expandedRequestIds.contains(id);
    final customer =
        _optionalText(request['customerName']) ?? 'Cliente não identificado';
    final customerPhone = _optionalText(request['customerPhone']);
    final status = _RequestStatus.fromValue(request['status']);
    final transitioning =
        id.isNotEmpty && _transitioningRequestIds.contains(id);
    final colors = Theme.of(context).colorScheme;

    return Card(
      key: ValueKey(id),
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      color: Color.alphaBlend(
        status.background(context).withAlpha(45),
        colors.surface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            expanded: expanded,
            child: InkWell(
              key: ValueKey('toggle-$id'),
              onTap: id.isEmpty
                  ? null
                  : () => setState(() {
                      if (expanded) {
                        _expandedRequestIds.remove(id);
                      } else {
                        _expandedRequestIds.add(id);
                      }
                    }),
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 12,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          customer,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        _StatusBadge(status: status),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _formatDateTime(request['createdAt']),
                      style: TextStyle(color: colors.onSurfaceVariant),
                    ),
                    const SizedBox(height: 16),
                    _buildSummary(request),
                    ..._buildLifecycle(request),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Icon(
                        expanded ? Icons.expand_less : Icons.expand_more,
                        semanticLabel: expanded
                            ? 'Recolher solicitação'
                            : 'Expandir solicitação',
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (expanded) ...[
            const Divider(height: 1),
            Padding(
              key: ValueKey('expanded-$id'),
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Cliente',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(customer),
                  if (customerPhone != null &&
                      (status == _RequestStatus.pending ||
                          status == _RequestStatus.inProgress)) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 12,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          _formatCustomerPhone(customerPhone),
                          key: ValueKey('phone-$id'),
                        ),
                        OutlinedButton.icon(
                          key: ValueKey('whatsapp-$id'),
                          onPressed: () => _openWhatsApp(customerPhone),
                          icon: const Icon(Icons.chat_outlined),
                          label: const Text('WhatsApp'),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    'Resumo do pedido',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  _buildSummary(request),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      alignment: WrapAlignment.end,
                      children: [
                        if (status == _RequestStatus.pending) ...[
                          FilledButton.icon(
                            key: ValueKey('start-request-$id'),
                            onPressed: transitioning || id.isEmpty
                                ? null
                                : () => _transitionRequest(request, 'start'),
                            icon: transitioning
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.play_arrow),
                            label: const Text('Iniciar atendimento'),
                          ),
                          OutlinedButton.icon(
                            key: ValueKey('cancel-request-$id'),
                            onPressed: transitioning || id.isEmpty
                                ? null
                                : () => _confirmCancelRequest(request),
                            icon: const Icon(Icons.cancel_outlined),
                            label: const Text('Cancelar solicitação'),
                          ),
                          TextButton.icon(
                            key: ValueKey('details-$id'),
                            onPressed: transitioning
                                ? null
                                : () => _openRequestDetail(request),
                            icon: const Icon(Icons.arrow_forward),
                            label: const Text('Ver detalhes'),
                          ),
                        ] else if (status == _RequestStatus.inProgress) ...[
                          FilledButton.icon(
                            key: ValueKey('open-request-$id'),
                            onPressed: transitioning
                                ? null
                                : () => _openRequestDetail(request),
                            icon: const Icon(Icons.support_agent),
                            label: const Text('Abrir atendimento'),
                          ),
                        ] else ...[
                          TextButton.icon(
                            key: ValueKey('details-$id'),
                            onPressed: () => _openRequestDetail(request),
                            icon: const Icon(Icons.arrow_forward),
                            label: const Text('Ver detalhes'),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildFilters() {
    const labels = <String?, String>{
      null: 'Todas',
      'pending': 'Novas',
      'in_progress': 'Em atendimento',
      'completed': 'Finalizadas',
      'cancelled': 'Canceladas',
    };
    final filters = labels.entries.map((entry) {
      final count = entry.key == null
          ? _requests.length
          : _requests.where((request) => request['status'] == entry.key).length;
      return LayoutBuilder(
        builder: (context, constraints) => ChoiceChip(
          key: ValueKey('filter-${entry.key ?? 'all'}'),
          label: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: constraints.maxWidth - 16),
            child: Builder(
              builder: (context) => DefaultTextStyle(
                style: DefaultTextStyle.of(context).style,
                textAlign: TextAlign.center,
                softWrap: true,
                child: Text('${entry.value} ($count)'),
              ),
            ),
          ),
          labelPadding: const EdgeInsets.symmetric(horizontal: 4),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          showCheckmark: false,
          selected: _selectedStatus == entry.key,
          onSelected: (_) => setState(() => _selectedStatus = entry.key),
        ),
      );
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(flex: 2, child: filters[0]),
            const SizedBox(width: 8),
            Expanded(flex: 2, child: filters[1]),
            const SizedBox(width: 8),
            Expanded(flex: 4, child: filters[2]),
          ],
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: filters[3]),
            const SizedBox(width: 8),
            Flexible(child: filters[4]),
          ],
        ),
      ],
    );
  }

  Widget _buildEmptyState() {
    final filtered = _selectedStatus != null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 64, horizontal: 16),
      child: Column(
        children: [
          Icon(
            Icons.inbox_outlined,
            size: 64,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
          const SizedBox(height: 20),
          Text(
            filtered
                ? 'Nenhuma solicitação neste status.'
                : 'Nenhuma solicitação recebida',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(
            filtered
                ? 'Selecione outro filtro para ver as solicitações.'
                : 'Quando um cliente selecionar produtos no catálogo e enviar a solicitação, ela aparecerá aqui.',
            textAlign: TextAlign.center,
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
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 56, color: Colors.red),
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
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_errorMessage != null) {
      return _buildErrorState();
    }

    final visible = _requests
        .where(
          (request) =>
              _selectedStatus == null || request['status'] == _selectedStatus,
        )
        .toList();
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 900),
        child: RefreshIndicator(
          onRefresh: _loadRequests,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Text(
                'Pedidos de produtos do catálogo',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 16),
              _buildFilters(),
              const SizedBox(height: 20),
              if (visible.isEmpty) _buildEmptyState(),
              ...visible.map(_buildRequestCard),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Solicitações recebidas'),
        centerTitle: false,
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            onPressed: _isLoading ? null : _loadRequests,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _buildBody(),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

// Unknown persisted values remain neutral and never enter the pending filter.
enum _RequestStatus {
  pending('Nova'),
  inProgress('Em atendimento'),
  completed('Finalizada'),
  cancelled('Cancelada'),
  unknown('Status indisponível');

  const _RequestStatus(this.label);
  final String label;

  static _RequestStatus fromValue(dynamic value) => switch (value) {
    'pending' => pending,
    'in_progress' => inProgress,
    'completed' => completed,
    'cancelled' => cancelled,
    _ => unknown,
  };

  MaterialColor get palette => switch (this) {
    pending => Colors.pink,
    inProgress => Colors.blue,
    completed => Colors.green,
    cancelled || unknown => Colors.grey,
  };

  Color background(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? palette.shade900
      : palette.shade50;

  Color foreground(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? palette.shade50
      : palette.shade900;
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final _RequestStatus status;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: status.background(context),
      borderRadius: BorderRadius.circular(20),
    ),
    child: Text(
      status.label,
      style: TextStyle(
        color: status.foreground(context),
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}
