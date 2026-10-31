import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:store_connect/services/subscription_billing_access.dart';
import 'package:store_connect/screens/subscription_screen.dart';
import 'package:store_connect/screens/finance/invoices_screen.dart';

void main() {
  test('existing invoice lookup never reserves or creates another subscription', () async {
    final calls = <String>[];
    final access = SubscriptionBillingAccess(storeId: 'synthetic-store',
      read: () async => null, persist: (_) async => fail('Lookup must not reserve a request'),
      checkScope: () async {}, call: (endpoint, payload) async {
        calls.add(endpoint);
        expect(payload, {'storeId': 'synthetic-store'});
        if (endpoint == 'getAsaasSubscriptionStateV1') return {
          'schemaVersion': 1, 'attemptStatus': 'none', 'canStart': false, 'billingState': 'bound',
        };
        expect(endpoint, 'getAsaasPortalUrl');
        return {'portalUrl': 'https://www.asaas.com/i/synthetic'};
      });
    expect((await access.existingInvoice()).host, 'www.asaas.com');
    expect(calls, ['getAsaasSubscriptionStateV1', 'getAsaasPortalUrl']);
  });
  for (final link in ['https://asaas.com.evil.example/x', 'http://www.asaas.com/i/x', 'https://user:pass@www.asaas.com/i/x']) {
    test('existing invoice refuses unsafe URL $link', () async {
      final access = SubscriptionBillingAccess(storeId: 'synthetic-store', read: () async => null,
        persist: (_) async => fail('No writes'), checkScope: () async {}, call: (endpoint, _) async =>
          endpoint == 'getAsaasSubscriptionStateV1'
            ? {'schemaVersion': 1, 'attemptStatus': 'none', 'canStart': false, 'billingState': 'bound'}
            : {'portalUrl': link});
      await expectLater(access.existingInvoice(), throwsStateError);
    });
  }
  testWidgets('bound Business account offers its existing invoice without a second contract', (tester) async {
    final access = SubscriptionBillingAccess(storeId: 'synthetic-store', read: () async => null,
      persist: (_) async => fail('No writes'), checkScope: () async {}, call: (endpoint, _) async {
        expect(endpoint, 'getAsaasSubscriptionStateV1');
        return {'schemaVersion': 1, 'attemptStatus': 'none', 'canStart': false,
          'billingState': 'bound', 'subscriptionStatus': 'pending', 'subscriptionType': 'business'};
      });
    await tester.pumpWidget(MaterialApp(home: SubscriptionScreen(storeId: 'synthetic-store',
      observeStatus: false, billingFactory: (_) async => access)));
    await tester.pumpAndSettle();
    expect(find.text('Sua assinatura Business'), findsOneWidget);
    expect(find.text('Abrir cobrança existente'), findsOneWidget);
    expect(find.byType(ElevatedButton), findsNothing);
    expect(find.text('ASSINAR AGORA'), findsNothing);
    expect(find.textContaining('temporariamente suspenso'), findsNothing);
  });
  testWidgets('Pro price matches the current catalog without creating or changing a subscription', (tester) async {
    var reads = 0;
    await tester.pumpWidget(MaterialApp(home: InvoicesScreen(storeId: 'synthetic-store',
      subscriptionReader: (_) async => {
        'subscriptionStatus': 'active', 'subscriptionType': 'pro',
        'asaasCustomerId': 'cus_synthetic', 'asaasSubscriptionId': 'sub_synthetic',
      }, invoicesReader: (_) async { reads++; return []; })));
    await tester.pumpAndSettle();
    expect(find.text('R\$ 39,90 / mês'), findsOneWidget);
    expect(find.textContaining('35,90'), findsNothing);
    expect(reads, 1);
  });
  test('contract without explicit consent performs zero reads, writes or sends', () async {
    var effects = 0;
    final access = SubscriptionBillingAccess(storeId: 'synthetic-store',
      read: () async { effects++; return null; }, persist: (_) async { effects++; },
      checkScope: () async { effects++; }, call: (_, __) async { effects++; return {}; });
    await expectLater(access.contract({'consentToContract': true}), throwsStateError);
    expect(effects, 0);
  });
  for (final entry in <(String, String?, String)>[
    ('not-found', null, 'ainda não publicado'),
    ('unavailable', null, 'temporariamente indisponível'),
    ('permission-denied', null, 'não autorizada'),
    ('failed-precondition', null, 'condição de segurança'),
    ('failed-precondition', 'upstream_unauthorized', 'Credencial Asaas indisponível'),
    ('failed-precondition', 'credential_unavailable', 'Credencial Asaas indisponível'),
    ('failed-precondition', 'provider_operations_disabled', 'Consulta externa bloqueada por segurança'),
    ('permission-denied', 'upstream_forbidden', 'Credencial Asaas indisponível'),
    ('internal', null, 'causa precisa ser conferida'),
  ]) {
    testWidgets('invoice read diagnostic ${entry.$1}/${entry.$2} stays read-only', (tester) async {
      await tester.pumpWidget(MaterialApp(home: InvoicesScreen(storeId: 'synthetic-store',
        subscriptionReader: (_) async => {'subscriptionStatus': 'inactive'},
        invoicesReader: (_) async => throw FirebaseFunctionsException(code: entry.$1,
          message: 'private-do-not-display', details: {'reason': entry.$2}))));
      await tester.pumpAndSettle();
      expect(find.textContaining(entry.$3), findsOneWidget);
      expect(find.textContaining('listAsaasInvoices'), findsOneWidget);
      expect(find.textContaining('private-do-not-display'), findsNothing);
      expect(find.text('Assinar Agora'), findsNothing);
    });
  }
  testWidgets('active business without binding is not displayed as paid', (tester) async {
    await tester.pumpWidget(MaterialApp(home: InvoicesScreen(storeId: 'synthetic-store',
      subscriptionReader: (_) async => {'subscriptionStatus': 'active', 'subscriptionType': 'business'},
      invoicesReader: (_) async => [])));
    await tester.pumpAndSettle();
    expect(find.textContaining('Acesso ativo sem assinatura Asaas vinculada'), findsOneWidget);
    expect(find.text('Assinatura ativa'), findsNothing);
  });
  testWidgets('Minha Assinatura invoice query error shows code only and retry remains read-only', (tester) async {
    var reads = 0;
    await tester.pumpWidget(MaterialApp(home: InvoicesScreen(storeId: 'synthetic-store',
      subscriptionReader: (_) async => {'subscriptionType': 'pro', 'subscriptionStatus': 'inactive'},
      invoicesReader: (_) async { reads++; throw FirebaseFunctionsException(code: 'failed-precondition', message: 'synthetic-private-customer'); })));
    await tester.pumpAndSettle();
    expect(find.textContaining('(failed-precondition; listAsaasInvoices)'), findsOneWidget);
    expect(find.textContaining('synthetic-private-customer'), findsNothing);
    await tester.tap(find.text('Tentar Novamente')); await tester.pumpAndSettle();
    expect(reads, 2);
  });
  test('query never writes or calls creation; timeout identity survives a new access instance', () async {
    String? saved;
    var writes = 0, sends = 0;
    SubscriptionBillingAccess access() => SubscriptionBillingAccess(storeId: 'synthetic-store',
      read: () async => saved, persist: (id) async { saved = id; writes++; }, checkScope: () async {},
      call: (endpoint, payload) async {
        if (endpoint == 'getAsaasSubscriptionStateV1') return {'schemaVersion': 1, 'attemptStatus': 'none', 'canStart': true};
        expect(saved, payload['requestId']); expect(payload['storeId'], 'synthetic-store'); expect(payload['consentToContract'], true);
        sends++; throw FirebaseFunctionsException(code: 'deadline-exceeded', message: 'synthetic timeout');
      });
    await access().query(); expect(writes, 0); expect(sends, 0);
    await expectLater(access().contract({}, consentToContract: true), throwsA(isA<FirebaseFunctionsException>()));
    final original = saved;
    await expectLater(access().contract({}, consentToContract: true), throwsStateError);
    expect(saved, original); expect(writes, 1); expect(sends, 1);
  });
  test('scope change prevents sends; failed durable persistence never sends', () async {
    var sends = 0;
    final access = SubscriptionBillingAccess(storeId: 'synthetic-store', read: () async => null,
      persist: (_) async => throw StateError('synthetic full disk'), checkScope: () async {}, call: (endpoint, _) async {
        if (endpoint == 'getAsaasSubscriptionStateV1') return {'schemaVersion': 1, 'attemptStatus': 'none', 'canStart': true};
        sends++; return {};
      });
    await expectLater(access.contract({}, consentToContract: true), throwsStateError); expect(sends, 0);
    final crossed = SubscriptionBillingAccess(storeId: 'synthetic-store', read: () async => null, persist: (_) async {},
      checkScope: () async => throw StateError('operator changed'), call: (_, __) async { sends++; return {}; });
    await expectLater(crossed.query(), throwsStateError); expect(sends, 0);
  });
  testWidgets('Minha Assinatura query failure is diagnostic and cannot enable contract', (tester) async {
    var create = 0, query = 0;
    final access = SubscriptionBillingAccess(storeId: 'synthetic-store', read: () async => null, persist: (_) async {}, checkScope: () async {},
      call: (endpoint, _) async {
        if (endpoint == 'createAsaasSubscription') create++;
        query++; throw FirebaseFunctionsException(code: 'unavailable', message: 'private payload must not appear');
      });
    await tester.pumpWidget(MaterialApp(home: SubscriptionScreen(storeId: 'synthetic-store', observeStatus: false, billingFactory: (_) async => access)));
    await tester.pumpAndSettle();
    expect(find.textContaining('temporariamente indisponível'), findsOneWidget);
    expect(find.textContaining('private payload'), findsNothing);
    final button = tester.widget<ElevatedButton>(find.byWidgetPredicate((w) => w is ElevatedButton).first);
    expect(button.onPressed, isNull); expect(create, 0); expect(query, 1);
  });
  testWidgets('published global block displays state; consulting does not create subscription', (tester) async {
    var creates = 0;
    final access = SubscriptionBillingAccess(storeId: 'synthetic-store', read: () async => null, persist: (_) async {}, checkScope: () async {},
      call: (endpoint, _) async {
        if (endpoint == 'createAsaasSubscription') creates++;
        return {'schemaVersion': 1, 'attemptStatus': 'none', 'canStart': false, 'subscriptionStatus': 'inactive', 'inactiveReason': 'unknown'};
      });
    await tester.pumpWidget(MaterialApp(home: SubscriptionScreen(storeId: 'synthetic-store', observeStatus: false, billingFactory: (_) async => access)));
    await tester.pumpAndSettle();
    expect(find.textContaining('motivo: unknown'), findsOneWidget);
    expect(tester.widget<ElevatedButton>(find.byWidgetPredicate((w) => w is ElevatedButton).first).onPressed, isNull);
    expect(creates, 0);
  });
}
