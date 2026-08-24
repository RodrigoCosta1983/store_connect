// ============================================================================
// STORE CONNECT - OPÇÕES DE PAGAMENTO / REGISTRO DE VENDA
// ============================================================================
//
// Arquivo:
//   lib/widgets/payment_options_sheet.dart
//
// Objetivo:
//   Exibir as formas de pagamento disponíveis no fechamento da venda e
//   registrar vendas instantâneas com estratégia online + fallback local.
//
// Responsabilidades principais:
//   - validar o status da assinatura antes de concluir a venda;
//   - baixar estoque manual ou por lotes em transação;
//   - registrar o recibo em stores/{storeId}/sales/{saleId};
//   - abrir o fluxo de PIX;
//   - abrir o fluxo de venda a prazo;
//   - distinguir cartão de crédito e cartão de débito;
//   - quando o servidor estiver indisponível, revalidar o estoque local;
//   - salvar no SQLite somente quando houver saldo suficiente;
//   - manter um localSaleId estável para sincronização idempotente.
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
//   - "Crédito / A Prazo" é venda fiada e NÃO é cartão de crédito;
//   - o modo offline desta etapa cobre apenas vendas instantâneas;
//   - venda offline NÃO altera o estoque Firestore imediatamente;
//   - pending/syncing/failed reservam estoque no SQLite;
//   - antes de persistir uma venda offline, o cache Firestore fornece o último
//     saldo conhecido e o repository executa uma validação transacional;
//   - se faltar saldo, a venda NÃO é criada e o carrinho NÃO é limpo;
//   - o backend continua sendo a autoridade definitiva multi-dispositivo;
//   - NFC-e é solicitada somente depois da sincronização comercial.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
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
  final OfflineSalesRepository _offlineSalesRepository =
      OfflineSalesRepository();

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
    final subscriptionType =
        (storeData['subscriptionType'] ??
                storeData['plan'] ??
                storeData['plano'] ??
                storeData['subscriptionPlan'] ??
                '')
            .toString()
            .trim()
            .toLowerCase();

    final perfilFiscal = storeData['perfilFiscal'];

    if (perfilFiscal is! Map) {
      return false;
    }

    final fiscalData = Map<String, dynamic>.from(perfilFiscal);

    return subscriptionType == 'business' && fiscalData['configurado'] == true;
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
      debugPrint('🧾 NFC-e: solicitando emissão/validação para venda $saleId');

      final callable = FirebaseFunctions.instance.httpsCallable('emitirNfce');

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
          content: Text('Venda concluída. NFC-e: $status.'),
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
          content: Text('Venda concluída. NFC-e pendente: $message'),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 8),
        ),
      );
    } catch (e) {
      debugPrint('❌ Erro inesperado ao solicitar NFC-e: $e');

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

  // ============================================================================
  // VENDA INSTANTÂNEA - ONLINE COM FALLBACK OFFLINE
  // ============================================================================
  //
  // Estratégia desta fase:
  //
  //   1. Um localSaleId é criado ANTES de acessar a rede.
  //   2. Online: o mesmo ID é usado como ID do documento da venda no Firestore.
  //   3. Se o servidor ficar indisponível: a venda é gravada no SQLite usando
  //      exatamente o mesmo ID e recebe status pending.
  //   4. A NFC-e continua exclusiva do fluxo online por enquanto.
  //   5. O SyncService futuro reutilizará esse ID para evitar duplicidade.
  //
  // Importante:
  //   - nesta fase o estoque não é abatido localmente no SQLite;
  //   - portanto o estoque exibido offline ainda representa o último estado
  //     conhecido do servidor;
  //   - a reconciliação idempotente de estoque será feita no backend na fase
  //     de sincronização.
  // ============================================================================

  Future<void> _handleInstantSale(String paymentMethod) async {
    if (_isLoading) return;

    setState(() => _isLoading = true);

    final cart = Provider.of<CartProvider>(context, listen: false);

    // O ID nasce antes da tentativa de rede e nunca muda durante esse fluxo.
    final localSaleId = _offlineSalesRepository.createLocalSaleId();

    try {
      // ------------------------------------------------------------------
      // TRAVA ONLINE DE ASSINATURA
      // ------------------------------------------------------------------
      // Enquanto há internet, continuamos exigindo leitura direta do servidor.
      // Não relaxamos a regra de assinatura do fluxo atual.
      // ------------------------------------------------------------------
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get(const GetOptions(source: Source.server));

      if (!storeDoc.exists) {
        throw Exception('Loja não encontrada.');
      }

      final storeData = storeDoc.data() as Map<String, dynamic>;
      final status = storeData['subscriptionStatus'] as String? ?? 'trial';
      final shouldRequestNfce = _shouldRequestNfce(storeData);

      if (!_isAllowedSubscriptionStatus(status)) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Venda bloqueada! Sua assinatura está inativa ou expirada.',
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
        return;
      }

      final firestore = FirebaseFirestore.instance;

      // Usamos o MESMO ID gerado localmente. Isso prepara a venda para
      // sincronização idempotente caso a resposta da rede se perca.
      final saleDocRef = firestore
          .collection('stores')
          .doc(widget.storeId)
          .collection('sales')
          .doc(localSaleId);

      await firestore.runTransaction((transaction) async {
        // =================================================================
        // FASE 1: APENAS LEITURAS
        // =================================================================
        final Map<String, DocumentSnapshot> productSnapshots = {};

        for (final cartItem in cart.items.values) {
          final productRef = firestore
              .collection('stores')
              .doc(widget.storeId)
              .collection('products')
              .doc(cartItem.productId);

          final productSnapshot = await transaction.get(productRef);

          if (!productSnapshot.exists) {
            throw Exception('Produto ${cartItem.name} não encontrado.');
          }

          productSnapshots[cartItem.productId] = productSnapshot;
        }

        // =================================================================
        // FASE 2: APENAS ESCRITAS / ESTOQUE
        // =================================================================
        for (final cartItem in cart.items.values) {
          final productSnapshot = productSnapshots[cartItem.productId]!;
          final data = productSnapshot.data() as Map<String, dynamic>;
          final productRef = productSnapshot.reference;

          // Produto SEM lotes: estoque manual.
          if (!data.containsKey('lotes') || (data['lotes'] as List).isEmpty) {
            final int qtdAtual = data['quantidade'] ?? 0;

            if (qtdAtual < cartItem.quantity) {
              throw Exception('Estoque insuficiente para ${cartItem.name}');
            }

            transaction.update(productRef, {
              'quantidade': FieldValue.increment(-cartItem.quantity),
            });
          } else {
            // Produto COM lotes: baixa FIFO.
            final List<dynamic> lotesBrutos = List.from(data['lotes'] ?? []);

            final List<dynamic> lotesAtivos = lotesBrutos
                .where((l) => l['quantidade'] > 0)
                .toList();

            lotesAtivos.sort(
              (a, b) => (a['validade'] as Timestamp).compareTo(
                b['validade'] as Timestamp,
              ),
            );

            int qtdParaBaixar = cartItem.quantity;
            final List<Map<String, dynamic>> lotesAtualizados = [];

            for (final lote in lotesAtivos) {
              final loteMap = Map<String, dynamic>.from(lote as Map);

              if (qtdParaBaixar <= 0) {
                lotesAtualizados.add(loteMap);
                continue;
              }

              final int qtdNoLote = loteMap['quantidade'] as int;

              if (qtdNoLote <= qtdParaBaixar) {
                qtdParaBaixar -= qtdNoLote;
              } else {
                loteMap['quantidade'] = qtdNoLote - qtdParaBaixar;
                lotesAtualizados.add(loteMap);
                qtdParaBaixar = 0;
              }
            }

            if (qtdParaBaixar > 0) {
              throw Exception(
                'Estoque insuficiente para ${cartItem.name} nos lotes.',
              );
            }

            final int novoTotalEstoque = lotesAtualizados.fold(
              0,
              (total, item) => total + (item['quantidade'] as int),
            );

            transaction.update(productRef, {
              'quantidade': novoTotalEstoque,
              'lotes': lotesAtualizados,
            });
          }
        }

        // =================================================================
        // FASE 3: REGISTRAR A VENDA
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
          'localSaleId': localSaleId,
          'syncOrigin': 'online',
        });
      });

      // A venda comercial já foi confirmada no servidor.
      cart.clear();

      if (shouldRequestNfce) {
        await _requestNfceForSale(localSaleId);
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

      if (_isNetworkUnavailable(e)) {
        await _saveInstantSaleOffline(
          localSaleId: localSaleId,
          paymentMethod: paymentMethod,
          cart: cart,
        );
        return;
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro: ${e.toString()}'),
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

  bool _isAllowedSubscriptionStatus(String status) {
    return status == 'active' || status == 'trial' || status == 'overdue';
  }

  bool _isNetworkUnavailable(Object error) {
    if (error is FirebaseException && error.code == 'unavailable') {
      return true;
    }

    final text = error.toString().toLowerCase();

    return text.contains('unavailable') ||
        text.contains('socket') ||
        text.contains('unknownhost') ||
        text.contains('failed host lookup') ||
        text.contains('unable to resolve host');
  }

  Future<Map<String, int>> _loadCachedStockForCart(CartProvider cart) async {
    final firestore = FirebaseFirestore.instance;

    final knownStockByProduct = <String, int>{};

    for (final cartItem in cart.items.values) {
      final cachedProduct = await firestore
          .collection('stores')
          .doc(widget.storeId)
          .collection('products')
          .doc(cartItem.productId)
          .get(const GetOptions(source: Source.cache));

      if (!cachedProduct.exists) {
        throw Exception(
          'Não foi possível validar o estoque offline de '
          '${cartItem.name}. Conecte-se à internet ao menos uma vez '
          'com esse produto carregado antes de vendê-lo offline.',
        );
      }

      final data = cachedProduct.data() as Map<String, dynamic>;

      final lotes = data['lotes'];

      int knownStock;

      if (lotes is List && lotes.isNotEmpty) {
        knownStock = lotes.fold<int>(0, (total, rawLote) {
          if (rawLote is! Map) {
            return total;
          }

          final rawQuantity = rawLote['quantidade'];

          final quantity = rawQuantity is num
              ? rawQuantity.toInt()
              : int.tryParse(rawQuantity?.toString() ?? '') ?? 0;

          return quantity > 0 ? total + quantity : total;
        });
      } else {
        final rawQuantity = data['quantidade'];

        knownStock = rawQuantity is num
            ? rawQuantity.toInt()
            : int.tryParse(rawQuantity?.toString() ?? '') ?? 0;
      }

      knownStockByProduct[cartItem.productId] = knownStock < 0 ? 0 : knownStock;
    }

    return knownStockByProduct;
  }

  Future<void> _saveInstantSaleOffline({
    required String localSaleId,
    required String paymentMethod,
    required CartProvider cart,
  }) async {
    try {
      // ------------------------------------------------------------------
      // TRAVA OFFLINE
      // ------------------------------------------------------------------
      // Sem rede não conseguimos consultar o servidor. Portanto exigimos que
      // exista uma cópia da loja no cache do Firestore e reaplicamos a mesma
      // regra de status. Isso é deliberadamente mais restritivo do que
      // simplesmente ignorar a assinatura.
      //
      // Na fase de produção adicionaremos também uma política explícita de
      // validade temporal para essa autorização offline.
      // ------------------------------------------------------------------
      final cachedStoreDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(widget.storeId)
          .get(const GetOptions(source: Source.cache));

      if (!cachedStoreDoc.exists) {
        throw Exception(
          'Não foi possível validar a loja offline. Conecte-se à internet '
          'ao menos uma vez antes de usar vendas offline.',
        );
      }

      final cachedStoreData = cachedStoreDoc.data() as Map<String, dynamic>;
      final cachedStatus =
          cachedStoreData['subscriptionStatus'] as String? ?? 'trial';

      if (!_isAllowedSubscriptionStatus(cachedStatus)) {
        throw Exception(
          'Venda offline bloqueada: a última assinatura conhecida não está '
          'ativa.',
        );
      }

      final products = cart.items.values
          .map((item) => Map<String, dynamic>.from(item.toMap()))
          .toList();

      final knownStockByProduct = await _loadCachedStockForCart(cart);

      await _offlineSalesRepository.validateStockAndSaveSale(
        localId: localSaleId,
        storeId: widget.storeId,
        totalAmount: cart.totalAmount,
        products: products,
        paymentMethod: paymentMethod,
        knownStockByProduct: knownStockByProduct,
        notes: widget.notes,
        customerId: cart.selectedCustomer?.id,
        customerName: cart.selectedCustomer?.name,
      );

      debugPrint(
        '💾 Venda salva offline após validação de estoque | '
        'localSaleId=$localSaleId | paymentMethod=$paymentMethod',
      );

      // A venda foi preservada localmente. O carrinho pode ser liberado para
      // que o caixa continue operando.
      cart.clear();

      if (!mounted) return;

      final messenger = ScaffoldMessenger.of(context);

      Navigator.of(context).pop(true);

      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Venda salva offline. Ela será sincronizada quando a internet voltar.',
          ),
          backgroundColor: Colors.orange,
          duration: Duration(seconds: 6),
        ),
      );
    } on OfflineStockValidationException catch (offlineStockError) {
      debugPrint(
        '⛔ VENDA OFFLINE BLOQUEADA POR ESTOQUE: '
        '${offlineStockError.friendlyMessage}',
      );

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(offlineStockError.friendlyMessage),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 6),
        ),
      );
    } catch (offlineError) {
      debugPrint('❌ Não foi possível salvar a venda offline: $offlineError');

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Não foi possível salvar offline: $offlineError'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 8),
        ),
      );
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
