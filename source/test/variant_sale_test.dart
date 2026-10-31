import 'dart:io';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/models/cart_item_model.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/services/variant_sale.dart';
import 'package:store_connect/services/android_checkout_cart.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/commercial_checkout_legacy_guard.dart';
import 'android_checkout_cart_test.dart' show TestAndroidOrigin;

class FailedAtomicWrite implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore inner;
  FailedAtomicWrite(this.inner);
  @override Future<String?> read(String key) => inner.read(key);
  @override Future<List<String>> keys(String prefix) => inner.keys(prefix);
  @override Future<bool> compareAndSet(String key, String? expected, String value) => inner.compareAndSet(key, expected, value);
  @override Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) => inner.readSnapshot(scope);
  @override Future<SaleAtomicCommit<T>> transact<T>(SaleAtomicScope scope, SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide) async =>
    throw const FileSystemException('Injected durable write failure');
  @override Future<void> close() => inner.close();
}
const scope = {'projectId': 'demo-f10', 'uid': 'u', 'storeId': 's'};
VariantSaleChoice choice(String id, {int price = 3990, int stock = 8, Map<String, dynamic> origin = scope, int epoch = 1}) =>
  VariantSaleChoice(scope: origin, productId: 'camiseta', variantId: id, name: 'Camiseta $id', unitPriceCents: price, availableQuantity: stock, epoch: epoch);
