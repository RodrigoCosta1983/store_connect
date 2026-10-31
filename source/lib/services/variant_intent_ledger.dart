import 'dart:convert';
import 'package:crypto/crypto.dart';
import '../data/local/variant_intent_store.dart';
import 'product_mutation_command.dart';
import 'variant_preview_state.dart';

String _json(dynamic value) => productCanonicalJson(value);
String _hash(dynamic value) =>
    sha256.convert(utf8.encode(_json(value))).toString();

enum VariantIntentStatus { prepared, unknown, committed, rejected, conflict }

class VariantLocalAccess {
  final Map<String, dynamic> scope;
  final String sessionToken;
  final String role;
  final bool revoked;
  VariantLocalAccess(
    Map<String, dynamic> scope, {
    required this.sessionToken,
    this.role = 'admin',
    this.revoked = false,
  }) : scope = Map.unmodifiable(scope);
}

class VariantLedgerAttempt {
  final String _encoded;
  VariantLedgerAttempt._(this._encoded);
  Map<String, dynamic> get _record => requireObject(jsonDecode(_encoded));
  VariantPreviewIntent get intent =>
      VariantPreviewIntent.fromJson(requireObject(_record['intent']));
  String get requestId => intent.requestId;
  String get intentKey => _record['intentKey'] as String;
  VariantIntentStatus get status =>
      VariantIntentStatus.values.byName(_record['status'] as String);
  bool get terminal =>
      status == VariantIntentStatus.committed ||
      status == VariantIntentStatus.rejected;
  String get fingerprint => _hash(intent.toJson());
}

// Abstract contracts only: B1 never invokes these or implements remote adapters.
abstract interface class VariantAuthoritativeReader {
  Future<VariantPreviewData> read(
    VariantLocalAccess access,
    VariantIdentity identity,
  );
}

abstract interface class VariantReceiptReader {
  Future<VariantLocalResolution?> query(
    VariantLocalAccess access,
    VariantPreviewIntent original,
  );
}

abstract interface class VariantFutureTransport {
  Future<void> send(
    VariantLocalAccess access,
    VariantFutureClaim persistedClaim,
  );
}

class VariantFutureClaim {
  final VariantLedgerAttempt attempt;
  VariantFutureClaim._(this.attempt);
}

// A LOCAL resolution, not a server receipt. B2 must verify authoritative proof.
class VariantLocalResolution {
  final VariantPreviewIntent original;
  final VariantIntentStatus status;
  final String reason;
  final bool replayed;
  VariantLocalResolution({
    required this.original,
    required this.status,
    required this.reason,
    this.replayed = false,
  }) {
    if (!{
          VariantIntentStatus.committed,
          VariantIntentStatus.rejected,
          VariantIntentStatus.conflict,
        }.contains(status) ||
        reason.trim().isEmpty) {
      throw const FormatException('Reconciliação local inválida.');
    }
  }
}

class VariantIntentLedger {
  final VariantIntentStore store;
  final Map<String, dynamic> scope;
  final String sessionToken;
  final bool allowSyntheticReconciliation;
  final Future<VariantLocalAccess?> Function() activeAccess;
  VariantIntentLedger({
    required this.store,
    required Map<String, dynamic> scope,
    required this.sessionToken,
    required this.activeAccess,
    this.allowSyntheticReconciliation = false,
  }) : scope = Map.unmodifiable(scope) {
    if (scope.length != 3 ||
        !scope.keys.toSet().containsAll({'projectId', 'uid', 'storeId'}) ||
        scope.values.any(
          (v) => v is! String || v.isEmpty || v.trim() != v || v.contains('/'),
        ) ||
        !(scope['projectId'] as String).startsWith('demo-') ||
        sessionToken.isEmpty) {
      throw const FormatException('Escopo local inválido.');
    }
  }
  String get storageKey =>
      'variant-intents-v1:${base64Url.encode(utf8.encode(_json(scope)))}';
  Future<void> _check([String? operation]) async {
    final access = await activeAccess();
    if (access == null ||
        access.revoked ||
        access.sessionToken != sessionToken ||
        _json(access.scope) != _json(scope) ||
        !{
          'admin',
          'gerente',
          'operador',
          'caixa',
          'vendedor',
        }.contains(access.role) ||
        (operation == 'archiveVariantC3' && access.role != 'admin')) {
      throw StateError(
        'Sessão, escopo ou permissão mudou. Intenção preservada.',
      );
    }
  }

