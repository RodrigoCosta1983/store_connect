import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/sale_mutation_store.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/services/checkout_coordinator_ports.dart';
import 'package:store_connect/services/checkout_coordinator_preparation_adapter.dart';
import 'package:store_connect/services/checkout_intention_reader.dart';
import 'package:store_connect/services/checkout_presentation_controller.dart';
import 'package:store_connect/services/checkout_sale_preparation.dart';
import 'package:store_connect/widgets/checkout_intention_panel.dart';
import 'support/checkout_coordinator_fakes.dart';
import 'support/checkout_sale_preparation_cases.dart'
    show checkoutContext, checkoutDraft;

class _ReadGuard implements AtomicSaleMutationStore {
  final AtomicSaleMutationStore inner;
  int mutations = 0;
  bool unavailable = false;
  Future<void> Function()? reading;
  _ReadGuard(this.inner);
  @override
  Future<List<String>> keys(String prefix) async {
    if (unavailable) throw StateError('secret raw JSON must never be shown');
    final result = await inner.keys(prefix);
    await reading?.call();
    return result;
  }

  @override
  Future<String?> read(String key) => inner.read(key);
  @override
  Future<SaleAtomicSnapshot> readSnapshot(SaleAtomicScope scope) async {
    await reading?.call();
    return inner.readSnapshot(scope);
  }

  @override
  Future<SaleAtomicCommit<T>> transact<T>(
    SaleAtomicScope scope,
    SaleAtomicPlan<T> Function(SaleAtomicSnapshot) decide,
  ) => inner.transact(scope, (snapshot) {
    final plan = decide(snapshot);
    if (plan.writes.isNotEmpty) {
      mutations++;
      throw StateError('Presentation must never write');
    }
    return plan;
  });
  @override
  Future<bool> compareAndSet(String key, String? expected, String value) {
    mutations++;
    throw StateError('Presentation must never write');
  }

  @override
  Future<void> close() async => throw StateError('Borrowed store');
}