Product simple() => Product(id: 'simple', name: 'Simples', price: 10, quantidade: 5, minimumStock: 0);
void main() {
  test('schema 3 historical intent stays query-only on its original endpoint and payload', () async {
    final dir = Directory.systemTemp.createTempSync('f10-legacy-query-');
    final store = SqliteSaleMutationStore('${dir.path}/sale.sqlite');
    final calls = <String>[];
    Map<String, dynamic>? received;
    final access = VariantSaleAccess(store: store, scope: scope, currentScope: () async => scope,
      call: (endpoint, data) async { calls.add(endpoint); received = data;
        return {'status': 'not-recorded', 'definitive': false, 'saleId': data['saleId']}; });
    try {
      await access.prepare([VariantSaleLine(choice('a'), 1)], 'PIX', 'original');
      final before = (await store.read(access.key))!;
      final record = saleObject(jsonDecode(before))..remove('integrity');
      final command = saleObject(record['command']);
      command['schemaVersion'] = 3;
      command.remove('createdAtMs'); command.remove('deferred');
      record['command'] = command;
      final legacy = saleJson({...record, 'integrity': saleHash(record)});
      expect(await store.compareAndSet(access.key, before, legacy), isTrue);
      await access.consultOriginal();
      expect(calls, ['getVariantSaleResultV1']);
      expect(received, command);
      expect((await access.pending())!['command'], command);
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('query-only unknown/conflict preserves epoch, command and F9 lock after restart; no send', () async {
    final dir = Directory.systemTemp.createTempSync('f10-query-');
    final path = '${dir.path}/sale.sqlite';
    final calls = <String>[];
    var status = 'identity-conflict';
    Future<Map<String, dynamic>> call(String endpoint, Map<String, dynamic> data) async {
      calls.add(endpoint);
      return {'status': status, 'saleId': data['saleId'], if (status == 'not-recorded') 'definitive': false};
    }
    VariantSaleAccess open() => VariantSaleAccess(store: SqliteSaleMutationStore(path), scope: scope,
      currentScope: () async => scope, call: call);
    var access = open();
    try {
      await access.prepare([VariantSaleLine(choice('a'), 1)], 'PIX', 'original');
      final command = (await access.pending())!['command'];
      await access.consultOriginal();
      await access.close(); access = open(); status = 'not-recorded';
      await access.consultOriginal();
      final pending = (await access.pending())!;
      expect(pending['status'], 'identity-conflict'); expect(pending['command'], command);
      expect(pending['lastConsultation']['status'], 'not-recorded');
      await expectLater(access.acknowledge(), throwsStateError);
      await expectLater(access.prepare([VariantSaleLine(choice('b'), 1)], 'PIX', ''), throwsStateError);
      await expectLater(requireNoActiveCommercialCheckout('demo-f10', 's', borrowedStore: access.store), throwsStateError);
      final evidence = saleObject(jsonDecode(await access.recoveryEvidence()));
      final hash = evidence.remove('integrity'); expect(hash, saleHash(evidence));
      expect(evidence['authority'], 'local-only'); expect(evidence['record']['command'], command);
      expect(await access.store.keys('${access.key}:observation:'), hasLength(2));
      expect(command['schemaVersion'], 4);
      expect(calls, everyElement('getVariantCommercialResultV2'));
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('confirmed resolution archives evidence before unlock; next sale retains original proof', () async {
    final dir = Directory.systemTemp.createTempSync('f10-archive-');
    var status = 'not-recorded', total = 3990;
    final access = VariantSaleAccess(store: SqliteSaleMutationStore('${dir.path}/sale.sqlite'), scope: scope,
      currentScope: () async => scope, call: (_, data) async => {'status': status, 'saleId': data['saleId'],
        if (status == 'confirmed') 'totalCents': total});
    try {
      await access.prepare([VariantSaleLine(choice('a'), 1)], 'PIX', '');
      await access.consultOriginal(); expect((await access.pending())!['status'], 'unknown');
      await expectLater(access.acknowledge(), throwsStateError);
      status = 'confirmed'; total = 4000;
      await expectLater(access.consultOriginal(), throwsStateError);
      expect((await access.pending())!['status'], 'unknown');
      total = 3990; await access.consultOriginal();
      status = 'not-recorded'; await expectLater(access.consultOriginal(), throwsStateError);
      expect((await access.pending())!['status'], 'confirmed');
      await access.acknowledge(); expect(await access.pending(), isNull);
      final keys = await access.store.keys('${access.key}:resolved:'); expect(keys, hasLength(1));
      final archived = await access.store.read(keys.single);
      await access.prepare([VariantSaleLine(choice('b'), 1)], 'Dinheiro', 'next');
      expect(await access.store.read(keys.single), archived);
      expect(saleObject(jsonDecode(archived!))['result']['status'], 'confirmed');
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('acknowledged pointer from older app is archived before a new sale replaces it', () async {
    final dir = Directory.systemTemp.createTempSync('f10-old-proof-');
    final access = VariantSaleAccess(store: SqliteSaleMutationStore('${dir.path}/sale.sqlite'), scope: scope,
      currentScope: () async => scope, call: (_, data) async => {'status': 'rejected', 'saleId': data['saleId'], 'reason': 'price-conflict'});
    try {
      await access.prepare([VariantSaleLine(choice('a'), 1)], 'PIX', '');
      await access.consultOriginal(); await access.acknowledge();
      final raw = await access.store.read(access.key);
      // Separate empty store models the old app, which only retained pointer + lock.
      final oldStore = SqliteSaleMutationStore('${dir.path}/old.sqlite');
      final old = VariantSaleAccess(store: oldStore, scope: scope, currentScope: () async => scope,
        call: (_, data) async => throw StateError('No network expected'));
      try {
        await oldStore.compareAndSet(old.key, null, raw!);
        await oldStore.compareAndSet(old.family, null, (await access.store.read(access.family))!);
        await old.prepare([VariantSaleLine(choice('b'), 1)], 'Dinheiro', 'next');
        final archived = await oldStore.keys('${old.key}:resolved:'); expect(archived, hasLength(1));
        expect(await oldStore.read(archived.single), raw);
      } finally { await old.close(); }
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('query-only refuses changed actor and failed durable observation leaves lock active', () async {
    final dir = Directory.systemTemp.createTempSync('f10-query-fail-');
    var actor = scope, calls = 0;
    final store = SqliteSaleMutationStore('${dir.path}/sale.sqlite');
    final access = VariantSaleAccess(store: store, scope: scope, currentScope: () async => actor,
      call: (_, data) async { calls++; return {'status': 'rejected', 'saleId': data['saleId'], 'reason': 'price-conflict'}; });
    try {
      await access.prepare([VariantSaleLine(choice('a'), 1)], 'PIX', '');
      actor = {...scope, 'uid': 'other'}; await expectLater(access.consultOriginal(), throwsStateError);
      await expectLater(access.recoveryEvidence(), throwsStateError); expect(calls, 0); actor = scope;
      final failing = VariantSaleAccess(store: FailedAtomicWrite(store), scope: scope, currentScope: () async => scope,
        call: (_, data) async => {'status': 'rejected', 'saleId': data['saleId'], 'reason': 'price-conflict'});
      await expectLater(failing.consultOriginal(), throwsA(isA<FileSystemException>()));
      expect((await access.pending())!['status'], 'prepared');
      await expectLater(access.acknowledge(), throwsStateError);
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('same parent distinct variant tuples and quantities/subtotals never merge', () {
    final cart = CartProvider(); cart.addVariant(choice('Azul-M')); cart.addVariant(choice('Azul-M')); cart.addVariant(choice('Preto-G', price: 4290));
    expect(cart.itemCount, 2); expect(cart.variantItems.map((l) => l.quantity), [2, 1]);
    expect(cart.totalAmount, 122.7); expect(() => cart.items, throwsStateError);
    cart.removeVariant(choice('Azul-M').key); expect(cart.variantItems.first.quantity, 1);
    final revision = cart.revision; expect(cart.clearIfCurrent(revision), true); expect(cart.itemCount, 0); expect(cart.items, isEmpty);
  });
  test('mixed baskets preserve identities; changed price/epoch/operator and excess quantity are blocked', () {
    final cart = CartProvider(); cart.addItem(simple()); cart.addVariant(choice('a'));
    expect(cart.simpleItems.keys, ['simple']);
    expect(cart.variantItems.single.choice.variantId, 'a');
    expect(cart.totalAmount, 49.9);
    expect(() => cart.items, throwsStateError);
    cart.clear(); cart.addVariant(choice('a', stock: 1)); cart.addItem(simple());
    expect(cart.itemCount, 2);
    expect(cart.simpleItems.keys, ['simple']);
    expect(() => cart.addVariant(choice('a', stock: 1)), throwsStateError);
    expect(() => cart.addVariant(choice('a', price: 4990)), throwsStateError);
    expect(() => cart.addVariant(choice('b', epoch: 2)), throwsStateError);
    expect(() => cart.addVariant(choice('b', origin: {...scope, 'uid': 'other'})), throwsStateError);
  });
  test('historical variantId roundtrips and simple item keeps exact legacy JSON shape', () {
    final old = {'productId': 'p', 'name': 'Simple', 'quantity': 2, 'price': 10.0};
    expect(CartItem.fromMap(old).toMap(), old);
    final variant = {...old, 'variantId': 'blue-m'}; expect(CartItem.fromMap(variant).toMap(), variant);
  });
  test('SQLite atomic persistence failure prevents send and leaves family/intent absent', () async {
    final dir = Directory.systemTemp.createTempSync('f10-sale-fail-');
    final store = FailedAtomicWrite(SqliteSaleMutationStore('${dir.path}/sale.sqlite')); var calls = 0;
    final access = VariantSaleAccess(store: store, scope: scope, currentScope: () async => scope,
      call: (endpoint, data) async { calls++; return {}; });
    try {
      await expectLater(access.prepare([VariantSaleLine(choice('a'), 2)], 'Dinheiro', ''), throwsA(isA<FileSystemException>()));
      expect(await store.keys(''), isEmpty); await expectLater(access.recover(allowSend: true), throwsStateError); expect(calls, 0);
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('pending payload immutable, retry uses original payment and unknown cannot be acknowledged', () async {
    final dir = Directory.systemTemp.createTempSync('f10-sale-freeze-');
    final access = VariantSaleAccess(store: SqliteSaleMutationStore('${dir.path}/sale.sqlite'), scope: scope,
      currentScope: () async => scope, call: (endpoint, data) async => {'status': 'not-recorded', 'saleId': data['saleId'], 'definitive': false});
    try {
      final draft = [VariantSaleLine(choice('a'), 2)]; await access.prepare(draft, 'PIX', 'original'); draft.clear();
      final saved = await access.pending(); expect(saved!['command']['paymentMethod'], 'PIX'); expect(saved['command']['items'], hasLength(1));
      await expectLater(access.prepare([VariantSaleLine(choice('b'), 1)], 'Dinheiro', 'changed'), throwsStateError);
      await access.recover(); await expectLater(access.acknowledge(), throwsStateError);
      expect((await access.pending())!['command'], saved['command']);
    } finally { await access.close(); dir.deleteSync(recursive: true); }
  });
  test('existing V2 cannot start a simple sale while F10 owns the shared commercial lock', () async {
    final dir = Directory.systemTemp.createTempSync('f10-v2-lock-');
    final access = VariantSaleAccess(store: SqliteSaleMutationStore('${dir.path}/sale.sqlite'), scope: scope,
      currentScope: () async => scope, call: (endpoint, data) async => throw StateError('No network expected'));
    final origin = TestAndroidOrigin('demo-f10');
    final checkout = AndroidCheckoutCart(origin: origin, store: access.store);
    final cart = CartProvider()..addItem(simple());
    try {
      await access.prepare([VariantSaleLine(choice('a'), 1)], 'Dinheiro', '');
      await expectLater(checkout.submit(cart, 's', 'Dinheiro', ''), throwsStateError);
      expect(origin.sends, 0); expect((await access.pending())!['status'], 'prepared');
    } finally { checkout.close(); await access.close(); dir.deleteSync(recursive: true); }
  });
}
