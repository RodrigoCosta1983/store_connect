import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:store_connect/services/pdf_receipt_service.dart';

class CustomerReceivablesScreen extends StatelessWidget {
  final String storeId;
  final String customerId;
  final String customerName;

  const CustomerReceivablesScreen({
    super.key,
    required this.storeId,
    required this.customerId,
    required this.customerName,
  });

  // ===========================================================================
  // FORMATAÇÕES
  // ===========================================================================

  String _money(double value) {
    return NumberFormat.currency(
      locale: 'pt_BR',
      symbol: 'R\$',
    ).format(value);
  }

  String _date(DateTime date) {
    return DateFormat('dd/MM/yyyy').format(date);
  }

  // ===========================================================================
  // CONVERTE DATA DO FIRESTORE
  // ===========================================================================

  DateTime? _toDate(dynamic value) {
    if (value == null) return null;

    if (value is Timestamp) {
      return value.toDate();
    }

    if (value is DateTime) {
      return value;
    }

    if (value is String) {
      return DateTime.tryParse(value);
    }

    return null;
  }

  // ===========================================================================
  // NORMALIZA DATA
  //
  // Ignora horas/minutos para conseguirmos agrupar parcelas que vencem
  // no mesmo dia.
  // ===========================================================================

  DateTime _dateOnly(DateTime date) {
    return DateTime(
      date.year,
      date.month,
      date.day,
    );
  }

  // ===========================================================================
  // MONTA TODAS AS PARCELAS PENDENTES DO CLIENTE
  // ===========================================================================

  List<Map<String, dynamic>> _extractPendingInstallments(
      List<QueryDocumentSnapshot> salesDocs,
      ) {
    final pending = <Map<String, dynamic>>[];

    for (final saleDoc in salesDocs) {
      final sale =
      saleDoc.data() as Map<String, dynamic>;

      final installments =
          sale['installments'] as List<dynamic>? ?? [];

      final saleCreatedAt =
      _toDate(sale['createdAt']);

      final int installmentCount =
          (sale['installmentCount'] as num?)?.toInt() ??
              installments.length;

      // -----------------------------------------------------------------------
      // VENDAS COM PARCELAMENTO NOVO
      // -----------------------------------------------------------------------

      for (final rawInstallment in installments) {
        if (rawInstallment is! Map) continue;

        final installment =
        Map<String, dynamic>.from(rawInstallment);

        final bool isPaid =
            installment['isPaid'] == true;

        final double amount =
        (installment['amount'] as num? ?? 0)
            .toDouble();

        final double paidAmount =
        (installment['paidAmount'] as num? ?? 0)
            .toDouble();

        // Valor que realmente ainda falta.
        final double remaining =
            amount - paidAmount;

        // Já quitada ou sem saldo.
        if (isPaid || remaining <= 0.001) {
          continue;
        }

        final dueDate =
        _toDate(installment['dueDate']);

        if (dueDate == null) continue;

        pending.add({
          'saleId': saleDoc.id,
          'saleCreatedAt': saleCreatedAt,
          'dueDate': _dateOnly(dueDate),
          'installmentNumber':
          (installment['number'] as num? ?? 0)
              .toInt(),
          'installmentCount':
          installmentCount,
          'amount': amount,
          'paidAmount': paidAmount,
          'remainingAmount': remaining,
          'products':
          sale['products'] as List<dynamic>? ?? [],
        });
      }

      // -----------------------------------------------------------------------
// COMPATIBILIDADE COM VENDA A PRAZO ANTIGA SEM installments
//
// As vendas antigas não possuem lista "installments".
// Nelas, o abatimento realizado pelo sistema é salvo no campo:
//
// paidAmount
//
// Por isso:
//
// saldo = totalAmount - paidAmount
// -----------------------------------------------------------------------

      if (installments.isEmpty &&
          sale['isPaid'] != true) {
        final dueDate =
        _toDate(sale['dueDate']);

        if (dueDate == null) {
          continue;
        }

        final double totalAmount =
        (sale['totalAmount'] as num? ?? 0)
            .toDouble();

        final double paidAmount =
        (sale['paidAmount'] as num? ?? 0)
            .toDouble();

        final double remaining =
            totalAmount - paidAmount;

        // Se já foi totalmente quitada,
        // não entra na lista de pendências.
        if (remaining <= 0.001) {
          continue;
        }

        pending.add({
          'saleId': saleDoc.id,
          'saleCreatedAt': saleCreatedAt,
          'dueDate': _dateOnly(dueDate),
          'installmentNumber': 1,
          'installmentCount': 1,

          // Valor original da venda
          'amount': totalAmount,

          // Quanto já foi abatido
          'paidAmount': paidAmount,

          // Quanto ainda falta receber
          'remainingAmount': remaining,

          'products':
          sale['products'] as List<dynamic>? ?? [],
        });
      }
    }

    pending.sort(
          (a, b) => (a['dueDate'] as DateTime)
          .compareTo(
        b['dueDate'] as DateTime,
      ),
    );

    return pending;
  }

