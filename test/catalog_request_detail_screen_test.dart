import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/screens/management/catalog_request_detail_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );

  late Map<String, dynamic> currentRequest;
  late Future<List<Object?>> Function() getRequest;
  late Future<List<Object?>> Function(Map<String, dynamic>) transition;
  final calls = <Map<String, dynamic>>[];

  Map<String, dynamic> request(
    String status, {
    bool withClient = true,
  }) {
    return {
      'requestId': 'request-a',
      'requestVersion': withClient ? 2 : 1,
      'status': status,
      'itemCount': 1,
      'totalUnits': 2,
      'totalAmount': 20.0,
      'createdAt': '2026-09-18T18:00:00Z',
      if (withClient) 'customerName': 'Maria Silva',
      if (withClient) 'customerPhone': '5521985050120',
      if (withClient) 'note': 'Separar para retirada.',
      'items': [
        {
          'productId': 'p1',
          'name': 'Produto A',
          'quantity': 2,
          'price': 10.0,
          'subtotal': 20.0,
        },
      ],
    };
  }

  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
  });

  setUp(() {
    calls.clear();

    currentRequest = request('pending');

    getRequest = () async => [
          {
            'success': true,
            'request': currentRequest,
          },
        ];

    transition = (parameters) async => [
          {
            'success': true,
            'changed': true,
            'requestId': parameters['requestId'],
            'status': parameters['action'] == 'start'
                ? 'in_progress'
                : parameters['action'] == 'complete'
                    ? 'completed'
                    : 'cancelled',
          },
        ];

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(
      channel,
      (message) async {
        final args = Map<String, dynamic>.from(
          (message as List).single as Map,
        );

        calls.add(args);

        if (args['functionName'] == 'getCatalogRequest') {
          return getRequest();
        }

        if (args['functionName'] == 'transitionCatalogRequest') {
          final parameters = Map<String, dynamic>.from(
            args['parameters'] as Map,
          );
          return transition(parameters);
        }

        fail('Callable inesperada: ${args['functionName']}');
      },
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(
      channel,
      null,
    );
  });

  Future<void> openDetail(
    WidgetTester tester, {
    double width = 900,
  }) async {
    tester.view.physicalSize = Size(width, 1400);
    tester.view.devicePixelRatio = 1;

    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(
        home: CatalogRequestDetailScreen(
          requestId: 'request-a',
        ),
      ),
    );

    await tester.pumpAndSettle();
  }

  Iterable<Map<String, dynamic>> callsFor(String functionName) {
    return calls.where(
      (call) => call['functionName'] == functionName,
    );
  }

  testWidgets(
    'in_progress mostra cliente, observação, lifecycle e ações',
    (tester) async {
      currentRequest = {
        ...request('in_progress'),
        'attendedByUid': 'uid-a',
        'attendedByName': 'Rodrigo',
        'attendedAt': '2026-09-18T18:10:00Z',
      };

      await openDetail(tester, width: 320);

      expect(find.text('Em atendimento'), findsOneWidget);
      expect(find.text('Maria Silva'), findsOneWidget);
      expect(find.text('+55 (21) 98505-0120'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('detail-whatsapp')),
        findsOneWidget,
      );
      expect(find.text('Separar para retirada.'), findsOneWidget);

      expect(find.text('Histórico do atendimento'), findsOneWidget);
      expect(find.text('Atendimento iniciado'), findsOneWidget);
      expect(find.text('Rodrigo'), findsOneWidget);

      expect(
        find.byKey(const ValueKey('detail-complete')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('detail-cancel')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('detail-start')),
        findsNothing,
      );

      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'pending inicia atendimento e recarrega o detalhe',
    (tester) async {
      currentRequest = request('pending');

      transition = (parameters) async {
        expect(parameters, {
          'requestId': 'request-a',
          'action': 'start',
        });

        currentRequest = {
          ...request('in_progress'),
          'attendedByUid': 'uid-a',
          'attendedByName': 'Rodrigo',
          'attendedAt': '2026-09-18T18:10:00Z',
        };

        return [
          {
            'success': true,
            'changed': true,
            'requestId': 'request-a',
            'status': 'in_progress',
          },
        ];
      };

      await openDetail(tester);

      expect(find.text('Nova'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('detail-start')),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const ValueKey('detail-start')),
      );
      await tester.pumpAndSettle();

      expect(callsFor('transitionCatalogRequest').length, 1);
      expect(
        callsFor('transitionCatalogRequest').single['parameters'],
        {
          'requestId': 'request-a',
          'action': 'start',
        },
      );

      expect(callsFor('getCatalogRequest').length, 2);
      expect(find.text('Em atendimento'), findsOneWidget);
      expect(find.text('Atendimento iniciado'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('detail-complete')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'in_progress finaliza somente após confirmação',
    (tester) async {
      currentRequest = {
        ...request('in_progress'),
        'attendedByUid': 'uid-a',
        'attendedByName': 'Rodrigo',
        'attendedAt': '2026-09-18T18:10:00Z',
      };

      transition = (parameters) async {
        expect(parameters, {
          'requestId': 'request-a',
          'action': 'complete',
        });

        currentRequest = {
          ...currentRequest,
          'status': 'completed',
          'completedByUid': 'uid-a',
          'completedByName': 'Rodrigo',
          'completedAt': '2026-09-18T18:20:00Z',
        };

        return [
          {
            'success': true,
            'changed': true,
            'requestId': 'request-a',
            'status': 'completed',
          },
        ];
      };

      await openDetail(tester);

      await tester.tap(
        find.byKey(const ValueKey('detail-complete')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Finalizar atendimento?'), findsOneWidget);
      expect(callsFor('transitionCatalogRequest'), isEmpty);

      await tester.tap(
        find.byKey(
          const ValueKey('confirm-detail-complete'),
        ),
      );
      await tester.pumpAndSettle();

      expect(callsFor('transitionCatalogRequest').length, 1);
      expect(find.text('Finalizada'), findsOneWidget);
      expect(find.text('Atendimento finalizado'), findsOneWidget);

      expect(
        find.byKey(const ValueKey('detail-complete')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('detail-cancel')),
        findsNothing,
      );
    },
  );

  testWidgets(
    'in_progress cancela somente após confirmação',
    (tester) async {
      currentRequest = {
        ...request('in_progress'),
        'attendedByUid': 'uid-a',
        'attendedByName': 'Rodrigo',
        'attendedAt': '2026-09-18T18:10:00Z',
      };

      transition = (parameters) async {
        expect(parameters, {
          'requestId': 'request-a',
          'action': 'cancel',
        });

        currentRequest = {
          ...currentRequest,
          'status': 'cancelled',
          'cancelledByUid': 'uid-a',
          'cancelledByName': 'Rodrigo',
          'cancelledAt': '2026-09-18T18:20:00Z',
        };

        return [
          {
            'success': true,
            'changed': true,
            'requestId': 'request-a',
            'status': 'cancelled',
          },
        ];
      };

      await openDetail(tester);

      await tester.tap(
        find.byKey(const ValueKey('detail-cancel')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Cancelar atendimento?'), findsOneWidget);
      expect(callsFor('transitionCatalogRequest'), isEmpty);

      await tester.tap(
        find.byKey(
          const ValueKey('confirm-detail-cancel'),
        ),
      );
      await tester.pumpAndSettle();

      expect(callsFor('transitionCatalogRequest').length, 1);
      expect(
        callsFor('transitionCatalogRequest').single['parameters'],
        {
          'requestId': 'request-a',
          'action': 'cancel',
        },
      );

      expect(find.text('Cancelada'), findsOneWidget);
      expect(find.text('Solicitação cancelada'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('detail-complete')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('detail-cancel')),
        findsNothing,
      );
    },
  );

  testWidgets(
    'legacy sem cliente continua seguro',
    (tester) async {
      currentRequest = request(
        'pending',
        withClient: false,
      );

      await openDetail(tester, width: 320);

      expect(
        find.text('Cliente não identificado'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('detail-whatsapp')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('detail-note')),
        findsNothing,
      );
      expect(
        find.text('Atendimento ainda não iniciado.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('detail-start')),
        findsOneWidget,
      );

      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'completed é terminal mas mantém cliente e lifecycle',
    (tester) async {
      currentRequest = {
        ...request('completed'),
        'attendedByUid': 'uid-a',
        'attendedByName': 'Rodrigo',
        'attendedAt': '2026-09-18T18:10:00Z',
        'completedByUid': 'uid-b',
        'completedByName': null,
        'completedAt': '2026-09-18T18:20:00Z',
      };

      await openDetail(tester);

      expect(find.text('Finalizada'), findsOneWidget);
      expect(find.text('Atendimento iniciado'), findsOneWidget);
      expect(find.text('Atendimento finalizado'), findsOneWidget);
      expect(
        find.text('Responsável não identificado'),
        findsOneWidget,
      );

      expect(
        find.byKey(const ValueKey('detail-start')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('detail-complete')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('detail-cancel')),
        findsNothing,
      );

      expect(
        find.byKey(const ValueKey('detail-whatsapp')),
        findsOneWidget,
      );
    },
  );
}