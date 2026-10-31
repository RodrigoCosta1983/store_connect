// Official Firebase platform fakes and callable channel; no remote access.
// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/user_role_provider.dart';
import 'package:store_connect/screens/management/manage_products_screen.dart';

class _Auth extends FirebaseAuthPlatform {
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    dynamic currentUser,
    String? languageCode,
  }) => this;
  @override
  Stream<UserPlatform?> authStateChanges() => const Stream.empty();
}

class _Firestore extends FirebaseFirestorePlatform {
  _Firestore()
    : super(appInstance: Firebase.app(), databaseChoice: '(default)');
  final products = <String, Map<String, dynamic>>{};
  int codChecks = 0;
  int ids = 0;
  DocumentSnapshotPlatform snapshot(String path, Map<String, dynamic>? data) =>
      DocumentSnapshotPlatform(
        this,
        path,
        data,
        InternalSnapshotMetadata(hasPendingWrites: false, isFromCache: false),
      );
  QuerySnapshotPlatform rows(String path, Iterable<List<dynamic>> conditions) {
    var entries = path.endsWith('/products')
        ? products.entries.toList()
        : <MapEntry<String, Map<String, dynamic>>>[];
    for (final filter in conditions) {
      final field = filter[0];
      final key = field is FieldPath ? field.components.join('.') : field;
      entries = entries.where((e) => e.value[key] == filter[2]).toList();
    }
    return QuerySnapshotPlatform(
      entries.map((e) => snapshot('$path/${e.key}', e.value)).toList(),
      [],
      SnapshotMetadataPlatform(false, false),
    );
  }

  @override
  FirebaseFirestorePlatform delegateFor({
    required FirebaseApp app,
    required String databaseId,
  }) => this;
  @override
  CollectionReferencePlatform collection(String path) =>
      _Collection(this, path);
}

class _Collection extends CollectionReferencePlatform {
  _Collection(this.fake, String path, [this.filters = const []])
    : super(fake, path);
  final _Firestore fake;
  final Iterable<List<dynamic>> filters;
  @override
  Map<String, dynamic> get parameters => {
    'orderBy': <List<dynamic>>[],
    'where': filters.toList(),
  };
  @override
  DocumentReferencePlatform doc([String? path]) =>
      _Document(fake, '${this.path}/${path ?? 'request-${fake.ids++}'}');
  @override
  QueryPlatform where(Iterable<List<dynamic>> conditions) =>
      _Collection(fake, path, conditions);
  @override
  QueryPlatform orderBy(Iterable<List<dynamic>> orders) => this;
  @override
  Future<QuerySnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async {
    if (filters.isNotEmpty) fake.codChecks++;
    return fake.rows(path, filters);
  }

  @override
  Stream<QuerySnapshotPlatform> snapshots({
    bool includeMetadataChanges = false,
    required ListenSource listenSource,
  }) => Stream.value(fake.rows(path, filters));
}

