import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'product_cadastral_edit.dart' show ProductCadastralEditAccess;
import 'product_mutation_api.dart';
import 'product_mutation_command.dart';
import 'product_mutation_ledger.dart';
import 'product_stock_draft.dart';
export 'product_stock_draft.dart';

// Explicit Emulator configuration and durable adapters are shared with B04.
// Neither flow installs a default runtime.
typedef ProductStockEditAccess = ProductCadastralEditAccess;
const stockOperation = 'adjustProductStockV1';

enum StockEditStatus {
  loading,
  editing,
  noChanges,
  validationError,
  persisting,
  sending,
  checking,
  confirmed,
  rejected,
  versionConflict,
  unknown,
  identityConflict,
  persistenceFailure,
  scopeChanged,
  readFailure,
  disabled,
}

class _ScopeChanged implements Exception {}

// One durable active-intent slot per scope/product serializes new intentions
// across dialogs/tabs. It complements B03; its separate prefix never appears
// in ProductMutationLedger.reopen(). A slot contains the frozen command so a
// crash between slot reservation and ledger.prepare cannot lose its identity.
class ProductStockEditSession extends ChangeNotifier {
  final ProductStockEditAccess access;
  final String productId;
  final String storeId;
  ProductMutationScope? _scope;
  ProductStockDraft? _draft;
  Map<String, dynamic>? _frozen;
  String? _slotRaw;
  ProductMutationAttempt? _attempt;
  final Map<String, String> _errors = {};
  late final StreamSubscription<ProductMutationScope?> _subscription;
  StockEditStatus status = StockEditStatus.loading;
  bool _busy = false;
  bool _disposed = false;
  ProductStockEditSession({
    required this.access,
    required this.productId,
    required this.storeId,
  }) {
    _subscription = access.scopeChanges.listen((current) {
      if (_scope != null && current?.prefix != _scope!.prefix) {
        _draft = null;
        _setStatus(StockEditStatus.scopeChanged);
      }
    });
  }
  ProductStockDraft? get draft => _draft;
  bool get busy => _busy;
  bool get canEdit =>
      !_busy &&
      _frozen == null &&
      _draft != null &&
      {
        StockEditStatus.editing,
        StockEditStatus.noChanges,
        StockEditStatus.validationError,
      }.contains(status);
  Map<String, dynamic>? get frozenCommand =>
      _frozen == null || status == StockEditStatus.scopeChanged
      ? null
      : requireObject(canonicalProductJson(_frozen));
  String? get requestId => _frozen?['requestId'] as String?;
  String? get rejectionReason =>
      _attempt?.outcome?['error']?['reason'] as String?;
  String? errorFor(String field) => _errors[field];
  String get _slotKey =>
      'b04-active-v1:${_scope!.prefix}${base64Url.encode(utf8.encode(productId))}';
  void _setStatus(StockEditStatus next) {
    if (_disposed) return;
    // An in-flight response may settle its original record, but may never
    // expose the old form/result or resume UI under another account.
    if (status == StockEditStatus.scopeChanged &&
        next != StockEditStatus.scopeChanged) {
      return;
    }
    status = next;
    notifyListeners();
  }

  Future<void> _checkScope() async {
    final active = await access.ledger.activeScope();
    if (_scope == null ||
        active?.prefix != _scope!.prefix ||
        status == StockEditStatus.scopeChanged) {
      throw _ScopeChanged();
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy || _disposed || status == StockEditStatus.scopeChanged) {
      return;
    }
    _busy = true;
    notifyListeners();
    try {
      await action();
    } on _ScopeChanged {
      _draft = null;
      _setStatus(StockEditStatus.scopeChanged);
    } on FormatException {
      _setStatus(StockEditStatus.persistenceFailure);
    } catch (_) {
      ProductMutationScope? current;
      try {
        current = await access.ledger.activeScope();
      } catch (_) {
        /* Suspend if the identity source is unavailable. */
      }
      if (_scope != null && current?.prefix != _scope!.prefix) {
        _draft = null;
        _setStatus(StockEditStatus.scopeChanged);
      } else {
        _setStatus(StockEditStatus.persistenceFailure);
      }
    } finally {
      _busy = false;
      if (!_disposed) notifyListeners();
    }
  }

  Map<String, dynamic> _slotCommand(String raw) {
    final slot = requireObject(jsonDecode(raw));
    final command = requireObject(slot['command']);
    if (slot['slotVersion'] != 1 ||
        slot['operation'] != stockOperation ||
        command['productId'] != productId ||
        productCanonicalJson(command['scope']) !=
            productCanonicalJson(_scope!.toJson()) ||
        slot['commandHash'] != productCommandHash(stockOperation, command) ||
        productCanonicalJson(
              normalizeProductCommand(stockOperation, command),
            ) !=
            productCanonicalJson(command)) {
      throw const FormatException(
        'Pendência de estoque corrompida ou operação cadastral incompatível.',
      );
    }
    return command;
  }

