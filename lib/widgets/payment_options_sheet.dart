// ============================================================================
// STORE CONNECT - OPÇÕES DE PAGAMENTO / REGISTRO DE VENDA
// ============================================================================
//
// Arquivo:
//   lib/widgets/payment_options_sheet.dart
//
// Objetivo:
//   Exibir as formas de pagamento disponíveis no fechamento da venda e
//   registrar a venda paga no Firestore com o método escolhido.
//
// Responsabilidades principais:
//   - validar o status da assinatura antes de concluir a venda;
//   - baixar estoque manual ou por lotes em transação;
//   - registrar o recibo em stores/{storeId}/sales/{saleId};
//   - abrir o fluxo de PIX;
//   - abrir o fluxo de venda a prazo;
//   - distinguir cartão de crédito e cartão de débito.
//
// Motivo da separação de cartões:
//   O antigo valor "Cartão" era ambíguo para emissão fiscal. NFC-e diferencia
//   crédito e débito, portanto as vendas novas passam a gravar:
//
//     paymentMethod: "Cartão de crédito"
//     paymentMethod: "Cartão de débito"
//
// Compatibilidade:
//   Vendas antigas que já possuem paymentMethod == "Cartão" permanecem como
//   histórico legado e não são alteradas por este arquivo.
//
// Integração fiscal:
//   Após a venda instantânea ser confirmada no Firestore, o saleId criado é
//   enviado para a Cloud Function emitirNfce quando a loja estiver no plano
//   Business e com perfilFiscal.configurado == true.
//
//   Importante:
//   - a venda NÃO é desfeita se a emissão fiscal falhar;
//   - o backend fiscal registra o motivo no próprio documento da venda;
//   - a interface informa o usuário, mas preserva a venda comercial;
//   - a Cloud Function continua sendo responsável por validar owner, plano,
//     credencial Focus, produtos, tributos, certificado e demais requisitos.
//
// Cuidados:
//   - não alterar a lógica de estoque sem revisar o fluxo transacional;
//   - manter quantidade de produto como inteiro;
//   - não unificar crédito/débito novamente em um único valor;
//   - "Crédito / A Prazo" é venda fiada e NÃO é cartão de crédito.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/widgets/confirm_fiado_dialog.dart';

import '../screens/auth/auth_gate.dart';

class PaymentOptionsSheet extends StatefulWidget {
  final String storeId;
  final String notes;

  const PaymentOptionsSheet({
    super.key,
    required this.storeId,
    required this.notes,
  });

  @override
  State<PaymentOptionsSheet> createState() => _PaymentOptionsSheetState();
}

class _PaymentOptionsSheetState extends State<PaymentOptionsSheet> {
  var _isLoading = false;
  bool _fiadoIsEnabled = false;

  // ADICIONADO: guarda a URL do QR Code do PIX (se houver)
  String? _pixQrCodeUrl;
  bool _pixLoading = false;

  @override
  void initState() {
    super.initState();
    _loadFiadoPreference();
    _loadPixQrCodeUrl(); // carrega a url do PIX ao abrir o sheet
  }

