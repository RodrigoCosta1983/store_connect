// Host SDK boundary tests: official FlutterFire platform APIs, no remote IO.
// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'dart:io';
import 'package:drift/native.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/services/offline_sales_sync_service.dart';
import 'package:cloud_firestore_platform_interface/cloud_firestore_platform_interface.dart'
    as fp;
import 'package:firebase_auth_platform_interface/firebase_auth_platform_interface.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_core_platform_interface/test.dart';
import 'package:cloud_functions_platform_interface/src/pigeon/messages.pigeon.dart';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:store_connect/widgets/payment_options_sheet.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/models/customer_model.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:store_connect/firebase/app_environment.dart';
import 'package:store_connect/firebase/commercial_checkout_origin.dart';
import 'package:store_connect/firebase/commercial_checkout_bundle.dart';
import 'package:store_connect/data/local/sale_mutation_store_native.dart';
import 'package:store_connect/models/product_model.dart';
import 'package:store_connect/providers/cart_provider.dart';
import 'package:store_connect/services/android_checkout_cart.dart';
import 'package:store_connect/services/sale_mutation_ledger.dart';
import 'package:store_connect/services/commercial_checkout_legacy_guard.dart';

class _Core implements TestFirebaseCoreHostApi {
  @override
  Future<List<CoreInitializeResponse>> initializeCore() async => [];
  @override
  Future<CoreInitializeResponse> initializeApp(
    String name,
    CoreFirebaseOptions options,
  ) async =>
      CoreInitializeResponse(name: name, options: options, pluginConstants: {});
  @override
  Future<CoreFirebaseOptions> optionsFromResource() =>
      throw StateError('Explicit identity only');
}

class _Paths extends PathProviderPlatform {
  final String directory;
  _Paths(this.directory);
  @override
  Future<String?> getApplicationSupportPath() async => directory;
}

class _Token extends Fake implements IdTokenResult {
  static String project = 'store-connect-hml';
  @override
  Map<String, dynamic> get claims => {
    'aud': project,
    'sub': 'u',
    'iss': 'https://securetoken.google.com/$project',
  };
  @override
  DateTime get expirationTime => DateTime.now().add(const Duration(hours: 1));
}

class _User extends Fake
    with MockPlatformInterfaceMixin
    implements UserPlatform {
  @override
  String get uid => 'u';
  @override
  Future<IdTokenResult> getIdTokenResult(bool forceRefresh) async => _Token();
}

class _Auth extends FirebaseAuthPlatform {
  UserPlatform? user = _User();
  final events = StreamController<UserPlatform?>.broadcast();
  @override
  FirebaseAuthPlatform delegateFor({required FirebaseApp app}) => this;
  @override
  FirebaseAuthPlatform setInitialValues({
    dynamic currentUser,
    String? languageCode,
  }) => this;
  @override
  UserPlatform? get currentUser => user;
  @override
  String? get tenantId => null;
  @override
  Stream<UserPlatform?> idTokenChanges() async* {
    yield user;
    yield* events.stream;
  }
}

class _Firestore extends fp.FirebaseFirestorePlatform {
  _Firestore()
    : super(appInstance: Firebase.app(), databaseChoice: '(default)');
  String store = 's';
  bool cached = false;
  bool offlineReads = false;
  final events = StreamController<fp.DocumentSnapshotPlatform>.broadcast();
  fp.DocumentSnapshotPlatform snapshot(String path) =>
      fp.DocumentSnapshotPlatform(
        this,
        path,
        path.startsWith('users/')
            ? {'storeId': store, 'role': 'admin'}
            : path.contains('/products/')
              ? {'name':'Synthetic','price':0.29,'quantidade':5}
              : {'subscriptionStatus': 'active'},
        fp.InternalSnapshotMetadata(
          hasPendingWrites: false,
          isFromCache: cached,
        ),
      );
  @override
  fp.Settings get settings =>
      const fp.Settings(host: 'firestore.googleapis.com', sslEnabled: true);
  @override
  fp.FirebaseFirestorePlatform delegateFor({
    required FirebaseApp app,
    required String databaseId,
  }) => this;
  @override
  fp.CollectionReferencePlatform collection(String path) =>
      _Collection(this, path);
}

class _Collection extends fp.CollectionReferencePlatform {
  final _Firestore db;
  _Collection(this.db, String path) : super(db, path);
  @override
  fp.DocumentReferencePlatform doc([String? path]) =>
      _Document(db, '${this.path}/$path');
}