  // ===========================================================================
  // AGRUPA POR DATA DE VENCIMENTO
  // ===========================================================================

  Map<DateTime, List<Map<String, dynamic>>> _groupByDueDate(
      List<Map<String, dynamic>> installments,
      ) {
    final groups =
    <DateTime, List<Map<String, dynamic>>>{};

    for (final installment in installments) {
      final dueDate =
      installment['dueDate'] as DateTime;

      groups.putIfAbsent(
        dueDate,
            () => [],
      );

      groups[dueDate]!.add(
        installment,
      );
    }

    return groups;
  }

  // ===========================================================================
  // SOMA SALDOS
  // ===========================================================================

  double _sumRemaining(
      Iterable<Map<String, dynamic>> installments,
      ) {
    return installments.fold<double>(
      0,
          (total, installment) =>
      total +
          (installment['remainingAmount']
          as num)
              .toDouble(),
    );
  }

  // ===========================================================================
  // DESCRIÇÃO PRODUTOS
  // ===========================================================================

  String _productsDescription(
      List<dynamic> products,
      ) {
    if (products.isEmpty) {
      return 'Venda a prazo';
    }

    final names = <String>[];

    for (final raw in products) {
      if (raw is Map) {
        final map =
        Map<String, dynamic>.from(raw);

        final name =
        map['name']?.toString();

        if (name != null &&
            name.trim().isNotEmpty) {
          names.add(name);
        }
      }
    }

    if (names.isEmpty) {
      return 'Venda a prazo';
    }

    if (names.length <= 2) {
      return names.join(', ');
    }

    return '${names.take(2).join(', ')} +${names.length - 2} item(ns)';
  }

