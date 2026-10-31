import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/data/local/contextual_sale_mutation_store.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_coordinator_preparation_adapter.dart';
import 'package:store_connect/services/checkout_intention_reader.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'checkout_coordinator_fakes.dart';
import 'checkout_sale_preparation_cases.dart'
    show checkoutContext, checkoutDraft;
import 'sale_association_cases.dart' show AssociationLegacyStore;

/// Real backend beneath; any attempt at mutation/direct load is a test failure.
class EnumerationReadOnlyStore implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore inner;
  int writes = 0, snapshots = 0;
  int? failSnapshot;
  bool failKeys = false;
  final prefixes = <String>[];
  Future<void> Function(List<String>)? afterKeys;
  Future<void> Function(int, SaleAtomicSnapshot)? afterSnapshot;
  EnumerationReadOnlyStore(this.inner);
  @override
  Future<List<String>> keys(String prefix) async {
    prefixes.add(prefix);
    if (failKeys) throw StateError('Synthetic unavailable storage');
    final result = await inner.keys(prefix);
    await afterKeys?.call(result);
    return result;
  }

  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) async {
    snapshots++;
    if (snapshots == failSnapshot) throw StateError('Synthetic read failure');
    final result = await inner.readSnapshot(scope);
    await afterSnapshot?.call(snapshots, result);
    return result;
  }

  @override
  Future<String?> read(String key) =>
      throw StateError('Enumeration must use snapshots');
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) {
    writes++;
    throw StateError('Mutation forbidden');
  }

  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) {
    writes++;
    throw StateError('Mutation transaction forbidden');
  }

  @override
  Future<void> close() => throw StateError('Borrowed store');
}

