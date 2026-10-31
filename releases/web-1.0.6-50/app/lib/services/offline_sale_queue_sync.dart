import 'dart:async';
import 'dart:convert';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import '../data/local/app_database.dart';
import '../data/local/offline_sales_repository.dart';
import 'sale_mutation_command.dart';
import 'offline_sale_command.dart';
import '../models/sale_payment_allocation.dart';

typedef OfflineSaleCall = Future<Map<String, dynamic>> Function(String endpoint, Map<String, dynamic> command);
typedef OfflineSaleScope = Future<Map<String, dynamic>?> Function();

/// Lost responses require receipt recovery before any same-ID resend. SQLite
/// leases serialize local workers; server receipts remain the final authority.
class OfflineSalesSyncService {
  final OfflineSalesRepository _repository;
  final OfflineSaleCall _call;
  final OfflineSaleScope _scope;
  final Future<void> Function(Map<String, dynamic>) _refresh;
  final Future<void> Function(Map<String, dynamic>) _requestFiscal;
  bool _isSyncing = false;

  OfflineSalesSyncService({OfflineSalesRepository? repository,
    FirebaseFunctions? functions, FirebaseFirestore? firestore,
    OfflineSaleCall? call, OfflineSaleScope? activeScope,
    Future<void> Function(Map<String, dynamic>)? refresh,
    Future<void> Function(Map<String, dynamic>)? requestFiscal})
    : _repository = repository ?? OfflineSalesRepository(),
      _scope = activeScope ?? currentOfflineSaleScope,
      _call = call ?? ((endpoint, command) async {
        final app = Firebase.app();
        if (app.options.projectId != command['scope']['projectId'] ||
            FirebaseAuth.instanceFor(app: app).currentUser?.uid != command['scope']['uid']) {
          throw StateError('Sessão offline substituída.');
        }
        final response = await (functions ?? FirebaseFunctions.instanceFor(app: app))
          .httpsCallable(endpoint, options: HttpsCallableOptions(timeout: const Duration(seconds: 30)))
          .call(endpoint == 'syncOfflineSale' ? saleObject(command['payload']) : command);
        return saleObject(response.data);
      }),
      _requestFiscal = requestFiscal ?? ((command) async {
        final scope = saleObject(command['scope']), app = Firebase.app();
        if (app.options.projectId != scope['projectId'] ||
            FirebaseAuth.instance.currentUser?.uid != scope['uid']) {
          return;
        }
        await (functions ?? FirebaseFunctions.instanceFor(app: app)).httpsCallable('emitirNfce')
          .call({'storeId': scope['storeId'], 'vendaId': command['saleId']});
      }),
      _refresh = refresh ?? ((command) async {
        for (final item in command['items'] as List) {
          await (firestore ?? FirebaseFirestore.instance).collection('stores')
            .doc(command['scope']['storeId'] as String).collection('products')
            .doc(item['productId'] as String).get(const GetOptions(source: Source.server));
        }
      });

  bool get isSyncing => _isSyncing;

  Future<OfflineSyncResult> syncPendingSales() => _process(recoveryOnly: false);

  /// Receipt lookup never sends a sale or requests fiscal emission.
  Future<OfflineSyncResult> recoverPendingReceipts() => _process(recoveryOnly: true);