class _Document extends fp.DocumentReferencePlatform {
  final _Firestore db;
  _Document(this.db, String path) : super(db, path);
  @override
  Future<fp.DocumentSnapshotPlatform> get([
    fp.GetOptions options = const fp.GetOptions(),
  ]) async {
    if (!db.offlineReads) expect(options.source, fp.Source.server);
    return db.snapshot(path);
  }

  @override
  Stream<fp.DocumentSnapshotPlatform> snapshots({
    bool includeMetadataChanges = false,
    required fp.ListenSource listenSource,
  }) async* {
    yield db.snapshot(path);
    yield* db.events.stream;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _Auth auth;
  late _Firestore db;
  late CommercialCheckoutOrigin origin;
  late Directory dir;
  late SqliteSaleMutationStore store;
  late AndroidCheckoutCart checkout;
  late CartProvider cart;
  final calls = <Map<Object?, Object?>>[];
  bool lost = false;
  Completer<void>? pause;
  const channel = BasicMessageChannel<Object?>(
    'dev.flutter.pigeon.cloud_functions_platform_interface.CloudFunctionsHostApi.call',
    CloudFunctionsHostApi.pigeonChannelCodec,
  );
  setUpAll(() async {
    TestFirebaseCoreHostApi.setUp(_Core());
    await Firebase.initializeApp(
      options: FirebaseOptions(
        apiKey: 'synthetic-only',
        appId: AppEnvironment.hml.androidAppId,
        messagingSenderId: '123',
        projectId: AppEnvironment.hml.projectId,
      ),
    );
    auth = _Auth();
    FirebaseAuthPlatform.instance = auth;
    db = _Firestore();
    fp.FirebaseFirestorePlatform.instance = db;
  });
  tearDownAll(() async {
    await auth.events.close();
    await db.events.close();
  });
  setUp(() async {
    auth.user = _User();
    db.store = 's';
    db.cached = false;
    db.offlineReads = false;
    _Token.project = 'store-connect-hml';
    calls.clear();
    lost = false;
    pause = null;
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockDecodedMessageHandler<Object?>(channel, (message) async {
          final request = Map<Object?, Object?>.from(
            (message as List).single as Map,
          );
          calls.add(request);
          await pause?.future;
          if (lost &&
              request['functionUri'].toString().endsWith(
                '/confirmCommercialSaleV2',
              )) {
            return [null, 'unavailable', 'lost response', null];
          }
          final data = Map.from(request['parameters'] as Map);
          return [
            {
              'status': 'confirmed',
              'saleId': data['saleId'],
              'totalCents': 29,
              'replayed': calls.length > 1,
            },
          ];
        });
    origin = await CommercialCheckoutOrigin.open(AppEnvironment.hml);
    await origin.authorize();
    dir = Directory.systemTemp.createTempSync('commercial06-');
    PathProviderPlatform.instance = _Paths(dir.path);
    store = SqliteSaleMutationStore('${dir.path}/sale_mutations_v1.sqlite');
    checkout = AndroidCheckoutCart(origin: origin, store: store);
    cart = CartProvider()
      ..addItem(
        Product(
          id: 'p',
          name: 'Synthetic',
          price: 0.29,
          quantidade: 5,
          minimumStock: 0,
        ),
      );
  });
  tearDown(() async {
    checkout.close();
    await origin.close();
    await store.close();
    dir.deleteSync(recursive: true);
  });
  test(
    'commercial cart -> durable ledger -> FlutterFire SDK URL -> confirmed cart',
    () async {
      final sale = await checkout.submit(cart, 's', 'PIX', '');
      expect(sale.handle.attempt.state, SaleAttemptState.confirmed);
      expect(
        calls.single['functionUri'],
        'https://us-central1-store-connect-hml.cloudfunctions.net/confirmCommercialSaleV2',
      );
      expect(calls.single['appName'], '[DEFAULT]');
      expect(await checkout.applyConfirmed(sale), true);
      expect(cart.itemCount, 0);
    },
  );
  test(
    'lost SDK response and SQLite restart recover original ID; legacy stays blocked',
    () async {
      lost = true;
      final sale = await checkout.submit(cart, 's', 'PIX', '');
      expect(sale.handle.attempt.state, SaleAttemptState.unknown);
      await expectLater(
        checkout.acknowledgeRecovered(sale.handle),
        throwsStateError,
      );
      await expectLater(
        requireNoActiveCommercialCheckout(
          'store-connect-hml',
          's',
          borrowedStore: store,
        ),
        throwsStateError,
      );
      checkout.close();
      await store.close();
      store = SqliteSaleMutationStore('${dir.path}/sale_mutations_v1.sqlite');
      checkout = AndroidCheckoutCart(origin: origin, store: store);
      final recovered = await checkout.recoverActive('s');
      expect(recovered!.attempt.state, SaleAttemptState.confirmed);
      expect(recovered.attempt.requestId, sale.handle.attempt.requestId);
      expect(
        calls.last['functionUri'],
        endsWith('/getCommercialSaleMutationResultV1'),
      );
      expect(calls.length, 2);
      expect(cart.itemCount, 1);
      expect(calls.first['parameters'], calls.last['parameters']);
      await checkout.acknowledgeRecovered(recovered);
      expect(cart.itemCount, 1);
      expect(await checkout.recoverActive('s'), isNull);
      await requireNoActiveCommercialCheckout(
        'store-connect-hml',
        's',
        borrowedStore: store,
      );
    },
  );
  test('logout in flight cannot clear cart or create a second sale', () async {
    pause = Completer<void>();
    final sending = checkout.submit(cart, 's', 'PIX', '');
    while (calls.isEmpty) {
      await Future<void>.delayed(Duration.zero);
    }
    auth.user = null;
    auth.events.add(null);
    await Future<void>.delayed(Duration.zero);
    pause!.complete();
    await expectLater(sending, throwsStateError);
    expect(cart.itemCount, 1);
    await expectLater(checkout.submit(cart, 's', 'PIX', ''), throwsStateError);
    expect(calls.length, 1);
  });
  test(
    'membership A-B-A invalidates captured binding; cached profile denied',
    () async {
      final binding = await origin.authorize();
      db.store = 'other';
      db.events.add(db.snapshot('users/u'));
      await Future<void>.delayed(Duration.zero);
      db.store = 's';
      db.events.add(db.snapshot('users/u'));
      await Future<void>.delayed(Duration.zero);
      expect(origin.isCurrent(binding), false);
      db.cached = true;
      await expectLater(origin.authorize(), throwsStateError);
      expect(calls, isEmpty);
    },
  );
  test(
    'direct legacy fiado writer cannot bypass an active V2 intention',
    () async {
      lost = true;
      await checkout.submit(cart, 's', 'PIX', '');
      final sales = SalesProvider()..updateStoreId('s');
      await expectLater(
        sales.addOrder(
          cartProducts: cart.items.values.toList(),
          total: cart.totalAmount,
          customer: Customer(id: 'c', name: 'Synthetic'),
          dueDate: DateTime.now(),
          notes: '',
        ),
        throwsStateError,
      );
      expect(calls.length, 1);
      sales.dispose();
    },
  );
  test(
    'cross-project token is refused before preparing any sale identity',
    () async {
      _Token.project = 'foreign';
      await expectLater(
        checkout.submit(cart, 's', 'PIX', ''),
        throwsStateError,
      );
      expect(calls, isEmpty);
      expect(await store.keys(''), isEmpty);
    },
  );
  test('production bundle cannot be enabled by build flag', () async {
    await expectLater(
      CommercialCheckoutBundle.open(AppEnvironment.production),
      throwsStateError,
    );
  });
  test(
    'concurrent actions cannot allocate two commercial intentions',
    () async {
      pause = Completer<void>();
      final first = checkout.submit(cart, 's', 'PIX', '');
      expect(() => checkout.submit(cart, 's', 'PIX', ''), throwsStateError);
      while (calls.isEmpty) {
        await Future<void>.delayed(Duration.zero);
      }
      pause!.complete();
      await first;
      expect(calls.length, 1);
    },
  );
  testWidgets(
    'real commercial PaymentOptionsSheet uses SDK callable and returns confirmed cart',
    (tester) async {
      await tester.pumpWidget(
        ChangeNotifierProvider<CartProvider>.value(
          value: cart,
          child: MaterialApp(
            home: Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => showModalBottomSheet<bool>(
                    context: context,
                    builder: (_) => PaymentOptionsSheet(
                      storeId: 's',
                      notes: '',
                      localV2Checkout: checkout,
                    ),
                  ),
                  child: const Text('Checkout'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Checkout'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Dinheiro'));
      await tester.pumpAndSettle();
      expect(cart.itemCount, 0);
      expect(calls, hasLength(1));
      expect(calls.single['functionUri'], endsWith('/confirmCommercialSaleV2'));
      expect(find.text('Escolha a forma de pagamento'), findsNothing);
    },
  );
  testWidgets('native S03 payment persists before transport and never reports local sale as confirmed', (tester) async {
    final local=AppDatabase.offlineQueue(NativeDatabase(File('${dir.path}/offline.sqlite')));
    final repository=OfflineSalesRepository(database:local);
    var transportCalls=0;
    final sync=OfflineSalesSyncService(repository:repository,
      activeScope:()async=>{'projectId':'store-connect-hml','uid':'u','storeId':'s'},
      call:(endpoint,command)async {
        transportCalls++;
        expect(await repository.readCommand(command['requestId'] as String),isNotNull);
        throw TimeoutException('No connection');
      },refresh:(_)async{});
    db.cached=true;db.offlineReads=true;
    try {
      await tester.pumpWidget(ChangeNotifierProvider<CartProvider>.value(value:cart,
        child:MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(
          onPressed:()=>showModalBottomSheet<bool>(context:context,builder:(_)=>PaymentOptionsSheet(
            storeId:'s',notes:'',offlineQueueRepository:repository,offlineQueueSync:sync)),
          child:const Text('Offline checkout')))))));
      await tester.tap(find.text('Offline checkout'));await tester.pumpAndSettle();
      await tester.tap(find.text('Dinheiro'));
      await tester.runAsync(()async {await Future<void>.delayed(const Duration(milliseconds:350));});
      await tester.pumpAndSettle();
      expect(cart.itemCount,0);expect(transportCalls,1);expect(calls,isEmpty);
      final row=(await repository.getLocalHistory()).single;
      expect(row.status,'unknown');expect(await repository.readCommand(row.localId),isNotNull);
      expect(find.byType(SnackBar),findsNothing);
      expect(find.textContaining('quando a internet voltar'),findsNothing);
      expect(find.textContaining('Venda finalizada'),findsNothing);
    }finally{db.cached=false;db.offlineReads=false;await local.close();}
  });
  for (final refreshFails in [false, true]) {
    testWidgets('native payment reports actual confirmation, refreshFails=$refreshFails', (tester) async {
      final local=AppDatabase.offlineQueue(NativeDatabase(File('${dir.path}/feedback.sqlite')));
      final repository=OfflineSalesRepository(database:local);
      final response=Completer<void>();
      final sync=OfflineSalesSyncService(repository:repository,
        activeScope:()async=>{'projectId':'store-connect-hml','uid':'u','storeId':'s'},
        call:(endpoint,command)async {
          await response.future;
          return {'status':'confirmed','requestId':command['requestId'],
            'saleId':command['saleId'],'totalCents':command['expectedTotalCents']};
        },refresh:(_)async{if(refreshFails)throw StateError('Cache unavailable');});
      db.cached=true;db.offlineReads=true;
      try {
        await tester.pumpWidget(ChangeNotifierProvider<CartProvider>.value(value:cart,
          child:MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(
            onPressed:()=>showModalBottomSheet<bool>(context:context,builder:(_)=>PaymentOptionsSheet(
              storeId:'s',notes:'',offlineQueueRepository:repository,offlineQueueSync:sync)),
            child:const Text('Checkout feedback')))))));
        await tester.tap(find.text('Checkout feedback'));await tester.pumpAndSettle();
        await tester.tap(find.text('Dinheiro'));
        await tester.runAsync(()async{await Future<void>.delayed(const Duration(milliseconds:350));});
        await tester.pumpAndSettle();
        expect(find.byType(SnackBar),findsNothing);
        expect(find.textContaining('quando a internet voltar'),findsNothing);
        expect(find.text('Venda finalizada e estoque atualizado!'),findsNothing);
        response.complete();
        await tester.runAsync(()async{await Future<void>.delayed(const Duration(milliseconds:350));});
        await tester.pumpAndSettle();
        expect(find.text('Venda finalizada e estoque atualizado!'),
          refreshFails ? findsNothing : findsOneWidget);
        if (refreshFails) expect(find.byType(SnackBar),findsNothing);
        expect((await repository.getLocalHistory()).single.status,
          refreshFails?'confirmedRefreshPending':'synced');
      }finally{if(!response.isCompleted)response.complete();db.cached=false;db.offlineReads=false;await local.close();}
    });
  }
}
