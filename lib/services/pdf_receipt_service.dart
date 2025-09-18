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

  // Esta é a função que estava com o erro
  Future<Uint8List> _generatePdfBytes(SaleOrder order) async {
    final pdf = pw.Document();
    final font = await PdfGoogleFonts.robotoRegular();
    final boldFont = await PdfGoogleFonts.robotoBold();

    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Text('Recibo de Venda', style: pw.TextStyle(font: boldFont, fontSize: 24)),
              pw.Divider(thickness: 2),
              pw.SizedBox(height: 20),
              pw.Row(
                children: [
                  pw.Text('Data:', style: pw.TextStyle(font: boldFont)),
                  pw.SizedBox(width: 8),
                  pw.Text(DateFormat('dd/MM/yyyy HH:mm').format(order.createdAt), style: pw.TextStyle(font: font)),
                ],
              ),
              if (order.customerName != null && order.customerName!.isNotEmpty)
                pw.Padding(
                  padding: const pw.EdgeInsets.only(top: 8),
                  child: pw.Row(
                    children: [
                      pw.Text('Cliente:', style: pw.TextStyle(font: boldFont)),
                      pw.SizedBox(width: 8),
                      pw.Text(order.customerName!, style: pw.TextStyle(font: font)),
                    ],
                  ),
                ),
              pw.SizedBox(height: 30),
              pw.TableHelper.fromTextArray(
                headerStyle: pw.TextStyle(font: boldFont),
                cellStyle: pw.TextStyle(font: font),
                headers: ['Produto', 'Qtd.', 'Preço Un.', 'Subtotal'],
                data: order.products.map((prod) => [
                  prod.name,
                  prod.quantity.toString(),
                  'R\$ ${prod.price.toStringAsFixed(2)}',
                  'R\$ ${(prod.price * prod.quantity).toStringAsFixed(2)}',
                ]).toList(),
              ),
              pw.SizedBox(height: 20),
              if (order.notes.isNotEmpty)
                pw.Container(
                  padding: const pw.EdgeInsets.all(10),
                  decoration: pw.BoxDecoration(border: pw.Border.all(color: PdfColors.grey)),
                  child: pw.Column(
                    crossAxisAlignment: pw.CrossAxisAlignment.start,
                    children: [
                      pw.Text('Observações:', style: pw.TextStyle(font: boldFont)),
                      pw.SizedBox(height: 5),
                      pw.Text(order.notes, style: pw.TextStyle(font: font)),
                    ],
                  ),
                ),
              pw.Spacer(),
              pw.Align(
                alignment: pw.Alignment.centerRight,
                child: pw.Text(
                  'Total: R\$ ${order.totalAmount.toStringAsFixed(2)}',
                  style: pw.TextStyle(font: boldFont, fontSize: 20),
                ),
              ),
            ],
          );
        },
      ),
    );
    // --- LINHA CORRIGIDA ---
    // A função agora retorna os bytes do PDF gerado.
    return pdf.save();
  }

  Future<void> viewAndSavePdf(SaleOrder order) async {
    final pdfBytes = await _generatePdfBytes(order);
    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdfBytes,
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
    final pdfBytes = await _generatePdfBytes(order);
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
}