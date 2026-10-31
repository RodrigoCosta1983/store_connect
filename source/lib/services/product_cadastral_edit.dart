import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_core/firebase_core.dart';
import '../data/local/product_mutation_store_factory.dart';
import 'product_mutation_api.dart';
import 'product_mutation_command.dart';
import 'product_mutation_ledger.dart';

const cadastralOperation = 'updateProductV2';
const cadastralFields = {
  'name',
  'price',
  'minimumStock',
  'imageUrl',
  'cod',
  'barcode',
  'costPrice',
};
const removableCadastralFields = {'cod', 'barcode', 'costPrice'};
const editableFiscalFields = [
  'ncm',
  'origem',
  'cfop',
  'unidade',
  'cest',
  'icmsSituacaoTributaria',
  'pisSituacaoTributaria',
  'cofinsSituacaoTributaria',
  'ibsCbsSituacaoTributaria',
  'ibsCbsClassificacaoTributaria',
];

// No remote flag, default app or automatic runtime is installed. HML/PROD
// remain forbidden even when enabled is explicitly supplied by a caller.
class ProductCadastralEditAccess {
  final bool enabled;
  final String projectId;
  final ProductMutationLedger ledger;
  final Future<ProductEditState> Function(String productId) readState;
  final Stream<ProductMutationScope?> scopeChanges;
  const ProductCadastralEditAccess({
    this.enabled = false,
    required this.projectId,
    required this.ledger,
    required this.readState,
    required this.scopeChanges,
  });
  bool get isLocalEnabled => enabled && projectId.startsWith('demo-');

  static Future<ProductCadastralEditAccess> forEmulator({
    required FirebaseApp app,
    required Future<ProductMutationScope?> Function() activeScope,
    required Stream<ProductMutationScope?> scopeChanges,
    String host = '127.0.0.1',
    int port = 5001,
  }) async {
    if (!app.options.projectId.startsWith('demo-') ||
        !{'localhost', '127.0.0.1', '10.0.2.2'}.contains(host)) {
      throw StateError(
        'B04 permitido somente em projeto demo e Emulator local.',
      );
    }
    FirebaseFunctions.instanceFor(app: app).useFunctionsEmulator(host, port);
    final api = ProductMutationApi(app: app);
    final store = await openProductMutationStore();
    return ProductCadastralEditAccess(
      enabled: true,
      projectId: app.options.projectId,
      ledger: ProductMutationLedger(
        store: store,
        transport: api,
        activeScope: activeScope,
      ),
      readState: api.getEditState,
      scopeChanges: scopeChanges,
    );
  }
}

// Only explicit user intents enter these maps. Rendering missing/null values
// as empty inputs does not synthesize changes or defaults.
class ProductCadastralDraft {
  final ProductEditState baseline;
  final Map<String, dynamic> _set = {};
  final Set<String> _remove = {};
  final Map<String, dynamic> _fiscalSet = {};
  final Set<String> _fiscalRemove = {};
  List<String>? _categories;
  ProductCadastralDraft(this.baseline);
  bool get fiscalLocked =>
      baseline.unavailable.contains('fiscal') ||
      (baseline.product.containsKey('fiscal') &&
          baseline.product['fiscal'] is! Map);
  bool get categoriesLocked {
    final p = baseline.product;
    if (baseline.unavailable.any(
      (f) => {'categoryIds', 'categoryId', 'categoryName'}.contains(f),
    )) {
      return true;
    }
    if (!p.containsKey('categoryIds')) return false;
    final ids = p['categoryIds'];
    return ids is! List ||
        ids.length > 10 ||
        ids.toSet().length != ids.length ||
        ids.any(
          (id) =>
              id is! String ||
              id.isEmpty ||
              id.trim() != id ||
              id.contains('/') ||
              id == '.' ||
              id == '..',
        );
  }

  List<String> get categoryIds {
    if (_categories != null) return List.of(_categories!);
    final p = baseline.product;
    if (categoriesLocked) return [];
    if (p.containsKey('categoryIds')) {
      return List<String>.from(p['categoryIds'] as List);
    }
    final legacy = p['categoryId'];
    return legacy is String &&
            legacy.isNotEmpty &&
            legacy.trim() == legacy &&
            !legacy.contains('/') &&
            legacy != '.' &&
            legacy != '..'
        ? [legacy]
        : [];
  }

