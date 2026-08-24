// ============================================================================
// STORE CONNECT - SERVIÇO DE SINCRONIZAÇÃO DE VENDAS OFFLINE
// ============================================================================
//
// Arquivo:
//   lib/services/offline_sales_sync_service.dart
//
// Objetivo:
//   Consumir a fila SQLite de vendas pending/failed e enviá-las para a callable
//   syncOfflineSale quando houver internet.
//
// Fluxo:
//   SQLite
//      ↓
//   pending / failed
//      ↓
//   markAsSyncing()
//      ↓
//   Cloud Function syncOfflineSale
//      ↓
//   sucesso
//      ↓
//   markAsSynced()
//
// IDEMPOTÊNCIA:
//   O mesmo localId é enviado em toda tentativa.
//   O backend usa esse ID como documentId da venda e não baixa estoque novamente
//   quando a venda já foi processada.
//
// CONTROLE DE CONCORRÊNCIA:
//   O campo _isSyncing evita duas varreduras simultâneas dentro da mesma
//   instância do serviço.
//
// FALHAS:
//   - uma venda que falha volta para status failed;
//   - failed continua fazendo parte da fila aguardando sincronização;
//   - indisponibilidade de rede encerra a rodada atual para evitar chamadas
//     inúteis em sequência.
//
// NFC-e:
//   Depois que a venda comercial foi sincronizada e marcada como synced, a
//   emissão fiscal pode ser solicitada separadamente.
//   Falha fiscal NÃO volta a venda para failed e NÃO repete estoque.
//
// IMPORTANTE:
//   Este serviço não monitora conectividade sozinho.
//   Na próxima integração, NewSaleScreen chamará syncPendingSales() quando o
//   InternetConnection mudar para connected.
//
// ============================================================================

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';

class OfflineSalesSyncService {
  final OfflineSalesRepository _repository;
  final FirebaseFunctions _functions;

  bool _isSyncing = false;

  OfflineSalesSyncService({
    OfflineSalesRepository? repository,
    FirebaseFunctions? functions,
  })  : _repository =
      repository ?? OfflineSalesRepository(),
        _functions =
            functions ?? FirebaseFunctions.instance;

  bool get isSyncing => _isSyncing;

  Future<OfflineSyncResult> syncPendingSales() async {
    if (_isSyncing) {
      return const OfflineSyncResult(
        skippedBecauseAlreadyRunning: true,
      );
    }

    _isSyncing = true;

    var syncedCount = 0;
    var failedCount = 0;

    try {
      // Se o app foi encerrado no meio de uma tentativa anterior,
      // syncing volta para pending antes da nova varredura.
      await _repository.recoverInterruptedSyncs();

      final waitingSales =
      await _repository.getWaitingSales();

      if (waitingSales.isEmpty) {
        return const OfflineSyncResult();
      }

      debugPrint(
        '🔄 SYNC OFFLINE: ${waitingSales.length} venda(s) aguardando.',
      );

      for (final sale in waitingSales) {
        final outcome = await _syncOneSale(sale);

        switch (outcome) {
          case _SyncOneSaleOutcome.synced:
            syncedCount++;
            break;

          case _SyncOneSaleOutcome.failed:
            failedCount++;
            break;

          case _SyncOneSaleOutcome.networkUnavailable:
            failedCount++;

            // A rede caiu novamente.
            // Mantemos as próximas vendas intactas para a próxima rodada.
            return OfflineSyncResult(
              syncedCount: syncedCount,
              failedCount: failedCount,
              stoppedBecauseNetworkUnavailable: true,
            );
        }
      }

      return OfflineSyncResult(
        syncedCount: syncedCount,
        failedCount: failedCount,
      );
    } finally {
      _isSyncing = false;
    }
  }