class _Document extends DocumentReferencePlatform {
  _Document(this.fake, String path) : super(fake, path);
  final _Firestore fake;
  Map<String, dynamic>? get data =>
      path.startsWith('stores/') && path.split('/').length == 2
      ? {'subscriptionType': 'pro', 'subscriptionStatus': 'active'}
      : fake.products[path.split('/').last];
  @override
  Future<DocumentSnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async => fake.snapshot(path, data);
  @override
  Stream<DocumentSnapshotPlatform> snapshots({
    bool includeMetadataChanges = false,
    required ListenSource listenSource,
  }) => Stream.value(fake.snapshot(path, data));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );
  late _Firestore firestore;
  final calls = <Map<String, dynamic>>[];
  final receipts = <String, String>{};
  late Future<List<Object?>> Function(Map<String, dynamic>) respond;
  int writes = 0;
  List<Object?> failure(String code, String reason) => [
    code,
    'Falha simulada',
    {
      'code': code,
      'message': 'Falha simulada',
      'additionalData': {'reason': reason},
    },
  ];
  List<Object?> commit(Map<String, dynamic> call) {
    final parameters = Map<String, dynamic>.from(call['parameters'] as Map);
    final requestId = parameters['requestId'] as String;
    final body = jsonEncode(parameters);
    if (receipts.containsKey(requestId)) {
      if (receipts[requestId] != body) {
        return failure('already-exists', 'request-id-reused');
      }
      return [
        {
          'success': true,
          'productId': parameters['productId'] ?? 'persisted',
          'replayed': true,
        },
      ];
    }
    receipts[requestId] = body;
    firestore.products[parameters['productId'] as String? ?? 'persisted'] =
        Map<String, dynamic>.from(parameters['product'] as Map);
    writes++;
    return [
      {
        'success': true,
        'productId': parameters['productId'] ?? 'persisted',
        'replayed': false,
      },
    ];
  }

  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
    FirebaseAuthPlatform.instance = _Auth();
    firestore = _Firestore();
    FirebaseFirestorePlatform.instance = firestore;
  });
  setUp(() {
    firestore.products.clear();
    firestore.codChecks = 0;
    firestore.ids = 0;
    calls.clear();
    receipts.clear();
    writes = 0;
    respond = (call) async => commit(call);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
          final call = Map<String, dynamic>.from(
            (message as List).single as Map,
          );
          expect([
            'createProduct',
            'updateProduct',
          ], contains(call['functionName']));
          calls.add(call);
          return respond(call);
        });
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null),
  );
  Finder field(String label) => find.byWidgetPredicate(
    (w) => w is TextField && w.decoration?.labelText == label,
  );
  Future<void> open(WidgetTester tester, {bool editing = false}) async {
    tester.view.physicalSize = const Size(1200, 1800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    if (editing) {
      firestore.products['p'] = {
        'name': 'Original',
        'name_lowercase': 'original',
        'cod': 'OLD',
        'price': 10.0,
        'quantidade': 5,
        'lotes': [],
        'minimumStock': 1,
        'imageUrl': '',
      };
    }
    final role = UserRoleProvider();
    addTearDown(role.dispose);
    await tester.pumpWidget(
      ChangeNotifierProvider<UserRoleProvider>.value(
        value: role,
        child: const MaterialApp(
          home: ManageProductsScreen(storeId: 'hml-fixture'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(
      editing
          ? find.byIcon(Icons.edit).first
          : find.byTooltip('Adicionar Produto'),
    );
    await tester.pumpAndSettle();
    await tester.enterText(field('Nome do Produto'), 'Produto');
    await tester.enterText(field('COD'), 'RETRY');
    await tester.ensureVisible(field('Preço'));
    await tester.enterText(field('Preço'), '10');
    await tester.ensureVisible(field('Quantidade Manual'));
    await tester.enterText(field('Quantidade Manual'), '5');
  }

  Future<void> save(WidgetTester tester) async {
    // Let a previous error SnackBar expire before the user's next attempt.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ElevatedButton, 'Salvar'));
    await tester.pumpAndSettle();
  }

  for (final editing in [false, true]) {
    testWidgets('commit then lost response replays once; editing=$editing', (
      tester,
    ) async {
      await open(tester, editing: editing);
      respond = (call) async {
        final result = commit(call);
        if (editing && calls.length == 1) {
          // A later operation releases RETRY and another product claims it.
          // The original receipt must still replay without reverting that work.
          firestore.products['p']!['cod'] = 'LATER';
          firestore.products['other'] = {'name': 'Other', 'cod': 'RETRY'};
        }
        return calls.length == 1
            ? failure('unavailable', 'simulated-response-loss')
            : result;
      };
      await save(tester);
      expect(writes, 1);
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(
        tester.widget<TextField>(field('Nome do Produto')).controller!.text,
        'Produto',
      );
      expect(firestore.codChecks, 1);
      await save(tester);
      expect(calls.length, 2);
      expect(calls[1]['parameters'], calls[0]['parameters']);
      expect(firestore.codChecks, 1);
      expect(writes, 1);
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Produto salvo com sucesso!'), findsOneWidget);
      if (editing) expect(firestore.products['p']!['cod'], 'LATER');
    });
  }
  testWidgets('existing COD before first attempt prevents submission', (
    tester,
  ) async {
    await open(tester);
    firestore.products['other'] = {'cod': 'RETRY'};
    await save(tester);
    expect(calls, isEmpty);
    expect(writes, 0);
    expect(
      find.text('Este COD já está sendo usado por outro produto.'),
      findsOneWidget,
    );
    expect(find.byType(AlertDialog), findsOneWidget);
  });
  testWidgets('failure before commit can retry; no false duplicate', (
    tester,
  ) async {
    await open(tester);
    respond = (call) async => calls.length == 1
        ? failure('deadline-exceeded', 'before-commit')
        : commit(call);
    await save(tester);
    expect(writes, 0);
    await save(tester);
    expect(writes, 1);
    expect(calls[1]['parameters'], calls[0]['parameters']);
  });
  for (final editing in [false, true]) {
    testWidgets(
      'incomplete response after commit remains recoverable; editing=$editing',
      (tester) async {
        await open(tester, editing: editing);
        respond = (call) async {
          final result = commit(call);
          return calls.length == 1
              ? [
                  {'success': true},
                ]
              : result;
        };
        await save(tester);
        expect(writes, 1);
        expect(find.byType(AlertDialog), findsOneWidget);
        await save(tester);
        expect(writes, 1);
        expect(calls[1]['parameters'], calls[0]['parameters']);
        expect(find.byType(AlertDialog), findsNothing);
      },
    );
  }
  testWidgets(
    'changed payload after ambiguous commit keeps requestId and cannot duplicate',
    (tester) async {
      await open(tester);
      respond = (call) async {
        final result = commit(call);
        return calls.length == 1 ? failure('unavailable', 'lost') : result;
      };
      await save(tester);
      await tester.ensureVisible(field('Nome do Produto'));
      await tester.enterText(field('Nome do Produto'), 'Alterado');
      await save(tester);
      expect(writes, 1);
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(
        find.textContaining(
          'A tentativa anterior foi enviada com outros dados.',
        ),
        findsOneWidget,
      );
      expect(
        (calls[1]['parameters'] as Map)['requestId'],
        (calls[0]['parameters'] as Map)['requestId'],
      );
      await tester.ensureVisible(field('Nome do Produto'));
      await tester.enterText(field('Nome do Produto'), 'Produto');
      await save(tester);
      expect(writes, 1);
      expect(find.byType(AlertDialog), findsNothing);
    },
  );
  testWidgets('in-flight save cannot be submitted twice', (tester) async {
    await open(tester);
    final pending = Completer<List<Object?>>();
    respond = (_) => pending.future;
    await tester.tap(find.widgetWithText(ElevatedButton, 'Salvar'));
    await tester.pump();
    expect(calls.length, 1);
    final button = tester.widget<ElevatedButton>(
      find.byType(ElevatedButton).last,
    );
    expect(button.onPressed, isNull);
    pending.complete(commit(calls.single));
    await tester.pumpAndSettle();
    expect(writes, 1);
    expect(calls.length, 1);
  });
}
