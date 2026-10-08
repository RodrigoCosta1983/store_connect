import 'dart:async';
import 'dart:io';

// ignore: depend_on_referenced_packages
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
// ignore: depend_on_referenced_packages
import 'package:firebase_core_platform_interface/test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/sales/new_sale_screen.dart';
import 'package:store_connect/services/home/smart_home_screen.dart';
import 'package:store_connect/services/navigation_service.dart';

// Keep all Firestore reads local; data loading is outside these navigation tests.
class _Firestore extends FirebaseFirestorePlatform {
  @override
  FirebaseFirestorePlatform delegateFor({required FirebaseApp app,
      required String databaseId}) => this;
  @override
  CollectionReferencePlatform collection(String path) => _Collection(this, path);
  @override
  DocumentReferencePlatform doc(String path) => _Document(this, path);
}

class _Collection extends CollectionReferencePlatform {
  _Collection(super.firestore, super.path) {
    parameters.addAll({'orderBy': <List<dynamic>>[], 'where': <List<dynamic>>[]});
  }
  @override
  DocumentReferencePlatform doc([String? path]) =>
      _Document(firestore, '${this.path}/${path ?? 'test'}');
  @override
  QueryPlatform orderBy(Iterable<List<dynamic>> orders) => this;
  @override
  QueryPlatform where(List<List<dynamic>> conditions) => this;
  @override
  Stream<QuerySnapshotPlatform> snapshots({bool includeMetadataChanges = false,
      required ListenSource listenSource}) => const Stream.empty();
  @override
  Future<QuerySnapshotPlatform> get([GetOptions options = const GetOptions()]) =>
      Completer<QuerySnapshotPlatform>().future;
}

class _Document extends DocumentReferencePlatform {
  _Document(super.firestore, super.path);
  @override
  Stream<DocumentSnapshotPlatform> snapshots({bool includeMetadataChanges = false,
      required ListenSource listenSource}) => const Stream.empty();
  @override
  Future<DocumentSnapshotPlatform> get([GetOptions options = const GetOptions()]) =>
      Completer<DocumentSnapshotPlatform>().future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory databaseDirectory;
  setUpAll(() async {
    setupFirebaseCoreMocks();
    await Firebase.initializeApp();
    FirebaseFirestorePlatform.instance = _Firestore();
    databaseDirectory = await Directory.systemTemp.createTemp('home_navigation_');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('plugins.flutter.io/path_provider'),
            (_) async => databaseDirectory.path);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('dev.fluttercommunity.plus/package_info'),
            (_) async => <String, dynamic>{'appName': 'Test', 'packageName': 'test',
              'version': '1', 'buildNumber': '1'});
    await AppDatabase.instance.getSalesWaitingForSync();
  });
  tearDownAll(() async {
    await AppDatabase.instance.close();
    await databaseDirectory.delete(recursive: true);
  });

  Future<CartProvider> open(WidgetTester tester, Widget screen,
      {bool withItems = false}) async {
    final cart = CartProvider();
    if (withItems) {
      cart.addItem(Product(id: 'p1', name: 'Produto', price: 10,
          quantidade: 5, minimumStock: 0));
      cart.addItem(Product(id: 'p1', name: 'Produto', price: 10,
          quantidade: 5, minimumStock: 0));
    }
    await tester.pumpWidget(ChangeNotifierProvider.value(value: cart,
      child: MaterialApp(navigatorKey: NavigationService.navigatorKey,
        home: const Scaffold(body: Text('Origem intermediária')))));
    NavigationService.navigatorKey.currentState!.push(
      MaterialPageRoute<void>(builder: (_) => screen));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pump();
    return cart;
  }

  Future<void> finishNavigation(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(tester.widget<HomeScreen>(find.byType(HomeScreen)).storeId, 'store');
    expect(NavigationService.navigatorKey.currentState!.canPop(), isFalse);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 1));
  }

  testWidgets('Radar exibe Home e vai ao destino fixo removendo a pilha', (tester) async {
    await open(tester, const SmartHomeScreen(storeId: 'store'));
    expect(find.byIcon(Icons.home_outlined), findsOneWidget);
    expect(find.byTooltip('Início'), findsOneWidget);
    await tester.tap(find.byTooltip('Início'));
    await finishNavigation(tester);
  });

  testWidgets('Nova Venda mantém Menu, Home e título nessa ordem', (tester) async {
    await open(tester, const NewSaleScreen(storeId: 'store'));
    expect(find.byType(DrawerButton), findsOneWidget);
    expect(find.byIcon(Icons.home_outlined), findsOneWidget);
    expect(find.text('Nova Venda'), findsOneWidget);
    expect(tester.getCenter(find.byType(DrawerButton)).dx,
        lessThan(tester.getCenter(find.byTooltip('Início')).dx));
    expect(tester.getCenter(find.byTooltip('Início')).dx,
        lessThan(tester.getCenter(find.text('Nova Venda')).dx));
    await tester.tap(find.byType(DrawerButton));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final scaffold = tester.state<ScaffoldState>(find.byType(Scaffold).last);
    expect(scaffold.isDrawerOpen, isTrue);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 1));
  });

  for (final width in [320.0, 360.0, 400.0]) {
    testWidgets('Cabeçalho sem overflow em largura $width', (tester) async {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await open(tester, const NewSaleScreen(storeId: 'store'));
      expect(find.byType(DrawerButton), findsOneWidget);
      expect(find.byTooltip('Início'), findsOneWidget);
      expect(find.text('Nova Venda'), findsOneWidget);
      expect(find.byIcon(Icons.search), findsOneWidget);
      expect(find.byIcon(Icons.shopping_cart), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byIcon(Icons.search));
      await tester.pump();
      expect(find.byType(TextField), findsOneWidget);
      expect(find.byTooltip('Início'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(milliseconds: 1));
    });
  }

  testWidgets('Venda vazia vai direto à Home sem confirmação nem simples pop', (tester) async {
    await open(tester, const NewSaleScreen(storeId: 'store'));
    await tester.tap(find.byTooltip('Início'));
    expect(find.text('Venda em andamento'), findsNothing);
    await finishNavigation(tester);
  });

  testWidgets('Continuar venda preserva produtos e quantidade', (tester) async {
    final cart = await open(tester, const NewSaleScreen(storeId: 'store'), withItems: true);
    await tester.tap(find.byTooltip('Início'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Venda em andamento'), findsOneWidget);
    expect(find.text('Você já adicionou produtos a esta venda. Deseja sair e voltar para o início?'), findsOneWidget);
    await tester.tap(find.text('Continuar venda'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(NewSaleScreen), findsOneWidget);
    expect(cart.items['p1']!.quantity, 2);
    expect(cart.totalAmount, 20);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(milliseconds: 1));
  });

  testWidgets('Sair da venda confirma e navega à Home', (tester) async {
    await open(tester, const NewSaleScreen(storeId: 'store'), withItems: true);
    await tester.tap(find.byTooltip('Início'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.text('Sair da venda'));
    await finishNavigation(tester);
  });

  for (final screen in <Widget>[const NewSaleScreen(storeId: 'store'),
      const SmartHomeScreen(storeId: 'store')]) {
    testWidgets('Voltar nativo mantém a origem em ${screen.runtimeType}', (tester) async {
      final cart = await open(tester, screen, withItems: true);
      await tester.binding.handlePopRoute();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Origem intermediária'), findsOneWidget);
      expect(find.byType(HomeScreen), findsNothing);
      expect(find.text('Venda em andamento'), findsNothing);
      expect(cart.items['p1']!.quantity, 2);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(milliseconds: 1));
    });
  }
}