  Future<OfflineSyncResult> _process({required bool recoveryOnly}) async {
    if (_isSyncing) return const OfflineSyncResult(skippedBecauseAlreadyRunning: true);
    _isSyncing = true;
    var synced = 0, failed = 0;
    var busyClaims = false;
    try {
      for (final sale in await _repository.getWaitingSales()) {
        final raw = await _repository.readCommand(sale.localId);
        // No proven origin: preserve historical bytes and never adopt/send.
        if (raw == null || sale.status == OfflineSaleStatus.rejected) { failed++; continue; }
        final command = saleObject(jsonDecode(raw));
        final transportRaw = await _repository.readTransport(sale.localId);
        final transport = transportRaw == null ? null : saleObject(jsonDecode(transportRaw));
        final splitTransport = transport?['schemaVersion'] == 2;
        if (command['paymentMethod'] == splitPaymentMethod && !splitTransport) { failed++; continue; }
        // Receipt-only support must never turn into a write on the legacy API.
        if (recoveryOnly && transport != null && !splitTransport) { failed++; continue; }
        Future<bool> current() async => saleJson(await _scope()) == saleJson(command['scope']);
        if (!await current()) { failed++; continue; }
        final token = await _repository.claim(sale.localId, DateTime.now());
        if (token == null) { busyClaims = true; continue; }
        var confirmed = false;
        var endpoint = 'getOfflineSaleResultV1';
        try {
          if (!await current()) throw StateError('Contexto alterado antes da consulta.');
          Map<String, dynamic> result;
          if (splitTransport) {
            if (transport!['endpoint'] != 'syncSplitPaymentSaleV1' ||
                transport['queryEndpoint'] != 'getSplitPaymentSaleResultV1' || transport['commandJson'] != raw ||
                saleJson(transport['scope']) != saleJson(command['scope']) ||
                command['paymentMethod'] != splitPaymentMethod || command['payments'] == null) {
              throw StateError('Confirmação de pagamento dividido incompatível; intenção preservada.');
            }
            endpoint = 'getSplitPaymentSaleResultV1';
            result = await _call(endpoint, command);
            if (!await current()) throw StateError('Contexto alterado durante consulta de pagamento.');
            if (result['status'] == 'not-recorded' && result['canAutoResend'] == true && !recoveryOnly) {
              endpoint = 'syncSplitPaymentSaleV1';
              result = await _call(endpoint, command);
            }
          } else if (transport != null) {
            final payload = saleObject(transport['payload']);
            if (transport['schemaVersion'] != 1 || transport['endpoint'] != 'syncOfflineSale' ||
                transport['commandJson'] != raw || saleJson(transport['scope']) != saleJson(command['scope']) ||
                command['scope']['projectId'] != 'store-connect-app' ||
                command['paymentMethod'] == splitPaymentMethod ||
                payload['storeId'] != command['scope']['storeId'] || payload['localSaleId'] != sale.localId ||
                ((payload['totalAmount'] as num) * 100).round() != command['expectedTotalCents']) {
              throw StateError('Transporte offline incompatível; intenção preservada.');
            }
            final originalIntent = offlineSaleCommand(id: payload['localSaleId'] as String,
              scope: saleObject(transport['scope']),
              products: (payload['products'] as List).map(saleObject).toList(),
              totalAmount: (payload['totalAmount'] as num).toDouble(),
              paymentMethod: payload['paymentMethod'] as String,
              createdAt: DateTime.parse(payload['createdAt'] as String),
              notes: payload['notes'] as String?, customerId: payload['customerId'] as String?,
              payments: payload['payments'] == null ? null : (payload['payments'] as List)
                .map((payment) => SalePaymentAllocation.fromJson(saleObject(payment))).toList());
            if (saleJson(originalIntent) != saleJson(command)) {
              throw StateError('Pedido offline divergente; comando original preservado.');
            }
            endpoint = 'syncOfflineSale';
            final response = await _call(endpoint, {'scope': command['scope'], 'payload': payload});
            if (response['success'] != true || response['serverSaleId'] != sale.localId) {
              throw StateError('Servidor não confirmou a identidade offline original.');
            }
            result = {'status': 'confirmed', 'requestId': sale.localId, 'saleId': sale.localId,
              'totalCents': command['expectedTotalCents'], 'replayed': response['alreadyProcessed'] == true,
              'shouldRequestNfce': response['shouldRequestNfce'] == true, 'transport': endpoint};
          } else {
            result = await _call('getOfflineSaleResultV1', command);
          }
          if (!await current()) throw StateError('Contexto alterado durante a consulta.');
          if (result['requestId'] != sale.localId) throw StateError('Comprovante de outra identidade.');
          if (result['status'] == 'not-recorded') {
            if (splitTransport || recoveryOnly || sale.status == OfflineSaleStatus.unknown ||
                sale.status == OfflineSaleStatus.syncing ||
                sale.status == OfflineSaleStatus.confirmedRefreshPending) {
              // Absence at one instant does not resolve an earlier attempt.
              // Preserve the original command; never auto-resend an unknown.
              await _repository.finish(sale.localId, token, OfflineSaleStatus.unknown,
                reason: 'Sem comprovante localizado; execução anterior ainda exige conferência. Nenhum reenvio realizado.');
              failed++;
              continue;
            }
            // Another in-flight attempt can still commit. Only the exact same
            // command and identity may be sent after a not-recorded response.
            endpoint = 'syncOfflineSaleV1';
            result = await _call(endpoint, command);
            if (!await current()) throw StateError('Contexto alterado durante o envio.');
          }
          if (result['requestId'] != sale.localId) throw StateError('Identidade divergente.');
          if (result['status'] == 'confirmed' && result['saleId'] == sale.localId &&
              result['totalCents'] == command['expectedTotalCents']) {
            confirmed = true;
            await _refresh(command);
            if (!await current()) throw StateError('Contexto alterado durante atualização.');
            if (await _repository.finish(sale.localId, token, OfflineSaleStatus.synced,
                result: jsonEncode(result))) {
              synced++;
              // Fiscal emission remains separate and best effort, exactly once
              // per local finalization. Fiscal failure never reopens the sale.
              if (!recoveryOnly && result['shouldRequestNfce'] == true) {
                try { if (await current()) await _requestFiscal(command); } catch (_) { /* Fiscal remains pending. */ }
              }
            }
          } else if (result['status'] == 'rejected' && result['reason'] is String) {
            await _repository.finish(sale.localId, token, OfflineSaleStatus.rejected,
              result: jsonEncode(result), reason: result['reason'] as String);
            failed++;
          } else {
            throw StateError('Resultado não confirmado ou identidade em conflito.');
          }
        } catch (error) {
          await _repository.finish(sale.localId, token,
            confirmed ? OfflineSaleStatus.confirmedRefreshPending : OfflineSaleStatus.unknown,
            reason: confirmed ? 'Confirmada no servidor; atualização de estoque pendente.' :
              error is FirebaseFunctionsException && {'not-found', 'unimplemented'}.contains(error.code)
                ? 'Serviço offline indisponível (${error.code}; $endpoint). Pendência preservada; nenhum reenvio automático.'
                : 'Resultado desconhecido; consultar comprovante original.');
          failed++;
          if (error is TimeoutException || error is FirebaseException &&
              {'unavailable','deadline-exceeded','network-request-failed'}.contains(error.code)) {
            return OfflineSyncResult(syncedCount: synced, failedCount: failed,
              stoppedBecauseNetworkUnavailable: true, retryAutomatically: transport != null);
          }
        }
      }
      return OfflineSyncResult(syncedCount: synced, failedCount: failed, hasBusyClaims: busyClaims);
    } finally { _isSyncing = false; }
  }
}

