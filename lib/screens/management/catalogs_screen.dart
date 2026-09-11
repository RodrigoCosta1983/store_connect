import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

class CatalogsScreen extends StatefulWidget {
  const CatalogsScreen({super.key});

  @override
  State<CatalogsScreen> createState() => _CatalogsScreenState();
}

class _CatalogsScreenState extends State<CatalogsScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  List<Map<String, dynamic>> _catalogs = [];

  @override
  void initState() {
    super.initState();
    _loadCatalogs();
  }

  Future<void> _loadCatalogs() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final callable = FirebaseFunctions.instance.httpsCallable(
        'listCatalogs',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      );

      final response = await callable.call();

      final rawData = response.data;

      if (rawData is! Map) {
        throw const FormatException('Resposta inválida ao carregar catálogos.');
      }

      if (rawData['success'] != true) {
        throw const FormatException(
          'O backend não confirmou a listagem dos catálogos.',
        );
      }

      final rawCatalogs = rawData['catalogs'];

      if (rawCatalogs is! List) {
        throw const FormatException(
          'Lista de catálogos não encontrada na resposta.',
        );
      }

      final catalogs = rawCatalogs
          .whereType<Map>()
          .map((catalog) => Map<String, dynamic>.from(catalog))
          .toList();

      if (!mounted) {
        return;
      }

      setState(() {
        _catalogs = catalogs;
      });
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage =
            error.message ?? 'Não foi possível carregar os catálogos.';
      });
    } catch (error) {
      debugPrint('[CatalogsScreen] Erro ao carregar catálogos: $error');

      if (!mounted) {
        return;
      }

      setState(() {
        _errorMessage = 'Não foi possível carregar os catálogos.';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _copyCatalogLink(String publicUrl) async {
    await Clipboard.setData(ClipboardData(text: publicUrl));

    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(const SnackBar(content: Text('Link copiado.')));
  }

  Future<void> _shareCatalogLink(String publicUrl) async {
    await SharePlus.instance.share(
      ShareParams(text: 'Confira este catálogo:\n\n$publicUrl'),
    );
  }

  String _formatDate(dynamic value) {
    final rawValue = value?.toString().trim() ?? '';

    if (rawValue.isEmpty) {
      return '—';
    }

    final date = DateTime.tryParse(rawValue)?.toLocal();

    if (date == null) {
      return '—';
    }

    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    final year = date.year.toString();

    return '$day/$month/$year';
  }

  String _statusLabel(dynamic value) {
    final status = value?.toString().trim().toLowerCase() ?? '';

    switch (status) {
      case 'active':
        return 'ATIVO';

      case 'expired':
        return 'EXPIRADO';

      case 'inactive':
        return 'INATIVO';

      case 'closed':
        return 'ENCERRADO';

      default:
        return 'STATUS INDEFINIDO';
    }
  }

  Color _statusColor(BuildContext context, dynamic value) {
    final status = value?.toString().trim().toLowerCase() ?? '';

    switch (status) {
      case 'active':
        return Colors.green;

      case 'expired':
        return Colors.red;

      case 'inactive':
      case 'closed':
        return Colors.grey;

      default:
        return Theme.of(context).colorScheme.secondary;
    }
  }

  Widget _buildStatusBadge(BuildContext context, dynamic status) {
    final color = _statusColor(context, status);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 9, color: color),
          const SizedBox(width: 7),
          Text(
            _statusLabel(status),
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCatalogCard(Map<String, dynamic> catalog) {
    final title = catalog['title']?.toString().trim() ?? '';

    final productCount = (catalog['productCount'] as num?)?.toInt() ?? 0;

    final publicUrl = catalog['publicUrl']?.toString().trim() ?? '';

    final linkAvailable =
        catalog['linkAvailable'] == true && publicUrl.isNotEmpty;

    return Card(
      elevation: 3,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'CATÁLOGO',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: Colors.grey,
                letterSpacing: 1.2,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 25,
                  backgroundColor: Colors.deepPurple.shade50,
                  child: const Icon(
                    Icons.inventory_2_outlined,
                    color: Colors.deepPurple,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    title.isEmpty ? 'Catálogo sem título' : title,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                _buildStatusBadge(context, catalog['status']),
              ],
            ),
            const SizedBox(height: 18),
            const Divider(),
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(
                  Icons.shopping_bag_outlined,
                  size: 19,
                  color: Colors.grey,
                ),
                const SizedBox(width: 8),
                Text(
                  productCount == 1 ? '1 produto' : '$productCount produtos',
                  style: const TextStyle(fontSize: 15),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Icon(
                  Icons.calendar_today_outlined,
                  size: 18,
                  color: Colors.grey,
                ),
                const SizedBox(width: 8),
                Text(
                  'Criado: ${_formatDate(catalog['createdAt'])}',
                  style: TextStyle(color: Colors.grey.shade700),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(
                  Icons.event_busy_outlined,
                  size: 18,
                  color: Colors.grey,
                ),
                const SizedBox(width: 8),
                Text(
                  'Expira: ${_formatDate(catalog['expiresAt'])}',
                  style: TextStyle(color: Colors.grey.shade700),
                ),
              ],
            ),
            if (linkAvailable) ...[
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        _copyCatalogLink(publicUrl);
                      },
                      icon: const Icon(Icons.copy_outlined),
                      label: const Text('Copiar link'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () {
                        _shareCatalogLink(publicUrl);
                      },
                      icon: const Icon(Icons.share_outlined),
                      label: const Text('Compartilhar'),
                    ),
                  ),
                ],
              ),
            ],
            if (!linkAvailable) ...[
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.orange.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.link_off_outlined,
                      size: 19,
                      color: Colors.orange,
                    ),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Link deste catálogo não está disponível.',
                        style: TextStyle(
                          color: Colors.orange,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.inventory_2_outlined,
              size: 64,
              color: Colors.grey.shade400,
            ),
            const SizedBox(height: 18),
            const Text(
              'Nenhum catálogo criado',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Os catálogos compartilhados da sua loja aparecerão aqui.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600, height: 1.4),
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
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 56, color: Colors.red),
            const SizedBox(height: 16),
            Text(
              _errorMessage ?? 'Não foi possível carregar os catálogos.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: _loadCatalogs,
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

    if (_catalogs.isEmpty) {
      return _buildEmptyState();
    }

    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: 1100,
        ),
        child: RefreshIndicator(
          onRefresh: _loadCatalogs,
          child: ListView.builder(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            itemCount: _catalogs.length,
            itemBuilder: (context, index) {
              return _buildCatalogCard(_catalogs[index]);
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
        title: const Text('Catálogo Inteligente'),
        centerTitle: true,
      ),
      body: _buildBody(),
    );
  }
}
