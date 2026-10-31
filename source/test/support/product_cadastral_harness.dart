import 'dart:async';
import 'package:store_connect/services/product_cadastral_edit.dart';
import 'package:store_connect/services/product_mutation_api.dart';
import 'package:store_connect/services/product_mutation_command.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import '../product_mutation_ledger_test.dart' show MemoryStore;

class CadastralHarness {
  final store = MemoryStore();
  final changes = StreamController<ProductMutationScope?>.broadcast(sync: true);
  ProductMutationScope? active = const ProductMutationScope(
    projectId: 'demo-b04',
    uid: 'u',
    storeId: 's',
  );
  late final remote = CadastralRemote(this);
  late final ledger = ProductMutationLedger(
    store: store,
    transport: remote,
    activeScope: () async => active,
  );
  int reads = 0;
  int revision = 1;
  Map<String, dynamic> product = {
    'name': 'Original',
    'price': 10,
    'cod': 'OLD',
    'quantidade': 5,
    'lotes': [],
    'categoryIds': ['c1'],
    'minimumStock': 1,
    'fiscal': {'ncm': '12345678', 'cest': null, 'internalTax': 'keep'},
  };
  Map<String, dynamic> get token => {
    'seconds': '1791970000',
    'nanoseconds': revision * 1000,
  };
  ProductCadastralEditAccess access({
    bool enabled = true,
    String projectId = 'demo-b04',
  }) => ProductCadastralEditAccess(
    enabled: enabled,
    projectId: projectId,
    ledger: ledger,
    scopeChanges: changes.stream,
    readState: (id) async {
      reads++;
      return ProductEditState.fromJson({
        'schemaVersion': 1,
        'productId': id,
        'uid': active!.uid,
        'storeId': active!.storeId,
        'expectedUpdateTime': token,
        'product': product,
        'unavailable': [],
      });
    },
  );
  ProductCadastralEditSession session({bool fiscal = true}) =>
      ProductCadastralEditSession(
        access: access(),
        productId: 'p',
        storeId: 's',
        allowFiscal: fiscal,
      );
  void move(ProductMutationScope? scope) {
    active = scope;
    changes.add(scope);
  }

  Future<void> close() => changes.close();
}

class CadastralRemote implements ProductMutationTransport {
  final CadastralHarness h;
  final commands = <Map<String, dynamic>>[];
  final events = <String>[];
  final receipts = <String, Map<String, dynamic>>{};
  int writes = 0;
  bool unknown = false;
  bool loseResponse = false;
  String? rejectReason;
  void Function()? afterCommit;
  Completer<Map<String, dynamic>>? recovery;
  CadastralRemote(this.h);
  @override
  Future<Map<String, dynamic>> send(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) async {
    commands.add(requireObject(canonicalProductJson(command)));
    final id = command['requestId'] as String;
    events.add('send:$id');
    if (unknown) throw TimeoutException('No known commit');
    if (!receipts.containsKey(id)) {
      final reason =
          rejectReason ??
          (productCanonicalJson(command['expectedUpdateTime']) !=
                  productCanonicalJson(h.token)
              ? 'product-version-conflict'
              : null);
      if (reason != null) {
        receipts[id] = {
          'hash': productCommandHash(operation, command),
          'status': 'rejected',
          'error': {
            'code': reason == 'product-version-conflict'
                ? 'aborted'
                : 'failed-precondition',
            'reason': reason,
          },
        };
      } else {
        final patch = requireObject(command['changes']);
        h.product.addAll(requireObject(patch['set'] ?? {}));
        for (final field in (patch['remove'] as List? ?? [])) {
          h.product.remove(field);
        }
        if (patch['fiscal'] is Map) {
          final fiscal = requireObject(h.product['fiscal'] ?? {});
          fiscal.addAll(requireObject(patch['fiscal']['set'] ?? {}));
          for (final field in (patch['fiscal']['remove'] as List? ?? [])) {
            fiscal.remove(field);
          }
          h.product['fiscal'] = fiscal;
        }
        if (patch['categories'] is Map) {
          h.product['categoryIds'] = patch['categories']['ids'];
        }
        writes++;
        h.revision++;
        receipts[id] = {
          'hash': productCommandHash(operation, command),
          'status': 'confirmed',
          'result': {
            'success': true,
            'productId': command['productId'],
            'requestId': id,
            'changed': true,
          },
        };
      }
    }
    final saved = receipts[id]!;
    afterCommit?.call();
    if (loseResponse || saved['status'] == 'rejected') {
      throw TimeoutException('Response lost/rejected');
    }
    return requireObject(saved['result']);
  }

  @override
  Future<Map<String, dynamic>> recover(
    ProductMutationScope scope,
    String operation,
    Map<String, dynamic> command,
  ) async {
    final id = command['requestId'] as String;
    events.add('recover:$id');
    if (recovery != null) await recovery!.future;
    final saved = receipts[id];
    return {
      'operation': operation,
      'requestId': id,
      'productId': command['productId'],
      if (saved == null) ...{
        'status': 'not-recorded',
        'definitive': false,
      } else if (saved['hash'] != productCommandHash(operation, command)) ...{
        'status': 'identity-conflict',
        'definitive': true,
      } else ...{
        'status': saved['status'],
        'definitive': true,
        if (saved['result'] != null) 'result': saved['result'],
        if (saved['error'] != null) 'error': saved['error'],
      },
    };
  }
}
