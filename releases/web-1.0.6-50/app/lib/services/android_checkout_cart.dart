import 'dart:convert';
import '../models/sale_payment_allocation.dart';
import 'package:flutter/foundation.dart';
import '../data/local/contextual_sale_mutation_store.dart';
import '../data/local/sale_mutation_store.dart';
import '../providers/cart_provider.dart';
import 'checkout_coordinator_ports.dart';
import 'checkout_sale_preparation.dart';
import 'sale_mutation_command.dart';
import 'sale_mutation_ledger.dart';
import 'commercial_checkout_legacy_guard.dart';

/// Implemented by the owned FlutterFire adapter. Test doubles belong in tests.
abstract class AndroidCheckoutOrigin extends ChangeNotifier
    implements CheckoutContextPort, SaleMutationTransport {
  bool get commercial => false;
  Future<CheckoutContextBinding> authorize();
  Future<Map<String, dynamic>> readStore();
}

class AndroidCartSale {
  final CheckoutAssociatedHandle handle;
  final CheckoutContextBinding _binding;
  final Object _revision;
  final CartProvider _cart;
  final AndroidCheckoutCart _owner;
  AndroidCartSale._(this.handle, this._binding, this._revision, this._cart, this._owner);
}

/// No Firebase defaults, database ownership, legacy fallback or new sale engine.
/// One durable cart slot is committed atomically WITH the existing association.
class AndroidCheckoutCart {
  final AndroidCheckoutOrigin origin;
  final AtomicSaleMutationStore store;
  CheckoutSaleSession? _session;
  Future<Object?>? _pending;
  bool _closed = false;
  AndroidCheckoutCart({required this.origin, required SaleMutationStore store})
      : store = requireAtomicSaleMutationStore(store) {
    origin.addListener(_invalidate);
  }
  void _invalidate() => _session?.change(null);
  Future<Map<String, dynamic>> readStore() => origin.readStore();

  /// Recovery after app reconstruction does not require retyping products or
  /// attaching the result to an unrelated current cart. No send/new ID here.
  Future<CheckoutAssociatedHandle?> recoverActive(String storeId) {
    if (_closed || _pending != null) throw StateError('Checkout indisponivel ou ocupado.');
    final operation = _recoverActive(storeId);
    _pending = operation;
    return operation.whenComplete(() {if (identical(_pending, operation)) _pending = null;});
  }
  Future<CheckoutAssociatedHandle?> _recoverActive(String storeId) async {
    final binding = await origin.authorize();
    void check() {
      if (_closed || !origin.isCurrent(binding) || binding.context.scope.storeId != storeId ||
          (!origin.commercial && !binding.context.scope.projectId.startsWith('demo-'))) {
        throw StateError('Contexto de recuperacao substituido.');
      }
    }
    check();
    final linked = _CartLinkedStore(store, binding.context, check);
    final session = CheckoutSaleSession(binding.context);
    _session = session;
    try {
      final saved = await linked.readLink();
      check();
      if (saved == null || saved['state'] != 'active') return null;
      final ref = CheckoutSaleReference(context: binding.context, intentKey: saved['intentKey'] as String);
      session.attach(ref);
      final preparation = CheckoutSalePreparation(store: linked, session: session,
        associatedLookup: origin.recover);
      var handle = await preparation.resumeAssociated(ref);
      check();
      if (handle.attempt.state == SaleAttemptState.unknown || handle.attempt.state == SaleAttemptState.sending) {
        handle = await preparation.consultAssociated(handle);
      }
      check();
      return handle;
    } finally {
      session.change(null);
      if (identical(_session, session)) _session = null;
    }
  }

  Map<String, dynamic> _draft(CartProvider cart, String payment, String notes, List<SalePaymentAllocation>? payments) {
    int cents(double value) {
      final scaled = value * 100;
      if (!scaled.isFinite || scaled < 0 || (scaled - scaled.round()).abs() > 0.000001) {
        throw const FormatException('Preco comercial exige centavos exatos.');
      }
      return saleInteger(scaled.round());
    }
    final items = cart.items.values.map((item) => {
      'productId': item.productId, 'quantity': item.quantity,
      'expectedUnitPriceCents': cents(item.price),
    }).toList();
    return {'items': items, 'expectedTotalCents': cents(cart.totalAmount),
      'paymentMethod': payment, 'notes': notes, 'customerId': cart.selectedCustomer?.id,
      if (payments != null) 'payments': validateSplitPayments(payments, cents(cart.totalAmount))
        .map((part) => part.toJson()).toList()};
  }

  Future<AndroidCartSale> submit(CartProvider cart, String storeId, String payment, String notes,
      {List<SalePaymentAllocation>? payments}) {
    if (_closed) throw StateError('Checkout fechado.');
    // A competing action must not inherit another payment/draft silently.
    if (_pending != null) throw StateError('A mesma intencao ainda esta em andamento.');
    final revision = cart.revision;
    final draft = _draft(cart, payment, notes, payments);
    final operation = _submit(cart, revision, storeId, draft);
    _pending = operation;
    return operation.whenComplete(() { if (identical(_pending, operation)) _pending = null; });
  }