  dynamic value(String field, {bool fiscal = false}) {
    if (fiscal) {
      if (_fiscalRemove.contains(field)) return null;
      if (_fiscalSet.containsKey(field)) return _fiscalSet[field];
      final map = baseline.product['fiscal'];
      return map is Map ? map[field] : null;
    }
    if (_remove.contains(field)) return null;
    return _set.containsKey(field) ? _set[field] : baseline.product[field];
  }

  String intent(String field, {bool fiscal = false}) =>
      (fiscal ? _fiscalRemove : _remove).contains(field)
      ? 'remove'
      : (fiscal ? _fiscalSet : _set).containsKey(field)
      ? ((fiscal ? _fiscalSet : _set)[field] == null ? 'null' : 'set')
      : 'preserve';
  void reset(String field, {bool fiscal = false}) {
    (fiscal ? _fiscalSet : _set).remove(field);
    (fiscal ? _fiscalRemove : _remove).remove(field);
  }

  void setField(String field, dynamic value, {bool fiscal = false}) {
    if (fiscal) {
      if (!editableFiscalFields.contains(field) || fiscalLocked) {
        throw const FormatException('Campo fiscal indisponível.');
      }
      if (value != null && value is! String) {
        throw const FormatException('Valor fiscal inválido.');
      }
      final before = baseline.product['fiscal'];
      reset(field, fiscal: true);
      if (before is Map &&
          before.containsKey(field) &&
          before[field] == value) {
        return;
      }
      _fiscalSet[field] = value;
      return;
    }
    if (!cadastralFields.contains(field)) {
      throw const FormatException('Campo fora do cadastro.');
    }
    if (field == 'cod' && baseline.product['isArchived'] == true) {
      throw const FormatException('COD arquivado é imutável.');
    }
    // Reuse the established command validator for field semantics, not a
    // whole-product serializer. This never includes stock/lots/internal fiscal.
    final normalized = normalizeProductCommand(cadastralOperation, {
      'schemaVersion': 2,
      'requestId': 'draft-validation',
      'productId': baseline.productId,
      'expectedUpdateTime': baseline.expectedUpdateTime,
      'changes': {
        'set': {field: value},
      },
    })['changes']['set'][field];
    reset(field);
    if (baseline.product.containsKey(field) &&
        baseline.product[field] == normalized) {
      return;
    }
    _set[field] = normalized;
  }

  void removeField(String field, {bool fiscal = false}) {
    if (fiscal) {
      if (!editableFiscalFields.contains(field) || fiscalLocked) {
        throw const FormatException('Campo fiscal indisponível.');
      }
      reset(field, fiscal: true);
      final before = baseline.product['fiscal'];
      if (before is Map && before.containsKey(field)) _fiscalRemove.add(field);
    } else {
      if (!removableCadastralFields.contains(field)) {
        throw const FormatException('Remoção não permitida.');
      }
      if (field == 'cod' && baseline.product['isArchived'] == true) {
        throw const FormatException('COD arquivado é imutável.');
      }
      reset(field);
      if (baseline.product.containsKey(field)) _remove.add(field);
    }
  }

  void selectCategories(List<String> ids) {
    if (categoriesLocked) {
      throw const FormatException('Taxonomia inválida; edição bloqueada.');
    }
    final normalized =
        normalizeProductCommand(cadastralOperation, {
              'schemaVersion': 2,
              'requestId': 'draft-validation',
              'productId': baseline.productId,
              'expectedUpdateTime': baseline.expectedUpdateTime,
              'changes': {
                'categories': {'ids': ids},
              },
            })['changes']['categories']['ids']
            as List;
    _categories = null;
    if (!listEquals(categoryIds, normalized)) {
      _categories = List<String>.from(normalized);
    }
  }

  Map<String, dynamic> get changes => requireObject(
    canonicalProductJson({
      if (_set.isNotEmpty) 'set': _set,
      if (_remove.isNotEmpty) 'remove': _remove.toList()..sort(),
      if (_fiscalSet.isNotEmpty || _fiscalRemove.isNotEmpty)
        'fiscal': {
          if (_fiscalSet.isNotEmpty) 'set': _fiscalSet,
          if (_fiscalRemove.isNotEmpty)
            'remove': _fiscalRemove.toList()..sort(),
        },
      if (_categories != null) 'categories': {'ids': _categories},
    }),
  );
}

