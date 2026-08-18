// lib/screens/finance/invoices_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

class InvoicesScreen extends StatefulWidget {
  final String storeId;

  const InvoicesScreen({
    super.key,
    required this.storeId,
  });

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  bool _isLoading = true;
  bool _isChangingPlan = false;

  List<dynamic> _invoices = [];

  String _errorMessage = '';

  // ---------------------------------------------------------------------------
  // DADOS DA ASSINATURA
  // ---------------------------------------------------------------------------

  String? _subscriptionType;
  String? _subscriptionStatus;
  String? _pendingPlanChange;
  String? _asaasSubscriptionId;

  double get _currentPlanPrice {
    if (_subscriptionType == 'business') {
      return 99.90;
    }

    return 35.90;
  }

  bool get _isBusiness =>
      _subscriptionType == 'business';

  bool get _isPro =>
      _subscriptionType == 'pro';

  bool get _hasPendingDowngrade =>
      _subscriptionType == 'business' &&
          _pendingPlanChange == 'pro';

  bool get _isSubscriptionActive =>
      _subscriptionStatus == 'active';

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------

  @override
  void initState() {
    super.initState();

    _loadAll();
  }

  // ---------------------------------------------------------------------------
  // CARREGA TUDO
  // ---------------------------------------------------------------------------