  Future<AndroidCartSale> _submit(CartProvider cart, Object revision, String storeId,
      Map<String, dynamic> draft) async {
    final binding = await origin.authorize();
    void check() {
      if (_closed || !origin.isCurrent(binding) || !identical(cart.revision, revision) ||
          binding.context.scope.storeId != storeId) {
        throw StateError('Carrinho, usuario, loja ou sessao substituidos.');
      }
    }
    check();
    if (!origin.commercial && !binding.context.scope.projectId.startsWith('demo-')) throw StateError('Somente Emulator.');
    // Check only the deferred family: this checkout may own an active V2 pointer.
    for (final key in await store.keys('checkout-v1:fiado-create-v1:')) {
      if (!key.endsWith(':active')) continue;
      final raw = await store.read(key);
      if (raw == null) throw StateError('Referência de fiado indisponível.');
      final record = saleObject(jsonDecode(raw));
      final hash = record.remove('integrity');
      if (hash != saleHash(record)) throw StateError('Referência de fiado inválida.');
      final scope = saleObject(record['scope']);
      if (scope['projectId'] == binding.context.scope.projectId && scope['storeId'] == storeId && record['state'] == 'active') {
        throw StateError('Fiado pendente. Consulte antes de outra venda.');
      }
    }
    check();
    final linked = _CartLinkedStore(store, binding.context, check);
    final session = CheckoutSaleSession(binding.context);
    _session = session;
    void changed() => session.change(null);
    cart.addListener(changed);
    final preparation = CheckoutSalePreparation(store: linked, session: session,
      associatedLocalSend: origin.send, associatedLookup: origin.recover);
    try {
      final saved = await linked.readLink();
      check();
      CheckoutAssociatedHandle handle;
      if (saved != null && saved['state'] == 'active') {
        final ref = CheckoutSaleReference(context: binding.context, intentKey: saved['intentKey'] as String);
        session.attach(ref);
        // Existing association/ledger compare the exact frozen intent. A changed
        // draft persists conflict evidence, never overwrites or sends a new sale.
        handle = await preparation.persistAssociated(
          preparation.candidateForAssociatedIntention(ref, draft));
      } else {
        handle = await preparation.persistAssociated(preparation.newAssociatedPurchase(draft));
      }
      check();
      handle = origin.commercial
        ? await preparation.dispatchAssociatedCommercially(handle)
        : await preparation.dispatchAssociatedLocally(handle);
      check();
      return AndroidCartSale._(handle, binding, revision, cart, this);
    } finally {
      cart.removeListener(changed);
      session.change(null);
      if (identical(_session, session)) _session = null;
    }
  }

  /// Confirmation applies only to the captured cart and SDK generation. A crash
  /// between clear and completion leaves a conservative recoverable slot.
  Future<bool> applyConfirmed(AndroidCartSale sale) async {
    if (_closed || !identical(sale._owner, this) || !origin.isCurrent(sale._binding) ||
        sale.handle.attempt.state != SaleAttemptState.confirmed ||
        !identical(sale._cart.revision, sale._revision)) {
      return false;
    }
    if (!sale._cart.clearIfCurrent(sale._revision) || !origin.isCurrent(sale._binding)) {
      return false;
    }
    final clearedRevision = sale._cart.revision;
    final linked = _CartLinkedStore(store, sale._binding.context, () {});
    await linked.complete(sale.handle.reference.intentKey);
    return !_closed && origin.isCurrent(sale._binding) && identical(sale._cart.revision, clearedRevision);
  }

  /// Explicit review of a terminal recovered receipt, never financial cancellation.
  /// Leaves the current cart untouched; unknown/conflict cannot free the slot.
  Future<void> acknowledgeRecovered(CheckoutAssociatedHandle handle) {
    if (_closed || _pending != null) throw StateError('Checkout ocupado.');
    final operation = _acknowledgeRecovered(handle).then<Object?>((_) => null);
    _pending = operation;
    return operation.then<void>((_) {}).whenComplete(() {
      if (identical(_pending, operation)) _pending = null;
    });
  }

  Future<void> _acknowledgeRecovered(CheckoutAssociatedHandle handle) async {
    final binding = await origin.authorize();
    void check() {
      if (_closed || !origin.isCurrent(binding) || !binding.context.same(handle.reference.context)) {
        throw StateError('Revisao de outra sessao.');
      }
    }
    check();
    final linked = _CartLinkedStore(store, binding.context, check);
    final session = CheckoutSaleSession(binding.context)..attach(handle.reference);
    try {
      final current = await CheckoutSalePreparation(store: linked, session: session)
        .resumeAssociated(handle.reference);
      check();
      if (![SaleAttemptState.confirmed, SaleAttemptState.rejected].contains(current.attempt.state)) {
        throw StateError('Resultado ainda nao terminal.');
      }
      await linked.complete(handle.reference.intentKey);
      check();
    } finally {session.change(null);}
  }

