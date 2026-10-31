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
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../services/offline_sales_sync_service.dart';
import '../models/sale_payment_allocation.dart';
import 'split_payment_dialog.dart';
import '../services/commercial_checkout_legacy_guard.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:store_connect/models/customer_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/widgets/confirm_fiado_dialog.dart';


import '../screens/auth/auth_gate.dart';
import '../services/android_checkout_cart.dart';
import '../services/sale_mutation_ledger.dart';

class PaymentOptionsSheet extends StatefulWidget {
  final String storeId;
  final String notes;
  // Explicit local/Emulator injection only; commercial bootstrap remains unchanged.
  final AndroidCheckoutCart? localV2Checkout;
  final OfflineSalesRepository? offlineQueueRepository;
  final OfflineSalesSyncService? offlineQueueSync;

  const PaymentOptionsSheet({
    super.key,
    required this.storeId,
    required this.notes,
    this.localV2Checkout,
    this.offlineQueueRepository,
    this.offlineQueueSync,
  });

  @override
  State<PaymentOptionsSheet> createState() => _PaymentOptionsSheetState();
}

class _PaymentOptionsSheetState extends State<PaymentOptionsSheet> {
  late final OfflineSalesRepository? _offlineSalesRepository =
  kIsWeb
      ? null
      : widget.offlineQueueRepository ?? OfflineSalesRepository();

  var _isLoading = false;
  bool _fiadoIsEnabled = false;

  // ADICIONADO: guarda a URL do QR Code do PIX (se houver)
  String? _pixQrCodeUrl;
  bool _pixLoading = false;
  Object _localViewGeneration = Object();
  String? _offlineCandidateId;
  String? _offlineCandidateContext;
  Object? _offlineCandidateRevision;

  @override
  void didUpdateWidget(covariant PaymentOptionsSheet oldWidget) {
    _localViewGeneration = Object();
    super.didUpdateWidget(oldWidget);
  }

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
      final local = widget.localV2Checkout;
      if (local != null) {
        final generation = _localViewGeneration;
        final data = await local.readStore();
        if (mounted && identical(generation, _localViewGeneration) && identical(widget.localV2Checkout, local)) {
          setState(() => _pixQrCodeUrl = data['pixQrCodeUrl'] as String?);
        }
        return;
      }
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

