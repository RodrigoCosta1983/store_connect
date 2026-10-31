// Official platform fakes: no network or Firebase writes.
// ignore_for_file: depend_on_referenced_packages
import 'dart:async';

import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:store_connect/screens/management/category_management_screen.dart';
import 'package:store_connect/widgets/category_management_groups.dart';

class _User extends Fake
    with MockPlatformInterfaceMixin
    implements UserPlatform {
  @override
  String get uid => 'admin';
}

class _Auth extends FirebaseAuthPlatform {
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    dynamic currentUser,
    String? languageCode,
  }) => this;
  @override
  UserPlatform get currentUser => _User();
}

class _Firestore extends FirebaseFirestorePlatform {
  _Firestore()
    : super(appInstance: Firebase.app(), databaseChoice: '(default)');
  late StreamController<QuerySnapshotPlatform> events;
  List<Map<String, Object?>> rows = [];
  String role = 'admin';
  final paths = <String>[];
  void reset() {
    events = StreamController<QuerySnapshotPlatform>.broadcast();
    rows = [];
    role = 'admin';
    paths.clear();
  }

  DocumentSnapshotPlatform snapshot(String path, Map<String, Object?>? data) =>
      DocumentSnapshotPlatform(
        this,
        path,
        data,
        InternalSnapshotMetadata(hasPendingWrites: false, isFromCache: false),
      );
  QuerySnapshotPlatform querySnapshot(String path) => QuerySnapshotPlatform(
    rows
        .map((row) => snapshot('$path/${row['id']}', {...row}..remove('id')))
        .toList(),
    [],
    SnapshotMetadataPlatform(false, false),
  );
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
  _Collection(this.fake, String path) : super(fake, path);
  final _Firestore fake;
  @override
  Map<String, dynamic> get parameters => {
    'orderBy': <List<dynamic>>[],
    'where': <List<dynamic>>[],
  };
  @override
  DocumentReferencePlatform doc([String? path]) =>
      _Document(fake, '${this.path}/${path ?? 'new'}');
  @override
  QueryPlatform orderBy(Iterable<List<dynamic>> orders) => this;
  @override
  Future<QuerySnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async => fake.querySnapshot(path);
  @override
  Stream<QuerySnapshotPlatform> snapshots({
    bool includeMetadataChanges = false,
    required ListenSource listenSource,
  }) {
    fake.paths.add(path);
    return fake.events.stream;
  }
}

class _Document extends DocumentReferencePlatform {
  _Document(this.fake, String path) : super(fake, path);
  final _Firestore fake;
  @override
  Future<DocumentSnapshotPlatform> get([
    GetOptions options = const GetOptions(),
  ]) async => fake.snapshot(path, {'role': fake.role});
}