  String _seal(Map<String, dynamic> record) {
    final body = {...record}..remove('recordHash');
    return _json({...body, 'recordHash': _hash(body)});
  }

  Map<String, dynamic> _decode(String? raw) {
    if (raw == null) {
      return {
        'ledgerVersion': 1,
        'protocol': 'variant-intents-v1',
        'scope': scope,
        'entries': <String, dynamic>{},
      };
    }
    final record = requireObject(jsonDecode(raw));
    final digest = record.remove('recordHash');
    if (digest != _hash(record) ||
        record.length != 4 ||
        record['ledgerVersion'] != 1 ||
        record['protocol'] != 'variant-intents-v1' ||
        _json(record['scope']) != _json(scope)) {
      throw const FormatException('Ledger de variantes corrompido.');
    }
    final entries = requireObject(record['entries']);
    final intents = <String>{};
    var active = 0;
    for (final item in entries.entries) {
      final value = requireObject(item.value);
      final intent = VariantPreviewIntent.fromJson(
        requireObject(value['intent']),
      );
      final status = VariantIntentStatus.values.byName(
        value['status'] as String,
      );
      if (value.length != 5 ||
          value['intentKey'] is! String ||
          (value['intentKey'] as String).isEmpty ||
          !intents.add(value['intentKey'] as String) ||
          item.key != intent.requestId ||
          _json(intent.command['scope']) != _json(scope) ||
          value['fingerprint'] != _hash(intent.toJson())) {
        throw const FormatException('Identidade durável inválida.');
      }
      final outcome = value['outcome'];
      if ({
        VariantIntentStatus.committed,
        VariantIntentStatus.rejected,
        VariantIntentStatus.conflict,
      }.contains(status)) {
        if (!allowSyntheticReconciliation ||
            outcome is! Map ||
            outcome['source'] != 'synthetic-b1' ||
            outcome['status'] != status.name ||
            outcome['reason'] is! String ||
            (outcome['reason'] as String).trim().isEmpty ||
            outcome['replayed'] is! bool) {
          throw const FormatException('Resultado local inválido.');
        }
      } else if (outcome != null) {
        throw const FormatException('Resultado prematuro.');
      }
      if (status != VariantIntentStatus.committed &&
          status != VariantIntentStatus.rejected) {
        active++;
      }
    }
    if (active > 1) {
      throw const FormatException('Mais de uma intenção pendente no escopo.');
    }
    return record;
  }

  VariantLedgerAttempt _attempt(Map entry) =>
      VariantLedgerAttempt._(_json(entry));
  Future<List<VariantLedgerAttempt>> reopen() async {
    await _check();
    final raw = await store.read(storageKey);
    await _check();
    final record = _decode(raw);
    final result = [
      for (final entry in requireObject(record['entries']).values)
        _attempt(entry as Map),
    ];
    for (final item in result) {
      await _check(item.intent.operation);
    }
    return result;
  }

  Future<VariantLedgerAttempt> prepare(
    String intentKey,
    VariantPreviewIntent original,
  ) async {
    // Copy before first await; operation, COD, baselines and scope never normalize away.
    final intent = VariantPreviewIntent.fromJson(original.toJson());
    if (intentKey.isEmpty ||
        intentKey.trim() != intentKey ||
        _json(intent.command['scope']) != _json(scope)) {
      throw const FormatException(
        'Intenção de outro escopo ou chave inválida.',
      );
    }
    return _mutate(intent.operation, (record) {
      final entries = requireObject(record['entries']);
      for (final entry in entries.values) {
        final attempt = _attempt(entry as Map);
        if (attempt.requestId == intent.requestId ||
            attempt.intentKey == intentKey) {
          if (attempt.intentKey != intentKey ||
              attempt.intent.encoded != intent.encoded) {
            throw StateError(
              'Conflito de identidade. Intenção original preservada.',
            );
          }
          return attempt.requestId;
        }
      }
      if (entries.values.any((e) => !_attempt(e as Map).terminal)) {
        throw StateError('Resultado pendente: nova intenção bloqueada.');
      }
      entries[intent.requestId] = {
        'intentKey': intentKey,
        'intent': intent.toJson(),
        'fingerprint': _hash(intent.toJson()),
        'status': VariantIntentStatus.prepared.name,
        'outcome': null,
      };
      record['entries'] = entries;
      return intent.requestId;
    });
  }