  // ===========================================================================
  // UI
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Conta do Cliente',
        ),
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('stores')
            .doc(storeId)
            .collection('sales')
            .where(
          'customerId',
          isEqualTo: customerId,
        )
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState ==
              ConnectionState.waiting) {
            return const Center(
              child:
              CircularProgressIndicator(),
            );
          }

          if (snapshot.hasError) {
            return Center(
              child: Text(
                'Erro ao carregar parcelas: ${snapshot.error}',
              ),
            );
          }

          final salesDocs =
              snapshot.data?.docs ?? [];

          final installments =
          _extractPendingInstallments(
            salesDocs,
          );

          if (installments.isEmpty) {
            return _buildEmptyState();
          }

          final groups =
          _groupByDueDate(
            installments,
          );

          final dates =
          groups.keys.toList()
            ..sort();

          final nextDueDate =
              dates.first;

          final nextInstallments =
          groups[nextDueDate]!;

          final nextAmount =
          _sumRemaining(
            nextInstallments,
          );

          final totalOpen =
          _sumRemaining(
            installments,
          );

          final today =
          _dateOnly(DateTime.now());

          final bool nextIsOverdue =
          nextDueDate.isBefore(today);

          return RefreshIndicator(
            onRefresh: () async {
              // StreamBuilder já atualiza automaticamente.
              await Future<void>.delayed(
                const Duration(
                  milliseconds: 400,
                ),
              );
            },
            child: ListView(
              padding:
              const EdgeInsets.all(16),
              children: [
                // =============================================================
                // CLIENTE
                // =============================================================

                Text(
                  customerName,
                  style: const TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),

                const SizedBox(height: 4),

                Text(
                  'Resumo de valores a receber',
                  style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 14,
                  ),
                ),

                const SizedBox(
                  height: 20,
                ),

                // =============================================================
                // PRÓXIMO VENCIMENTO
                // =============================================================

                _buildNextPaymentCard(
                  context: context,
                  dueDate: nextDueDate,
                  amount: nextAmount,
                  installmentCount: nextInstallments.length,
                  isOverdue: nextIsOverdue,
                  installments: nextInstallments,
                  totalOpen: totalOpen,
                ),
                const SizedBox(
                  height: 16,
                ),

                // =============================================================
                // SALDO TOTAL
                // =============================================================

                Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 14,
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.account_balance_wallet_outlined,
                          size: 28,
                        ),

                        const SizedBox(width: 14),

                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Saldo total em aberto',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),

                              const SizedBox(height: 2),

                              Text(
                                '${installments.length} parcela(s) pendente(s)',
                                style: TextStyle(
                                  color: Colors.grey.shade600,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),

                        const SizedBox(width: 12),

                        Text(
                          _money(totalOpen),
                          style: const TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(
                  height: 28,
                ),

                const Text(
                  'Próximos vencimentos',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight:
                    FontWeight.bold,
                  ),
                ),

                const SizedBox(
                  height: 12,
                ),

                // =============================================================
                // TODOS OS VENCIMENTOS
                // =============================================================

                ...dates.map(
                      (date) {
                    final items =
                    groups[date]!;

                    final total =
                    _sumRemaining(
                      items,
                    );

                    return _buildDueDateGroup(
                      context,
                      date,
                      items,
                      total,
                    );
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // ===========================================================================
  // CARD PRINCIPAL
  // ===========================================================================

  Widget _buildNextPaymentCard({
    required BuildContext context,
    required DateTime dueDate,
    required double amount,
    required int installmentCount,
    required bool isOverdue,
    required List<Map<String, dynamic>> installments,
    required double totalOpen,
  }) {
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
            Row(
              children: [
                Icon(
                  isOverdue
                      ? Icons
                      .warning_amber_rounded
                      : Icons
                      .calendar_month,
                  color: isOverdue
                      ? Colors.red
                      : Colors.deepPurple,
                ),

                const SizedBox(
                  width: 10,
                ),

                Text(
                  isOverdue
                      ? 'VALOR EM ATRASO'
                      : 'PRÓXIMO VENCIMENTO',
                  style:
                  const TextStyle(
                    fontWeight:
                    FontWeight.bold,
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),

            const SizedBox(
              height: 18,
            ),

            Text(
              _money(amount),
              style:
              const TextStyle(
                fontSize: 34,
                fontWeight:
                FontWeight.bold,
              ),
            ),

            const SizedBox(
              height: 6,
            ),

            Text(
              'Vencimento: ${_date(dueDate)}',
              style:
              const TextStyle(
                fontSize: 16,
                fontWeight:
                FontWeight.w500,
              ),
            ),

            const SizedBox(
              height: 4,
            ),

            Text(
              '$installmentCount parcela(s) incluída(s) neste vencimento',
              style: TextStyle(
                color:
                Colors.grey.shade600,
              ),
            ),

            const SizedBox(
              height: 20,
            ),

            SizedBox(
              width:
              double.infinity,
              child:
              ElevatedButton.icon(
                onPressed: () async {
                  try {
                    await PdfReceiptService().shareCustomerPaymentSummary(
                      context: context,
                      storeId: storeId,
                      customerName: customerName,
                      dueDate: dueDate,
                      installments: installments,
                      totalDue: amount,
                      totalOpen: totalOpen,
                    );
                  } catch (e) {
                    if (!context.mounted) return;

                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          'Não foi possível gerar o resumo: $e',
                        ),
                        backgroundColor: Colors.red,
                      ),
                    );
                  }
                },
                icon: const Icon(
                  Icons.picture_as_pdf_outlined,
                ),
                label: const Text(
                  'GERAR RESUMO DE PAGAMENTO',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ===========================================================================
  // GRUPO DE VENCIMENTO
  // ===========================================================================

  Widget _buildDueDateGroup(
      BuildContext context,
      DateTime date,
      List<Map<String, dynamic>> items,
      double total,
      ) {
    return Card(
      margin:
      const EdgeInsets.only(
        bottom: 12,
      ),
      child: ExpansionTile(
        title: Text(
          _date(date),
          style:
          const TextStyle(
            fontWeight:
            FontWeight.bold,
          ),
        ),
        subtitle: Text(
          '${items.length} parcela(s)',
        ),
        trailing: Text(
          _money(total),
          style:
          const TextStyle(
            fontWeight:
            FontWeight.bold,
            fontSize: 16,
          ),
        ),
        children: [
          const Divider(
            height: 1,
          ),

          ...items.map(
                (item) {
              final saleDate =
              item['saleCreatedAt']
              as DateTime?;

              final installmentNumber =
              item[
              'installmentNumber'];

              final installmentCount =
              item[
              'installmentCount'];

              final amount =
              (item['amount'] as num)
                  .toDouble();

              final paid =
              (item['paidAmount']
              as num)
                  .toDouble();

              final remaining =
              (item[
              'remainingAmount']
              as num)
                  .toDouble();

              final products =
                  item['products']
                  as List<dynamic>? ??
                      [];

              return ListTile(
                leading:
                const CircleAvatar(
                  child: Icon(
                    Icons.receipt_long,
                  ),
                ),
                title: Text(
                  'Parcela $installmentNumber/$installmentCount',
                  style:
                  const TextStyle(
                    fontWeight:
                    FontWeight.bold,
                  ),
                ),
                subtitle: Column(
                  crossAxisAlignment:
                  CrossAxisAlignment
                      .start,
                  children: [
                    if (saleDate != null)
                      Text(
                        'Compra: ${_date(saleDate)}',
                      ),

                    Text(
                      _productsDescription(
                        products,
                      ),
                    ),

                    if (paid > 0)
                      Text(
                        'Parcela: ${_money(amount)} • Pago: ${_money(paid)}',
                      ),
                  ],
                ),
                trailing: Text(
                  _money(remaining),
                  style:
                  const TextStyle(
                    fontWeight:
                    FontWeight.bold,
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // ===========================================================================
  // SEM DÉBITOS
  // ===========================================================================

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding:
        const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment:
          MainAxisAlignment.center,
          children: [
            const Icon(
              Icons
                  .check_circle_outline,
              size: 72,
              color: Colors.green,
            ),

            const SizedBox(
              height: 18,
            ),

            const Text(
              'Nenhum valor em aberto',
              style: TextStyle(
                fontSize: 22,
                fontWeight:
                FontWeight.bold,
              ),
            ),

            const SizedBox(
              height: 8,
            ),

            Text(
              '$customerName não possui parcelas pendentes.',
              textAlign:
              TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}