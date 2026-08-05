// lib/screens/finance/invoices_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

class InvoicesScreen extends StatefulWidget {
  final String storeId;

  const InvoicesScreen({super.key, required this.storeId});

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  bool _isLoading = true;
  List<dynamic> _invoices = [];
  String _errorMessage = '';

  @override
  void initState() {
    super.initState();
    _fetchInvoices();
  }

  Future<void> _fetchInvoices() async {
    setState(() {
      _isLoading = true;
      _errorMessage = '';
    });

    try {
      final result = await FirebaseFunctions.instance
          .httpsCallable('listAsaasInvoices')
          .call({'storeId': widget.storeId});

      setState(() {
        _invoices = result.data['invoices'] as List<dynamic>;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _errorMessage = 'Não foi possível carregar as faturas.';
        _isLoading = false;
      });
    }
  }

  Future<void> _openInvoiceUrl(String url) async {
    if (url.isEmpty) return;
    final Uri uri = Uri.parse(url);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Erro ao abrir o link da fatura.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Map<String, dynamic> _getStatusConfig(String status, DateTime dueDate) {
    switch (status) {
      case 'RECEIVED':
      case 'CONFIRMED':
        return {'text': 'Pago', 'color': Colors.green, 'icon': Icons.check_circle};
      case 'OVERDUE':
        return {'text': 'Atrasado', 'color': Colors.red, 'icon': Icons.error};
      case 'PENDING':
        if (dueDate.isAfter(DateTime.now().add(const Duration(days: 7)))) {
          return {'text': 'A Vencer', 'color': Colors.grey.shade600, 'icon': Icons.schedule};
        } else {
          return {'text': 'Pagar Agora', 'color': Colors.blue.shade700, 'icon': Icons.warning_rounded};
        }
      default:
        return {'text': status, 'color': Colors.grey, 'icon': Icons.info};
    }
  }

  String _formatDate(String dateString) {
    try {
      final parts = dateString.split('-');
      return '${parts[2]}/${parts[1]}/${parts[0]}';
    } catch (e) {
      return dateString;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Histórico de Faturas'),
        centerTitle: true,
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_errorMessage.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.receipt_long, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            Text(_errorMessage, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _fetchInvoices,
              child: const Text('Tentar Novamente'),
            )
          ],
        ),
      );
    }

    if (_invoices.isEmpty) {
      return const Center(child: Text('Nenhuma fatura encontrada.'));
    }

    return RefreshIndicator(
      onRefresh: _fetchInvoices,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _invoices.length,
        itemBuilder: (context, index) {
          final invoice = _invoices[index];
          final String statusStr = invoice['status'] ?? 'UNKNOWN';
          final String dueDateStr = invoice['dueDate'] ?? '';
          final double value = (invoice['value'] ?? 0).toDouble();
          final String url = invoice['invoiceUrl'] ?? '';

          DateTime dueDate = DateTime.now();
          try {
            dueDate = DateTime.parse(dueDateStr);
          } catch (_) {}

          final config = _getStatusConfig(statusStr, dueDate);
          final bool isActionable = statusStr == 'PENDING' || statusStr == 'OVERDUE';

          return Card(
            margin: const EdgeInsets.only(bottom: 12),
            elevation: 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              leading: CircleAvatar(
                backgroundColor: config['color'].withOpacity(0.15),
                child: Icon(config['icon'], color: config['color']),
              ),
              title: Text(
                'Vencimento: ${_formatDate(dueDateStr)}',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
              subtitle: Text(
                'R\$ ${value.toStringAsFixed(2).replaceAll('.', ',')}',
                style: TextStyle(color: Colors.grey.shade700, fontWeight: FontWeight.w500),
              ),
              trailing: isActionable
                  ? ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: config['color'],
                  foregroundColor: Colors.white,
                ),
                onPressed: () => _openInvoiceUrl(url),
                child: Text(config['text']),
              )
                  : Text(
                config['text'],
                style: TextStyle(color: config['color'], fontWeight: FontWeight.bold),
              ),
            ),
          );
        },
      ),
    );
  }
}