  Future<_SyncOneSaleOutcome> _syncOneSale(
      PendingSale sale,
      ) async {
    await _repository.markAsSyncing(
      sale.localId,
    );

    try {
      final products =
      _repository.decodeProducts(sale);

      final callable =
      _functions.httpsCallable(
        'syncOfflineSale',
      );

      final response =
      await callable.call<Map<String, dynamic>>(
        {
          'storeId': sale.storeId,
          'localSaleId': sale.localId,
          'totalAmount': sale.totalAmount,
          'products': products,
          'paymentMethod': sale.paymentMethod,
          'notes': sale.notes,
          'customerId': sale.customerId,
          'customerName': sale.customerName,
          'createdAt':
          sale.createdAt.toUtc().toIso8601String(),
        },
      );

      final data = Map<String, dynamic>.from(
        response.data,
      );

      final success =
          data['success'] == true;

      final serverSaleId =
          data['serverSaleId']?.toString().trim() ?? '';

      if (!success || serverSaleId.isEmpty) {
        throw StateError(
          'Backend não confirmou a sincronização da venda.',
        );
      }

      // A venda comercial já está definitivamente registrada.
      await _repository.markAsSynced(
        localId: sale.localId,
        serverSaleId: serverSaleId,
      );

      debugPrint(
        '✅ SYNC OFFLINE: ${sale.localId} → $serverSaleId',
      );

      // --------------------------------------------------------------
      // NFC-e é uma segunda etapa.
      // --------------------------------------------------------------

      final shouldRequestNfce =
          data['shouldRequestNfce'] == true;

      if (shouldRequestNfce) {
        await _requestNfceBestEffort(
          storeId: sale.storeId,
          serverSaleId: serverSaleId,
        );
      }

      return _SyncOneSaleOutcome.synced;
    } on FirebaseFunctionsException catch (error) {
      await _repository.markAsFailed(
        localId: sale.localId,
        error: error,
      );

      debugPrint(
        '❌ SYNC OFFLINE: ${sale.localId} | '
            'code=${error.code} | message=${error.message}',
      );

      if (_isNetworkUnavailable(error)) {
        return _SyncOneSaleOutcome.networkUnavailable;
      }

      return _SyncOneSaleOutcome.failed;
    } catch (error) {
      await _repository.markAsFailed(
        localId: sale.localId,
        error: error,
      );

      debugPrint(
        '❌ SYNC OFFLINE: ${sale.localId} | $error',
      );

      return _SyncOneSaleOutcome.failed;
    }
  }

  Future<void> _requestNfceBestEffort({
    required String storeId,
    required String serverSaleId,
  }) async {
    try {
      final callable =
      _functions.httpsCallable(
        'emitirNfce',
      );

      await callable.call<Map<String, dynamic>>(
        {
          'storeId': storeId,
          'vendaId': serverSaleId,
        },
      );

      debugPrint(
        '🧾 SYNC OFFLINE: NFC-e solicitada para $serverSaleId.',
      );
    } on FirebaseFunctionsException catch (error) {
      // A venda permanece synced.
      debugPrint(
        '⚠️ SYNC OFFLINE: venda sincronizada, '
            'mas NFC-e ficou pendente | '
            'code=${error.code} | message=${error.message}',
      );
    } catch (error) {
      // A venda permanece synced.
      debugPrint(
        '⚠️ SYNC OFFLINE: venda sincronizada, '
            'mas houve erro ao iniciar NFC-e | $error',
      );
    }
  }

  bool _isNetworkUnavailable(
      FirebaseFunctionsException error,
      ) {
    final code =
    error.code.trim().toLowerCase();

    return code == 'unavailable' ||
        code == 'deadline-exceeded' ||
        code == 'network-request-failed';
  }
}

enum _SyncOneSaleOutcome {
  synced,
  failed,
  networkUnavailable,
}

class OfflineSyncResult {
  final int syncedCount;
  final int failedCount;
  final bool stoppedBecauseNetworkUnavailable;
  final bool skippedBecauseAlreadyRunning;

  const OfflineSyncResult({
    this.syncedCount = 0,
    this.failedCount = 0,
    this.stoppedBecauseNetworkUnavailable = false,
    this.skippedBecauseAlreadyRunning = false,
  });

  int get processedCount =>
      syncedCount + failedCount;

  bool get hasFailures =>
      failedCount > 0;

  bool get hasSyncedSales =>
      syncedCount > 0;
}