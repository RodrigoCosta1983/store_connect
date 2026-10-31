// ignore_for_file: depend_on_referenced_packages
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/data/local/app_database.dart';
import 'package:store_connect/data/local/offline_sales_repository.dart';
import 'package:store_connect/services/offline_sales_sync_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final scope = {'projectId':'demo-local', 'uid':'u', 'storeId':'s'};
  late Directory directory;
  late AppDatabase db;
  late OfflineSalesRepository repo;
  late Map<String,dynamic>? active;
  late List<String> calls;
  late Map<String,dynamic>? receipt;
  late int effects;
  late bool lose, refreshFails;
  Future<Map<String,dynamic>> backend(String endpoint, Map<String,dynamic> c) async {
    calls.add(endpoint);
    if (receipt != null) return {...receipt!, 'replayed':true};
    if (endpoint == 'getOfflineSaleResultV1') return {'status':'not-recorded','requestId':c['requestId']};
    effects++;
    receipt = {'status':'confirmed','requestId':c['requestId'],'saleId':c['saleId'],
      'totalCents':c['expectedTotalCents'],'replayed':false};
    if (lose) throw TimeoutException('Discarded after commit');
    return receipt!;
  }
  OfflineSalesSyncService worker({OfflineSalesRepository? repository, OfflineSaleCall? call}) =>
    OfflineSalesSyncService(repository:repository??repo, activeScope:() async=>active,
      call:call??backend, refresh:(_)async {if(refreshFails)throw StateError('No stock refresh');});
  Future<void> enqueue({String id='sale', List<Map<String,dynamic>>? products}) async {
    await repo.validateStockAndSaveSale(localId:id,originScope:scope,storeId:'s',totalAmount:10,
      products:products??[{'productId':'p','quantity':1,'name':'Product','price':10}],
      paymentMethod:'Dinheiro',knownStockByProduct:{'p':10});
  }
  setUp(() async {
    directory=await Directory.systemTemp.createTemp('s03-09-');
    db=AppDatabase.offlineQueue(NativeDatabase(File('${directory.path}/queue.db')));
    repo=OfflineSalesRepository(database:db);active={...scope};calls=[];receipt=null;effects=0;lose=false;refreshFails=false;
  });
  tearDown(() async {await db.close();await directory.delete(recursive:true);});

  test('offline capture persists immutable command without network, restart then confirms once',()async{
    final products=[{'productId':'p','quantity':1,'name':'Product','price':10}];
    await enqueue(products:products);products[0]['quantity']=9;
    final original=await repo.readCommand('sale');expect(calls,isEmpty);
    expect((await repo.getSale('sale'))!.status,'pending');
    await db.close();db=AppDatabase.offlineQueue(NativeDatabase(File('${directory.path}/queue.db')));
    repo=OfflineSalesRepository(database:db);expect(await repo.readCommand('sale'),original);
    expect((await worker().syncPendingSales()).syncedCount,1);
    await worker().syncPendingSales();expect(effects,1);expect((await repo.getSale('sale'))!.status,'synced');
  });
  test('lost response and reopened SQLite query original receipt without resending',()async{
    await enqueue();lose=true;await worker().syncPendingSales();
    expect((await repo.getSale('sale'))!.status,'unknown');
    expect((await db.getUnsyncedSalesForLocalStock()).length,1);
    await db.close();db=AppDatabase.offlineQueue(NativeDatabase(File('${directory.path}/queue.db')));
    repo=OfflineSalesRepository(database:db);calls.clear();lose=false;
    await worker().syncPendingSales();expect(calls,['getOfflineSaleResultV1']);expect(effects,1);
  });
  test('two SQLite connections claim only once; expired process claim recovers',()async{
    await enqueue();final other=AppDatabase.offlineQueue(NativeDatabase(File('${directory.path}/queue.db')));
    try {
      final claims=await Future.wait([db.claimS03('sale',DateTime.now()),other.claimS03('sale',DateTime.now())]);
      expect(claims.whereType<String>().length,1);
      final busy=await worker().syncPendingSales();
      expect(busy.syncedCount,0);expect(busy.hasBusyClaims,true);expect(calls,isEmpty);
      await db.customStatement('UPDATE offline_sale_commands_v1 SET claim_until = 0');
      await worker().syncPendingSales();expect(effects,0);
      expect(calls,['getOfflineSaleResultV1']);
      expect((await repo.getSale('sale'))!.status,'unknown');
      expect(await db.finishS03('sale',claims.whereType<String>().single,'unknown'),false);
    }finally{await other.close();}
  });
  test('two concurrent synchronizers call same sale once',()async{
    await enqueue();final entered=Completer<void>(),release=Completer<void>();
    final first=worker(call:(e,c)async {if(!entered.isCompleted)entered.complete();await release.future;return backend(e,c);});
    final pending=first.syncPendingSales();await entered.future;
    await worker().syncPendingSales();release.complete();await pending;expect(effects,1);
  });
  test('different operator/store sends nothing and late session change cannot confirm',()async{
    await enqueue();for(final change in [{'uid':'other'},{'storeId':'other'}]){
      active={...scope,...change};await worker().syncPendingSales();expect(calls,isEmpty);
    }
    active={...scope};await worker(call:(e,c)async {final r=await backend(e,c);active={...scope,'uid':'other'};return r;}).syncPendingSales();
    expect((await repo.getSale('sale'))!.status,'unknown');expect(effects,0);
    active={...scope};calls.clear();await worker().syncPendingSales();expect(effects,0);
    expect(calls,['getOfflineSaleResultV1']);
    expect((await repo.getSale('sale'))!.status,'unknown');
  });
  test('server rejection is terminal with reason and no retry or local stock reservation',()async{
    await enqueue();await worker(call:(e,c)async=>{'status':'rejected','requestId':c['requestId'],'reason':'price-conflict'}).syncPendingSales();
    final sale=(await repo.getSale('sale'))!;expect(sale.status,'rejected');expect(sale.lastSyncError,'price-conflict');
    await worker().syncPendingSales();expect(calls,isEmpty);expect(await db.getUnsyncedSalesForLocalStock(),isEmpty);
  });
  test('refresh failure retains reservation and recovers receipt instead of repeating effects',()async{
    await enqueue();refreshFails=true;await worker().syncPendingSales();expect(effects,1);
    expect((await repo.getSale('sale'))!.status,'confirmedRefreshPending');
    expect((await db.getUnsyncedSalesForLocalStock()).length,1);calls.clear();refreshFails=false;
    await worker().syncPendingSales();expect(calls,['getOfflineSaleResultV1']);expect(effects,1);
  });
  test('historical incompatible queue remains byte-identical and is never sent',()async{
    await repo.saveSale(localId:'old',storeId:'s',totalAmount:10,
      products:[{'productId':'p','quantity':1,'price':10}],paymentMethod:'A prazo');
    final before=(await db.customSelect('SELECT * FROM pending_sales').getSingle()).data;
    await worker().syncPendingSales();
    expect((await db.customSelect('SELECT * FROM pending_sales').getSingle()).data,before);
    expect(calls,isEmpty);expect(await repo.readCommand('old'),null);
  });
  test('disk failure rolls back both queue row and intention, sends nothing',()async{
    await db.prepareS03();await db.customStatement("CREATE TRIGGER fail_disk BEFORE INSERT ON offline_sale_commands_v1 BEGIN SELECT RAISE(ABORT, 'synthetic disk failure'); END");
    await expectLater(enqueue(),throwsA(anything));expect(await repo.getSale('sale'),null);
    await worker().syncPendingSales();expect(calls,isEmpty);
  });
  test('retry keeps original command and timestamp; changed intent is refused',()async{
    await enqueue();final raw=await repo.readCommand('sale');await enqueue();expect(await repo.readCommand('sale'),raw);
    await expectLater(enqueue(products:[{'productId':'p','quantity':2,'price':5}]),throwsStateError);
    expect(await repo.readCommand('sale'),raw);
    expect(jsonDecode(raw!)['requestId'],'sale');
  });
  test('store reservations do not contaminate another store',()async{
    await repo.saveSale(localId:'other-store',storeId:'other',totalAmount:100,
      products:[{'productId':'p','quantity':10,'price':10}],paymentMethod:'Dinheiro');
    await enqueue();expect((await repo.getSale('sale'))!.status,'pending');
    expect(await repo.watchReservedQuantitiesByProduct(storeId:'s').first,{'p':1});
  });
  test('normal binary money residual is accepted but real fractional-cent total is refused',()async{
    await repo.validateStockAndSaveSale(localId:'decimal',originScope:scope,storeId:'s',
      totalAmount:0.1+0.2,products:[{'productId':'p','quantity':1,'price':0.1},
        {'productId':'q','quantity':1,'price':0.2}],paymentMethod:'Dinheiro',knownStockByProduct:{'p':5,'q':5});
    final c=jsonDecode((await repo.readCommand('decimal'))!) as Map;expect(c['expectedTotalCents'],30);
    await expectLater(repo.validateStockAndSaveSale(localId:'bad-total',originScope:scope,storeId:'s',
      totalAmount:0.305,products:[{'productId':'p','quantity':1,'price':0.3}],
      paymentMethod:'Dinheiro',knownStockByProduct:{'p':5}),throwsFormatException);
  });
  test('fiscal failure never reopens confirmed commercial sale or repeats fiscal request',()async{
    await enqueue();var fiscalCalls=0;
    final sync=OfflineSalesSyncService(repository:repo,activeScope:()async=>active,
      call:(e,c)async=>{...await backend(e,c),'shouldRequestNfce':true},refresh:(_)async{},
      requestFiscal:(_)async{fiscalCalls++;throw TimeoutException('Fiscal unavailable');});
    expect((await sync.syncPendingSales()).syncedCount,1);await sync.syncPendingSales();
    expect(fiscalCalls,1);expect(effects,1);expect((await repo.getSale('sale'))!.status,'synced');
  });
  test('unknown plus not-recorded never resends and preserves original command', () async {
    await enqueue();final original=await repo.readCommand('sale');await repo.markAsFailed(localId: 'sale', error: 'synthetic');
    await db.customStatement("UPDATE pending_sales SET status = 'unknown' WHERE local_id = ?", ['sale']);
    await worker().syncPendingSales();
    expect(calls,['getOfflineSaleResultV1']);expect(effects,0);expect(await repo.readCommand('sale'),original);
    expect((await repo.getSale('sale'))!.status,'unknown');
  });
  test('manual receipt-only recovery never sends a pending sale or invokes fiscal', () async {
    await enqueue();var fiscalCalls=0;
    final sync=OfflineSalesSyncService(repository:repo,activeScope:()async=>active,call:backend,refresh:(_)async{},requestFiscal:(_)async{fiscalCalls++;});
    await sync.recoverPendingReceipts();expect(calls,['getOfflineSaleResultV1']);expect(effects,0);expect(fiscalCalls,0);
    calls.clear();receipt={'status':'confirmed','requestId':'sale','saleId':'sale','totalCents':1000,'shouldRequestNfce':true};
    expect((await sync.recoverPendingReceipts()).syncedCount,1);expect(calls,['getOfflineSaleResultV1']);expect(fiscalCalls,0);expect(effects,0);
  });
}
