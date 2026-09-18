import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/management/catalog_requests_screen.dart';
import 'package:store_connect/screens/management/catalog_request_detail_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );
  late List<Map<String, dynamic>> requests;
  late Future<List<Object?>> Function() list;
  late Future<List<Object?>> Function(Map<String, dynamic>) transition;
  final calls = <Map<String, dynamic>>[];
  Map<String, dynamic> request(String id, String status) => {
    'requestId': id,
    'status': status,
    'itemCount': 1,
    'totalUnits': 1,
    'totalAmount': 567.0,
    'createdAt': '2026-09-18T18:46:00Z',
  };
  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });
  setUp(() {
    calls.clear();
    requests = [request('a', 'pending'), request('b', 'in_progress')];
    list = () async => [
      {'success': true, 'requests': requests},
    ];
    transition = (parameters) async => [
      {
        'success': true,
        'changed': true,
        'requestId': parameters['requestId'],
        'status': parameters['action'] == 'start'
            ? 'in_progress'
            : 'cancelled',
      },
    ];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
          final args = Map<String, dynamic>.from(
            (message as List).single as Map,
          );
          calls.add(args);
          if (args['functionName'] == 'listCatalogRequests') return list();
          if (args['functionName'] == 'transitionCatalogRequest') {
            final parameters = Map<String, dynamic>.from(
              args['parameters'] as Map,
            );
            return transition(parameters);
          }
          expect(args['functionName'], 'getCatalogRequest');
          return [
            {
              'success': true,
              'request': {...requests.first, 'items': []},
            },
          ];
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null);
  });
  Future<void> open(WidgetTester tester, {double width = 900}) async {
    tester.view.physicalSize = Size(width, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const MaterialApp(home: CatalogRequestsScreen()));
    await tester.pumpAndSettle();
  }

  Future<void> tap(WidgetTester tester, String key) async {
    final finder = find.byKey(ValueKey(key));
    await tester.ensureVisible(finder);
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Iterable<Map<String, dynamic>> transitionCalls() => calls.where(
        (call) => call['functionName'] == 'transitionCatalogRequest',
      );

  testWidgets('labels, fallback, pluralização e status desconhecido', (
    tester,
  ) async {
    requests = [
      request('a', 'pending'),
      {
        ...request('b', 'in_progress'),
        'customerName': '  ',
        'itemCount': 2,
        'totalUnits': 3,
      },
      {...request('c', 'completed'), 'customerName': null},
      {...request('d', 'cancelled'), 'customerName': 'Maria'},
      request('e', 'unexpected'),
    ];
    await open(tester);
    for (final label in [
      'Nova',
      'Em atendimento',
      'Finalizada',
      'Cancelada',
      'Status indisponível',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.text('Cliente não identificado'), findsNWidgets(4));
    expect(find.text('Maria'), findsOneWidget);
    expect(find.text('1 produto'), findsNWidgets(4));
    expect(find.text('1 unidade'), findsNWidgets(4));
    expect(find.text('2 produtos'), findsOneWidget);
    expect(find.text('3 unidades'), findsOneWidget);
    expect(find.text(r'Total: R$ 567,00'), findsNWidgets(5));
    expect(find.text('Novas (1)'), findsOneWidget);
    expect(find.text('Todas (5)'), findsOneWidget);
    await tap(tester, 'filter-pending');
    expect(find.text('Nova'), findsOneWidget);
    expect(find.text('Status indisponível'), findsNothing);
    expect(calls.length, 1);
  });

  testWidgets('expansão por ID sobrevive a filtros e refresh/reordenação', (
    tester,
  ) async {
    await open(tester);
    await tap(tester, 'toggle-a');
    await tap(tester, 'filter-in_progress');
    expect(find.byKey(const ValueKey('expanded-b')), findsNothing);
    await tap(tester, 'filter-all');
    expect(find.byKey(const ValueKey('expanded-a')), findsOneWidget);
    requests = requests.reversed.toList();
    await tester.tap(find.byTooltip('Atualizar'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('expanded-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('expanded-b')), findsNothing);
    expect(
      tester.getTopLeft(find.byKey(const ValueKey('b'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const ValueKey('a'))).dy),
    );
    await tap(tester, 'filter-pending');
    requests = [request('b', 'in_progress')];
    await tester.tap(find.byTooltip('Atualizar'));
    await tester.pumpAndSettle();
    expect(find.text('Nenhuma solicitação neste status.'), findsOneWidget);
    expect(
      tester
          .widget<ChoiceChip>(find.byKey(const ValueKey('filter-pending')))
          .selected,
      isTrue,
    );
    requests.add(request('a', 'pending'));
    await tester.tap(find.byTooltip('Atualizar'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('expanded-a')), findsNothing);
  });

  testWidgets('vazio global e vazio do filtro são diferentes', (tester) async {
    requests = [];
    await open(tester, width: 320);
    expect(find.text('Nenhuma solicitação recebida'), findsOneWidget);
    await tap(tester, 'filter-completed');
    expect(find.text('Nenhuma solicitação neste status.'), findsOneWidget);
    expect(find.text('Nenhuma solicitação recebida'), findsNothing);
    expect(calls.length, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('loading, erro, retry e refresh sem chamadas simultâneas', (
    tester,
  ) async {
    list = () async => [
      'unavailable',
      'falha',
      {'code': 'unavailable'},
    ];
    await open(tester);
    expect(find.text('Tentar novamente'), findsOneWidget);
    final pending = Completer<List<Object?>>();
    list = () => pending.future;
    await tester.tap(find.text('Tentar novamente'));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(
      tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (widget) => widget is IconButton && widget.tooltip == 'Atualizar',
            ),
          )
          .onPressed,
      isNull,
    );
    expect(calls.length, 2);
    pending.complete([
      {'success': true, 'requests': requests},
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Nova'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsNothing);
  });

  testWidgets('nova mostra cliente, WhatsApp e inicia atendimento com reload', (
    tester,
  ) async {
    requests = [
      {
        ...request('a', 'pending'),
        'customerName': 'Maria Silva',
        'customerPhone': '5521985050120',
      },
    ];

    transition = (parameters) async {
      expect(parameters, {
        'requestId': 'a',
        'action': 'start',
      });

      requests = [
        {
          ...request('a', 'in_progress'),
          'customerName': 'Maria Silva',
          'customerPhone': '5521985050120',
          'attendedByName': 'Rodrigo',
          'attendedAt': '2026-09-18T19:00:00Z',
        },
      ];

      return [
        {
          'success': true,
          'changed': true,
          'requestId': 'a',
          'status': 'in_progress',
        },
      ];
    };

    await open(tester);
    await tap(tester, 'toggle-a');

    expect(find.text('Maria Silva'), findsNWidgets(2));
    expect(find.text('+55 (21) 98505-0120'), findsOneWidget);
    expect(find.byKey(const ValueKey('whatsapp-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('start-request-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('cancel-request-a')), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('start-request-a')));
    await tester.pumpAndSettle();

    expect(transitionCalls().length, 1);
    expect(transitionCalls().single['parameters'], {
      'requestId': 'a',
      'action': 'start',
    });
    expect(
      calls
          .where((call) => call['functionName'] == 'listCatalogRequests')
          .length,
      2,
    );
    expect(find.text('Em atendimento'), findsOneWidget);
    expect(find.text('Atendido por Rodrigo'), findsOneWidget);
    expect(find.byKey(const ValueKey('open-request-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('start-request-a')), findsNothing);
    expect(find.byKey(const ValueKey('cancel-request-a')), findsNothing);
  });

  testWidgets('cancelamento exige confirmação e recarrega a lista', (
    tester,
  ) async {
    requests = [
      {
        ...request('a', 'pending'),
        'customerName': 'Maria Silva',
        'customerPhone': '5521985050120',
      },
    ];

    transition = (parameters) async {
      expect(parameters, {
        'requestId': 'a',
        'action': 'cancel',
      });

      requests = [
        {
          ...request('a', 'cancelled'),
          'customerName': 'Maria Silva',
          'customerPhone': '5521985050120',
        },
      ];

      return [
        {
          'success': true,
          'changed': true,
          'requestId': 'a',
          'status': 'cancelled',
        },
      ];
    };

    await open(tester);
    await tap(tester, 'toggle-a');

    await tester.tap(find.byKey(const ValueKey('cancel-request-a')));
    await tester.pumpAndSettle();

    expect(find.text('Cancelar solicitação?'), findsOneWidget);
    expect(
      find.text(
        'Esta solicitação será marcada como cancelada. '
        'Essa ação não poderá ser desfeita.',
      ),
      findsOneWidget,
    );
    expect(transitionCalls(), isEmpty);

    await tester.tap(find.byKey(const ValueKey('confirm-cancel-a')));
    await tester.pumpAndSettle();

    expect(transitionCalls().length, 1);
    expect(transitionCalls().single['parameters'], {
      'requestId': 'a',
      'action': 'cancel',
    });
    expect(
      calls
          .where((call) => call['functionName'] == 'listCatalogRequests')
          .length,
      2,
    );
    expect(find.text('Cancelada'), findsOneWidget);
    expect(find.byKey(const ValueKey('start-request-a')), findsNothing);
    expect(find.byKey(const ValueKey('cancel-request-a')), findsNothing);
    expect(find.byKey(const ValueKey('details-a')), findsOneWidget);
  });

  testWidgets('em atendimento abre detalhe sem ações indevidas', (
    tester,
  ) async {
    requests = [
      {
        ...request('a', 'in_progress'),
        'customerName': 'Maria Silva',
        'customerPhone': '5521985050120',
        'attendedByName': 'Rodrigo',
        'attendedAt': '2026-09-18T19:00:00Z',
      },
    ];

    await open(tester, width: 320);
    await tap(tester, 'toggle-a');

    expect(find.text('+55 (21) 98505-0120'), findsOneWidget);
    expect(find.byKey(const ValueKey('whatsapp-a')), findsOneWidget);
    expect(find.byKey(const ValueKey('open-request-a')), findsOneWidget);
    expect(find.text('Abrir atendimento'), findsOneWidget);

    expect(find.byKey(const ValueKey('start-request-a')), findsNothing);
    expect(find.byKey(const ValueKey('cancel-request-a')), findsNothing);
    expect(find.byKey(const ValueKey('details-a')), findsNothing);
    expect(transitionCalls(), isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('estados terminais oferecem somente consulta do detalhe', (
    tester,
  ) async {
    requests = [
      {
        ...request('c', 'completed'),
        'customerName': 'Cliente C',
        'customerPhone': '5521985050120',
      },
      {
        ...request('d', 'cancelled'),
        'customerName': 'Cliente D',
        'customerPhone': '5521985050121',
      },
    ];

    await open(tester);
    await tap(tester, 'toggle-c');
    await tap(tester, 'toggle-d');

    expect(find.byKey(const ValueKey('details-c')), findsOneWidget);
    expect(find.byKey(const ValueKey('details-d')), findsOneWidget);
    expect(find.byKey(const ValueKey('whatsapp-c')), findsNothing);
    expect(find.byKey(const ValueKey('whatsapp-d')), findsNothing);

    expect(find.byKey(const ValueKey('start-request-c')), findsNothing);
    expect(find.byKey(const ValueKey('start-request-d')), findsNothing);
    expect(find.byKey(const ValueKey('cancel-request-c')), findsNothing);
    expect(find.byKey(const ValueKey('cancel-request-d')), findsNothing);
    expect(find.byKey(const ValueKey('open-request-c')), findsNothing);
    expect(find.byKey(const ValueKey('open-request-d')), findsNothing);
    expect(transitionCalls(), isEmpty);
  });

  testWidgets('detalhe recebe ID e retorno não recarrega lista', (
    tester,
  ) async {
    requests = [request('a', 'pending')];
    await open(tester);
    await tap(tester, 'toggle-a');
    await tester.tap(find.text('Ver detalhes'));
    await tester.pumpAndSettle();
    expect(find.byType(CatalogRequestDetailScreen), findsOneWidget);
    expect(calls.last['parameters'], {'requestId': 'a'});
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('expanded-a')), findsOneWidget);
    expect(
      calls
          .where((call) => call['functionName'] == 'listCatalogRequests')
          .length,
      1,
    );
  });

  testWidgets('mobile: opcionais seguros, datas inválidas e nome longo', (
    tester,
  ) async {
    requests = [
      {
        ...request('a', 'in_progress'),
        'customerName':
            'Cliente com nome muito longo para conferir quebra de linha',
        'attendedByName': 'Rodrigo',
        'attendedAt': '2026-09-18T18:46:00Z',
        'createdAt': 'invalid',
      },
    ];
    await open(tester, width: 320);
    expect(find.text('Atendido por Rodrigo'), findsOneWidget);
    expect(find.textContaining('Atendimento em'), findsOneWidget);
    expect(find.text('Data não disponível'), findsOneWidget);
    await tap(tester, 'toggle-a');
    expect(find.text('Abrir atendimento'), findsOneWidget);
    expect(find.text('Ver detalhes'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
