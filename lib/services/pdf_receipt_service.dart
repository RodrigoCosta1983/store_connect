// lib/services/pdf_receipt_service.dart

import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
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
  Future<Uint8List> _generatePdfBytes(SaleOrder order, {String storeName = 'Store Connect'}) async {
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
                        pw.Image(logoImage, width: 50, height: 50), // Ajuste o tamanho conforme sua logo
                        pw.SizedBox(width: 10),
                      ],
                      pw.Column(
                        crossAxisAlignment: pw.CrossAxisAlignment.start,
                        children: [
                          pw.Text(storeName, style: pw.TextStyle(font: boldFont, fontSize: 24, color: primaryColor, fontFallback: [emojiFont])),
                          pw.Text('Recibo gerado via app', style: pw.TextStyle(font: font, fontSize: 10, color: neutralGrey)),
                        ],
                      ),
                    ],
                  ),
                  // Coluna da direita: Título
                  pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.end,
                    children: [
                      pw.Text('RECIBO DE VENDA', style: pw.TextStyle(font: boldFont, fontSize: 18)),
                      pw.SizedBox(height: 4),
                      pw.Text('ID: ${order.id}', style: pw.TextStyle(font: font, fontSize: 10, color: neutralGrey)),
                      pw.SizedBox(height: 2),
                      pw.Text(DateFormat('dd/MM/yyyy').format(order.createdAt), style: pw.TextStyle(font: font, fontSize: 12)),
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
                      if (order.customerName != null && order.customerName!.isNotEmpty)
                        pw.RichText(
                          text: pw.TextSpan(
                            children: [
                              pw.TextSpan(text: 'Cliente: ', style: pw.TextStyle(font: boldFont)),
                              pw.TextSpan(text: order.customerName!, style: pw.TextStyle(font: font, fontFallback: [emojiFont], color: neutralGrey)),
                            ],
                          ),
                        ),
                      pw.SizedBox(height: 4),
                      pw.RichText(
                        text: pw.TextSpan(
                          children: [
                            pw.TextSpan(text: 'Data: ', style: pw.TextStyle(font: boldFont)),
                            pw.TextSpan(text: DateFormat('dd/MM/yyyy HH:mm').format(order.createdAt), style: pw.TextStyle(font: font)),
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
                data: order.products.map((prod) => [
                  prod.name,
                  prod.quantity.toString(),
                  'R\$ ${prod.price.toStringAsFixed(2)}',
                  'R\$ ${(prod.price * prod.quantity).toStringAsFixed(2)}',
                ]).toList(),
                border: null, // Remove as bordas padrão da tabela para um visual mais limpo
                headerStyle: pw.TextStyle(font: boldFont, color: PdfColors.white,
                  fontSize: 11,
                ),
                headerDecoration: const pw.BoxDecoration(color: primaryColor),
                cellStyle: pw.TextStyle(font: font, fontFallback: [emojiFont], color: neutralGrey,fontSize: 10,
                ),
                cellHeight: 34,
                cellAlignments: {
                  0: pw.Alignment.centerLeft,
                  1: pw.Alignment.center, // Quantidade centralizada
                  2: pw.Alignment.centerLeft, // Valores financeiros alinhados à direita
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
                              text: order.paymentMethod,
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
                            DateFormat('dd/MM/yyyy').format(
                              installment.dueDate,
                            ),
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
                    borderRadius: const pw.BorderRadius.all(pw.Radius.circular(4)),
                  ),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text('Observações:', style: pw.TextStyle(font: boldFont, fontSize: 12)),
                      pw.SizedBox(height: 4),
                      pw.Text(order.notes, style: pw.TextStyle(font: font, fontSize: 12, fontFallback: [emojiFont], color: neutralGrey)),
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
                    pw.Text('Total: ', style: pw.TextStyle(font: boldFont, fontSize: 18)),
                    pw.Text(
                      'R\$ ${order.totalAmount.toStringAsFixed(2)}',
                      style: pw.TextStyle(font: boldFont, fontSize: 18, color: primaryColor),
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
                    pw.Text('Obrigado pela preferência!', style: pw.TextStyle(font: boldFont, fontSize: 12)),
                    pw.Text('Tecnologia por Store Connect', style: pw.TextStyle(font: font, fontSize: 10, color: neutralGrey)),
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
        final storeDoc = await FirebaseFirestore.instance.collection('stores').doc(order.storeId).get();
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
        final storeDoc = await FirebaseFirestore.instance.collection('stores').doc(order.storeId).get();
        if (storeDoc.exists) {
          storeName = storeDoc.data()?['name'] ?? 'StoreConnect';
        }
      }
    } catch (e) {
      print('Erro ao buscar nome da loja: $e');
    }

    final sanitizedStoreName = storeName.replaceAll(RegExp(r'[^\w\s]+'), '').replaceAll(' ', '_');
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
    required DateTime dueDate,
    required List<Map<String, dynamic>> installments,
    required double totalDue,
    required double totalOpen,
  }) async {
    String storeName = 'Store Connect';

    try {
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .get();

      if (storeDoc.exists) {
        storeName =
            storeDoc.data()?['name']?.toString() ?? 'Store Connect';
      }
    } catch (e) {
      print('Erro ao buscar nome da loja: $e');
    }

    final pdf = pw.Document();

    final font = await PdfGoogleFonts.robotoRegular();
    final boldFont = await PdfGoogleFonts.robotoBold();

    pw.MemoryImage? logoImage;

    try {
      final ByteData bytes =
      await rootBundle.load('assets/images/logo.png');

      logoImage =
          pw.MemoryImage(bytes.buffer.asUint8List());
    } catch (e) {
      print('Erro ao carregar logo: $e');
    }

    const primaryColor = PdfColors.blue600;
    const neutralGrey = PdfColors.grey700;

    String money(double value) {
      return NumberFormat.currency(
        locale: 'pt_BR',
        symbol: 'R\$',
      ).format(value);
    }

    String date(DateTime value) {
      return DateFormat('dd/MM/yyyy').format(value);
    }

    String productsDescription(List<dynamic> products) {
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
            names.add(name.trim());
          }
        }
      }

      if (names.isEmpty) {
        return 'Venda a prazo';
      }

      return names.join(', ');
    }

    pdf.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(36),

        build: (context) {
          return [

            // ============================================================
            // CABEÇALHO
            // ============================================================

            pw.Row(
              mainAxisAlignment:
              pw.MainAxisAlignment.spaceBetween,
              crossAxisAlignment:
              pw.CrossAxisAlignment.center,
              children: [

                pw.Row(
                  children: [

                    if (logoImage != null) ...[
                      pw.Image(
                        logoImage,
                        width: 45,
                        height: 45,
                      ),
                      pw.SizedBox(width: 10),
                    ],

                    pw.Column(
                      crossAxisAlignment:
                      pw.CrossAxisAlignment.start,
                      children: [

                        pw.Text(
                          storeName,
                          style: pw.TextStyle(
                            font: boldFont,
                            fontSize: 22,
                            color: primaryColor,
                          ),
                        ),

                        pw.Text(
                          'Store Connect',
                          style: pw.TextStyle(
                            font: font,
                            fontSize: 9,
                            color: neutralGrey,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),

                pw.Text(
                  'RESUMO DE PAGAMENTO',
                  style: pw.TextStyle(
                    font: boldFont,
                    fontSize: 16,
                  ),
                ),
              ],
            ),

            pw.SizedBox(height: 15),

            pw.Divider(
              color: PdfColors.grey300,
            ),

            pw.SizedBox(height: 15),

            // ============================================================
            // CLIENTE
            // ============================================================

            pw.Container(
              width: double.infinity,
              padding: const pw.EdgeInsets.all(14),
              decoration: pw.BoxDecoration(
                color: PdfColors.grey100,
                borderRadius:
                pw.BorderRadius.circular(6),
              ),
              child: pw.Column(
                crossAxisAlignment:
                pw.CrossAxisAlignment.start,
                children: [

                  pw.Text(
                    'Cliente',
                    style: pw.TextStyle(
                      font: font,
                      fontSize: 9,
                      color: neutralGrey,
                    ),
                  ),

                  pw.Text(
                    customerName,
                    style: pw.TextStyle(
                      font: boldFont,
                      fontSize: 16,
                    ),
                  ),

                  pw.SizedBox(height: 8),

                  pw.Text(
                    'Vencimento: ${date(dueDate)}',
                    style: pw.TextStyle(
                      font: boldFont,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),

            pw.SizedBox(height: 20),

            pw.Text(
              'Parcelas deste vencimento',
              style: pw.TextStyle(
                font: boldFont,
                fontSize: 15,
                color: primaryColor,
              ),
            ),

            pw.SizedBox(height: 10),

            // ============================================================
            // PARCELAS
            // ============================================================

            ...installments.map((item) {

              final saleDate =
              item['saleCreatedAt'] as DateTime?;

              final installmentNumber =
              item['installmentNumber'];

              final installmentCount =
              item['installmentCount'];

              final amount =
              (item['amount'] as num)
                  .toDouble();

              final paid =
              (item['paidAmount'] as num)
                  .toDouble();

              final remaining =
              (item['remainingAmount'] as num)
                  .toDouble();

              final products =
                  item['products']
                  as List<dynamic>? ??
                      [];

              return pw.Container(
                margin:
                const pw.EdgeInsets.only(
                  bottom: 10,
                ),
                padding:
                const pw.EdgeInsets.all(12),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(
                    color: PdfColors.grey300,
                  ),
                  borderRadius:
                  pw.BorderRadius.circular(5),
                ),
                child: pw.Column(
                  crossAxisAlignment:
                  pw.CrossAxisAlignment.start,
                  children: [

                    pw.Row(
                      mainAxisAlignment:
                      pw.MainAxisAlignment
                          .spaceBetween,
                      children: [

                        pw.Text(
                          'Parcela $installmentNumber/$installmentCount',
                          style: pw.TextStyle(
                            font: boldFont,
                            fontSize: 12,
                          ),
                        ),

                        pw.Text(
                          money(remaining),
                          style: pw.TextStyle(
                            font: boldFont,
                            fontSize: 12,
                            color: primaryColor,
                          ),
                        ),
                      ],
                    ),

                    if (saleDate != null) ...[
                      pw.SizedBox(height: 5),

                      pw.Text(
                        'Compra realizada em ${date(saleDate)}',
                        style: pw.TextStyle(
                          font: font,
                          fontSize: 9,
                          color: neutralGrey,
                        ),
                      ),
                    ],

                    pw.SizedBox(height: 4),

                    pw.Text(
                      productsDescription(products),
                      style: pw.TextStyle(
                        font: font,
                        fontSize: 10,
                      ),
                    ),

                    if (paid > 0) ...[
                      pw.SizedBox(height: 5),

                      pw.Text(
                        'Valor original: ${money(amount)}  |  '
                            'Já pago: ${money(paid)}',
                        style: pw.TextStyle(
                          font: font,
                          fontSize: 9,
                          color: neutralGrey,
                        ),
                      ),
                    ],
                  ],
                ),
              );
            }),

            pw.SizedBox(height: 15),

            // ============================================================
            // TOTAL DO VENCIMENTO
            // ============================================================

            pw.Container(
              width: double.infinity,
              padding:
              const pw.EdgeInsets.all(16),
              decoration: pw.BoxDecoration(
                color: PdfColors.blue50,
                borderRadius:
                pw.BorderRadius.circular(6),
              ),
              child: pw.Row(
                mainAxisAlignment:
                pw.MainAxisAlignment
                    .spaceBetween,
                children: [

                  pw.Text(
                    'TOTAL A PAGAR EM ${date(dueDate)}',
                    style: pw.TextStyle(
                      font: boldFont,
                      fontSize: 13,
                    ),
                  ),

                  pw.Text(
                    money(totalDue),
                    style: pw.TextStyle(
                      font: boldFont,
                      fontSize: 18,
                      color: primaryColor,
                    ),
                  ),
                ],
              ),
            ),

            pw.SizedBox(height: 12),

            pw.Row(
              mainAxisAlignment:
              pw.MainAxisAlignment.end,
              children: [

                pw.Text(
                  'Saldo total em aberto: ',
                  style: pw.TextStyle(
                    font: font,
                    fontSize: 10,
                    color: neutralGrey,
                  ),
                ),

                pw.Text(
                  money(totalOpen),
                  style: pw.TextStyle(
                    font: boldFont,
                    fontSize: 11,
                  ),
                ),
              ],
            ),

            pw.SizedBox(height: 35),

            pw.Divider(
              color: PdfColors.grey300,
            ),

            pw.Center(
              child: pw.Text(
                'Documento gerado pelo Store Connect',
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

    // ================================================================
    // SALVA TEMPORARIAMENTE
    // ================================================================

    final pdfBytes =
    await pdf.save();

    final output =
    await getTemporaryDirectory();

    final sanitizedCustomerName =
    customerName
        .replaceAll(
      RegExp(r'[^\w\s]+'),
      '',
    )
        .replaceAll(' ', '_');

    final file = File(
      '${output.path}/resumo_pagamento_$sanitizedCustomerName.pdf',
    );

    await file.writeAsBytes(
      pdfBytes,
    );

    if (!context.mounted) return;

    final box =
    context.findRenderObject()
    as RenderBox?;

    // ================================================================
    // COMPARTILHAMENTO
    // ================================================================

    await Share.shareXFiles(
      [
        XFile(
          file.path,
          mimeType:
          'application/pdf',
        ),
      ],
      subject:
      'Resumo de pagamento - $customerName',
      text:
      'Resumo de pagamento com vencimento em ${date(dueDate)} - ${money(totalDue)}',
      sharePositionOrigin:
      box != null
          ? box.localToGlobal(
        Offset.zero,
      ) &
      box.size
          : null,
    );
  }

  //recibo para mini impressoras térmicas

  Future<Uint8List> _generateThermalPdfBytes(SaleOrder order, {String storeName = 'Store Connect'}) async {
    final pdf = pw.Document();
    final font = await PdfGoogleFonts.robotoRegular();
    final boldFont = await PdfGoogleFonts.robotoBold();
    final emojiFont = await PdfGoogleFonts.notoColorEmoji(); // Emojis garantidos!

    pdf.addPage(
      pw.Page(
        // roll57 = Bobina de 58mm com altura contínua
        pageFormat: PdfPageFormat.roll57,
        // Margens bem pequenas para aproveitar o papel estreito
        margin: const pw.EdgeInsets.symmetric(horizontal: 10, vertical: 15),
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // 1. Cabeçalho Centralizado
              pw.Center(
                child: pw.Text(storeName, style: pw.TextStyle(font: boldFont, fontSize: 14, fontFallback: [emojiFont]), textAlign: pw.TextAlign.center),
              ),
              pw.SizedBox(height: 2),
              pw.Center(
                child: pw.Text('RECIBO DE VENDA', style: pw.TextStyle(font: boldFont, fontSize: 10)),
              ),
              pw.SizedBox(height: 4),
              pw.Divider(borderStyle: pw.BorderStyle.dashed, thickness: 1), // Linha tracejada clássica de cupom

              // 2. Dados da Venda (Fontes pequenas)
              pw.Text('Data: ${DateFormat('dd/MM/yyyy HH:mm').format(order.createdAt)}', style: pw.TextStyle(font: font, fontSize: 8)),
              pw.Text('ID: ${order.id}', style: pw.TextStyle(font: font, fontSize: 8)),
              if (order.customerName != null && order.customerName!.isNotEmpty)
                pw.Text('Cliente: ${order.customerName}', style: pw.TextStyle(font: font, fontSize: 8, fontFallback: [emojiFont])),

              pw.SizedBox(height: 4),
              pw.Divider(borderStyle: pw.BorderStyle.dashed, thickness: 1),

              // 3. Lista de Produtos Simplificada (Qtd x Nome -> Valor)
              pw.SizedBox(height: 2),
              pw.Text('QTD  PRODUTO                     SUBTOTAL', style: pw.TextStyle(font: boldFont, fontSize: 7)),
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
                          '${prod.quantity}x ${prod.name}',
                          style: pw.TextStyle(font: font, fontSize: 8, fontFallback: [emojiFont]),
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
                  pw.Text('TOTAL:', style: pw.TextStyle(font: boldFont, fontSize: 12)),
                  pw.Text('R\$ ${order.totalAmount.toStringAsFixed(2)}', style: pw.TextStyle(font: boldFont, fontSize: 12)),
                ],
              ),

              if (order.installments.isNotEmpty) ...[
                pw.SizedBox(height: 6),

                pw.Divider(
                  borderStyle: pw.BorderStyle.dashed,
                  thickness: 1,
                ),

                pw.SizedBox(height: 4),

                pw.Text(
                  'PAGAMENTO: ${order.paymentMethod}',
                  style: pw.TextStyle(
                    font: boldFont,
                    fontSize: 8,
                  ),
                ),

                pw.Text(
                  'PARCELAS: ${order.installmentCount}x',
                  style: pw.TextStyle(
                    font: boldFont,
                    fontSize: 8,
                  ),
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

                  final remaining =
                      installment.amount - installment.paidAmount;

                  return pw.Padding(
                    padding: const pw.EdgeInsets.only(bottom: 4),
                    child: pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: [
                        pw.Row(
                          mainAxisAlignment:
                          pw.MainAxisAlignment.spaceBetween,
                          children: [
                            pw.Text(
                              '${installment.number}/${order.installmentCount} '
                                  '${DateFormat('dd/MM').format(installment.dueDate)}',
                              style: pw.TextStyle(
                                font: font,
                                fontSize: 8,
                              ),
                            ),
                            pw.Text(
                              'R\$ ${installment.amount.toStringAsFixed(2)}',
                              style: pw.TextStyle(
                                font: boldFont,
                                fontSize: 8,
                              ),
                            ),
                          ],
                        ),

                        pw.Text(
                          status,
                          style: pw.TextStyle(
                            font: boldFont,
                            fontSize: 7,
                          ),
                        ),

                        if (installment.paidAmount > 0 &&
                            !installment.isPaid)
                          pw.Text(
                            'Pago: R\$ ${installment.paidAmount.toStringAsFixed(2)} '
                                'Saldo: R\$ ${remaining.toStringAsFixed(2)}',
                            style: pw.TextStyle(
                              font: font,
                              fontSize: 7,
                            ),
                          ),
                      ],
                    ),
                  );
                }),

                pw.Divider(
                  borderStyle: pw.BorderStyle.dashed,
                  thickness: 1,
                ),

                pw.Row(
                  mainAxisAlignment:
                  pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Text(
                      'RECEBIDO:',
                      style: pw.TextStyle(
                        font: boldFont,
                        fontSize: 8,
                      ),
                    ),
                    pw.Text(
                      'R\$ ${order.totalPaidAmount.toStringAsFixed(2)}',
                      style: pw.TextStyle(
                        font: boldFont,
                        fontSize: 8,
                      ),
                    ),
                  ],
                ),

                pw.Row(
                  mainAxisAlignment:
                  pw.MainAxisAlignment.spaceBetween,
                  children: [
                    pw.Text(
                      'EM ABERTO:',
                      style: pw.TextStyle(
                        font: boldFont,
                        fontSize: 8,
                      ),
                    ),
                    pw.Text(
                      'R\$ ${(order.totalAmount - order.totalPaidAmount).toStringAsFixed(2)}',
                      style: pw.TextStyle(
                        font: boldFont,
                        fontSize: 8,
                      ),
                    ),
                  ],
                ),
              ],

              pw.SizedBox(height: 10),

              // 5. Observações (se houver)
              if (order.notes.isNotEmpty) ...[
                pw.Text('Obs:', style: pw.TextStyle(font: boldFont, fontSize: 8)),
                pw.Text(order.notes, style: pw.TextStyle(font: font, fontSize: 8, fontFallback: [emojiFont])),
                pw.SizedBox(height: 10),
              ],

              // 6. Rodapé Centralizado
              pw.Center(
                child: pw.Text('Obrigado pela preferencia!', style: pw.TextStyle(font: boldFont, fontSize: 8)),
              ),
              pw.SizedBox(height: 2),
              pw.Center(
                child: pw.Text('Tecnologia por Store Connect', style: pw.TextStyle(font: font, fontSize: 6, color: PdfColors.grey700)),
              ),
            ],
          );
        },
      ),
    );
    return pdf.save();
  }

}