/// Cache binds the local actor only. Backend revalidates all permissions.
Future<Map<String, dynamic>?> currentOfflineSaleScope() async {
  final app = Firebase.app(), auth = FirebaseAuth.instance;
  final user = auth.currentUser;
  if (user == null || auth.tenantId != null) return null;
  final snapshot = await FirebaseFirestore.instance.collection('users').doc(user.uid)
      .get(const GetOptions(source: Source.cache));
  if (auth.currentUser?.uid != user.uid) return null;
  final profile = snapshot.data();
  if (profile == null || profile['accessStatus'] == 'revoked' ||
      !{'admin','gerente','operador','caixa','vendedor'}.contains(profile['role']) ||
      profile['storeId'] is! String) { return null; }
  return {'projectId': app.options.projectId, 'uid': user.uid, 'storeId': profile['storeId']};
}

class OfflineSyncResult {
  final int syncedCount, failedCount;
  final bool stoppedBecauseNetworkUnavailable, skippedBecauseAlreadyRunning;
  final bool hasBusyClaims;
  final bool retryAutomatically;
  const OfflineSyncResult({this.syncedCount = 0, this.failedCount = 0,
    this.hasBusyClaims = false, this.retryAutomatically = false,
    this.stoppedBecauseNetworkUnavailable = false, this.skippedBecauseAlreadyRunning = false});
  int get processedCount => syncedCount + failedCount;
  bool get hasFailures => failedCount > 0;
  bool get hasSyncedSales => syncedCount > 0;
}