  Future<void> _requestNfceForSale(
    String saleId,
    bool Function() isCurrent,
  ) async {
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

      if (!mounted || !isCurrent()) return;

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

      if (!mounted || !isCurrent()) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Venda concluída. NFC-e pendente: $message'),
          backgroundColor: Colors.orange,
          duration: const Duration(seconds: 8),
        ),
      );
    } catch (e) {
      debugPrint('❌ Erro inesperado ao solicitar NFC-e: $e');

      if (!mounted || !isCurrent()) return;

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

  Future<void> _handleInstantSale(String paymentMethod, {List<SalePaymentAllocation>? payments}) async {
    if (_isLoading) return;

    setState(() => _isLoading = true);

    final localV2 = widget.localV2Checkout;
    if (localV2 != null) {
      // This branch returns on every outcome. Unknown V2 never reaches S01/S03,
      // its offline fallback, fiscal defaults, or a new sale identity.
      final cart = Provider.of<CartProvider>(context, listen: false);
      final store = widget.storeId;
      final notes = widget.notes;
      final viewGeneration = _localViewGeneration;
      try {
        final sale = await localV2.submit(cart, store, paymentMethod, notes, payments: payments);
        if (!mounted || !identical(viewGeneration, _localViewGeneration) || !identical(widget.localV2Checkout, localV2) ||
            widget.storeId != store || widget.notes != notes) {
          return;
        }
        if (sale.handle.attempt.state == SaleAttemptState.confirmed) {
          if (await localV2.applyConfirmed(sale) && mounted && identical(viewGeneration, _localViewGeneration)) {
            Navigator.of(context).pop(true);
          }
        } else {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
            sale.handle.attempt.terminal
              ? 'Venda nao confirmada. Intencao original preservada para revisao.'
              : 'Resultado desconhecido. Consulte novamente a mesma intencao.')));
        }
      } catch (_) {
        if (mounted && identical(viewGeneration, _localViewGeneration) && identical(widget.localV2Checkout, localV2)) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Venda V2 pendente ou contexto alterado. Retome a intencao original.')));
        }
      } finally {
        if (mounted) setState(() => _isLoading = false);
      }
      return;
    }

    final legacyStore = widget.storeId;
    final legacyGeneration = _localViewGeneration;
    try {
      await requireNoActiveCommercialCheckout(Firebase.app().options.projectId, legacyStore);
    } catch (_) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Venda V2 pendente. Consulte o resultado original antes de vender.')));
      }
      return;
    }
    if (!mounted) return;
    if (widget.storeId != legacyStore || !identical(legacyGeneration, _localViewGeneration)) {
      setState(() => _isLoading = false);
      return;
    }
    final cart = Provider.of<CartProvider>(context, listen: false);
    final revision = cart.revision;
    final storeId = widget.storeId;
    final notes = widget.notes;
    final items = cart.items.values.toList(growable: false);
    final totalAmount = cart.totalAmount;
    final customer = cart.selectedCustomer;
    final originalUid = FirebaseAuth.instance.currentUser?.uid;
    bool isCurrent() => mounted &&
        FirebaseAuth.instance.currentUser?.uid == originalUid &&
        widget.storeId == storeId && widget.notes == notes &&
        identical(cart.revision, revision) &&
        identical(Provider.of<CartProvider>(context, listen: false), cart);

    // O ID nasce antes da tentativa de rede e nunca muda durante esse fluxo.
    final localSaleId = kIsWeb
        ? FirebaseFirestore.instance
        .collection('stores')
        .doc(widget.storeId)
        .collection('sales')
        .doc()
        .id
        : _offlineIdentity(cart.revision, '$originalUid:$storeId:$paymentMethod:$notes:${payments?.map((p) => p.toJson()).toList()}');

    try {
      if (!kIsWeb) {
        // Native S03 persists its actor-owned command before any remote read or
        // write. It never falls back from an ambiguous S01/V2 response.
        await _saveInstantSaleOffline(localSaleId: localSaleId,
          paymentMethod: paymentMethod, payments: payments, cart: cart, revision: revision,
          isCurrent: isCurrent);
        return;
      }
      // ------------------------------------------------------------------
      // TRAVA ONLINE DE ASSINATURA
      // ------------------------------------------------------------------
      // Enquanto há internet, continuamos exigindo leitura direta do servidor.
      // Não relaxamos a regra de assinatura do fluxo atual.
      // ------------------------------------------------------------------
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .get(const GetOptions(source: Source.server));

      if (!isCurrent()) return;

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
          .doc(storeId)
          .collection('sales')
          .doc(localSaleId);

      await firestore.runTransaction((transaction) async {
        if (!isCurrent()) throw StateError('O contexto da venda mudou.');
        // =================================================================
        // FASE 1: APENAS LEITURAS
        // =================================================================
        final Map<String, DocumentSnapshot> productSnapshots = {};

        for (final cartItem in items) {
          final productRef = firestore
              .collection('stores')
              .doc(storeId)
              .collection('products')
              .doc(cartItem.productId);

          final productSnapshot = await transaction.get(productRef);

          if (!productSnapshot.exists) {
            throw Exception('Produto ${cartItem.name} não encontrado.');
          }

          productSnapshots[cartItem.productId] = productSnapshot;
        }

        if (!isCurrent()) throw StateError('O contexto da venda mudou.');

        // =================================================================
        // FASE 2: APENAS ESCRITAS / ESTOQUE
        // =================================================================
        for (final cartItem in items) {
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
          'totalAmount': totalAmount,
          'products': items.map((item) => item.toMap()).toList(),
          'createdAt': Timestamp.now(),
          'storeId': storeId,
          'notes': notes,
          'paymentMethod': paymentMethod,
          if (payments != null) 'payments': validateSplitPayments(payments, (totalAmount * 100).round())
            .map((part) => part.toJson()).toList(),
          'isPaid': true,
          'customerId': customer?.id,
          'customerName': customer?.name,
          'localSaleId': localSaleId,
          'syncOrigin': 'online',
        });
      });

      // A venda comercial já foi confirmada no servidor.
      if (!isCurrent() || !cart.clearIfCurrent(revision)) return;
      final clearedRevision = cart.revision;
      bool confirmationIsCurrent() => mounted &&
          widget.storeId == storeId && widget.notes == notes &&
          identical(cart.revision, clearedRevision) &&
          identical(Provider.of<CartProvider>(context, listen: false), cart);

      if (shouldRequestNfce) {
        await _requestNfceForSale(localSaleId, confirmationIsCurrent);
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

      if (mounted && confirmationIsCurrent()) {
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      debugPrint('❌ Erro na transação de venda: $e');

      if (!isCurrent()) return;

      if (_isNetworkUnavailable(e)) {
        if (kIsWeb) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'A venda offline ainda não está disponível na versão Web. '
                      'Verifique sua conexão com a internet.',
                ),
                backgroundColor: Colors.orange,
                duration: Duration(seconds: 6),
              ),
            );
          }

          return;
        }

        await _saveInstantSaleOffline(
          localSaleId: localSaleId,
          paymentMethod: paymentMethod,
          payments: payments,
          cart: cart,
          revision: revision,
          isCurrent: isCurrent,
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
              onPressed: () {
                if (isCurrent()) _handleInstantSale(paymentMethod, payments: payments);
              },
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

  String _offlineIdentity(Object revision, String contextKey) {
    if (!identical(revision, _offlineCandidateRevision) || _offlineCandidateContext != contextKey) {
      _offlineCandidateId = _offlineSalesRepository!.createLocalSaleId();
      _offlineCandidateRevision = revision;
      _offlineCandidateContext = contextKey;
    }
    return _offlineCandidateId!;
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
    List<SalePaymentAllocation>? payments,
    required CartProvider cart,
    required Object revision,
    required bool Function() isCurrent,
  }) async {
    if (kIsWeb) {
      return;
    }
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

      if (!isCurrent()) return;

      final originScope = await currentOfflineSaleScope();
      if (!isCurrent()) return;
      if (originScope == null || originScope['storeId'] != widget.storeId) {
        throw StateError('Contexto offline ausente ou de outra loja.');
      }


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

      if (!isCurrent()) return;

      await _offlineSalesRepository!.validateStockAndSaveSale(
        localId: localSaleId,
        originScope: originScope,
        storeId: widget.storeId,
        totalAmount: cart.totalAmount,
        products: products,
        paymentMethod: paymentMethod,
        payments: payments,
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
      if (!isCurrent() || !cart.clearIfCurrent(revision)) return;

      if (!mounted) return;

      final messenger = ScaffoldMessenger.of(context);
      final clearedRevision = cart.revision;
      final savedUid = FirebaseAuth.instance.currentUser?.uid;

      Navigator.of(context).pop(true);

      // The screen may already be closing; queue execution owns its persistent
      // identity independently of widget lifetime. Local-only is never success.
      await (widget.offlineQueueSync ?? OfflineSalesSyncService(repository: _offlineSalesRepository))
          .syncPendingSales();
      final savedSale = await _offlineSalesRepository.getSale(localSaleId);
      if (!messenger.mounted || FirebaseAuth.instance.currentUser?.uid != savedUid ||
          !identical(cart.revision, clearedRevision)) {
        return;
      }
      if (savedSale?.status != 'synced') return;
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(const SnackBar(
        content: Text('Venda finalizada e estoque atualizado!'),
        backgroundColor: Colors.green,
        duration: Duration(seconds: 6),
      ));
    } on OfflineStockValidationException catch (offlineStockError) {
      debugPrint(
        '⛔ VENDA OFFLINE BLOQUEADA POR ESTOQUE: '
        '${offlineStockError.friendlyMessage}',
      );

      if (!isCurrent()) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(offlineStockError.friendlyMessage),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 6),
        ),
      );
    } catch (offlineError) {
      debugPrint('❌ Não foi possível salvar a venda offline: $offlineError');

      if (!isCurrent()) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Não foi possível salvar offline: $offlineError'),
          backgroundColor: Colors.red,
          duration: const Duration(seconds: 8),
        ),
      );
    }
  }

  Future<void> _showSplitPaymentDialog() async {
    if (_isLoading) return;
    final cart = context.read<CartProvider>();
    final revision = cart.revision;
    final checkout = widget.localV2Checkout;
    final binding = checkout?.origin.capture();
    if (checkout != null && binding == null) return;
    final uid = checkout == null ? FirebaseAuth.instance.currentUser?.uid : null;
    final store = widget.storeId;
    final payments = await showDialog<List<SalePaymentAllocation>>(
      context: context, builder: (_) => SplitPaymentDialog(totalCents: (cart.totalAmount * 100).round(),
        pixQrCodeUrl: _pixQrCodeUrl));
    if (!mounted || payments == null) return;
    final sessionChanged = checkout == null ? FirebaseAuth.instance.currentUser?.uid != uid :
      !checkout.origin.isCurrent(binding!);
    if (!identical(cart.revision, revision) || sessionChanged || widget.storeId != store ||
        !identical(widget.localV2Checkout, checkout)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('O carrinho ou a conta mudou. Confira a venda antes de pagar.')));
      return;
    }
    await _handleInstantSale(splitPaymentMethod, payments: payments);
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
    final checkout = widget.localV2Checkout;
    if (checkout != null) {
      // Consultation also covers a prepared intent. Failure blocks legacy entry.
      try {
        final active = await checkout.recoverActive(widget.storeId);
        if (!mounted) return;
        if (active != null) throw StateError('Intencao V2 ativa.');
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Consulte a venda V2 pendente antes de iniciar o fiado.')));
        }
        return;
      }
    }
    if (checkout == null) {
      try {await requireNoActiveCommercialCheckout(Firebase.app().options.projectId, widget.storeId);}
      catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Venda V2 pendente. Consulte antes de iniciar o fiado.')));
        }
        return;
      }
      if (!mounted) return;
    }
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
            width: MediaQuery.sizeOf(ctx).width > 768 ? 680 : double.maxFinite,
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
                if (!snapshot.hasData) {
                  return const Center(
                    child: Text('Nenhum cliente cadastrado.'),
                  );
                }

                final customersDocs = snapshot.data!.docs.where((doc) {
                  final data = doc.data() as Map<String, dynamic>;

                  return data['isArchived'] != true;
                }).toList();

                if (customersDocs.isEmpty) {
                  return const Center(
                    child: Text('Nenhum cliente ativo cadastrado.'),
                  );
                }
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
      child: SingleChildScrollView(child: Container(
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
            if (!kIsWeb || widget.localV2Checkout != null) ListTile(
              leading: const Icon(Icons.call_split, size: 30, color: Colors.deepPurple),
              title: const Text('Dividir pagamento', style: TextStyle(fontSize: 18)),
              subtitle: const Text('Combine dinheiro, PIX e cartões'),
              onTap: _showSplitPaymentDialog,
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
      )),
    );
  }
}