void checkoutIntentionReaderCases(
  Future<AtomicSaleMutationStore> Function(String name) open, {
  required Future<void> Function(String name, String key)
  deleteTemporaryEvidence,
}) {
  late String name;
  late AtomicSaleMutationStore raw;
  late EnumerationReadOnlyStore readonly;
  late CoordinatorContextFake context;
  late CheckoutIntentionGeneration generation;
  late CheckoutIntentionReader reader;
  setUp(() async {
    name = SaleMutationCommand.newIdentity();
    raw = await open(name);
    readonly = EnumerationReadOnlyStore(raw);
    context = CoordinatorContextFake();
    generation = CheckoutIntentionGeneration();
    reader = CheckoutIntentionReader(
      store: readonly,
      context: context,
      generation: generation,
    );
  });
  tearDown(() async {
    expect(readonly.writes, 0);
    await raw.close();
  });
  Future<Map<String, String>> records() async => {
    for (final key in await raw.keys('')) key: (await raw.read(key))!,
  };
  Future<CheckoutSaleReference> seed({
    bool legacy = false,
    CheckoutSaleContext? origin,
  }) async {
    final prep = CheckoutSalePreparation(
      store: raw,
      session: CheckoutSaleSession(origin ?? context.binding!.context),
    );
    return legacy
        ? (await prep.persist(prep.newPurchase(checkoutDraft()))).reference
        : (await prep.persistAssociated(
            prep.newAssociatedPurchase(checkoutDraft()),
          )).reference;
  }

  Set<CheckoutIntentionCategory> categories(CheckoutIntentionScan result) =>
      result.entries.expand((e) => e.categories).toSet();
  Future<void> modify(
    String key,
    Map<String, dynamic> changes, {
    bool reseal = true,
  }) async {
    final original = (await raw.read(key))!;
    final record = saleObject(jsonDecode(original));
    final hashField = record.containsKey('ledgerVersion')
        ? 'recordHash'
        : 'integrity';
    record.remove(hashField);
    record.addAll(changes);
    await raw.compareAndSet(
      key,
      original,
      saleJson({...record, hashField: reseal ? saleHash(record) : 'invalid'}),
    );
  }

  String keyFor(
    Map<String, String> map,
    CheckoutSaleReference ref,
    String kind,
  ) => map.keys.singleWhere(
    (k) =>
        k.contains(kind) &&
        saleObject(jsonDecode(map[k]!))['intentKey'] == ref.intentKey,
  );

  test(
    'multiple V2 intentions classify consistently with zero byte changes or dispatch',
    () async {
      for (var i = 0; i < 4; i++) {
        await seed();
      }
      final before = await records();
      final result = await reader.scan();
      expect(result.status, CheckoutIntentionScanStatus.complete);
      expect(result.entries, hasLength(4));
      expect(
        result.entries.every(
          (e) =>
              e.categories.single == CheckoutIntentionCategory.v2Recoverable &&
              e.canSelectV2,
        ),
        true,
      );
      expect(result.isGlobalSnapshot, false);
      expect(await records(), before);
    },
  );

  test(
    'V1 historical remains separated from V2; V1 cannot be selected for associated recovery',
    () async {
      await seed(legacy: true);
      await seed();
      final before = await records();
      final result = await reader.scan();
      expect(result.entries, hasLength(2));
      expect(
        categories(result),
        containsAll([
          CheckoutIntentionCategory.v1Historical,
          CheckoutIntentionCategory.v2Recoverable,
        ]),
      );
      final old = result.entries.singleWhere((e) => e.metadataVersion == 1);
      await expectLater(
        reader.selectV2(result, old),
        throwsA(isA<CheckoutIntentionSelectionBlocked>()),
      );
      expect(await records(), before);
    },
  );

  for (final origin in [
    checkoutContext(store: 'other'),
    checkoutContext(uid: 'other'),
    checkoutContext(project: 'other'),
    checkoutContext(endpoint: 'other:8080'),
    CheckoutSaleContext(
      scope: checkoutContext().scope,
      environment: 'synthetic-prod',
      firestoreEndpoint: 'prod.synthetic',
      functionsEndpoint: 'prod.synthetic',
    ),
  ]) {
    test(
      'only captured namespace read, foreign ${origin.scope.prefix}/${origin.target} hidden',
      () async {
        final own = await seed();
        await seed(origin: origin);
        final before = await records();
        final result = await reader.scan(expectedBinding: context.binding);
        expect(result.entries, hasLength(1));
        expect(result.entries.single.reference!.intentKey, own.intentKey);
        expect(readonly.prefixes, hasLength(1));
        expect(
          readonly.prefixes.single,
          contains(context.binding!.context.scope.prefix),
        );
        expect(await records(), before);
      },
    );
  }

  test(
    'explicit incompatible binding refused before any backend operation',
    () async {
      final wrong = CheckoutContextBinding(
        checkoutContext(uid: 'other'),
        Object(),
      );
      final result = await reader.scan(expectedBinding: wrong);
      expect(result.status, CheckoutIntentionScanStatus.contextInvalid);
      expect(readonly.prefixes, isEmpty);
      expect(readonly.snapshots, 0);
    },
  );

  for (final state in ['sending', 'unknown']) {
    test(
      '$state state/claim/lease/timestamps preserved exactly and selectable only for local recovery',
      () async {
        final ref = await seed();
        final map = await records();
        await modify(keyFor(map, ref, 'confirmSaleV2:'), {
          'state': state,
          'prepared': true,
          'claim': 'existing-writer',
          'leaseUntilMs': 999999999,
          'attempts': 7,
          'updatedAtMs': 12345,
        });
        final before = await records();
        final result = await reader.scan();
        expect(
          result.entries.single.categories,
          contains(CheckoutIntentionCategory.v2Unknown),
        );
        expect(result.entries.single.localState!.name, state);
        expect(result.entries.single.canSelectV2, true);
        expect(await records(), before);
      },
    );
  }

  for (final missing in [
    'checkout-binding:',
    'confirmSaleV2:',
    'checkout-candidate:',
  ]) {
    test(
      'V2 absent $missing remains explicitly blocked and never repaired',
      () async {
        final ref = await seed();
        final initial = await records();
        await deleteTemporaryEvidence(name, keyFor(initial, ref, missing));
        final before = await records();
        final result = await reader.scan();
        expect(result.entries.any((e) => e.canSelectV2), false);
        final expected = missing == 'checkout-binding:'
            ? CheckoutIntentionCategory.canonicalWithoutAssociation
            : missing == 'confirmSaleV2:'
            ? CheckoutIntentionCategory.bindingWithoutLedger
            : CheckoutIntentionCategory.missingCandidate;
        expect(categories(result), contains(expected));
        expect(await records(), before);
      },
    );
  }

  test(
    'candidate alone is orphan, never a recoverable or confirmed sale',
    () async {
      final ref = await seed();
      final initial = await records();
      for (final kind in ['checkout-binding:', 'confirmSaleV2:']) {
        await deleteTemporaryEvidence(name, keyFor(initial, ref, kind));
      }
      final before = await records();
      final result = await reader.scan();
      expect(categories(result), {CheckoutIntentionCategory.orphanCandidate});
      expect(result.entries.single.canSelectV2, false);
      expect(await records(), before);
    },
  );

  test(
    'V1 binding gap remains historical blocked without generating an ID',
    () async {
      final ref = await seed(legacy: true);
      final initial = await records();
      await deleteTemporaryEvidence(
        name,
        keyFor(initial, ref, 'confirmSaleV2:'),
      );
      final before = await records();
      final result = await reader.scan();
      expect(
        categories(result),
        containsAll([
          CheckoutIntentionCategory.v1HistoricalGap,
          CheckoutIntentionCategory.bindingWithoutLedger,
        ]),
      );
      expect(await records(), before);
    },
  );

  for (final corruption in [
    'json',
    'canonicalHash',
    'bindingHash',
    'pointer',
    'candidateHash',
  ]) {
    test(
      'corrupt $corruption classified without exposing command or repairing',
      () async {
        final ref = await seed();
        final initial = await records();
        if (corruption == 'json') {
          final key = keyFor(initial, ref, 'checkout-candidate:');
          await raw.compareAndSet(key, initial[key], '{not-json');
        } else if (corruption == 'pointer') {
          await modify(keyFor(initial, ref, 'checkout-binding:'), {
            'ledgerKey': 'outside:scope:never-read',
          });
        } else {
          final kind = corruption == 'canonicalHash'
              ? 'confirmSaleV2:'
              : corruption == 'bindingHash'
              ? 'checkout-binding:'
              : 'checkout-candidate:';
          await modify(keyFor(initial, ref, kind), {}, reseal: false);
        }
        final before = await records();
        final result = await reader.scan();
        expect(
          categories(result),
          contains(CheckoutIntentionCategory.corruptedMetadata),
        );
        expect(result.entries.any((e) => e.canSelectV2), false);
        expect(await records(), before);
      },
    );
  }

  test(
    'unknown metadata version is not reinterpreted or automatically migrated',
    () async {
      final ref = await seed();
      final initial = await records();
      await modify(keyFor(initial, ref, 'checkout-binding:'), {'version': 99});
      final before = await records();
      final result = await reader.scan();
      expect(
        categories(result),
        contains(CheckoutIntentionCategory.unknownVersion),
      );
      expect(result.entries.any((e) => e.canSelectV2), false);
      expect(await records(), before);
    },
  );

  test(
    'foreign envelope misplaced in authorized namespace exposes no foreign identifiers',
    () async {
      final ref = await seed();
      final initial = await records();
      await modify(keyFor(initial, ref, 'checkout-binding:'), {
        'scope': {
          'projectId': 'foreign-secret',
          'storeId': 'secret-store',
          'uid': 'secret-user',
        },
      });
      final before = await records();
      final result = await reader.scan();
      expect(
        categories(result),
        contains(CheckoutIntentionCategory.contextMismatch),
      );
      expect(result.entries.every((e) => e.reference == null), true);
      expect(await records(), before);
    },
  );

  for (final phase in ['keys', 'snapshot']) {
    test(
      'record disappears after $phase: changed reference/partial result, no repair',
      () async {
        final ref = await seed();
        final initial = await records();
        final key = keyFor(initial, ref, 'confirmSaleV2:');
        if (phase == 'keys') {
          readonly.afterKeys = (_) => deleteTemporaryEvidence(name, key);
        } else {
          readonly.afterSnapshot = (n, _) async {
            if (n == 1) await deleteTemporaryEvidence(name, key);
          };
        }
        final result = await reader.scan();
        expect(result.status, CheckoutIntentionScanStatus.partial);
        expect(
          categories(result),
          contains(CheckoutIntentionCategory.referenceChanged),
        );
        expect(await raw.read(key), isNull);
        expect(readonly.writes, 0);
      },
    );
  }

  for (final phase in ['keys', 'snapshot', 'entry']) {
    test(
      'ABA after $phase invalidates entire scan including already observed entries',
      () async {
        await seed();
        final before = await records();
        final original = context.binding!;
        void aba() {
          generation.invalidate();
          context.binding = CheckoutContextBinding(
            checkoutContext(uid: 'b'),
            Object(),
          );
          generation.invalidate();
          context.binding = original;
        }

        if (phase == 'keys') {
          readonly.afterKeys = (_) async => aba();
        } else {
          readonly.afterSnapshot = (n, _) async {
            if (n == (phase == 'entry' ? 2 : 1)) aba();
          };
        }
        final result = await reader.scan();
        expect(result.status, CheckoutIntentionScanStatus.contextInvalid);
        expect(result.entries, isEmpty);
        expect(await records(), before);
      },
    );
  }

  test(
    'previous results and selection are invalidated on generation change',
    () async {
      await seed();
      final result = await reader.scan();
      final item = result.entries.single;
      final selected = await reader.selectV2(result, item);
      expect(selected.reference.intentKey, item.reference!.intentKey);
      generation.invalidate();
      expect(result.status, CheckoutIntentionScanStatus.contextInvalid);
      expect(result.entries, isEmpty);
      expect(() => selected.reference, throwsA(anything));
      await expectLater(
        reader.selectV2(result, item),
        throwsA(isA<CheckoutIntentionSelectionBlocked>()),
      );
    },
  );

  test(
    'empty observation differs from unavailable storage and never proves remote absence',
    () async {
      final empty = await reader.scan();
      expect(empty.isEmptyObservation, true);
      expect(empty.isGlobalSnapshot, false);
      readonly.failKeys = true;
      final unavailable = await reader.scan();
      expect(unavailable.status, CheckoutIntentionScanStatus.unavailable);
      expect(unavailable.isEmptyObservation, false);
      expect(
        unavailable.issues,
        contains(CheckoutIntentionCategory.storageUnavailable),
      );
    },
  );

  test(
    'closed real storage reports unavailable, not empty or a new intention',
    () async {
      final closed = await open(SaleMutationCommand.newIdentity());
      await closed.close();
      final result = await CheckoutIntentionReader(
        store: closed,
        context: context,
        generation: generation,
      ).scan();
      expect(result.status, CheckoutIntentionScanStatus.unavailable);
      expect(result.isEmptyObservation, false);
    },
  );

  test(
    'store without snapshot capability fails safely before any partial read/write',
    () async {
      final result = await CheckoutIntentionReader(
        store: AssociationLegacyStore(),
        context: context,
        generation: generation,
      ).scan();
      expect(result.status, CheckoutIntentionScanStatus.unavailable);
      expect(result.entries, isEmpty);
    },
  );

  test(
    'key and entry limits produce bounded partial discovery, never a complete empty result',
    () async {
      for (var i = 0; i < 3; i++) {
        await seed();
      }
      final before = await records();
      final byKeys = await reader.scan(
        limits: CheckoutIntentionLimits(maxKeys: 2),
      );
      expect(byKeys.status, CheckoutIntentionScanStatus.partial);
      expect(byKeys.inspectedKeys, lessThanOrEqualTo(2));
      final byEntries = await reader.scan(
        limits: CheckoutIntentionLimits(maxEntries: 1),
      );
      expect(byEntries.status, CheckoutIntentionScanStatus.partial);
      expect(byEntries.entries.length, lessThanOrEqualTo(1));
      expect(await records(), before);
    },
  );

  test(
    'elapsed budget after key discovery returns partial, not fabricated completeness',
    () async {
      await seed();
      readonly.afterKeys = (_) =>
          Future<void>.delayed(const Duration(milliseconds: 3));
      final result = await reader.scan(
        limits: CheckoutIntentionLimits(
          budget: const Duration(milliseconds: 1),
        ),
      );
      expect(result.status, CheckoutIntentionScanStatus.partial);
      expect(result.isEmptyObservation, false);
    },
  );

  test(
    'failure after a classified entry preserves typed partial result and error',
    () async {
      await seed();
      await seed();
      readonly.failSnapshot = 3;
      final before = await records();
      final result = await reader.scan();
      expect(result.status, CheckoutIntentionScanStatus.partial);
      expect(result.entries, hasLength(1));
      expect(
        result.issues,
        containsAll([
          CheckoutIntentionCategory.storageUnavailable,
          CheckoutIntentionCategory.enumerationPartial,
        ]),
      );
      expect(await records(), before);
    },
  );

  test(
    'explicit selection revalidates bytes before B1 resume and keeps same canonical ID',
    () async {
      final ref = await seed();
      final before = await records();
      final result = await reader.scan();
      final selected = await reader.selectV2(result, result.entries.single);
      expect(
        await records(),
        before,
      ); // Listing/selection did not prepare or write.
      final adapter = AssociatedCheckoutCoordinatorAdapter(raw);
      final h = CoordinatorHarness(adapter, adapter);
      try {
        final loaded = await h.coordinator.resume(selected.reference);
        final record = saleObject(
          jsonDecode(before[keyFor(before, ref, 'confirmSaleV2:')]!),
        );
        expect(loaded.evidence!.requestId, record['requestId']);
        expect(await records(), before);
      } finally {
        h.coordinator.dispose();
      }
    },
  );

  test(
    'selection rejects changed state without mutating or silently adopting stale entry',
    () async {
      final ref = await seed();
      final result = await reader.scan();
      final initial = await records();
      await modify(keyFor(initial, ref, 'confirmSaleV2:'), {
        'state': 'unknown',
      });
      final before = await records();
      await expectLater(
        reader.selectV2(result, result.entries.single),
        throwsA(isA<CheckoutIntentionSelectionBlocked>()),
      );
      expect(await records(), before);
    },
  );

  test(
    'scan of another reader cannot be selected through a different store owner',
    () async {
      await seed();
      final result = await reader.scan();
      final other = CheckoutIntentionReader(
        store: readonly,
        context: context,
        generation: generation,
      );
      await expectLater(
        other.selectV2(result, result.entries.single),
        throwsA(isA<CheckoutIntentionSelectionBlocked>()),
      );
    },
  );

  test(
    'unrelated keys also consume discovery bound, so truncated scan cannot claim empty completeness',
    () async {
      final current = context.binding!.context;
      final target = SaleStoreContext(
        scope: current.scope,
        target: current.target,
      ).targetPrefix;
      for (var i = 0; i < 3; i++) {
        await raw.compareAndSet(
          '$target${current.scope.prefix}aaa:$i',
          null,
          '{}',
        );
      }
      await seed();
      final before = await records();
      final result = await reader.scan(
        limits: CheckoutIntentionLimits(maxKeys: 2),
      );
      expect(result.status, CheckoutIntentionScanStatus.partial);
      expect(result.isEmptyObservation, false);
      expect(await records(), before);
    },
  );

  test(
    'valid JSON lacking origin metadata is corrupted, not recoverable',
    () async {
      final ref = await seed();
      final initial = await records();
      final key = keyFor(initial, ref, 'checkout-binding:');
      await raw.compareAndSet(key, initial[key], '{}');
      final before = await records();
      final result = await reader.scan();
      expect(
        categories(result),
        contains(CheckoutIntentionCategory.corruptedMetadata),
      );
      expect(result.entries.any((e) => e.canSelectV2), false);
      expect(await records(), before);
    },
  );

  test(
    'record decoding limit blocks oversized evidence without touching it',
    () async {
      await seed();
      final before = await records();
      final result = await reader.scan(
        limits: CheckoutIntentionLimits(maxRecordCharacters: 10),
      );
      expect(
        categories(result),
        contains(CheckoutIntentionCategory.corruptedMetadata),
      );
      expect(result.entries.any((e) => e.canSelectV2), false);
      expect(await records(), before);
    },
  );

  test(
    'ABA during explicit selection rejects reference before handoff to B1',
    () async {
      await seed();
      final before = await records();
      final result = await reader.scan();
      readonly.afterSnapshot = (_, _) async {
        generation.invalidate();
      };
      await expectLater(
        reader.selectV2(result, result.entries.single),
        throwsA(isA<CheckoutIntentionSelectionBlocked>()),
      );
      expect(result.entries, isEmpty);
      expect(await records(), before);
    },
  );

  test(
    'explicit synthetic HML and PROD target namespaces remain separate across selection changes',
    () async {
      final hml = CheckoutSaleContext(
        scope: checkoutContext().scope,
        environment: 'hml-fixture',
        firestoreEndpoint: 'hml.synthetic',
        functionsEndpoint: 'hml.synthetic',
      );
      final prod = CheckoutSaleContext(
        scope: checkoutContext().scope,
        environment: 'prod-fixture',
        firestoreEndpoint: 'prod.synthetic',
        functionsEndpoint: 'prod.synthetic',
      );
      final a = await seed(origin: hml);
      final b = await seed(origin: prod);
      final before = await records();
      generation.invalidate();
      context.binding = CheckoutContextBinding(hml, Object());
      final first = await reader.scan();
      expect(first.entries.single.reference!.intentKey, a.intentKey);
      generation.invalidate();
      context.binding = CheckoutContextBinding(prod, Object());
      expect(first.entries, isEmpty);
      final second = await reader.scan();
      expect(second.entries.single.reference!.intentKey, b.intentKey);
      expect(await records(), before);
    },
  );

  test(
    'canonical record alone is blocked without association, not a new or recovered sale',
    () async {
      final ref = await seed();
      final initial = await records();
      for (final kind in ['checkout-binding:', 'checkout-candidate:']) {
        await deleteTemporaryEvidence(name, keyFor(initial, ref, kind));
      }
      final before = await records();
      final result = await reader.scan();
      expect(categories(result), {
        CheckoutIntentionCategory.canonicalWithoutAssociation,
      });
      expect(result.entries.single.canSelectV2, false);
      expect(await records(), before);
    },
  );

  test(
    'terminal receipt and all canonical fields are untouched by enumeration and selection',
    () async {
      final ref = await seed();
      final initial = await records();
      final key = keyFor(initial, ref, 'confirmSaleV2:');
      final record = saleObject(jsonDecode(initial[key]!));
      await modify(key, {
        'state': 'confirmed',
        'prepared': true,
        'outcome': {
          'status': 'confirmed',
          'saleId': record['requestId'],
          'totalCents': 29,
          'replayed': false,
        },
      });
      final before = await records();
      final result = await reader.scan();
      await reader.selectV2(result, result.entries.single);
      expect(await records(), before);
    },
  );

  test(
    'unknown canonical version blocks decoding instead of degrading to historical reader',
    () async {
      final ref = await seed();
      final initial = await records();
      await modify(keyFor(initial, ref, 'confirmSaleV2:'), {
        'ledgerVersion': 9,
      });
      final before = await records();
      final result = await reader.scan();
      expect(
        categories(result),
        contains(CheckoutIntentionCategory.unknownVersion),
      );
      expect(result.entries.any((e) => e.canSelectV2), false);
      expect(await records(), before);
    },
  );

  test(
    'diagnostic conflict candidate does not replace or hide intact original identity',
    () async {
      final prep = CheckoutSalePreparation(
        store: raw,
        session: CheckoutSaleSession(context.binding!.context),
      );
      final original = await prep.persistAssociated(
        prep.newAssociatedPurchase(checkoutDraft()),
      );
      final candidate = prep.candidateForAssociatedIntention(
        original.reference,
        {...checkoutDraft(), 'notes': 'different'},
      );
      await expectLater(
        prep.persistAssociated(candidate),
        throwsA(isA<CheckoutAssociatedConflict>()),
      );
      final before = await records();
      final result = await reader.scan();
      expect(
        result.entries.single.categories,
        containsAll([
          CheckoutIntentionCategory.v2Recoverable,
          CheckoutIntentionCategory.diagnosticCandidate,
        ]),
      );
      expect(
        (await reader.selectV2(
          result,
          result.entries.single,
        )).reference.intentKey,
        original.reference.intentKey,
      );
      expect(await records(), before);
    },
  );
}