  String _encodeSlot(Map<String, dynamic> command) => productCanonicalJson({
    'slotVersion': 1,
    'operation': stockOperation,
    'command': command,
    'commandHash': productCommandHash(stockOperation, command),
  });
  Future<void> open() => _run(() async {
    if (!access.isLocalEnabled) {
      _setStatus(StockEditStatus.disabled);
      return;
    }
    final current = await access.ledger.activeScope();
    if (current == null ||
        current.projectId != access.projectId ||
        current.storeId != storeId) {
      throw _ScopeChanged();
    }
    if (_scope != null && _scope!.prefix != current.prefix) {
      throw _ScopeChanged();
    }
    _scope = current;
    _setStatus(StockEditStatus.loading);
    await _resumeOrRead();
  });
  Future<void> _resumeOrRead() async {
    await _checkScope();
    var raw = await access.ledger.store.read(_slotKey);
    // Validate the whole ledger before exposing a fresh intent. A corrupt
    // record must not disappear behind a seemingly empty product editor.
    final attempts = await access.ledger.reopen(_scope!);
    await _checkScope();
    if (attempts.any(
      (a) =>
          a.operation != stockOperation &&
          a.payload['productId'] == productId &&
          {
            ProductAttemptState.persisted,
            ProductAttemptState.sending,
            ProductAttemptState.unknown,
            ProductAttemptState.identityConflict,
          }.contains(a.state),
    )) {
      throw const FormatException('Conclua a pendência cadastral original.');
    }
    if (raw == null || raw == 'null') {
      final pending = attempts
          .where(
            (a) =>
                a.operation == stockOperation &&
                a.payload['productId'] == productId &&
                {
                  ProductAttemptState.persisted,
                  ProductAttemptState.sending,
                  ProductAttemptState.unknown,
                  ProductAttemptState.identityConflict,
                }.contains(a.state),
          )
          .toList();
      if (pending.length > 1) {
        throw const FormatException(
          'Múltiplas pendências exigem reconciliação.',
        );
      }
      if (pending.isNotEmpty) {
        final adopted = _encodeSlot(pending.single.payload);
        if (!await access.ledger.store.compareAndSet(_slotKey, raw, adopted)) {
          raw = await access.ledger.store.read(_slotKey);
        } else {
          raw = adopted;
        }
      }
    }
    if (raw != null && raw != 'null') {
      _slotRaw = raw;
      _frozen = _slotCommand(raw);
      await _prepareFrozen();
      await _recover();
    } else {
      _slotRaw = raw;
      await _readDraft();
    }
  }

  Future<void> _readDraft() async {
    await _checkScope();
    ProductEditState state;
    try {
      state = await access.readState(productId);
    } catch (_) {
      await _checkScope();
      _setStatus(StockEditStatus.readFailure);
      return;
    }
    await _checkScope();
    if (state.productId != productId ||
        state.storeId != _scope!.storeId ||
        state.uid != _scope!.uid) {
      throw _ScopeChanged();
    }
    _draft = ProductStockDraft(state);
    _errors.clear();
    _setStatus(StockEditStatus.editing);
  }

  void selectChange(
    Map<String, dynamic> change,
    String reason, {
    bool conversionConfirmed = false,
  }) {
    if (!canEdit) return;
    try {
      _draft!.select(change, conversionConfirmed: conversionConfirmed);
      _draft!.reason = reason.trim();
      _errors.clear();
    } on FormatException catch (e) {
      _errors['stock'] = e.message;
    }
    _setStatus(StockEditStatus.editing);
  }

  void manual(String intent, int value, String reason) {
    if (!canEdit) return;
    try {
      _draft!.manual(intent, value);
      _draft!.reason = reason.trim();
      _errors.clear();
    } on FormatException catch (e) {
      _errors['stock'] = e.message;
    }
    _setStatus(StockEditStatus.editing);
  }

  Future<void> _prepareFrozen() async {
    await _checkScope();
    _attempt = await access.ledger.prepare(_scope!, stockOperation, _frozen!);
  }