enum CadastralEditStatus {
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
class ProductCadastralEditSession extends ChangeNotifier {
  final ProductCadastralEditAccess access;
  final String productId;
  final String storeId;
  final bool allowFiscal;
  ProductMutationScope? _scope;
  ProductCadastralDraft? _draft;
  Map<String, dynamic>? _frozen;
  String? _slotRaw;
  ProductMutationAttempt? _attempt;
  final Map<String, String> _errors = {};
  late final StreamSubscription<ProductMutationScope?> _subscription;
  CadastralEditStatus status = CadastralEditStatus.loading;
  bool _busy = false;
  bool _disposed = false;
  ProductCadastralEditSession({
    required this.access,
    required this.productId,
    required this.storeId,
    required this.allowFiscal,
  }) {
    _subscription = access.scopeChanges.listen((current) {
      if (_scope != null && current?.prefix != _scope!.prefix) {
        _draft = null;
        _setStatus(CadastralEditStatus.scopeChanged);
      }
    });
  }
  ProductCadastralDraft? get draft => _draft;
  bool get busy => _busy;
  bool get canEdit =>
      !_busy &&
      _frozen == null &&
      _draft != null &&
      {
        CadastralEditStatus.editing,
        CadastralEditStatus.noChanges,
        CadastralEditStatus.validationError,
      }.contains(status);
  Map<String, dynamic>? get frozenCommand =>
      _frozen == null || status == CadastralEditStatus.scopeChanged
      ? null
      : requireObject(canonicalProductJson(_frozen));
  String? get requestId => _frozen?['requestId'] as String?;
  String? get rejectionReason =>
      _attempt?.outcome?['error']?['reason'] as String?;
  String? errorFor(String field) => _errors[field];
  String get _slotKey =>
      'b04-active-v1:${_scope!.prefix}${base64Url.encode(utf8.encode(productId))}';
  void _setStatus(CadastralEditStatus next) {
    if (_disposed) return;
    // An in-flight response may settle its original record, but may never
    // expose the old form/result or resume UI under another account.
    if (status == CadastralEditStatus.scopeChanged &&
        next != CadastralEditStatus.scopeChanged) {
      return;
    }
    status = next;
    notifyListeners();
  }