void main() {
  late Directory directory;
  late SqliteSaleMutationStore raw;
  late _ReadGuard guarded;
  late CoordinatorContextFake context;
  late CoordinatorEventsFake events;
  late CoordinatorPreparationFake port;
  late CheckoutPresentationController controller;
  late CheckoutIntentionReader reader;
  late CheckoutSaleReference original;

  Future<CheckoutSaleReference> seed({bool v1 = false}) async {
    final prep = CheckoutSalePreparation(
      store: raw,
      session: CheckoutSaleSession(context.binding!.context),
    );
    return v1
        ? (await prep.persist(prep.newPurchase(checkoutDraft()))).reference
        : (await prep.persistAssociated(
            prep.newAssociatedPurchase(checkoutDraft()),
          )).reference;
  }

  Future<Map<String, String>> records() async => {
    for (final key in await raw.keys('')) key: (await raw.read(key))!,
  };
  void compose() {
    controller = CheckoutPresentationController(
      reader: reader,
      context: context,
      draft: CoordinatorDraftFake(),
      events: events,
      preparation: port,
      evidence: port,
    );
  }

  setUp(() async {
    directory = Directory.systemTemp.createTempSync('b3-presentation-');
    raw = SqliteSaleMutationStore('${directory.path}/intentions.sqlite');
    guarded = _ReadGuard(raw);
    context = CoordinatorContextFake();
    events = CoordinatorEventsFake();
    port = CoordinatorPreparationFake();
    reader = CheckoutIntentionReader(
      store: guarded,
      context: context,
      generation: CheckoutIntentionGeneration(),
    );
    original = await seed();
    compose();
  });
  tearDown(() async {
    controller.dispose();
    expect(guarded.mutations, 0);
    expect(port.creates, 0);
    expect(port.persists, 0);
    await raw.close();
  });
  Future<void> list() async {
    controller.refreshContext();
    await controller.refresh();
  }

  Widget panel() => MaterialApp(
    home: Scaffold(body: CheckoutIntentionPanel(controller: controller)),
  );

  test('construction does not read, allocate or resume automatically', () {
    expect(controller.entries, isEmpty);
    expect(controller.canRefresh, false);
    expect(port.resumes, 0);
  });
  test(
    'explicit selection revalidates B2 and resumes same canonical ID without writes',
    () async {
      final adapter = AssociatedCheckoutCoordinatorAdapter(guarded);
      port.resuming = (ref) => adapter.resume(context.binding!, ref);
      final before = await records();
      await list();
      expect(port.resumes, 0);
      await controller.select(controller.entries.single);
      expect(port.resumes, 1);
      expect(controller.state.reference!.intentKey, original.intentKey);
      expect(controller.state.phase, CheckoutCoordinatorPhase.prepared);
      expect(await records(), before);
    },
  );
  test('V1 separated; controller rejects historical selection', () async {
    await seed(v1: true);
    await list();
    final historic = controller.entries.singleWhere(
      (e) => e.metadataVersion == 1,
    );
    expect(controller.canSelect(historic), false);
    await controller.select(historic);
    expect(port.resumes, 0);
  });
  test(
    'changed record between scan and select is blocked, no resume or raw exception',
    () async {
      await list();
      final entry = controller.entries.single;
      final key = (await raw.keys('')).first;
      final value = await raw.read(key);
      await raw.compareAndSet(key, value, '{"secret":"raw-data"}');
      await controller.select(entry);
      expect(port.resumes, 0);
      expect(controller.entries, isEmpty);
      expect(controller.notice, contains('referência mudou'));
      expect(controller.notice, isNot(contains('raw-data')));
    },
  );
  test(
    'unavailable differs from empty and shows no exception details',
    () async {
      guarded.unavailable = true;
      await list();
      expect(controller.listing, CheckoutListingPhase.unavailable);
      expect(controller.entries, isEmpty);
      expect(controller.notice, isNull);
    },
  );
  test('scan limits remain explicitly partial', () async {
    await seed();
    controller.refreshContext();
    await controller.refresh(limits: CheckoutIntentionLimits(maxEntries: 1));
    expect(controller.listing, CheckoutListingPhase.partial);
  });
  for (final reason in CheckoutGenerationChange.values) {
    test(
      'BEFORE $reason hides old results synchronously and blocks expired selection',
      () async {
        await list();
        final entry = controller.entries.single;
        events.emit(reason, () {
          expect(controller.entries, isEmpty);
          expect(controller.canSelect(entry), false);
          expect(controller.listing, CheckoutListingPhase.contextInvalid);
        });
        await controller.select(entry);
        expect(port.resumes, 0);
      },
    );
  }
  test('ABA while scan is pending never republishes prior results', () async {
    controller.refreshContext();
    final entered = Completer<void>(), release = Completer<void>();
    guarded.reading = () async {
      if (!entered.isCompleted) entered.complete();
      await release.future;
    };
    final pending = controller.refresh();
    await entered.future;
    final a = context.binding;
    events.emit(
      CheckoutGenerationChange.user,
      () => context.binding = CheckoutContextBinding(
        checkoutContext(uid: 'b'),
        Object(),
      ),
    );
    events.emit(CheckoutGenerationChange.user, () => context.binding = a);
    controller.refreshContext();
    release.complete();
    await pending;
    expect(controller.entries, isEmpty);
    expect(controller.listing, CheckoutListingPhase.contextInvalid);
  });
  test('invalidation during selection prevents B1.resume', () async {
    await list();
    final entry = controller.entries.single;
    final entered = Completer<void>(), release = Completer<void>();
    guarded.reading = () async {
      if (!entered.isCompleted) entered.complete();
      await release.future;
    };
    final pending = controller.select(entry);
    await entered.future;
    events.emit(CheckoutGenerationChange.store, () {});
    release.complete();
    await pending;
    expect(port.resumes, 0);
    expect(controller.entries, isEmpty);
  });
  test('late resume after ABA cannot publish evidence', () async {
    await list();
    final entered = Completer<void>(),
        release = Completer<CheckoutLocalEvidence>();
    port.resuming = (_) {
      entered.complete();
      return release.future;
    };
    final pending = controller.select(controller.entries.single);
    await entered.future;
    final a = context.binding;
    events.emit(
      CheckoutGenerationChange.project,
      () => context.binding = CheckoutContextBinding(
        checkoutContext(project: 'other'),
        Object(),
      ),
    );
    events.emit(CheckoutGenerationChange.project, () => context.binding = a);
    controller.refreshContext();
    release.complete(
      CheckoutLocalEvidence(
        original,
        CheckoutLocalCondition.recoverable,
        requestId: 'private-id',
      ),
    );
    await pending;
    expect(controller.state.phase, CheckoutCoordinatorPhase.ready);
    expect(controller.state.reference, isNull);
    expect(controller.entries, isEmpty);
  });
  test(
    'dispose prevents notifications and reopening requires fresh presentation',
    () async {
      await list();
      final entry = controller.entries.single;
      var notices = 0;
      controller.addListener(() => notices++);
      controller.dispose();
      final before = notices;
      await controller.select(entry);
      await controller.refresh();
      controller.publish(
        const CheckoutCoordinatorState(CheckoutCoordinatorPhase.prepared),
      );
      expect(notices, before);
      expect(controller.entries, isEmpty);
      compose();
      expect(controller.entries, isEmpty);
      expect(
        controller.state.phase,
        CheckoutCoordinatorPhase.contextUnavailable,
      );
      expect(controller.canSelect(entry), false);
    },
  );
  test(
    'lost origin without event hides entries and refuses selection',
    () async {
      await list();
      final entry = controller.entries.single;
      context.binding = CheckoutContextBinding(
        checkoutContext(uid: 'other'),
        Object(),
      );
      expect(controller.entries, isEmpty);
      expect(controller.state.phase, CheckoutCoordinatorPhase.contextReplaced);
      await controller.select(entry);
      expect(port.resumes, 0);
    },
  );
  test(
    'UNKNOWN projection remains unknown on explicit read and preserves bytes',
    () async {
      port.resuming = (ref) async => CheckoutLocalEvidence(
        ref,
        CheckoutLocalCondition.unknown,
        requestId: 'original',
      );
      final before = await records();
      await list();
      await controller.select(controller.entries.single);
      expect(controller.state.phase, CheckoutCoordinatorPhase.unknown);
      expect(await records(), before);
    },
  );

  for (final origin in [
    checkoutContext(uid: 'other'),
    checkoutContext(store: 'other'),
    checkoutContext(project: 'other'),
    checkoutContext(endpoint: 'localhost:9090'),
  ]) {
    test(
      'new namespace hides previous ${origin.target} ${origin.scope.prefix}',
      () async {
        await list();
        final previous = controller.entries.single;
        events.emit(CheckoutGenerationChange.authorization, () {
          context.binding = CheckoutContextBinding(origin, Object());
        });
        controller.refreshContext();
        await controller.refresh();
        expect(controller.entries, isEmpty);
        expect(controller.listing, CheckoutListingPhase.complete);
        await controller.select(previous);
        expect(port.resumes, 0);
      },
    );
  }
  test('dispose during read suppresses late presentation', () async {
    controller.refreshContext();
    final entered = Completer<void>(), release = Completer<void>();
    guarded.reading = () async {
      if (!entered.isCompleted) entered.complete();
      await release.future;
    };
    var notifications = 0;
    controller.addListener(() => notifications++);
    final pending = controller.refresh();
    await entered.future;
    controller.dispose();
    final before = notifications;
    release.complete();
    await pending;
    expect(notifications, before);
    expect(controller.entries, isEmpty);
  });
  test('corrupt entry cannot be resumed through controller', () async {
    final key = (await raw.keys('')).first;
    await raw.compareAndSet(key, await raw.read(key), '{invalid');
    await list();
    for (final entry in controller.entries) {
      expect(controller.canSelect(entry), false);
      await controller.select(entry);
    }
    expect(port.resumes, 0);
  });
  testWidgets('empty complete is observation, not proof of rollback', (
    tester,
  ) async {
    events.emit(CheckoutGenerationChange.store, () {
      context.binding = CheckoutContextBinding(
        checkoutContext(store: 'empty'),
        Object(),
      );
    });
    await tester.runAsync(list);
    await tester.pumpWidget(panel());
    expect(find.textContaining('Nenhuma intenção encontrada'), findsOneWidget);
    expect(find.textContaining('não prova ausência'), findsOneWidget);
    expect(find.text('Selecionar e retomar leitura local'), findsNothing);
  });
  testWidgets('corrupt diagnostics visible without selection', (tester) async {
    await tester.runAsync(() async {
      final all = await records();
      for (final entry in all.entries) {
        final record = jsonDecode(entry.value) as Map;
        if (record.containsKey('ledgerVersion')) {
          await raw.compareAndSet(entry.key, entry.value, '{invalid');
        }
      }
      await list();
    });
    await tester.pumpWidget(panel());
    expect(find.text('Registros bloqueados e diagnósticos'), findsOneWidget);
    expect(find.text('Selecionar e retomar leitura local'), findsNothing);
  });
  testWidgets('keyboard focus and refresh are local only', (tester) async {
    controller.refreshContext();
    await tester.pumpWidget(panel());
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    expect(FocusManager.instance.primaryFocus?.context, isNotNull);
    await tester.tap(find.text('Atualizar intenções'));
    await tester.pumpAndSettle();
    expect(controller.listing, CheckoutListingPhase.complete);
    expect(port.resumes, 0);
    expect(find.text('Intenções V2'), findsOneWidget);
  });

  for (final phase in CheckoutCoordinatorPhase.values) {
    testWidgets('Portuguese state $phase with no commercial controls', (
      tester,
    ) async {
      controller.refreshContext();
      controller.publish(CheckoutCoordinatorState(phase));
      await tester.pumpWidget(panel());
      expect(find.text(checkoutPhaseMessage(controller.state)), findsOneWidget);
      for (final label in [
        'Reenviar',
        'Forçar confirmação',
        'Vender novamente',
        'Descartar registro',
        'Venda concluída',
      ]) {
        expect(find.text(label), findsNothing);
      }
      expect(find.textContaining('Prévia isolada'), findsOneWidget);
    });
  }
  for (final persisted in [false, true]) {
    testWidgets('conflict diagnostic persisted=$persisted is explicit', (
      tester,
    ) async {
      controller.refreshContext();
      controller.publish(
        CheckoutCoordinatorState(
          CheckoutCoordinatorPhase.conflict,
          reference: original,
          candidateId: 'never-display-internal',
          candidatePersisted: persisted,
        ),
      );
      await tester.pumpWidget(panel());
      expect(
        find.textContaining(
          persisted ? 'diagnóstico salvo' : 'apenas em memória',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('never-display-internal'), findsNothing);
    });
  }
  testWidgets('multiple V2, V1 headings and explicit working selection', (
    tester,
  ) async {
    await tester.runAsync(() async {
      await seed();
      await seed(v1: true);
      await list();
    });
    await tester.pumpWidget(panel());
    expect(find.text('Intenções V2'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Histórico V1'), 250);
    expect(find.text('Histórico V1'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Selecionar e retomar leitura local').first,
      -250,
    );
    await tester.tap(find.text('Selecionar e retomar leitura local').first);
    await tester.pumpAndSettle();
    expect(port.resumes, 1);
    expect(find.textContaining('Sem confirmação comercial'), findsOneWidget);
    expect(find.textContaining(original.intentKey), findsNothing);
  });
  testWidgets('loading is accessible and all controls block while busy', (
    tester,
  ) async {
    controller.refreshContext();
    final entered = Completer<void>(), release = Completer<void>();
    guarded.reading = () async {
      if (!entered.isCompleted) entered.complete();
      await release.future;
    };
    final pending = controller.refresh();
    await tester.pumpWidget(panel());
    expect(entered.isCompleted, true);
    final semantics = tester.ensureSemantics();
    expect(find.bySemanticsLabel('Leitura local em andamento'), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(
      tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
      isNull,
    );
    release.complete();
    await tester.pumpAndSettle();
    await pending;
    semantics.dispose();
  });
  testWidgets('partial listing visible, safe messages, no raw payload', (
    tester,
  ) async {
    await tester.runAsync(() async {
      await seed();
      controller.refreshContext();
      await controller.refresh(limits: CheckoutIntentionLimits(maxEntries: 1));
    });
    await tester.pumpWidget(panel());
    expect(find.textContaining('Listagem parcial'), findsOneWidget);
    expect(find.textContaining('commandHash'), findsNothing);
  });
  testWidgets('unavailable listing is visible without raw error', (
    tester,
  ) async {
    guarded.unavailable = true;
    await tester.runAsync(list);
    await tester.pumpWidget(panel());
    expect(find.textContaining('Falha na enumeração'), findsOneWidget);
    expect(find.textContaining('secret raw JSON'), findsNothing);
  });
  testWidgets(
    'context invalidation removes rendered entries before new origin publication',
    (tester) async {
      await tester.runAsync(list);
      await tester.pumpWidget(panel());
      events.emit(CheckoutGenerationChange.target, () {});
      await tester.pump();
      expect(find.text('Selecionar e retomar leitura local'), findsNothing);
      expect(find.textContaining('Listagem invalidada'), findsOneWidget);
      expect(find.textContaining('conta e loja de origem'), findsOneWidget);
    },
  );
}