  Future<void> confirm() => _run(() async {
    await _checkScope();
    if (_frozen != null) {
      await _recover();
      return;
    }
    if (_draft == null) return;
    if (_errors.isNotEmpty) {
      _setStatus(StockEditStatus.validationError);
      return;
    }
    final changes = _draft!.change;
    if (_draft!.reason.isEmpty) {
      _errors['stock'] = 'Motivo obrigatório.';
      _setStatus(StockEditStatus.validationError);
      return;
    }
    if (changes == null) {
      _setStatus(StockEditStatus.noChanges);
      return;
    }
    _frozen = normalizeProductCommand(stockOperation, {
      'schemaVersion': 1,
      'requestId': ProductMutationLedger.newRequestId(),
      'productId': productId,
      'expectedUpdateTime': _draft!.baseline.expectedUpdateTime,
      'reason': _draft!.reason,
      'stockChange': changes,
      'scope': _scope!.toJson(),
    });
    _setStatus(StockEditStatus.persisting);
    final raw = await access.ledger.store.read(_slotKey);
    if (raw != null && raw != 'null') {
      _slotRaw = raw;
      _frozen = _slotCommand(raw);
      _draft = null;
      await _prepareFrozen();
      await _recover();
      return;
    }
    final reserved = _encodeSlot(_frozen!);
    if (!await access.ledger.store.compareAndSet(_slotKey, raw, reserved)) {
      final winner = await access.ledger.store.read(_slotKey);
      if (winner == null || winner == 'null') {
        throw StateError('Reserva local mudou.');
      }
      _slotRaw = winner;
      _frozen = _slotCommand(winner);
      _draft = null;
      await _prepareFrozen();
      await _recover();
      return;
    }
    _slotRaw = reserved;
    await _prepareFrozen();
    await _send();
  });
  void _applyAttempt() {
    final a = _attempt!;
    if (a.state == ProductAttemptState.confirmed) {
      final outcome = a.outcome;
      final result = outcome?['result'];
      if (outcome?['status'] != 'confirmed' ||
          result is! Map ||
          result['success'] != true ||
          result['productId'] != productId ||
          result['requestId'] != requestId) {
        throw const FormatException('Confirmação local incompatível.');
      }
      _setStatus(StockEditStatus.confirmed);
    } else if (a.state == ProductAttemptState.rejected) {
      final outcome = a.outcome;
      final error = outcome?['error'];
      if (outcome?['status'] != 'rejected' ||
          error is! Map ||
          error['code'] is! String ||
          error['reason'] is! String) {
        throw const FormatException('Rejeição local incompatível.');
      }
      final reason = a.outcome?['error']?['reason'];
      _setStatus(
        reason == 'product-version-conflict'
            ? StockEditStatus.versionConflict
            : StockEditStatus.rejected,
      );
    } else if (a.state == ProductAttemptState.identityConflict) {
      _setStatus(StockEditStatus.identityConflict);
    } else {
      _setStatus(StockEditStatus.unknown);
    }
  }

  Future<void> _recover() async {
    await _checkScope();
    _setStatus(StockEditStatus.checking);
    _attempt = await access.ledger.recover(_scope!, stockOperation, requestId!);
    await _checkScope();
    _applyAttempt();
  }

  Future<void> _send() async {
    await _checkScope();
    _setStatus(StockEditStatus.sending);
    _attempt = await access.ledger.send(_scope!, stockOperation, requestId!);
    await _checkScope();
    if (_attempt!.state == ProductAttemptState.unknown) {
      await _recover();
    } else {
      _applyAttempt();
    }
  }

  Future<void> checkResult() => _run(() async {
    await _checkScope();
    if (_frozen == null) {
      await _resumeOrRead();
      return;
    }
    // A failed CAS may have committed. Re-read the durable slot before any
    // retry; never manufacture an identity to escape a persistence failure.
    final raw = await access.ledger.store.read(_slotKey);
    if (raw == null || raw == 'null') {
      final encoded = _encodeSlot(_frozen!);
      if (!await access.ledger.store.compareAndSet(_slotKey, raw, encoded)) {
        throw StateError('Pendência local mudou.');
      }
      _slotRaw = encoded;
    } else {
      final stored = _slotCommand(raw);
      if (productCanonicalJson(stored) != productCanonicalJson(_frozen)) {
        _draft = null;
      }
      _slotRaw = raw;
      _frozen = stored;
    }
    await _prepareFrozen();
    await _recover();
  });
  Future<void> retrySameCommand() => _run(() async {
    if (_frozen == null || _attempt == null) return;
    await _recover();
    if (status == StockEditStatus.unknown &&
        _attempt!.state != ProductAttemptState.identityConflict) {
      await _send();
    }
  });
  Future<void> reviewCurrentState() => _run(() async {
    if (!{
      StockEditStatus.confirmed,
      StockEditStatus.rejected,
      StockEditStatus.versionConflict,
    }.contains(status)) {
      return;
    }
    await _checkScope();
    if (_slotRaw != null &&
        !await access.ledger.store.compareAndSet(_slotKey, _slotRaw, 'null')) {
      throw StateError('Pendência local mudou.');
    }
    _slotRaw = 'null';
    _frozen = null;
    _attempt = null;
    _draft = null;
    // A new DTO/baseline is loaded ONLY after the user's explicit review.
    // Previous changes are never automatically reapplied to the new version.
    await _resumeOrRead();
  });
  @override
  void dispose() {
    _disposed = true;
    _subscription.cancel();
    super.dispose();
  }
}