  Future<void> _loadAll() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = '';
      });
    }

    try {
      await Future.wait([
        _fetchStoreSubscription(),
        _fetchInvoices(),
      ]);
    } catch (e) {
      debugPrint(
        'Erro ao carregar Minha Assinatura: $e',
      );

      if (mounted) {
        setState(() {
          _errorMessage =
          'Não foi possível carregar os dados da assinatura.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // BUSCA DADOS DA LOJA
  // ---------------------------------------------------------------------------

  Future<void> _fetchStoreSubscription() async {
    final doc = await FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .get();

    if (!doc.exists) {
      throw Exception(
        'Loja não encontrada.',
      );
    }

    final data = doc.data()!;

    if (!mounted) return;

    setState(() {
      _subscriptionType =
      data['subscriptionType'] as String?;

      _subscriptionStatus =
      data['subscriptionStatus'] as String?;

      _pendingPlanChange =
      data['pendingPlanChange'] as String?;

      _asaasSubscriptionId =
      data['asaasSubscriptionId'] as String?;
    });
  }

  // ---------------------------------------------------------------------------
  // BUSCA FATURAS ASAAS
  // ---------------------------------------------------------------------------

  Future<void> _fetchInvoices() async {
    try {
      final result = await FirebaseFunctions.instance
          .httpsCallable(
        'listAsaasInvoices',
      )
          .call({
        'storeId': widget.storeId,
      });

      final data =
      Map<String, dynamic>.from(
        result.data,
      );

      if (!mounted) return;

      setState(() {
        _invoices =
            data['invoices'] as List<dynamic>? ??
                [];
      });
    } catch (e) {
      debugPrint(
        'Erro ao buscar faturas: $e',
      );

      rethrow;
    }
  }

  // ---------------------------------------------------------------------------
  // ALTERA O PLANO
  //
  // PRO -> BUSINESS
  // BUSINESS -> PRO
  //
  // A regra real está protegida no backend.
  // ---------------------------------------------------------------------------

  Future<void> _changePlan(
      String newPlan,
      ) async {
    if (_isChangingPlan) return;

    // -------------------------------------------------------------------------
    // CONFIRMAÇÃO
    // -------------------------------------------------------------------------

    final bool isUpgrade =
        newPlan == 'business';

    final confirmed =
    await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: Text(
            isUpgrade
                ? 'Upgrade para Business'
                : 'Alterar para Plano Pro',
          ),
          content: Text(
            isUpgrade
                ? 'O Plano Business custa R\$ 99,90 por mês.\n\n'
                'O acesso aos recursos Business será liberado agora, '
                'e a próxima mensalidade da sua assinatura passará para R\$ 99,90.\n\n'
                'Sua assinatura atual será mantida. Nenhuma segunda assinatura será criada.'
                : 'Seu downgrade para o Plano Pro será agendado.\n\n'
                'Você continuará utilizando o Business e deverá pagar a próxima mensalidade '
                'Business de R\$ 99,90.\n\n'
                'Após esse pagamento, sua assinatura passará para o Plano Pro de R\$ 39.90.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(ctx).pop(false);
              },
              child: const Text(
                'Cancelar',
              ),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.of(ctx).pop(true);
              },
              child: Text(
                isUpgrade
                    ? 'Confirmar Upgrade'
                    : 'Agendar Downgrade',
              ),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    if (mounted) {
      setState(() {
        _isChangingPlan = true;
      });
    }

    try {
      final callable =
      FirebaseFunctions.instance
          .httpsCallable(
        'changeAsaasPlan',
      );

      final response =
      await callable.call({
        'storeId': widget.storeId,
        'plan': newPlan,
      });

      final data =
      Map<String, dynamic>.from(
        response.data,
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            data['message'] ??
                'Plano atualizado com sucesso.',
          ),
          backgroundColor:
          Colors.green,
          duration:
          const Duration(seconds: 6),
        ),
      );

      // Recarrega o Firestore e as faturas
      await _loadAll();
    } on FirebaseFunctionsException catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            e.message ??
                'Não foi possível alterar o plano.',
          ),
          backgroundColor:
          Colors.red,
        ),
      );
    } catch (e) {
      if (!mounted) return;

      ScaffoldMessenger.of(context)
          .showSnackBar(
        SnackBar(
          content: Text(
            'Erro ao alterar plano: $e',
          ),
          backgroundColor:
          Colors.red,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isChangingPlan = false;
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ABRE FATURA
  // ---------------------------------------------------------------------------

  Future<void> _openInvoiceUrl(
      String url,
      ) async {
    if (url.isEmpty) return;

    final Uri uri =
    Uri.parse(url);

    if (!await launchUrl(
      uri,
      mode: LaunchMode.externalApplication,
    )) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(
          const SnackBar(
            content: Text(
              'Erro ao abrir o link da fatura.',
            ),
            backgroundColor:
            Colors.red,
          ),
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STATUS FATURA
  // ---------------------------------------------------------------------------

  Map<String, dynamic> _getStatusConfig(
      String status,
      DateTime dueDate,
      ) {
    switch (status) {
      case 'RECEIVED':
      case 'CONFIRMED':
        return {
          'text': 'Pago',
          'color': Colors.green,
          'icon':
          Icons.check_circle,
        };

      case 'OVERDUE':
        return {
          'text': 'Atrasado',
          'color': Colors.red,
          'icon': Icons.error,
        };

      case 'PENDING':
        if (dueDate.isAfter(
          DateTime.now().add(
            const Duration(days: 7),
          ),
        )) {
          return {
            'text': 'A Vencer',
            'color':
            Colors.grey.shade600,
            'icon': Icons.schedule,
          };
        }

        return {
          'text': 'Pagar Agora',
          'color':
          Colors.blue.shade700,
          'icon':
          Icons.warning_rounded,
        };

      default:
        return {
          'text': status,
          'color': Colors.grey,
          'icon': Icons.info,
        };
    }
  }

  // ---------------------------------------------------------------------------
  // DATA
  // ---------------------------------------------------------------------------

  String _formatDate(
      String dateString,
      ) {
    try {
      final parts =
      dateString.split('-');

      return '${parts[2]}/${parts[1]}/${parts[0]}';
    } catch (_) {
      return dateString;
    }
  }

  // ---------------------------------------------------------------------------
  // STATUS DA ASSINATURA
  // ---------------------------------------------------------------------------

  String get _subscriptionStatusText {
    switch (_subscriptionStatus) {
      case 'active':
        return 'Assinatura ativa';

      case 'pending':
        return 'Aguardando pagamento';

      case 'overdue':
        return 'Pagamento em atraso';

      case 'inactive':
        return 'Assinatura inativa';

      default:
        return 'Status não informado';
    }
  }

  Color get _subscriptionStatusColor {
    switch (_subscriptionStatus) {
      case 'active':
        return Colors.green;

      case 'pending':
        return Colors.orange;

      case 'overdue':
        return Colors.red;

      case 'inactive':
        return Colors.grey;

      default:
        return Colors.grey;
    }
  }

  // ---------------------------------------------------------------------------
  // BUILD
  // ---------------------------------------------------------------------------

  @override
  Widget build(
      BuildContext context,
      ) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Minha Assinatura',
        ),
        centerTitle: true,
      ),
      body: _buildBody(),
    );
  }

  // ---------------------------------------------------------------------------
  // BODY
  // ---------------------------------------------------------------------------

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child:
        CircularProgressIndicator(),
      );
    }

    if (_errorMessage.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment:
          MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.receipt_long,
              size: 64,
              color: Colors.grey,
            ),

            const SizedBox(
              height: 16,
            ),

            Text(
              _errorMessage,
              style: const TextStyle(
                color: Colors.red,
              ),
            ),

            const SizedBox(
              height: 16,
            ),

            ElevatedButton(
              onPressed: _loadAll,
              child: const Text(
                'Tentar Novamente',
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadAll,
      child: ListView(
        padding:
        const EdgeInsets.all(16),
        children: [
          // ================================================================
          // PLANO ATUAL
          // ================================================================

          _buildCurrentPlanCard(),

          const SizedBox(
            height: 16,
          ),

          // ================================================================
          // BUSINESS PARA CLIENTE PRO
          // ================================================================

          if (_isPro)
            _buildBusinessOfferCard(),

          // ================================================================
          // DOWNGRADE PENDENTE
          // ================================================================

          if (_hasPendingDowngrade)
            _buildPendingDowngradeCard(),

          const SizedBox(
            height: 28,
          ),

          // ================================================================
          // HISTÓRICO
          // ================================================================

          const Text(
            'Histórico de Faturas',
            style: TextStyle(
              fontSize: 20,
              fontWeight:
              FontWeight.bold,
            ),
          ),

          const SizedBox(
            height: 6,
          ),

          Text(
            'Consulte pagamentos anteriores e cobranças em aberto.',
            style: TextStyle(
              color:
              Colors.grey.shade600,
            ),
          ),

          const SizedBox(
            height: 16,
          ),

          if (_invoices.isEmpty)
            Padding(
              padding:
              const EdgeInsets.symmetric(
                vertical: 40,
              ),
              child: Center(
                child: Text(
                  'Nenhuma fatura encontrada.',
                  style: TextStyle(
                    color:
                    Colors.grey.shade600,
                  ),
                ),
              ),
            )
          else
            ..._invoices.map(
                  (invoice) =>
                  _buildInvoiceCard(
                    invoice,
                  ),
            ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // CARD PLANO ATUAL
  // ---------------------------------------------------------------------------

  Widget _buildCurrentPlanCard() {
    final bool business =
        _isBusiness;

    return Card(
      elevation: 3,
      shape: RoundedRectangleBorder(
        borderRadius:
        BorderRadius.circular(18),
      ),
      child: Padding(
        padding:
        const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.start,
          children: [
            const Text(
              'PLANO ATUAL',
              style: TextStyle(
                fontSize: 12,
                fontWeight:
                FontWeight.bold,
                color: Colors.grey,
                letterSpacing: 1.2,
              ),
            ),

            const SizedBox(
              height: 12,
            ),

            Row(
              children: [
                CircleAvatar(
                  radius: 25,
                  backgroundColor:
                  business
                      ? Colors.amber
                      .shade100
                      : Colors
                      .deepPurple
                      .shade50,
                  child: Icon(
                    business
                        ? Icons
                        .workspace_premium
                        : Icons
                        .verified_outlined,
                    color: business
                        ? Colors.amber
                        .shade800
                        : Colors
                        .deepPurple,
                  ),
                ),

                const SizedBox(
                  width: 14,
                ),

                Expanded(
                  child: Column(
                    crossAxisAlignment:
                    CrossAxisAlignment
                        .start,
                    children: [
                      Text(
                        business
                            ? 'Business'
                            : 'Pro',
                        style:
                        const TextStyle(
                          fontSize: 24,
                          fontWeight:
                          FontWeight
                              .bold,
                        ),
                      ),

                      Text(
                        'R\$ ${_currentPlanPrice.toStringAsFixed(2).replaceAll('.', ',')} / mês',
                        style:
                        TextStyle(
                          fontSize: 16,
                          color: Colors
                              .grey
                              .shade700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(
              height: 18,
            ),

            Container(
              padding:
              const EdgeInsets
                  .symmetric(
                horizontal: 12,
                vertical: 8,
              ),
              decoration:
              BoxDecoration(
                color:
                _subscriptionStatusColor
                    .withOpacity(
                  0.10,
                ),
                borderRadius:
                BorderRadius.circular(
                  20,
                ),
              ),
              child: Row(
                mainAxisSize:
                MainAxisSize.min,
                children: [
                  Icon(
                    Icons.circle,
                    size: 10,
                    color:
                    _subscriptionStatusColor,
                  ),

                  const SizedBox(
                    width: 8,
                  ),

                  Text(
                    _subscriptionStatusText,
                    style: TextStyle(
                      color:
                      _subscriptionStatusColor,
                      fontWeight:
                      FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),

            // ---------------------------------------------------------------
            // BUSINESS ATIVO SEM DOWNGRADE
            // ---------------------------------------------------------------

            if (
            business &&
                !_hasPendingDowngrade &&
                _isSubscriptionActive) ...[
              const SizedBox(
                height: 20,
              ),

              const Divider(),

              const SizedBox(
                height: 12,
              ),

              _buildFeature(
                'Tudo do Plano Pro',
              ),

              _buildFeature(
                'Emissão de NFC-e',
              ),

              _buildFeature(
                'Módulo fiscal',
              ),

              _buildFeature(
                'Integração Focus NFe',
              ),

              _buildFeature(
                'Histórico de notas fiscais',
              ),

              const SizedBox(
                height: 18,
              ),

              SizedBox(
                width:
                double.infinity,
                child:
                OutlinedButton(
                  onPressed:
                  _isChangingPlan
                      ? null
                      : () =>
                      _changePlan(
                        'pro',
                      ),
                  child: const Text(
                    'ALTERAR PARA PLANO PRO',
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // OFERTA BUSINESS
  // ---------------------------------------------------------------------------

  Widget _buildBusinessOfferCard() {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(
        borderRadius:
        BorderRadius.circular(18),
        side: BorderSide(
          color:
          Colors.amber.shade300,
        ),
      ),
      child: Padding(
        padding:
        const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment:
          CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons
                      .workspace_premium,
                  color:
                  Colors.amber.shade800,
                ),

                const SizedBox(
                  width: 10,
                ),

                const Expanded(
                  child: Text(
                    'Store Connect Business',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight:
                      FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(
              height: 8,
            ),

            const Text(
              'R\$ 99,90 / mês',
              style: TextStyle(
                fontSize: 22,
                fontWeight:
                FontWeight.bold,
              ),
            ),

            const SizedBox(
              height: 18,
            ),

            _buildFeature(
              'Tudo que você já possui no PRO',
            ),

            _buildFeature(
              'Emissão de NFC-e',
            ),

            _buildFeature(
              'Configuração fiscal da empresa',
            ),

            _buildFeature(
              'Integração com Focus NFe',
            ),

            _buildFeature(
              'Histórico de documentos fiscais',
            ),

            const SizedBox(
              height: 20,
            ),

            SizedBox(
              width: double.infinity,
              height: 50,
              child:
              ElevatedButton.icon(
                onPressed:
                !_isSubscriptionActive ||
                    _isChangingPlan
                    ? null
                    : () =>
                    _changePlan(
                      'business',
                    ),
                icon:
                _isChangingPlan
                    ? const SizedBox(
                  width: 18,
                  height: 18,
                  child:
                  CircularProgressIndicator(
                    strokeWidth:
                    2,
                  ),
                )
                    : const Icon(
                  Icons
                      .rocket_launch_outlined,
                ),
                label: const Text(
                  'FAZER UPGRADE PARA BUSINESS',
                  style: TextStyle(
                    fontWeight:
                    FontWeight.bold,
                  ),
                ),
              ),
            ),

            if (!_isSubscriptionActive) ...[
              const SizedBox(
                height: 10,
              ),

              const Text(
                'Regularize sua assinatura antes de alterar o plano.',
                style: TextStyle(
                  color: Colors.red,
                  fontSize: 13,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // DOWNGRADE AGENDADO
  // ---------------------------------------------------------------------------

  Widget _buildPendingDowngradeCard() {
    return Padding(
      padding:
      const EdgeInsets.only(
        top: 16,
      ),
      child: Card(
        elevation: 1,
        shape:
        RoundedRectangleBorder(
          borderRadius:
          BorderRadius.circular(
            18,
          ),
        ),
        child: Padding(
          padding:
          const EdgeInsets.all(
            20,
          ),
          child: Column(
            crossAxisAlignment:
            CrossAxisAlignment
                .start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.schedule,
                    color: Colors
                        .orange
                        .shade700,
                  ),

                  const SizedBox(
                    width: 10,
                  ),

                  const Expanded(
                    child: Text(
                      'Alteração de plano agendada',
                      style:
                      TextStyle(
                        fontSize: 18,
                        fontWeight:
                        FontWeight
                            .bold,
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(
                height: 14,
              ),

              const Text(
                'Você continua no Plano Business.',
                style: TextStyle(
                  fontWeight:
                  FontWeight.bold,
                ),
              ),

              const SizedBox(
                height: 8,
              ),

              const Text(
                'Após o pagamento da próxima mensalidade Business de R\$ 99,90, sua assinatura será alterada automaticamente para o Plano Pro de R\$ 39.90 por mês.',
                style: TextStyle(
                  height: 1.4,
                ),
              ),

              const SizedBox(
                height: 14,
              ),

              Text(
                'Enquanto o pagamento Business não for confirmado, seus recursos Business continuam disponíveis.',
                style: TextStyle(
                  color:
                  Colors.grey.shade700,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // FEATURE
  // ---------------------------------------------------------------------------

  Widget _buildFeature(
      String text,
      ) {
    return Padding(
      padding:
      const EdgeInsets.symmetric(
        vertical: 5,
      ),
      child: Row(
        children: [
          const Icon(
            Icons.check_circle,
            color: Colors.green,
            size: 20,
          ),

          const SizedBox(
            width: 9,
          ),

          Expanded(
            child: Text(
              text,
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // CARD FATURA
  // ---------------------------------------------------------------------------

  Widget _buildInvoiceCard(
      dynamic invoice,
      ) {
    final String statusStr =
        invoice['status'] ??
            'UNKNOWN';

    final String dueDateStr =
        invoice['dueDate'] ?? '';

    final double value =
    (invoice['value'] ?? 0)
        .toDouble();

    final String url =
        invoice['invoiceUrl'] ??
            '';

    DateTime dueDate =
    DateTime.now();

    try {
      dueDate =
          DateTime.parse(
            dueDateStr,
          );
    } catch (_) {}

    final config =
    _getStatusConfig(
      statusStr,
      dueDate,
    );

    final bool isActionable =
        statusStr == 'PENDING' ||
            statusStr == 'OVERDUE';

    return Card(
      margin:
      const EdgeInsets.only(
        bottom: 12,
      ),
      elevation: 2,
      shape:
      RoundedRectangleBorder(
        borderRadius:
        BorderRadius.circular(
          12,
        ),
      ),
      child: ListTile(
        contentPadding:
        const EdgeInsets
            .symmetric(
          horizontal: 16,
          vertical: 12,
        ),
        leading: CircleAvatar(
          backgroundColor:
          config['color']
              .withOpacity(
            0.15,
          ),
          child: Icon(
            config['icon'],
            color:
            config['color'],
          ),
        ),
        title: Text(
          'Vencimento: ${_formatDate(dueDateStr)}',
          style:
          const TextStyle(
            fontWeight:
            FontWeight.bold,
          ),
        ),
        subtitle: Text(
          'R\$ ${value.toStringAsFixed(2).replaceAll('.', ',')}',
          style: TextStyle(
            color:
            Colors.grey.shade700,
            fontWeight:
            FontWeight.w500,
          ),
        ),
        trailing:
        isActionable
            ? ElevatedButton(
          style:
          ElevatedButton
              .styleFrom(
            backgroundColor:
            config[
            'color'],
            foregroundColor:
            Colors.white,
          ),
          onPressed: () =>
              _openInvoiceUrl(
                url,
              ),
          child: Text(
            config['text'],
          ),
        )
            : Text(
          config['text'],
          style:
          TextStyle(
            color:
            config[
            'color'],
            fontWeight:
            FontWeight
                .bold,
          ),
        ),
      ),
    );
  }
}