  Future<void> _checkScope() async {
    final active = await access.ledger.activeScope();
    if (_scope == null ||
        active?.prefix != _scope!.prefix ||
        status == CadastralEditStatus.scopeChanged) {
      throw _ScopeChanged();
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy || _disposed || status == CadastralEditStatus.scopeChanged) {
      return;
    }
    _busy = true;
    notifyListeners();
    try {
      await action();
    } on _ScopeChanged {
      _draft = null;
      _setStatus(CadastralEditStatus.scopeChanged);
    } on FormatException {
      _setStatus(CadastralEditStatus.persistenceFailure);
    } catch (_) {
      ProductMutationScope? current;
      try {
        current = await access.ledger.activeScope();
      } catch (_) {
        /* Suspend if the identity source is unavailable. */
      }
      if (_scope != null && current?.prefix != _scope!.prefix) {
        _draft = null;
        _setStatus(CadastralEditStatus.scopeChanged);
      } else {
        _setStatus(CadastralEditStatus.persistenceFailure);
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
        slot['operation'] != cadastralOperation ||
        command['productId'] != productId ||
        productCanonicalJson(command['scope']) !=
            productCanonicalJson(_scope!.toJson()) ||
        slot['commandHash'] !=
            productCommandHash(cadastralOperation, command) ||
        productCanonicalJson(
              normalizeProductCommand(cadastralOperation, command),
            ) !=
            productCanonicalJson(command)) {
      throw const FormatException('Pendência cadastral corrompida.');
    }
    return command;
  }

  String _encodeSlot(Map<String, dynamic> command) => productCanonicalJson({
    'slotVersion': 1,
    'operation': cadastralOperation,
    'command': command,
    'commandHash': productCommandHash(cadastralOperation, command),
  });
  Future<void> open() => _run(() async {
    if (!access.isLocalEnabled) {
      _setStatus(CadastralEditStatus.disabled);
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
    _setStatus(CadastralEditStatus.loading);
    await _resumeOrRead();
  });
  Future<void> _resumeOrRead() async {
    await _checkScope();
    var raw = await access.ledger.store.read(_slotKey);
    // Validate the whole ledger before exposing a fresh intent. A corrupt
    // record must not disappear behind a seemingly empty product editor.
    final attempts = await access.ledger.reopen(_scope!);
    await _checkScope();
    if (attempts.any((a) => a.operation != cadastralOperation &&
        a.payload['productId'] == productId &&
        {ProductAttemptState.persisted, ProductAttemptState.sending,
         ProductAttemptState.unknown, ProductAttemptState.identityConflict}.contains(a.state))) {
      throw const FormatException('Conclua a pendência de estoque original.');
    }
    if (raw == null || raw == 'null') {
      final pending = attempts
          .where(
            (a) =>
                a.operation == cadastralOperation &&
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
      _setStatus(CadastralEditStatus.readFailure);
      return;
    }
    await _checkScope();
    if (state.productId != productId ||
        state.storeId != _scope!.storeId ||
        state.uid != _scope!.uid) {
      throw _ScopeChanged();
    }
    _draft = ProductCadastralDraft(state);
    _errors.clear();
    _setStatus(CadastralEditStatus.editing);
  }

  void setText(String field, String text, {bool fiscal = false}) {
    if (!canEdit || (fiscal && !allowFiscal)) return;
    final path = fiscal ? 'fiscal.$field' : field;
    try {
      dynamic value = text;
      if (!fiscal && {'price', 'costPrice', 'minimumStock'}.contains(field)) {
        value = field == 'minimumStock'
            ? int.tryParse(text)
            : double.tryParse(text.replaceAll(',', '.'));
      }
      _draft!.setField(field, value, fiscal: fiscal);
      _errors.remove(path);
    } on FormatException {
      _errors[path] = 'Valor inválido. Para excluir, use Remover.';
    }
    _setStatus(CadastralEditStatus.editing);
  }

  void fieldAction(String field, String action, {bool fiscal = false}) {
    if (!canEdit || (fiscal && !allowFiscal)) return;
    try {
      if (action == 'remove') {
        _draft!.removeField(field, fiscal: fiscal);
      } else if (action == 'null' && fiscal) {
        _draft!.setField(field, null, fiscal: true);
      } else if (action == 'reset') {
        _draft!.reset(field, fiscal: fiscal);
      } else {
        throw const FormatException('Ação inválida.');
      }
      _errors.remove(fiscal ? 'fiscal.$field' : field);
    } on FormatException {
      _errors[fiscal ? 'fiscal.$field' : field] = 'Ação indisponível.';
    }
    _setStatus(CadastralEditStatus.editing);
  }

  void selectCategories(List<String> ids) {
    if (!canEdit) return;
    try {
      _draft!.selectCategories(ids);
      _errors.remove('categories');
    } on FormatException {
      _errors['categories'] = 'Seleção de categorias inválida.';
    }
    _setStatus(CadastralEditStatus.editing);
  }

  Future<void> _prepareFrozen() async {
    await _checkScope();
    _attempt = await access.ledger.prepare(
      _scope!,
      cadastralOperation,
      _frozen!,
    );
  }

  Future<void> save() => _run(() async {
    await _checkScope();
    if (_frozen != null) {
      await _recover();
      return;
    }
    if (_draft == null) return;
    if (_errors.isNotEmpty) {
      _setStatus(CadastralEditStatus.validationError);
      return;
    }
    final changes = _draft!.changes;
    if (changes.isEmpty) {
      _setStatus(CadastralEditStatus.noChanges);
      return;
    }
    _frozen = normalizeProductCommand(cadastralOperation, {
      'schemaVersion': 2,
      'requestId': ProductMutationLedger.newRequestId(),
      'productId': productId,
      'expectedUpdateTime': _draft!.baseline.expectedUpdateTime,
      'changes': changes,
      'scope': _scope!.toJson(),
    });
    _setStatus(CadastralEditStatus.persisting);
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
      _setStatus(CadastralEditStatus.confirmed);
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
            ? CadastralEditStatus.versionConflict
            : CadastralEditStatus.rejected,
      );
    } else if (a.state == ProductAttemptState.identityConflict) {
      _setStatus(CadastralEditStatus.identityConflict);
    } else {
      _setStatus(CadastralEditStatus.unknown);
    }
  }

  Future<void> _recover() async {
    await _checkScope();
    _setStatus(CadastralEditStatus.checking);
    _attempt = await access.ledger.recover(
      _scope!,
      cadastralOperation,
      requestId!,
    );
    await _checkScope();
    _applyAttempt();
  }

  Future<void> _send() async {
    await _checkScope();
    _setStatus(CadastralEditStatus.sending);
    _attempt = await access.ledger.send(
      _scope!,
      cadastralOperation,
      requestId!,
    );
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
    if (status == CadastralEditStatus.unknown &&
        _attempt!.state != ProductAttemptState.identityConflict) {
      await _send();
    }
  });
  Future<void> reviewCurrentState() => _run(() async {
    if (!{
      CadastralEditStatus.confirmed,
      CadastralEditStatus.rejected,
      CadastralEditStatus.versionConflict,
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