  Future<VariantLedgerAttempt> load(String requestId) async {
    final attempts = await reopen();
    return attempts.firstWhere(
      (a) => a.requestId == requestId,
      orElse: () => throw StateError('Intenção não encontrada.'),
    );
  }

  Future<VariantFutureClaim> claimForFutureTransport(String requestId) async {
    final previous = await load(requestId);
    final claimed = await _mutate(previous.intent.operation, (record) {
      final entry = requireObject(requireObject(record['entries'])[requestId]);
      if (entry['status'] != VariantIntentStatus.prepared.name) {
        throw StateError(
          'Resultado desconhecido ou terminal: transporte bloqueado.',
        );
      }
      entry['status'] = VariantIntentStatus.unknown.name;
      (record['entries'] as Map)[requestId] = entry;
      return requestId;
    });
    return VariantFutureClaim._(
      claimed,
    ); // Only after durable unknown CAS succeeds.
  }

  Future<VariantLedgerAttempt> reconcileLocal(
    VariantLocalResolution resolution,
  ) async {
    if (!allowSyntheticReconciliation) {
      throw UnsupportedError(
        'B1 não possui prova autoritativa. Resultado desconhecido permanece bloqueado.',
      );
    }
    return _mutate(resolution.original.operation, (record) {
      final entry = requireObject(
        requireObject(record['entries'])[resolution.original.requestId],
      );
      final attempt = _attempt(entry);
      if (attempt.intent.encoded != resolution.original.encoded) {
        throw StateError('Resultado pertence a outra intenção.');
      }
      final outcome = {
        'source': 'synthetic-b1',
        'status': resolution.status.name,
        'reason': resolution.reason,
        'replayed': resolution.replayed,
      };
      if (attempt.terminal) {
        if (attempt.status != resolution.status) {
          throw StateError('Resultado terminal incompatível.');
        }
        return attempt.requestId;
      }
      if (attempt.status == VariantIntentStatus.conflict) {
        if (_json(entry['outcome']) != _json(outcome)) {
          throw StateError('Resultado imutável ou conflito exige contrato B2.');
        }
        return attempt.requestId;
      }
      if (attempt.status != VariantIntentStatus.unknown) {
        throw StateError('Reconciliação exige intenção desconhecida.');
      }
      entry['status'] = resolution.status.name;
      entry['outcome'] = outcome;
      (record['entries'] as Map)[attempt.requestId] = entry;
      return attempt.requestId;
    });
  }

  Future<VariantLedgerAttempt> _mutate(
    String operation,
    String Function(Map<String, dynamic>) action,
  ) async {
    for (var retry = 0; retry < 20; retry++) {
      await _check(operation);
      final raw = await store.read(storageKey);
      final record = _decode(raw);
      final id = action(record);
      final next = _seal(record);
      await _check(operation);
      if (next == raw || await store.compareAndSet(storageKey, raw, next)) {
        await _check(operation);
        return _attempt(requireObject(record['entries'])[id] as Map);
      }
    }
    throw StateError('Concorrência excessiva. Intenção preservada.');
  }
}

class VariantDurablePreview {
  final VariantPreviewSession preview;
  final VariantIntentLedger ledger;
  VariantDurablePreview(this.preview, this.ledger);
  Future<VariantLedgerAttempt> persistPending(String intentKey) async {
    final intent = preview.pending;
    if (intent == null) throw StateError('Nenhuma intenção preparada.');
    return ledger.prepare(intentKey, intent);
  }

  Future<VariantLedgerAttempt?> restorePending() async {
    final attempts = await ledger.reopen();
    final active = attempts.where((a) => !a.terminal).toList();
    if (active.isEmpty) return null;
    final attempt = active.single;
    if (preview.pending == null) {
      preview.resume(attempt.intent);
    } else if (preview.pending!.encoded != attempt.intent.encoded) {
      throw StateError('Prévia possui outra intenção.');
    }
    return attempt;
  }
}
