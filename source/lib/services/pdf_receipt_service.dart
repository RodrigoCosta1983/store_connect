// lib/services/pdf_receipt_service.dart

import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:printing/printing.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../models/sale_order_model.dart';

class PdfReceiptService {
  // Atualizado para receber um 'storeName' opcional, útil caso queira o nome da loja do cliente no cabeçalho
  Future<Uint8List> _generatePdfBytes(
    SaleOrder order, {
    String storeName = 'Store Connect',
  }) async {
    final pdf = pw.Document();
    final font = await PdfGoogleFonts.robotoRegular();
    final boldFont = await PdfGoogleFonts.robotoBold();

    final emojiFont = await PdfGoogleFonts.notoColorEmoji();

    // 1. Carregando a imagem dos assets
    // Envolva em um try-catch caso a imagem não seja encontrada para não quebrar a geração
    pw.MemoryImage? logoImage;
    try {
      final ByteData bytes = await rootBundle.load('assets/images/logo.png');
      logoImage = pw.MemoryImage(bytes.buffer.asUint8List());
    } catch (e) {
      print('Erro ao carregar a logo: $e');
    }

    // Paleta de cores da marca (ajuste conforme o design do app)
    const primaryColor = PdfColors.blue600;
    const neutralGrey = PdfColors.grey700;

    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // 2. Cabeçalho atualizado com a Logo
              pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  // Coluna da esquerda: Logo + Nome
                  pw.Row(
                    crossAxisAlignment: pw.CrossAxisAlignment.center,
                    children: [
                      if (logoImage != null) ...[
                        pw.Image(
                          logoImage,
                          width: 50,
                          height: 50,
                        ), // Ajuste o tamanho conforme sua logo
                        pw.SizedBox(width: 10),
                      ],
                      pw.Column(
                        crossAxisAlignment: pw.CrossAxisAlignment.start,
                        children: [
                          pw.Text(
                            storeName,
                            style: pw.TextStyle(
                              font: boldFont,
                              fontSize: 24,
                              color: primaryColor,
                              fontFallback: [emojiFont],
                            ),
                          ),
                          pw.Text(
                            'Recibo gerado via app',
                            style: pw.TextStyle(
                              font: font,
                              fontSize: 10,
                              color: neutralGrey,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  // Coluna da direita: Título
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Text(
                        'RECIBO DE VENDA',
                        style: pw.TextStyle(font: boldFont, fontSize: 18),
                      ),
                      pw.SizedBox(height: 4),
                      pw.Text(
                        'ID: ${order.id}',
                        style: pw.TextStyle(
                          font: font,
                          fontSize: 10,
                          color: neutralGrey,
                        ),
                      ),
                      pw.SizedBox(height: 2),
                      pw.Text(
                        DateFormat('dd/MM/yyyy').format(order.createdAt),
                        style: pw.TextStyle(font: font, fontSize: 12),
                      ),
                    ],
                  ),
                ],
              ),
              pw.SizedBox(height: 20),
              pw.Divider(thickness: 1, color: PdfColors.grey300),
              pw.SizedBox(height: 15),

              // 2. Detalhes da Transação
              pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      if (order.customerName != null &&
                          order.customerName!.isNotEmpty)
                        pw.RichText(
                          text: pw.TextSpan(
                            children: [
                              pw.TextSpan(
                                text: 'Cliente: ',
                                style: pw.TextStyle(font: boldFont),
                              ),
                              pw.TextSpan(
                                text: order.customerName!,
                                style: pw.TextStyle(
                                  font: font,
                                  fontFallback: [emojiFont],
                                  color: neutralGrey,
                                ),
                              ),
                            ],
                          ),
                        ),
                      pw.SizedBox(height: 4),
                      pw.RichText(
                        text: pw.TextSpan(
                          children: [
                            pw.TextSpan(
                              text: 'Data: ',
                              style: pw.TextStyle(font: boldFont),
                            ),
                            pw.TextSpan(
                              text: DateFormat(
                                'dd/MM/yyyy HH:mm',
                              ).format(order.createdAt),
                              style: pw.TextStyle(font: font),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              pw.SizedBox(height: 25),

              // 3. Tabela de Produtos (Com cores e alinhamento)
              pw.TableHelper.fromTextArray(
                headers: ['Produto', 'Qtd.', 'Preço Un.', 'Subtotal'],
                data: order.products
                    .map(
                      (prod) => [
                        prod.receiptDescription,
                        prod.quantity.toString(),
                        'R\$ ${prod.price.toStringAsFixed(2)}',
                        'R\$ ${(prod.price * prod.quantity).toStringAsFixed(2)}',
                      ],
                    )
                    .toList(),
                border:
                    null, // Remove as bordas padrão da tabela para um visual mais limpo
                headerStyle: pw.TextStyle(
                  font: boldFont,
                  color: PdfColors.white,
                  fontSize: 11,
                ),
                headerDecoration: const pw.BoxDecoration(color: primaryColor),
                cellStyle: pw.TextStyle(
                  font: font,
                  fontFallback: [emojiFont],
                  color: neutralGrey,
                  fontSize: 10,
                ),
                cellHeight: 34,
                cellAlignments: {
                  0: pw.Alignment.centerLeft,
                  1: pw.Alignment.center, // Quantidade centralizada
                  2: pw
                      .Alignment
                      .centerLeft, // Valores financeiros alinhados à direita
                  3: pw.Alignment.centerLeft,
                },
              ),
              pw.Divider(thickness: 1, color: PdfColors.grey300),
              pw.SizedBox(height: 10),

              // ------------------------------------------------------------
              // CONDIÇÕES DE PAGAMENTO / PARCELAMENTO
              // ------------------------------------------------------------
              if (order.installments.isNotEmpty) ...[
                pw.Container(
                  width: double.infinity,
                  padding: const pw.EdgeInsets.all(12),
                  margin: const pw.EdgeInsets.only(bottom: 15),
                  decoration: pw.BoxDecoration(
                    color: PdfColors.grey100,
                    borderRadius: const pw.BorderRadius.all(
                      pw.Radius.circular(4),
                    ),
                  ),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                        'Condições de Pagamento',
                        style: pw.TextStyle(
                          font: boldFont,
                          fontSize: 14,
                          color: primaryColor,
                        ),
                      ),

                      pw.SizedBox(height: 8),

                      pw.RichText(
                        text: pw.TextSpan(
                          children: [
                            pw.TextSpan(
                              text: 'Forma de pagamento: ',
                              style: pw.TextStyle(font: boldFont),
                            ),
                            pw.TextSpan(
                              text: order.paymentDescription,
                              style: pw.TextStyle(font: font),
                            ),
                          ],
                        ),
                      ),

                      pw.SizedBox(height: 4),

                      pw.RichText(
                        text: pw.TextSpan(
                          children: [
                            pw.TextSpan(
                              text: 'Parcelamento: ',
                              style: pw.TextStyle(font: boldFont),
                            ),
                            pw.TextSpan(
                              text: '${order.installmentCount}x',
                              style: pw.TextStyle(font: font),
                            ),
                          ],
                        ),
                      ),

                      pw.SizedBox(height: 12),

                      pw.TableHelper.fromTextArray(
                        headers: [
                          'Parcela',
                          'Valor',
                          'Vencimento',
                          'Pago',
                          'Saldo',
                          'Status',
                        ],
                        data: order.installments.map((installment) {
                          final remaining =
                              installment.amount - installment.paidAmount;

                          String status;

                          if (installment.isPaid) {
                            status = 'Quitada';
                          } else if (installment.paidAmount > 0) {
                            status = 'Parcial';
                          } else if (installment.dueDate.isBefore(
                            DateTime(
                              DateTime.now().year,
                              DateTime.now().month,
                              DateTime.now().day,
                            ),
                          )) {
                            status = 'Vencida';
                          } else {
                            status = 'Pendente';
                          }

                          return [
                            '${installment.number}/${order.installmentCount}',
                            'R\$ ${installment.amount.toStringAsFixed(2)}',
                            DateFormat(
                              'dd/MM/yyyy',
                            ).format(installment.dueDate),
                            'R\$ ${installment.paidAmount.toStringAsFixed(2)}',
                            'R\$ ${remaining.toStringAsFixed(2)}',
                            status,
                          ];
                        }).toList(),
                        border: null,
                        headerStyle: pw.TextStyle(
                          font: boldFont,
                          color: PdfColors.white,
                          fontSize: 10,
                        ),
                        headerDecoration: const pw.BoxDecoration(
                          color: primaryColor,
                        ),
                        cellStyle: pw.TextStyle(
                          font: font,
                          fontSize: 9.5,
                          color: neutralGrey,
                        ),
                        cellHeight: 30,
                        cellAlignments: {
                          0: pw.Alignment.center,
                          1: pw.Alignment.centerRight,
                          2: pw.Alignment.center,
                          3: pw.Alignment.centerRight,
                          4: pw.Alignment.centerRight,
                          5: pw.Alignment.center,
                        },
                      ),

                      pw.SizedBox(height: 12),

                      pw.Row(
                        mainAxisAlignment: pw.MainAxisAlignment.end,
                        children: [
                          pw.Column(
                            crossAxisAlignment: pw.CrossAxisAlignment.end,
                            children: [
                              pw.Text(
                                'Total recebido: '
                                'R\$ ${order.totalPaidAmount.toStringAsFixed(2)}',
                                style: pw.TextStyle(
                                  font: boldFont,
                                  fontSize: 10,
                                ),
                              ),
                              pw.SizedBox(height: 3),
                              pw.Text(
                                'Saldo em aberto: '
                                'R\$ ${(order.totalAmount - order.totalPaidAmount).toStringAsFixed(2)}',
                                style: pw.TextStyle(
                                  font: boldFont,
                                  fontSize: 10,
                                  color: primaryColor,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],

              // 4. Observações
              if (order.notes.isNotEmpty)
                pw.Container(
                  margin: const pw.EdgeInsets.only(bottom: 20),
                  padding: const pw.EdgeInsets.all(10),
                  decoration: pw.BoxDecoration(
                    color: PdfColors.grey100,
                    borderRadius: const pw.BorderRadius.all(
                      pw.Radius.circular(4),
                    ),
                  ),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text(
                        'Observações:',
                        style: pw.TextStyle(font: boldFont, fontSize: 12),
                      ),
                      pw.SizedBox(height: 4),
                      pw.Text(
                        order.notes,
                        style: pw.TextStyle(
                          font: font,
                          fontSize: 12,
                          fontFallback: [emojiFont],
                          color: neutralGrey,
                        ),
                      ),
                    ],
                  ),
                ),

              pw.Spacer(),

              // 5. Total em Destaque
              pw.Container(
                alignment: pw.Alignment.centerRight,
                child: pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.end,
                  children: [
                    pw.Text(
                      'Total: ',
                      style: pw.TextStyle(font: boldFont, fontSize: 18),
                    ),
                    pw.Text(
                      'R\$ ${order.totalAmount.toStringAsFixed(2)}',
                      style: pw.TextStyle(
                        font: boldFont,
                        fontSize: 18,
                        color: primaryColor,
                      ),
                    ),
                  ],
                ),
              ),

              pw.SizedBox(height: 40),

              // 6. Rodapé
              pw.Center(
                child: pw.Column(
                  children: [
                    pw.Divider(thickness: 1, color: PdfColors.grey300),
                    pw.SizedBox(height: 8),
                    pw.Text(
                      'Obrigado pela preferência!',
                      style: pw.TextStyle(font: boldFont, fontSize: 12),
                    ),
                    pw.Text(
                      'Tecnologia por Store Connect',
                      style: pw.TextStyle(
                        font: font,
                        fontSize: 10,
                        color: neutralGrey,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
    return pdf.save();
  }

  Future<void> viewAndSavePdf(SaleOrder order) async {
    String storeName = 'Store Connect';

    // Busca o nome da loja no Firestore antes de gerar a visualização
    try {
      if (order.storeId.isNotEmpty) {
        final storeDoc = await FirebaseFirestore.instance
            .collection('stores')
            .doc(order.storeId)
            .get();
        if (storeDoc.exists) {
          storeName = storeDoc.data()?['name'] ?? 'Store Connect';
        }
      }
    } catch (e) {
      print('Erro ao buscar nome da loja na visualização: $e');
    }

    // ---> MUDANÇA AQUI: Passando o storeName <---
    final pdfBytes = await _generatePdfBytes(order, storeName: storeName);

    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdfBytes,
      name: 'Recibo $storeName', // Muda também o nome sugerido para impressão
    );
  }

  Future<void> viewThermalPdf(SaleOrder order) async {
    String storeName = 'Store Connect';

    try {
      if (order.storeId.isNotEmpty) {
        final storeDoc = await FirebaseFirestore.instance
            .collection('stores')
            .doc(order.storeId)
            .get();

        if (storeDoc.exists) {
          storeName = storeDoc.data()?['name'] ?? 'Store Connect';
        }
      }
    } catch (e) {
      print('Erro ao buscar nome da loja no recibo térmico: $e');
    }

    final pdfBytes = await _generateThermalPdfBytes(
      order,
      storeName: storeName,
    );

    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdfBytes,
      name: 'Cupom $storeName',
    );
  }

  Future<void> sharePdf(SaleOrder order, BuildContext context) async {
    String storeName = 'StoreConnect';
    try {
      if (order.storeId.isNotEmpty) {
        final storeDoc = await FirebaseFirestore.instance
            .collection('stores')
            .doc(order.storeId)
            .get();
        if (storeDoc.exists) {
          storeName = storeDoc.data()?['name'] ?? 'StoreConnect';
        }
      }
    } catch (e) {
      print('Erro ao buscar nome da loja: $e');
    }

    final sanitizedStoreName = storeName
        .replaceAll(RegExp(r'[^\w\s]+'), '')
        .replaceAll(' ', '_');
    final pdfBytes = await _generatePdfBytes(order, storeName: storeName);

    final output = await getTemporaryDirectory();
    final file = File("${output.path}/recibo_${sanitizedStoreName}.pdf");
    await file.writeAsBytes(pdfBytes);

    final box = context.findRenderObject() as RenderBox?;
    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/pdf')],
      subject: 'Recibo da Venda',
      sharePositionOrigin: box!.localToGlobal(Offset.zero) & box.size,
    );
  }

  Future<void> shareCustomerPaymentSummary({
    required BuildContext context,
    required String storeId,
    required String customerName,
    required List<Map<String, dynamic>> installments,
    required double totalOpen,
  }) async {
    String storeName = 'Store Connect';
    String? pixQrCodeUrl;

    try {
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .get();

      if (storeDoc.exists) {
        final data = storeDoc.data();

        storeName = data?['name']?.toString() ?? 'Store Connect';

        final rawPixQrCodeUrl = data?['pixQrCodeUrl']?.toString().trim();

        if (rawPixQrCodeUrl != null && rawPixQrCodeUrl.isNotEmpty) {
          pixQrCodeUrl = rawPixQrCodeUrl;
        }
      }
    } catch (e) {
      print('Erro ao buscar dados da loja para o PDF: $e');
    }

    final pdf = pw.Document();

    final font = await PdfGoogleFonts.robotoRegular();

    final boldFont = await PdfGoogleFonts.robotoBold();

    pw.MemoryImage? logoImage;

    try {
      final ByteData bytes = await rootBundle.load('assets/images/logo.png');

      logoImage = pw.MemoryImage(bytes.buffer.asUint8List());
    } catch (e) {
      print('Erro ao carregar logo: $e');
    }

    pw.ImageProvider? pixQrImage;

    if (pixQrCodeUrl != null) {
      try {
        pixQrImage = await networkImage(pixQrCodeUrl!);
      } catch (e) {
        print('Erro ao carregar QR Code PIX da loja para o PDF: $e');
      }
    }

    const primaryColor = PdfColors.blue600;

    const neutralGrey = PdfColors.grey700;

    final generatedAt = DateTime.now();

    double number(dynamic value) {
      if (value is num) {
        return value.toDouble();
      }

      return 0;
    }

    DateTime? dateValue(dynamic value) {
      if (value is DateTime) {
        return value;
      }

      if (value is Timestamp) {
        return value.toDate();
      }

      return null;
    }

    String money(double value) {
      return NumberFormat.currency(
        locale: 'pt_BR',
        symbol: 'R\$',
      ).format(value);
    }

    String date(DateTime value) {
      return DateFormat('dd/MM/yyyy').format(value);
    }

    String dateTime(DateTime value) {
      return DateFormat("dd/MM/yyyy 'às' HH:mm").format(value);
    }

    String shortId(String value) {
      if (value.length <= 12) {
        return value;
      }

      return '${value.substring(0, 6)}...'
          '${value.substring(value.length - 3)}';
    }

    String productsDescription(List<dynamic> products) {
      if (products.isEmpty) {
        return 'Venda a prazo';
      }

      final names = <String>[];

      for (final raw in products) {
        if (raw is! Map) {
          continue;
        }

        final map = Map<String, dynamic>.from(raw);

        final name = map['name']?.toString().trim();

        if (name != null && name.isNotEmpty) {
          names.add(name);
        }
      }

      if (names.isEmpty) {
        return 'Venda a prazo';
      }

      if (names.length <= 3) {
        return names.join(', ');
      }

      return '${names.take(3).join(', ')} '
          '+${names.length - 3} item(ns)';
    }

    pw.Widget infoCell(String label, String value) {
      return pw.Expanded(
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              label,
              style: pw.TextStyle(
                font: font,
                fontSize: 7.5,
                color: neutralGrey,
              ),
            ),
            pw.SizedBox(height: 2),
            pw.Text(value, style: pw.TextStyle(font: boldFont, fontSize: 9)),
          ],
        ),
      );
    }

    pw.Widget installmentRow(Map<String, dynamic> item) {
      final installmentNumber = (item['installmentNumber'] as num? ?? 0)
          .toInt();

      final installmentCount = (item['installmentCount'] as num? ?? 0).toInt();

      final amount = number(item['amount']);

      final paid = number(item['paidAmount']);

      final remaining = number(item['remainingAmount']);

      final dueDate = dateValue(item['dueDate']);

      final isPartial = paid > 0.001 && remaining > 0.001;

      final status = isPartial ? 'Parcial' : 'Pendente';

      final statusColor = isPartial ? PdfColors.orange700 : PdfColors.red700;

      final statusBackground = isPartial ? PdfColors.orange50 : PdfColors.red50;

      return pw.Container(
        margin: const pw.EdgeInsets.only(bottom: 5),
        padding: const pw.EdgeInsets.symmetric(horizontal: 9, vertical: 7),
        decoration: pw.BoxDecoration(
          color: PdfColors.grey50,
          border: pw.Border.all(color: PdfColors.grey300, width: 0.6),
          borderRadius: pw.BorderRadius.circular(6),
        ),
        child: pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.center,
          children: [
            pw.Container(
              width: 24,
              height: 24,
              alignment: pw.Alignment.center,
              decoration: pw.BoxDecoration(
                color: PdfColors.blue50,
                borderRadius: pw.BorderRadius.circular(12),
              ),
              child: pw.Text(
                '$installmentNumber',
                style: pw.TextStyle(
                  font: boldFont,
                  fontSize: 9,
                  color: primaryColor,
                ),
              ),
            ),
            pw.SizedBox(width: 7),
            pw.Expanded(
              flex: 2,
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    '$installmentNumber/'
                    '$installmentCount parcela',
                    style: pw.TextStyle(font: boldFont, fontSize: 8.5),
                  ),
                  pw.SizedBox(height: 2),
                  pw.Text(
                    money(amount),
                    style: pw.TextStyle(font: boldFont, fontSize: 9.5),
                  ),
                ],
              ),
            ),
            pw.Expanded(
              flex: 2,
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'Vencimento',
                    style: pw.TextStyle(
                      font: font,
                      fontSize: 7,
                      color: neutralGrey,
                    ),
                  ),
                  pw.SizedBox(height: 2),
                  pw.Text(
                    dueDate != null ? date(dueDate) : '-',
                    style: pw.TextStyle(font: boldFont, fontSize: 8),
                  ),
                ],
              ),
            ),
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'Pago',
                    style: pw.TextStyle(
                      font: font,
                      fontSize: 7,
                      color: neutralGrey,
                    ),
                  ),
                  pw.SizedBox(height: 2),
                  pw.Text(
                    money(paid),
                    style: pw.TextStyle(
                      font: boldFont,
                      fontSize: 8,
                      color: paid > 0 ? PdfColors.green700 : neutralGrey,
                    ),
                  ),
                ],
              ),
            ),
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  pw.Text(
                    'Restante',
                    style: pw.TextStyle(
                      font: font,
                      fontSize: 7,
                      color: neutralGrey,
                    ),
                  ),
                  pw.SizedBox(height: 2),
                  pw.Text(
                    money(remaining),
                    style: pw.TextStyle(font: boldFont, fontSize: 8),
                  ),
                ],
              ),
            ),
            pw.SizedBox(width: 5),
            pw.Container(
              padding: const pw.EdgeInsets.symmetric(
                horizontal: 7,
                vertical: 4,
              ),
              decoration: pw.BoxDecoration(
                color: statusBackground,
                borderRadius: pw.BorderRadius.circular(10),
              ),
              child: pw.Text(
                status,
                style: pw.TextStyle(
                  font: boldFont,
                  fontSize: 7,
                  color: statusColor,
                ),
              ),
            ),
          ],
        ),
      );
    }

    final groupedPurchases = <String, List<Map<String, dynamic>>>{};

    for (final installment in installments) {
      final saleId = installment['saleId']?.toString().trim() ?? '';

      if (saleId.isEmpty) {
        continue;
      }

      groupedPurchases
          .putIfAbsent(saleId, () => <Map<String, dynamic>>[])
          .add(installment);
    }

    final purchases = groupedPurchases.entries.toList()
      ..sort((a, b) {
        final aDate = dateValue(a.value.first['saleCreatedAt']);

        final bDate = dateValue(b.value.first['saleCreatedAt']);

        if (aDate == null && bDate == null) {
          return 0;
        }

        if (aDate == null) {
          return 1;
        }

        if (bDate == null) {
          return -1;
        }

        return aDate.compareTo(bDate);
      });

    final purchaseWidgets = <pw.Widget>[];

    for (
      var purchaseIndex = 0;
      purchaseIndex < purchases.length;
      purchaseIndex++
    ) {
      final purchase = purchases[purchaseIndex];

      final items = purchase.value;

      items.sort(
        (a, b) => ((a['installmentNumber'] as num? ?? 0).toInt()).compareTo(
          (b['installmentNumber'] as num? ?? 0).toInt(),
        ),
      );

      final first = items.first;

      final purchaseDate = dateValue(first['saleCreatedAt']);

      final installmentCount =
          (first['installmentCount'] as num? ?? items.length).toInt();

      var purchaseTotal = number(first['saleTotalAmount']);

      if (purchaseTotal <= 0) {
        purchaseTotal = items.fold<double>(
          0,
          (sum, item) => sum + number(item['amount']),
        );
      }

      final products = first['products'] as List<dynamic>? ?? [];

      purchaseWidgets.add(
        pw.Container(
          width: double.infinity,
          padding: const pw.EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: pw.BoxDecoration(
            color: PdfColors.grey50,
            border: pw.Border.all(color: PdfColors.grey300, width: 0.7),
            borderRadius: pw.BorderRadius.circular(7),
          ),
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Row(
                crossAxisAlignment: pw.CrossAxisAlignment.center,
                children: [
                  pw.Expanded(
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text(
                          customerName,
                          style: pw.TextStyle(font: boldFont, fontSize: 12),
                        ),
                        pw.SizedBox(height: 2),
                        pw.Text(
                          'Compra '
                          '${purchaseIndex + 1}'
                          '  •  ID: '
                          '${shortId(purchase.key)}',
                          style: pw.TextStyle(
                            font: font,
                            fontSize: 7.5,
                            color: neutralGrey,
                          ),
                        ),
                      ],
                    ),
                  ),
                  pw.Container(
                    width: 0.6,
                    height: 28,
                    color: PdfColors.grey300,
                  ),
                  pw.SizedBox(width: 12),
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Text(
                        'Valor total da compra',
                        style: pw.TextStyle(
                          font: font,
                          fontSize: 7.5,
                          color: neutralGrey,
                        ),
                      ),
                      pw.SizedBox(height: 2),
                      pw.Text(
                        money(purchaseTotal),
                        style: pw.TextStyle(
                          font: boldFont,
                          fontSize: 13,
                          color: primaryColor,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              pw.SizedBox(height: 7),
              pw.Divider(color: PdfColors.grey300, height: 1),
              pw.SizedBox(height: 7),
              pw.Row(
                children: [
                  infoCell(
                    'Data da compra',
                    purchaseDate != null ? dateTime(purchaseDate) : '-',
                  ),
                  pw.SizedBox(width: 8),
                  infoCell('Pagamento', 'A prazo (Pendente)'),
                  pw.SizedBox(width: 8),
                  infoCell('Parcelamento', '${installmentCount}x'),
                ],
              ),
              pw.SizedBox(height: 6),
              pw.Text(
                'Itens: '
                '${productsDescription(products)}',
                style: pw.TextStyle(
                  font: font,
                  fontSize: 7.5,
                  color: neutralGrey,
                ),
              ),
            ],
          ),
        ),
      );

      purchaseWidgets.add(pw.SizedBox(height: 6));

      purchaseWidgets.add(
        pw.Text(
          'Parcelas em aberto',
          style: pw.TextStyle(
            font: boldFont,
            fontSize: 9.5,
            color: primaryColor,
          ),
        ),
      );

      purchaseWidgets.add(pw.SizedBox(height: 5));

      for (final item in items) {
        purchaseWidgets.add(installmentRow(item));
      }

      purchaseWidgets.add(pw.SizedBox(height: 12));
    }

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.symmetric(horizontal: 34, vertical: 24),
        footer: (context) {
          if (context.pageNumber != context.pagesCount) {
            return pw.SizedBox();
          }

          return pw.Column(
            children: [
              pw.Divider(color: PdfColors.grey300),
              pw.SizedBox(height: 4),
              pw.Center(
                child: pw.Text(
                  'Documento gerado pelo Store&Connect',
                  style: pw.TextStyle(
                    font: font,
                    fontSize: 7.5,
                    color: neutralGrey,
                  ),
                ),
              ),
            ],
          );
        },
        build: (context) {
          return [
            // ====================================================
            // CABECALHO
            // ====================================================
            pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              crossAxisAlignment: pw.CrossAxisAlignment.center,
              children: [
                pw.Row(
                  children: [
                    if (logoImage != null) ...[
                      pw.Image(logoImage, width: 38, height: 38),
                      pw.SizedBox(width: 14),
                    ],
                    pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text(
                          storeName,
                          style: pw.TextStyle(
                            font: boldFont,
                            fontSize: 18,
                            color: primaryColor,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.end,
                  children: [
                    pw.Text(
                      'RESUMO DE PAGAMENTO',
                      style: pw.TextStyle(font: boldFont, fontSize: 14),
                    ),
                    pw.SizedBox(height: 2),
                    pw.Text(
                      'Emissão em: '
                      '${dateTime(generatedAt)}',
                      style: pw.TextStyle(
                        font: font,
                        fontSize: 7.5,
                        color: neutralGrey,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            pw.SizedBox(height: 10),

            pw.Divider(color: PdfColors.grey300),

            pw.SizedBox(height: 10),

            // ====================================================
            // TOTAL EM ABERTO - COMPACTO
            // ====================================================
            pw.Container(
              width: double.infinity,
              padding: const pw.EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 9,
              ),
              decoration: pw.BoxDecoration(
                color: PdfColors.red50,
                borderRadius: pw.BorderRadius.circular(7),
              ),
              child: pw.Row(
                children: [
                  pw.Expanded(
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Text(
                          'Total em Aberto',
                          style: pw.TextStyle(
                            font: font,
                            fontSize: 9,
                            color: neutralGrey,
                          ),
                        ),
                        pw.SizedBox(height: 1),
                        pw.Text(
                          money(totalOpen),
                          style: pw.TextStyle(
                            font: boldFont,
                            fontSize: 20,
                            color: PdfColors.red700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  pw.Text(
                    '${purchases.length} '
                    '${purchases.length == 1 ? 'compra' : 'compras'} '
                    'com saldo em aberto',
                    style: pw.TextStyle(
                      font: font,
                      fontSize: 8,
                      color: neutralGrey,
                    ),
                  ),
                ],
              ),
            ),

            pw.SizedBox(height: 12),

            if (purchaseWidgets.isEmpty)
              pw.Text(
                'Nenhuma parcela em aberto.',
                style: pw.TextStyle(
                  font: font,
                  fontSize: 10,
                  color: neutralGrey,
                ),
              )
            else
              ...purchaseWidgets,

            // ====================================================
            // PIX DA LOJA
            // ====================================================
            pw.SizedBox(height: 2),

            if (pixQrImage != null)
              pw.Container(
                width: double.infinity,
                padding: const pw.EdgeInsets.all(7),
                decoration: pw.BoxDecoration(
                  color: PdfColors.blue50,
                  borderRadius: pw.BorderRadius.circular(7),
                ),
                child: pw.Row(
                  crossAxisAlignment: pw.CrossAxisAlignment.center,
                  children: [
                    pw.Expanded(
                      child: pw.Column(
                        crossAxisAlignment: pw.CrossAxisAlignment.start,
                        children: [
                          pw.Text(
                            'Pague via PIX',
                            style: pw.TextStyle(
                              font: boldFont,
                              fontSize: 11,
                              color: primaryColor,
                            ),
                          ),
                          pw.SizedBox(height: 5),
                          pw.Text(
                            'Escaneie o QR Code e faça seu pagamento '
                            'de forma rápida e prática.',
                            style: pw.TextStyle(
                              font: font,
                              fontSize: 7.5,
                              color: neutralGrey,
                            ),
                          ),
                          pw.SizedBox(height: 5),
                          pw.Text(
                            'QR Code PIX da loja.',
                            style: pw.TextStyle(font: boldFont, fontSize: 8),
                          ),
                        ],
                      ),
                    ),
                    pw.SizedBox(width: 9),
                    pw.Container(
                      width: 82,
                      height: 82,
                      padding: const pw.EdgeInsets.all(3),
                      decoration: pw.BoxDecoration(
                        color: PdfColors.white,
                        border: pw.Border.all(color: PdfColors.grey300),
                        borderRadius: pw.BorderRadius.circular(5),
                      ),
                      child: pw.Image(pixQrImage, fit: pw.BoxFit.contain),
                    ),
                  ],
                ),
              )
            else
              pw.Container(
                width: double.infinity,
                padding: const pw.EdgeInsets.all(10),
                decoration: pw.BoxDecoration(
                  color: PdfColors.grey100,
                  borderRadius: pw.BorderRadius.circular(6),
                ),
                child: pw.Text(
                  'PIX: QR Code não disponível para esta loja.',
                  style: pw.TextStyle(
                    font: font,
                    fontSize: 8,
                    color: neutralGrey,
                  ),
                ),
              ),
          ];
        },
      ),
    );

    final pdfBytes = await pdf.save();

    // ================================================================
    // WEB
    // ================================================================

    if (kIsWeb) {
      final sanitizedCustomerNameWeb = customerName
          .replaceAll(RegExp(r'[^\w\s]+'), '')
          .replaceAll(' ', '_');

      await Printing.sharePdf(
        bytes: pdfBytes,
        filename:
            'resumo_pagamento_$sanitizedCustomerNameWeb.pdf',
      );

      return;
    }

    final output = await getTemporaryDirectory();

    final sanitizedCustomerName = customerName
        .replaceAll(RegExp(r'[^\w\s]+'), '')
        .replaceAll(' ', '_');

    final file = File(
      '${output.path}/'
      'resumo_pagamento_'
      '$sanitizedCustomerName.pdf',
    );

    await file.writeAsBytes(pdfBytes);

    if (!context.mounted) {
      return;
    }

    final box = context.findRenderObject() as RenderBox?;

    await Share.shareXFiles(
      [XFile(file.path, mimeType: 'application/pdf')],
      subject: 'Resumo de pagamento - $customerName',
      text:
          'Resumo de pagamento - '
          '${money(totalOpen)} em aberto',
      sharePositionOrigin: box != null
          ? box.localToGlobal(Offset.zero) & box.size
          : null,
    );
  }

  Future<Uint8List> _generateThermalPdfBytes(
    SaleOrder order, {
    String storeName = 'Store Connect',
  }) async {
    final pdf = pw.Document();
    final font = await PdfGoogleFonts.robotoRegular();
    final boldFont = await PdfGoogleFonts.robotoBold();
    final emojiFont =
        await PdfGoogleFonts.notoColorEmoji(); // Emojis garantidos!

    pdf.addPage(
      pw.Page(
        // roll57 = Bobina de 80mm com altura contínua
        pageFormat: PdfPageFormat.roll80,
        // Margens bem pequenas para aproveitar o papel estreito
        margin: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 15),
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // 1. Cabeçalho Centralizado
              pw.Center(
                child: pw.Text(
                  storeName,
                  style: pw.TextStyle(
                    font: boldFont,
                    fontSize: 14,
                    fontFallback: [emojiFont],
                  ),
                  textAlign: pw.TextAlign.center,
                ),
              ),
              pw.SizedBox(height: 2),
              pw.Center(
                child: pw.Text(
                  'RECIBO DE VENDA',
                  style: pw.TextStyle(font: boldFont, fontSize: 10),
                ),
              ),
              pw.SizedBox(height: 3),
              pw.Center(
                child: pw.Text(
                  'NÃO É DOCUMENTO FISCAL',
                  style: pw.TextStyle(
                    font: boldFont,
                    fontSize: 9,
                  ),
                ),
              ),
              pw.SizedBox(height: 4),
              pw.Divider(
                borderStyle: pw.BorderStyle.dashed,
                thickness: 1,
              ), // Linha tracejada clássica de cupom
              // 2. Dados da Venda (Fontes pequenas)
              pw.Text(
                'Data: ${DateFormat('dd/MM/yyyy HH:mm').format(order.createdAt)}',
                style: pw.TextStyle(font: font, fontSize: 8),
              ),
              pw.Text(
                'ID: ${order.id}',
                style: pw.TextStyle(font: font, fontSize: 8),
              ),
              if (order.customerName != null && order.customerName!.isNotEmpty)
                pw.Text(
                  'Cliente: ${order.customerName}',
                  style: pw.TextStyle(
                    font: font,
                    fontSize: 8,
                    fontFallback: [emojiFont],
                  ),
                ),

              pw.SizedBox(height: 4),
              pw.Divider(borderStyle: pw.BorderStyle.dashed, thickness: 1),

              // 3. Lista de Produtos Simplificada (Qtd x Nome -> Valor)
              pw.SizedBox(height: 2),
              pw.Text(
                'QTD  PRODUTO                     SUBTOTAL',
                style: pw.TextStyle(font: boldFont, fontSize: 7),
              ),
              pw.SizedBox(height: 4),
              ...order.products.map((prod) {
                return pw.Padding(
                  padding: const pw.EdgeInsets.only(bottom: 4),
                  child: pw.Row(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      // Quantidade e Nome do Produto
                      pw.Expanded(
                        child: pw.Text(
                          '${prod.quantity}x ${prod.receiptDescription}',
                          style: pw.TextStyle(
                            font: font,
                            fontSize: 8,
                            fontFallback: [emojiFont],
                          ),
                        ),
                      ),
                      // Subtotal alinhado à direita
                      pw.Text(
                        'R\$ ${(prod.price * prod.quantity).toStringAsFixed(2)}',
                        style: pw.TextStyle(font: font, fontSize: 8),
                      ),
                    ],
                  ),
                );
              }).toList(),

              pw.SizedBox(height: 2),
              pw.Divider(borderStyle: pw.BorderStyle.dashed, thickness: 1),
              pw.SizedBox(height: 2),

              // 4. Totalizador
              pw.Row(
                mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                children: [
                  pw.Text(
                    'TOTAL:',
                    style: pw.TextStyle(font: boldFont, fontSize: 12),
                  ),
                  pw.Text(
                    'R\$ ${order.totalAmount.toStringAsFixed(2)}',
                    style: pw.TextStyle(font: boldFont, fontSize: 12),
                  ),
                ],
              ),

              if (order.installments.isNotEmpty) ...[
                pw.SizedBox(height: 6),

                pw.Divider(borderStyle: pw.BorderStyle.dashed, thickness: 1),

                pw.SizedBox(height: 4),

                pw.Text(
                  'PAGAMENTO: ${order.paymentDescription}',
                  style: pw.TextStyle(font: boldFont, fontSize: 8),
                ),

                pw.Text(
                  'PARCELAS: ${order.installmentCount}x',
                  style: pw.TextStyle(font: boldFont, fontSize: 8),
                ),

                pw.SizedBox(height: 4),

                ...order.installments.map((installment) {
                  String status;

                  if (installment.isPaid) {
                    status = 'Paga';
                  } else if (installment.paidAmount > 0) {
                    status = 'Parcial';
                  } else if (installment.dueDate.isBefore(
                    DateTime(
                      DateTime.now().year,
                      DateTime.now().month,
                      DateTime.now().day,
                    ),
                  )) {
                    status = 'Vencida';
                  } else {
                    status = 'Pendente';
                  }

                  final remaining = installment.amount - installment.paidAmount;

                  return pw.Padding(
                    padding: const pw.EdgeInsets.only(bottom: 4),
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Row(
                          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                          children: [
                            pw.Text(
                              '${installment.number}/${order.installmentCount} '
                              '${DateFormat('dd/MM').format(installment.dueDate)}',
                              style: pw.TextStyle(font: font, fontSize: 8),
                            ),
                            pw.Text(
                              'R\$ ${installment.amount.toStringAsFixed(2)}',
                              style: pw.TextStyle(font: boldFont, fontSize: 8),
                            ),
                          ],
                        ),

                        pw.Text(
                          status,
                          style: pw.TextStyle(font: boldFont, fontSize: 7),
                        ),

                        if (installment.paidAmount > 0 && !installment.isPaid)
                          pw.Text(
                            'Pago: R\$ ${installment.paidAmount.toStringAsFixed(2)} '
                            'Saldo: R\$ ${remaining.toStringAsFixed(2)}',
                            style: pw.TextStyle(font: font, fontSize: 7),
                          ),
                      ],
                    ),
                  );
                }),

                pw.Divider(borderStyle: pw.BorderStyle.dashed, thickness: 1),

                pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Text(
                      'RECEBIDO:',
                      style: pw.TextStyle(font: boldFont, fontSize: 8),
                    ),
                    pw.Text(
                      'R\$ ${order.totalPaidAmount.toStringAsFixed(2)}',
                      style: pw.TextStyle(font: boldFont, fontSize: 8),
                    ),
                  ],
                ),

                pw.Row(
                  mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Text(
                      'EM ABERTO:',
                      style: pw.TextStyle(font: boldFont, fontSize: 8),
                    ),
                    pw.Text(
                      'R\$ ${(order.totalAmount - order.totalPaidAmount).toStringAsFixed(2)}',
                      style: pw.TextStyle(font: boldFont, fontSize: 8),
                    ),
                  ],
                ),
              ],

              pw.SizedBox(height: 10),

              // 5. Observações (se houver)
              if (order.notes.isNotEmpty) ...[
                pw.Text(
                  'Obs:',
                  style: pw.TextStyle(font: boldFont, fontSize: 8),
                ),
                pw.Text(
                  order.notes,
                  style: pw.TextStyle(
                    font: font,
                    fontSize: 8,
                    fontFallback: [emojiFont],
                  ),
                ),
                pw.SizedBox(height: 10),
              ],

              // 6. Rodapé Centralizado
              pw.Center(
                child: pw.Text(
                  'Obrigado pela preferencia!',
                  style: pw.TextStyle(font: boldFont, fontSize: 8),
                ),
              ),
              pw.SizedBox(height: 2),
              pw.Center(
                child: pw.Text(
                  'Tecnologia por Store Connect',
                  style: pw.TextStyle(
                    font: font,
                    fontSize: 6,
                    color: PdfColors.grey700,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
    return pdf.save();
  }
}