  Future<void> _loadFiadoPreference() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() {
        _fiadoIsEnabled = prefs.getBool('fiado_enabled') ?? false;
      });
    }
  }

  // ADICIONADO: carrega do Firestore o campo pixQrCodeUrl do documento da loja
  Future<void> _loadPixQrCodeUrl() async {
    setState(() => _pixLoading = true);
    try {
      final doc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get();
      if (doc.exists) {
        final data = doc.data();
        final url = data?['pixQrCodeUrl'] as String?;
        if (mounted) {
          setState(() {
            _pixQrCodeUrl = url;
          });
        }
      }
    } catch (e) {
      debugPrint('Erro ao carregar pixQrCodeUrl: $e');
    } finally {
      if (mounted) setState(() => _pixLoading = false);
    }
  }

  bool _shouldRequestNfce(Map<String, dynamic> storeData) {
    final subscriptionType = (
        storeData['subscriptionType'] ??
            storeData['plan'] ??
            storeData['plano'] ??
            storeData['subscriptionPlan'] ??
            ''
    ).toString().trim().toLowerCase();

    final perfilFiscal = storeData['perfilFiscal'];

    if (perfilFiscal is! Map) {
      return false;
    }

    final fiscalData = Map<String, dynamic>.from(perfilFiscal);

    return subscriptionType == 'business' &&
        fiscalData['configurado'] == true;
  }

  String _friendlyFiscalError(Object error) {
    if (error is FirebaseFunctionsException) {
      final message = error.message?.trim();

      if (message != null && message.isNotEmpty) {
        return message;
      }
    }

    return 'A venda foi concluída, mas não foi possível validar/emissão da NFC-e.';
  }

  Future<void> _requestNfceForSale(String saleId) async {
    try {
      debugPrint(
        '🧾 NFC-e: solicitando emissão/validação para venda $saleId',
      );

      final callable = FirebaseFunctions.instance.httpsCallable(
        'emitirNfce',
      );

      final result = await callable.call<Map<String, dynamic>>({
        'storeId': widget.storeId,
        'vendaId': saleId,
      });

      final data = result.data;
      final status = data['status']?.toString() ?? 'processado';

      debugPrint(
        '✅ NFC-e: retorno recebido para venda $saleId | status=$status',
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Venda concluída. NFC-e: $status.',
          ),
          backgroundColor: Colors.green,
        ),
      );
    } on FirebaseFunctionsException catch (e) {
      final message = _friendlyFiscalError(e);

      debugPrint(
        '⚠️ NFC-e não concluída | '
            'code=${e.code} | message=${e.message} | details=${e.details}',
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Venda concluída. NFC-e pendente: $message',
          ),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 8),
        ),
      );
    } catch (e) {
      debugPrint(
        '❌ Erro inesperado ao solicitar NFC-e: $e',
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Venda concluída, mas ocorreu um erro ao iniciar a NFC-e.',
          ),
          backgroundColor: Colors.orange,
          duration: Duration(seconds: 8),
        ),
      );
    }
  }

  Future<void> _handleInstantSale(String paymentMethod) async {
    if (_isLoading) return;
    setState(() => _isLoading = true);

    final cart = Provider.of<CartProvider>(context, listen: false);

    try {
      // ------------------------------------------------------------------
      // 🚨 A TRAVA DE SEGURANÇA (O GUARDA DA VENDA) ATUALIZADA
      // Fazemos uma verificação direto no servidor, ignorando o cache offline
      // ------------------------------------------------------------------
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get(const GetOptions(source: Source.server));

      if (!storeDoc.exists) throw Exception("Loja não encontrada.");

      final storeData = storeDoc.data() as Map<String, dynamic>;
      final status = storeData['subscriptionStatus'] as String? ?? 'trial';
      final shouldRequestNfce = _shouldRequestNfce(storeData);
      String? saleId;

      // 🚪 Nova Regra: Permite 'active', 'trial' e 'overdue' (período de tolerância)
      if (status != 'active' && status != 'trial' && status != 'overdue') {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                "Venda bloqueada! Sua assinatura está inativa ou expirada.",
              ),
              backgroundColor: Colors.red,
              duration: Duration(seconds: 8),
            ),
          );
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (ctx) => const AuthGate()),
                (route) => false,
          );
        }
        return; // ⛔ Interrompe a função AQUI.
      }

      final firestore = FirebaseFirestore.instance;
      final saleDocRef = firestore
          .collection('stores')
          .doc(widget.storeId)
          .collection('sales')
          .doc();

      saleId = saleDocRef.id;

      await firestore.runTransaction((transaction) async {

        // =================================================================
        // FASE 1: APENAS LEITURAS (READS)
        // =================================================================
        Map<String, DocumentSnapshot> productSnapshots = {};

        for (final cartItem in cart.items.values) {
          final productRef = firestore
              .collection('stores')
              .doc(widget.storeId)
              .collection('products')
              .doc(cartItem.productId);

          final productSnapshot = await transaction.get(productRef);
          if (!productSnapshot.exists) {
            throw Exception("Produto ${cartItem.name} não encontrado.");
          }
          productSnapshots[cartItem.productId] = productSnapshot;
        }

        // =================================================================
        // FASE 2: APENAS ESCRITAS (WRITES / UPDATES)
        // =================================================================
        for (final cartItem in cart.items.values) {
          final productSnapshot = productSnapshots[cartItem.productId]!;
          final data = productSnapshot.data() as Map<String, dynamic>;
          final productRef = productSnapshot.reference;

          // VERIFICAÇÃO 1: Produto SEM lotes (Apenas Estoque Manual)
          if (!data.containsKey('lotes') || (data['lotes'] as List).isEmpty) {
            int qtdAtual = data['quantidade'] ?? 0;
            if (qtdAtual < cartItem.quantity) {
              throw Exception("Estoque insuficiente para ${cartItem.name}");
            }
            transaction.update(productRef, {
              'quantidade': FieldValue.increment(-cartItem.quantity),
            });
          }
          // VERIFICAÇÃO 2: Produto COM lotes (Estoque Automático - FIFO)
          else {
            List<dynamic> lotesBrutos = List.from(data['lotes'] ?? []);

            // Pega apenas lotes com quantidade > 0 e ordena por validade
            List<dynamic> lotesAtivos = lotesBrutos
                .where((l) => l['quantidade'] > 0)
                .toList();
            lotesAtivos.sort(
                  (a, b) => (a['validade'] as Timestamp).compareTo(
                b['validade'] as Timestamp,
              ),
            );

            int qtdParaBaixar = cartItem.quantity;
            List<Map<String, dynamic>> lotesAtualizados = [];

            for (var lote in lotesAtivos) {
              Map<String, dynamic> loteMap = Map<String, dynamic>.from(
                lote as Map,
              );

              if (qtdParaBaixar <= 0) {
                lotesAtualizados.add(loteMap);
              } else {
                int qtdNoLote = loteMap['quantidade'] as int;
                if (qtdNoLote <= qtdParaBaixar) {
                  qtdParaBaixar -=
                      qtdNoLote; // Lote esgotou, não entra na nova lista
                } else {
                  loteMap['quantidade'] = qtdNoLote - qtdParaBaixar;
                  lotesAtualizados.add(loteMap);
                  qtdParaBaixar = 0;
                }
              }
            }

            if (qtdParaBaixar > 0) {
              throw Exception(
                "Estoque insuficiente para ${cartItem.name} nos lotes.",
              );
            }

            // Recalcula o estoque total com base no que sobrou
            final int novoTotalEstoque = lotesAtualizados.fold(
              0,
                  (total, item) => total + (item['quantidade'] as int),
            );

            // Atualiza o produto no banco sincronizando a quantidade e a lista de lotes
            transaction.update(productRef, {
              'quantidade': novoTotalEstoque,
              'lotes': lotesAtualizados,
            });
          }
        }

        // =================================================================
        // FASE 3: REGISTRAR O RECIBO DA VENDA
        // =================================================================
        transaction.set(saleDocRef, {
          'totalAmount': cart.totalAmount,
          'products': cart.items.values.map((item) => item.toMap()).toList(),
          'createdAt': Timestamp.now(),
          'storeId': widget.storeId,
          'notes': widget.notes,
          'paymentMethod': paymentMethod,
          'isPaid': true,
          'customerId': cart.selectedCustomer?.id,
          'customerName': cart.selectedCustomer?.name,
        });
      });

      // 4. A venda comercial já está confirmada neste ponto.
      // A emissão fiscal é uma segunda etapa e NÃO deve desfazer a venda.
      cart.clear();

      final createdSaleId = saleId;

      if (shouldRequestNfce) {
        await _requestNfceForSale(createdSaleId);
      } else {
        debugPrint(
          'ℹ️ NFC-e não solicitada automaticamente: '
              'loja sem Business fiscal configurado.',
        );

        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Venda finalizada e estoque atualizado!'),
              backgroundColor: Colors.green,
            ),
          );
        }
      }

      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      debugPrint('❌ Erro na transação de venda: $e');

      if (mounted) {
        setState(() => _isLoading = false);

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.toString().contains('UNAVAILABLE') ||
                  e.toString().contains('socket')
                  ? 'Sem conexão. Verifique sua internet e tente de novo.'
                  : 'Erro: ${e.toString()}',
            ),
            backgroundColor: Colors.red,
            action: SnackBarAction(
              label: 'Tentar Novamente',
              textColor: Colors.white,
              onPressed: () => _handleInstantSale(paymentMethod),
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  // Atualiza o diálogo de PIX para usar a imagem salva no Firestore (se existir)
  void _showPixDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Pagar com PIX'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Aponte a câmera para o QR Code para pagar.'),
            const SizedBox(height: 20),
            // Se estiver carregando, mostra spinner; se tiver URL mostra Image.network; se não, fallback para asset
            if (_pixLoading)
              const SizedBox(
                height: 150,
                width: 150,
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_pixQrCodeUrl != null && _pixQrCodeUrl!.isNotEmpty)
            // Exibe a imagem do Firebase Storage com tratamento de erro e fit
              Image.network(
                _pixQrCodeUrl!,
                height: 150,
                width: 150,
                fit: BoxFit.contain,
                // em caso de falha, mostramos o placeholder local
                errorBuilder: (context, error, stackTrace) {
                  debugPrint('Erro ao carregar pixQrCodeUrl: $error');
                  return Image.asset(
                    'assets/images/pix_qrcode.png',
                    height: 150,
                    width: 150,
                  );
                },
              )
            else
              Image.asset(
                'assets/images/pix_qrcode.png',
                height: 150,
                width: 150,
              ),
          ],
        ),
        actions: [
          TextButton(
            child: const Text("Cancelar"),
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
          ElevatedButton(
            child: const Text("Pagamento Concluído"),
            onPressed: () {
              Navigator.of(dialogContext).pop();
              _handleInstantSale('PIX');
            },
          ),
        ],
      ),
    );
  }

  // --- FUNÇÃO CENTRAL PARA O PROCESSO FIADO ---
  Future<void> _startFiadoProcess(Customer customer) async {
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => ConfirmFiadoDialog(
        storeId: widget.storeId,
        customer: customer,
        notes: widget.notes,
      ),
    );

    if (result == true && mounted) {
      Navigator.of(context).pop(true);
    }
  }

  // --- FUNÇÃO PARA SELECIONAR CLIENTE ---
  void _selectCustomerForFiado() {
    showDialog(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          title: const Text('Selecionar Cliente – Crédito'),
          content: SizedBox(
            width: double.maxFinite,
            child: StreamBuilder<QuerySnapshot>(
              stream: FirebaseFirestore.instance
                  .collection('stores')
                  .doc(widget.storeId)
                  .collection('customers')
                  .orderBy('name')
                  .snapshots(),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (!snapshot.hasData || snapshot.data!.docs.isEmpty) {
                  return const Center(
                    child: Text('Nenhum cliente cadastrado.'),
                  );
                }
                final customersDocs = snapshot.data!.docs;
                return ListView.builder(
                  shrinkWrap: true,
                  itemCount: customersDocs.length,
                  itemBuilder: (context, index) {
                    final customer = Customer.fromFirestore(
                      customersDocs[index],
                    );
                    return ListTile(
                      title: Text(customer.name),
                      onTap: () {
                        Navigator.of(ctx).pop(); // Fecha o diálogo de seleção
                        _startFiadoProcess(customer); // Chama a função central
                      },
                    );
                  },
                );
              },
            ),
          ),
          actions: [
            TextButton(
              child: const Text('Cancelar'),
              onPressed: () => Navigator.of(ctx).pop(),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const SizedBox(
        height: 300,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final cart = Provider.of<CartProvider>(context, listen: false);

    // Adicionamos o SafeArea para evitar que o conteúdo fique atrás do menu do sistema
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
        // Ajustamos o padding
        child: Wrap(
          runSpacing: 10,
          children: <Widget>[
            const Text(
              'Escolha a forma de pagamento',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 10, width: double.infinity),
            ListTile(
              leading: const Icon(Icons.money, size: 30, color: Colors.green),
              title: const Text('Dinheiro', style: TextStyle(fontSize: 18)),
              onTap: () => _handleInstantSale('Dinheiro'),
            ),
            ListTile(
              leading: const Icon(
                Icons.credit_card,
                size: 30,
                color: Colors.blueAccent,
              ),
              title: const Text(
                'Cartão de crédito',
                style: TextStyle(fontSize: 18),
              ),
              onTap: () => _handleInstantSale('Cartão de crédito'),
            ),
            ListTile(
              leading: const Icon(
                Icons.credit_card_outlined,
                size: 30,
                color: Colors.indigo,
              ),
              title: const Text(
                'Cartão de débito',
                style: TextStyle(fontSize: 18),
              ),
              onTap: () => _handleInstantSale('Cartão de débito'),
            ),
            ListTile(
              leading: const Icon(Icons.pix, size: 30, color: Colors.cyan),
              title: const Text('PIX', style: TextStyle(fontSize: 18)),
              onTap: _showPixDialog,
            ),
            if (_fiadoIsEnabled) ...[
              const Divider(),
              ListTile(
                leading: const Icon(
                  Icons.person_add_alt_1,
                  size: 30,
                  color: Colors.orange,
                ),
                title: const Text(
                  'Crédito / A Prazo',
                  style: TextStyle(fontSize: 18),
                ),
                onTap: () {
                  final selectedCustomer = cart.selectedCustomer;

                  if (selectedCustomer != null) {
                    _startFiadoProcess(selectedCustomer);
                  } else {
                    _selectCustomerForFiado();
                  }
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}