  void close() {
    if (_closed) return;
    _closed = true;
    _invalidate();
    origin.removeListener(_invalidate);
  }
}

class _CartLinkedStore implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore inner;
  final CheckoutSaleContext context;
  final void Function() check;
  late final String prefix = '${SaleStoreContext(scope: context.scope, target: context.target).targetPrefix}${context.scope.prefix}';
  late final String linkKey = '${prefix}android-active-cart';
  late final String familyKey = commercialSaleFamilyKey(context.scope.projectId,context.scope.storeId);
  _CartLinkedStore(this.inner, this.context, this.check);
  Map<String, dynamic> _decode(String raw) {
    final value = saleObject(jsonDecode(raw));
    final hash = value.remove('integrity');
    if (hash != saleHash(value) || value['schemaVersion'] != 1 ||
        value['target'] != context.target || saleJson(value['scope']) != saleJson(context.scope.toJson()) ||
        !['active', 'completed'].contains(value['state'])) {
      throw const FormatException('Referencia do carrinho invalida.');
    }
    saleId(value['intentKey']);
    return value;
  }
  String _encode(String intent, String state) {
    final value = {'schemaVersion': 1, 'scope': context.scope.toJson(),
      'target': context.target, 'intentKey': intent, 'state': state};
    return saleJson({...value, 'integrity': saleHash(value)});
  }
  Future<Map<String, dynamic>?> readLink() async {
    check();
    final raw = await inner.read(linkKey);
    check();
    return raw == null ? null : _decode(raw);
  }
  Future<void> complete(String intent) async {
    check();
    await inner.transact<void>(SaleAtomicScope(namespace:'checkout-v1:',keys:[linkKey,familyKey]),(snapshot){
      check();final raw=snapshot.values[linkKey];
      if(raw==null || _decode(raw)['intentKey']!=intent)throw StateError('Referencia substituida.');
      final family=readCommercialSaleFamily(snapshot.values[familyKey]);
      if(family!=null && family['state']=='active' &&
        (family['kind']!='instant' || family['identity']!=intent || family['reference']!=linkKey)) {
        throw StateError('Outra intenção comercial está ativa.');
      }
      return SaleAtomicPlan(writes:{linkKey:_encode(intent,'completed'),
        familyKey:sealCommercialSaleFamily(context.scope.toJson(),'instant',intent,linkKey,'idle')},value:null);
    });
    check();
  }
  @override
  Future<SaleAtomicCommit<T>> transact<T>(SaleAtomicScope scope, SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide) async {
    check();
    if (scope.namespace != prefix) throw StateError('Namespace do carrinho divergente.');
    late SaleAtomicPlan<T> visiblePlan;
    final result = await inner.transact<T>(SaleAtomicScope(namespace: 'checkout-v1:', keys: {...scope.keys, linkKey,familyKey}), (snapshot) {
      check();
      final plan = decide(SaleAtomicSnapshot({for (final key in scope.keys) key: snapshot.values[key]}));
      visiblePlan=plan;
      scope.validate(plan);
      final writes = {...plan.writes};
      for (final entry in plan.writes.entries) {
        if (entry.key.startsWith('${prefix}checkout-binding:') && snapshot.values[entry.key] == null) {
          final binding = saleObject(jsonDecode(entry.value));
          final intent = saleId(binding['intentKey']);
          final old = snapshot.values[linkKey];
          if (old != null && _decode(old)['state'] == 'active' && _decode(old)['intentKey'] != intent) {
            throw StateError('Carrinho ja possui intencao duravel; retome a referencia original.');
          }
          final family=readCommercialSaleFamily(snapshot.values[familyKey]);
          if(family!=null && family['state']=='active' &&
            (family['kind']!='instant' || family['identity']!=intent || family['reference']!=linkKey)) {
            throw StateError('Outra intenção comercial está ativa. Consulte o resultado.');
          }
          writes[linkKey] = _encode(intent, 'active');
          writes[familyKey]=sealCommercialSaleFamily(context.scope.toJson(),'instant',intent,linkKey,'active');
        }
      }
      return SaleAtomicPlan(writes: writes, value: plan.value);
    });
    check();
    // Keep the caller's contextual namespace intact; the shared lock is private
    // to this composition adapter and must not escape through target unwrapping.
    return SaleAtomicCommit<T>(SaleAtomicSnapshot({
      for(final key in scope.keys)key:result.before.values[key]}),visiblePlan);
  }
  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) => inner.readSnapshot(scope);
  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) => inner.compareAndSet(key, expected, value);
  @override
  Future<void> close() async => throw StateError('Armazenamento emprestado.');
}