const entries = [
  CategoryManagementEntry(id: 'skin', name: 'Cuidados com a Pele'),
  CategoryManagementEntry(
    id: 'body',
    name: 'Cuidados Corporais',
    parentId: 'skin',
  ),
  CategoryManagementEntry(id: 'solo', name: 'Cabelos'),
  CategoryManagementEntry(id: 'bad', name: 'Órfã', parentId: 'missing'),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _Firestore firestore;
  final calls = <Map<String, dynamic>>[];
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    StandardMessageCodec(),
  );
  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
    FirebaseAuthPlatform.instance = _Auth();
    firestore = _Firestore();
    FirebaseFirestorePlatform.instance = firestore;
  });
  setUp(() {
    firestore.reset();
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
          final args = Map<String, dynamic>.from(
            (message as List).single as Map,
          );
          calls.add(args);
          final parameters = args['parameters'] as Map;
          if (args['functionName'] == 'deleteCategory') {
            return [
              {
                'success': true,
                'deleted': true,
                'categoryId': parameters['categoryId'],
              },
            ];
          }
          if (args['functionName'] == 'upsertCategory') {
            return [
              {
                'success': true,
                'mode': parameters.containsKey('categoryId')
                    ? 'update'
                    : 'create',
                'categoryId': parameters['categoryId'] ?? 'new',
                'changed': true,
                'parentCategoryId': parameters['parentCategoryId'],
              },
            ];
          }
          fail('Unexpected callable');
        });
  });
  tearDown(() async {
    await firestore.events.close();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, null);
  });

  Future<void> screen(WidgetTester tester, {bool emit = true}) async {
    await tester.pumpWidget(
      const MaterialApp(home: CategoryManagementScreen(storeId: 'store-a')),
    );
    await tester.pump();
    if (emit) {
      firestore.events.add(
        firestore.querySnapshot('stores/store-a/categories'),
      );
      await tester.pumpAndSettle();
    }
  }

  void seed() {
    firestore.rows = [
      {'id': 'skin', 'name': 'Cuidados com a Pele', 'imageUrl': ''},
      {
        'id': 'body',
        'name': 'Cuidados Corporais',
        'imageUrl': '',
        'parentCategoryId': 'skin',
      },
    ];
  }

  Future<void> groups(
    WidgetTester tester, {
    double width = 360,
    double scale = 1,
    List<CategoryManagementEntry> data = entries,
    ValueChanged<String>? edit,
    ValueChanged<String>? delete,
  }) async {
    tester.view.physicalSize = Size(width, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(width, 640),
            textScaler: TextScaler.linear(scale),
          ),
          child: Scaffold(
            body: SingleChildScrollView(
              child: CategoryManagementGroups(
                entries: data,
                canDelete: true,
                onEdit: edit ?? (_) {},
                onDelete: delete ?? (_) {},
              ),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets(
    'groups expand/collapse; leaf and invalid documents remain accessible',
    (tester) async {
      final edited = <String>[];
      final deleted = <String>[];
      await groups(tester, edit: edited.add, delete: deleted.add);
      expect(find.text('Cuidados Corporais'), findsNothing);
      expect(find.byKey(const ValueKey('category-expand-solo')), findsNothing);
      expect(
        find.textContaining('Vínculo hierárquico inválido'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const ValueKey('category-expand-skin')));
      await tester.pump();
      expect(find.text('Cuidados Corporais'), findsOneWidget);
      expect(find.textContaining('Subcategoria de'), findsNothing);
      expect(find.byType(Checkbox), findsNothing);
      for (final id in ['skin', 'body', 'solo', 'bad']) {
        await tester.tap(find.byKey(ValueKey('category-edit-$id')));
        await tester.tap(find.byKey(ValueKey('category-delete-$id')));
      }
      expect(edited, ['skin', 'body', 'solo', 'bad']);
      expect(deleted, edited);
      await tester.tap(find.byKey(const ValueKey('category-expand-skin')));
      await tester.pump();
      expect(find.text('Cuidados Corporais'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('screen keeps short groups below AppBar at all widths', (
    tester,
  ) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.devicePixelRatio = 1;
    for (final width in [360.0, 768.0, 1440.0]) {
      await tester.pumpWidget(const SizedBox());
      tester.view.physicalSize = Size(width, 900);
      seed();
      firestore.rows.add({'id': 'solo', 'name': 'Cabelos', 'imageUrl': ''});
      await screen(tester);
      final first = tester.getRect(
        find.byKey(const ValueKey('category-group-skin')),
      );
      final second = tester.getRect(
        find.byKey(const ValueKey('category-group-solo')),
      );
      final appBar = tester.getRect(find.byType(AppBar));
      final contentWidth = width > 1100 ? 1100.0 : width;
      expect(first.top, appBar.bottom + 8);
      expect(first.left, (width - contentWidth) / 2 + 12);
      if (width >= 700) {
        expect(second.top, first.top);
        expect(second.right, (width + contentWidth) / 2 - 12);
      } else {
        expect(second.top, greaterThan(first.bottom));
        expect(second.left, first.left);
      }
      expect(find.byTooltip('Adicionar Categoria'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });
  testWidgets('tablet and web keep groups in two columns', (tester) async {
    for (final width in [768.0, 1100.0]) {
      await groups(tester, width: width);
      final first = tester.getTopLeft(
        find.byKey(const ValueKey('category-group-skin')),
      );
      final second = tester.getTopLeft(
        find.byKey(const ValueKey('category-group-solo')),
      );
      expect(first.dy, second.dy);
      expect(second.dx, greaterThan(first.dx));
      expect(tester.takeException(), isNull);
    }
  });
  testWidgets(
    'short names keep compact rows and visual weight separates levels',
    (tester) async {
      await groups(
        tester,
        data: const [
          CategoryManagementEntry(id: 'p', name: 'Sol'),
          CategoryManagementEntry(id: 'c', name: 'FPS', parentId: 'p'),
        ],
      );
      expect(
        tester.getSize(find.byKey(const ValueKey('category-row-p'))).height,
        56,
      );
      await tester.tap(find.byKey(const ValueKey('category-expand-p')));
      await tester.pump();
      expect(
        tester.widget<Text>(find.text('Sol')).style!.fontWeight,
        FontWeight.w600,
      );
      expect(
        tester.widget<Text>(find.text('FPS')).style!.fontWeight,
        FontWeight.w400,
      );
      expect(tester.widget<Text>(find.text('FPS')).style!.fontSize, 15);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'narrow long names and enlarged text wrap without clipping controls',
    (tester) async {
      const long = 'Cuidados especiais com a pele e proteção diária prolongada';
      for (final scale in [1.0, 2.0, 3.0]) {
        await groups(
          tester,
          width: 280,
          scale: scale,
          data: const [
            CategoryManagementEntry(id: 'long', name: long),
            CategoryManagementEntry(id: 'child', name: long, parentId: 'long'),
          ],
        );
        await tester.tap(find.byKey(const ValueKey('category-expand-long')));
        await tester.pump();
        final title = tester.widgetList<Text>(find.text(long)).first;
        expect(title.maxLines, isNull);
        expect(title.overflow, isNot(TextOverflow.ellipsis));
        expect(title.style!.fontSize, inInclusiveRange(14, 15));
        if (scale > 1) expect(title.style!.fontSize, 15);
        expect(
          tester
              .getSize(find.byKey(const ValueKey('category-edit-long')))
              .height,
          greaterThanOrEqualTo(48),
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      }
    },
  );
  testWidgets('loading empty error and add action remain available', (
    tester,
  ) async {
    await screen(tester, emit: false);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byTooltip('Adicionar Categoria'), findsOneWidget);
    firestore.events.add(firestore.querySnapshot('stores/store-a/categories'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Nenhuma categoria registada'), findsOneWidget);
    firestore.events.addError(StateError('local fake error'));
    await tester.pumpAndSettle();
    expect(find.text('Erro ao carregar categorias.'), findsOneWidget);
    await tester.tap(find.byTooltip('Adicionar Categoria'));
    await tester.pumpAndSettle();
    expect(find.text('Nova Categoria'), findsOneWidget);
    expect(calls, isEmpty);
    expect(
      firestore.paths.every((p) => p == 'stores/store-a/categories'),
      isTrue,
    );
  });
  testWidgets('management route returns to the previous screen', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      const CategoryManagementScreen(storeId: 'store-a'),
                ),
              ),
              child: const Text('Abrir categorias'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir categorias'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    firestore.events.add(firestore.querySnapshot('stores/store-a/categories'));
    await tester.pump();
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Abrir categorias'), findsOneWidget);
    expect(find.byType(CategoryManagementScreen), findsNothing);
    expect(calls, isEmpty);
  });
  testWidgets(
    'editing child sends existing ID and parent to unchanged callable',
    (tester) async {
      seed();
      await screen(tester);
      await tester.tap(find.byKey(const ValueKey('category-expand-skin')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('category-edit-body')));
      await tester.pumpAndSettle();
      expect(find.text('Editar Categoria'), findsWidgets);
      expect(
        find.widgetWithText(TextFormField, 'Cuidados Corporais'),
        findsOneWidget,
      );
      await tester.enterText(find.byType(TextFormField), 'Corpo');
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(calls.single['functionName'], 'upsertCategory');
      expect(calls.single['parameters'], {
        'categoryId': 'body',
        'name': 'Corpo',
        'imageUrl': '',
        'parentCategoryId': 'skin',
      });
      expect(find.byType(AlertDialog), findsNothing);
    },
  );
  testWidgets(
    'delete confirmation cancellation does not call backend; confirm targets child',
    (tester) async {
      seed();
      await screen(tester);
      await tester.tap(find.byKey(const ValueKey('category-expand-skin')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('category-delete-body')));
      await tester.pumpAndSettle();
      expect(find.text('Confirmar Eliminação'), findsOneWidget);
      expect(calls, isEmpty);
      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      await tester.tap(find.byKey(const ValueKey('category-delete-body')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Eliminar'));
      await tester.pumpAndSettle();
      expect(calls.single['functionName'], 'deleteCategory');
      expect(calls.single['parameters'], {'categoryId': 'body'});
      expect(find.byType(AlertDialog), findsNothing);
    },
  );
  testWidgets(
    'operator cannot see delete actions; creation retains root payload',
    (tester) async {
      seed();
      firestore.role = 'operador';
      await screen(tester);
      expect(find.byTooltip('Eliminar Categoria'), findsNothing);
      await tester.tap(find.byTooltip('Adicionar Categoria'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), 'Nova');
      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(calls.single['parameters'], {
        'name': 'Nova',
        'imageUrl': '',
        'parentCategoryId': null,
      });
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
