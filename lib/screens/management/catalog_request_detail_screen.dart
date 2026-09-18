import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

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
  bool _isTransitioning = false;
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

  String? _optionalText(dynamic value) =>
      value is String && value.trim().isNotEmpty ? value.trim() : null;

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

  String _statusLabel(dynamic status) {
    switch (status) {
      case 'pending':
        return 'Nova';
      case 'in_progress':
        return 'Em atendimento';
      case 'completed':
        return 'Finalizada';
      case 'cancelled':
        return 'Cancelada';
      default:
        return 'Status indisponível';
    }
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

  String? _whatsAppDigits(String phone) {
    var digits = phone.replaceAll(RegExp(r'[^0-9]'), '');

    if (digits.length == 10 || digits.length == 11) {
      digits = '55$digits';
    }

    if ((digits.length == 12 || digits.length == 13) &&
        digits.startsWith('55')) {
      return digits;
    }

    return null;
  }

  Future<void> _openWhatsApp(String phone) async {
    final digits = _whatsAppDigits(phone);

    if (digits == null) {
      _showMessage('WhatsApp não disponível para este cliente.');
      return;
    }

    try {
      final launched = await launchUrl(
        Uri.parse('https://wa.me/$digits'),
        mode: LaunchMode.externalApplication,
      );

      if (!launched) {
        _showMessage('Não foi possível abrir o WhatsApp.');
      }
    } catch (error) {
      debugPrint(
        '[CatalogRequestDetailScreen] Erro ao abrir WhatsApp: $error',
      );
      _showMessage('Não foi possível abrir o WhatsApp.');
    }
  }

  String _messageForTransitionError(
    FirebaseFunctionsException error,
  ) {
    switch (error.code) {
      case 'unauthenticated':
        return 'Sua sessão expirou. Entre novamente e tente outra vez.';

      case 'permission-denied':
        return 'Você não possui permissão para realizar esta ação.';

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

  Future<void> _transitionRequest(String action) async {
    if (_isTransitioning) {
      return;
    }

    final expectedStatus = switch (action) {
      'start' => 'in_progress',
      'complete' => 'completed',
      'cancel' => 'cancelled',
      _ => null,
    };

    if (expectedStatus == null) {
      _showMessage('Ação inválida para esta solicitação.');
      return;
    }

    setState(() {
      _isTransitioning = true;
    });

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'transitionCatalogRequest',
        options: HttpsCallableOptions(
          timeout: const Duration(seconds: 30),
        ),
      );

      final response = await callable.call({
        'requestId': widget.requestId,
        'action': action,
      });

      final rawData = response.data;

      if (rawData is! Map ||
          rawData['success'] != true ||
          rawData['requestId']?.toString().trim() != widget.requestId ||
          rawData['status'] != expectedStatus) {
        throw const FormatException(
          'Resposta inválida ao atualizar a solicitação.',
        );
      }

      await _loadRequest();

      if (!mounted) {
        return;
      }

      final message = switch (action) {
        'start' => 'Atendimento iniciado.',
        'complete' => 'Atendimento finalizado.',
        'cancel' => 'Solicitação cancelada.',
        _ => 'Solicitação atualizada.',
      };

      _showMessage(message);
    } on FirebaseFunctionsException catch (error) {
      _showMessage(_messageForTransitionError(error));
    } catch (error) {
      debugPrint(
        '[CatalogRequestDetailScreen] '
        'Erro ao atualizar solicitação: $error',
      );
      _showMessage('Não foi possível atualizar esta solicitação.');
    } finally {
      if (mounted) {
        setState(() {
          _isTransitioning = false;
        });
      }
    }
  }

  Future<bool> _confirmAction({
    required String title,
    required String message,
    required String confirmLabel,
    required String confirmKey,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Voltar'),
          ),
          FilledButton(
            key: ValueKey(confirmKey),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );

    return result == true;
  }

  Future<void> _confirmComplete() async {
    final confirmed = await _confirmAction(
      title: 'Finalizar atendimento?',
      message: 'Esta solicitação será marcada como finalizada. '
          'Essa ação não poderá ser desfeita.',
      confirmLabel: 'Finalizar atendimento',
      confirmKey: 'confirm-detail-complete',
    );

    if (confirmed && mounted) {
      await _transitionRequest('complete');
    }
  }

  Future<void> _confirmCancel() async {
    final status = _request?['status'];

    final inProgress = status == 'in_progress';

    final confirmed = await _confirmAction(
      title: inProgress
          ? 'Cancelar atendimento?'
          : 'Cancelar solicitação?',
      message: 'Esta solicitação será marcada como cancelada. '
          'Essa ação não poderá ser desfeita.',
      confirmLabel: 'Confirmar cancelamento',
      confirmKey: 'confirm-detail-cancel',
    );

    if (confirmed && mounted) {
      await _transitionRequest('cancel');
    }
  }

  bool _hasLifecycleEvent(
    Map<String, dynamic> request,
    String prefix,
  ) {
    return _optionalText(request['${prefix}ByUid']) != null ||
        _optionalText(request['${prefix}ByName']) != null ||
        _optionalText(request['${prefix}At']) != null;
  }

  bool _hasAvailableActions(Map<String, dynamic> request) {
    final status = request['status'];
    return status == 'pending' || status == 'in_progress';
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

  Widget _buildCustomerCard(
    Map<String, dynamic> request,
  ) {
    final name =
        _optionalText(request['customerName']) ?? 'Cliente não identificado';
    final phone = _optionalText(request['customerPhone']);
    final note = _optionalText(request['note']);
    final whatsappDigits =
        phone == null ? null : _whatsAppDigits(phone);

    return Card(
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
                  'Cliente',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                _DetailInfoChip(
                  icon: Icons.flag_outlined,
                  label: _statusLabel(request['status']),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              name,
              key: const ValueKey('detail-customer-name'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (phone != null) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    _formatCustomerPhone(phone),
                    key: const ValueKey('detail-customer-phone'),
                  ),
                  if (whatsappDigits != null)
                    OutlinedButton.icon(
                      key: const ValueKey('detail-whatsapp'),
                      onPressed: () => _openWhatsApp(phone),
                      icon: const Icon(Icons.chat_outlined),
                      label: const Text('WhatsApp'),
                    ),
                ],
              ),
            ],
            if (note != null) ...[
              const SizedBox(height: 18),
              Text(
                'Observação',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 6),
              Text(
                note,
                key: const ValueKey('detail-note'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildLifecycleEntry(
    Map<String, dynamic> request, {
    required String prefix,
    required String title,
    required IconData icon,
  }) {
    final name =
        _optionalText(request['${prefix}ByName']) ??
            'Responsável não identificado';
    final at = request['${prefix}At'];

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(name),
                const SizedBox(height: 2),
                Text(_formatDateTime(at)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLifecycleCard(
    Map<String, dynamic> request,
  ) {
    final hasAttended = _hasLifecycleEvent(request, 'attended');
    final hasCompleted = _hasLifecycleEvent(request, 'completed');
    final hasCancelled = _hasLifecycleEvent(request, 'cancelled');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Histórico do atendimento',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            if (!hasAttended && !hasCompleted && !hasCancelled) ...[
              const SizedBox(height: 12),
              const Text('Atendimento ainda não iniciado.'),
            ],
            if (hasAttended)
              _buildLifecycleEntry(
                request,
                prefix: 'attended',
                title: 'Atendimento iniciado',
                icon: Icons.play_circle_outline,
              ),
            if (hasCompleted)
              _buildLifecycleEntry(
                request,
                prefix: 'completed',
                title: 'Atendimento finalizado',
                icon: Icons.check_circle_outline,
              ),
            if (hasCancelled)
              _buildLifecycleEntry(
                request,
                prefix: 'cancelled',
                title: 'Solicitação cancelada',
                icon: Icons.cancel_outlined,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionsCard(
    Map<String, dynamic> request,
  ) {
    final status = request['status'];

    if (!_hasAvailableActions(request)) {
      return const SizedBox.shrink();
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Ações',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                if (status == 'pending')
                  FilledButton.icon(
                    key: const ValueKey('detail-start'),
                    onPressed: _isTransitioning
                        ? null
                        : () => _transitionRequest('start'),
                    icon: _isTransitioning
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
                if (status == 'in_progress')
                  FilledButton.icon(
                    key: const ValueKey('detail-complete'),
                    onPressed:
                        _isTransitioning ? null : _confirmComplete,
                    icon: _isTransitioning
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(Icons.check),
                    label: const Text('Finalizar atendimento'),
                  ),
                OutlinedButton.icon(
                  key: const ValueKey('detail-cancel'),
                  onPressed:
                      _isTransitioning ? null : _confirmCancel,
                  icon: const Icon(Icons.cancel_outlined),
                  label: Text(
                    status == 'in_progress'
                        ? 'Cancelar atendimento'
                        : 'Cancelar solicitação',
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
              const SizedBox(height: 16),
              _buildCustomerCard(request),
              const SizedBox(height: 16),
              _buildLifecycleCard(request),
              if (_hasAvailableActions(request)) ...[
                const SizedBox(height: 16),
                _buildActionsCard(request),
              ],
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
                _isLoading || _isTransitioning ? null : _loadRequest,
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