import 'dart:convert';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import '../data/local/sale_mutation_store.dart';
import '../data/local/sale_mutation_store_factory.dart';
import 'sale_mutation_command.dart';

typedef DebtPaymentCall = Future<Map<String, dynamic>> Function(
  String endpoint, Map<String, dynamic> command);

/// Financial namespace over the existing durable store. SaleMutationLedger only
/// accepts instant sale commands: never encode a debt payment as an instant sale.
class DebtPaymentService {
  final SaleMutationStore store;
  final DebtPaymentCall call;
  DebtPaymentService({required this.store, required this.call});
  static Future<DebtPaymentService>? _instance;
  static Future<DebtPaymentService> shared() async {
    final opening = _instance ??= _open();
    try {
      return await opening;
    } catch (_) {
      if (identical(_instance, opening)) _instance = null;
      rethrow;
    }
  }
  static Future<DebtPaymentService> _open() async => DebtPaymentService(
    store: await openSaleMutationStore(),
    call: (endpoint, command) async {
      final app = Firebase.app();
      final scope = saleObject(command['scope']);
      final user = FirebaseAuth.instanceFor(app: app).currentUser;
      if (app.options.projectId != scope['projectId'] || user?.uid != scope['uid']) {
        throw StateError('Sessão de recebimento substituída.');
      }
      final functions = FirebaseFunctions.instanceFor(app: app, region: 'us-central1');
      final response = await functions.httpsCallable(endpoint,
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30))).call(command);
      if (user?.uid != FirebaseAuth.instanceFor(app: app).currentUser?.uid) {
        throw StateError('Sessão de recebimento substituída. Consulte o resultado.');
      }
      return saleObject(response.data);
    },
  );

  String _key(Map<String, dynamic> scope, String target) =>
    'debt-payment-v1:${saleHash(scope)}:${saleHash(target)}';

  Map<String, dynamic> _read(String raw, Map<String, dynamic> scope) {
    final record = saleObject(jsonDecode(raw));
    final integrity = record.remove('integrity');
    if (integrity != saleHash(record) || saleJson(record['scope']) != saleJson(scope)) {
      throw const FormatException('Registro de recebimento inválido. Reconciliação necessária.');
    }
    return record;
  }

  String _seal(Map<String, dynamic> record) => jsonEncode({...record, 'integrity': saleHash(record)});

  /// Only an explicit new operator action may advance a terminal operation.
  Future<void> beginNew(Map<String, dynamic> scope, String target, {String? settlementSaleId}) async {
    final key = _key(scope, target);
    while (true) {
      final raw = await store.read(key);
      if (raw == null) return;
      final record = _read(raw, scope);
      if (record['command'] == null) return;
      final status = saleObject(record['result'] ?? {})['status'];
      if (settlementSaleId != null &&
          (!['confirmed', 'rejected'].contains(status) ||
           status == 'confirmed' && saleObject(record['command'])['saleId'] == settlementSaleId)) {
        return;
      }
      if (!['confirmed', 'rejected'].contains(saleObject(record['result'] ?? {})['status'])) {
        throw StateError('Recebimento pendente. Use Consultar recebimento antes de iniciar outro.');
      }
      final history = '$key:history:${saleObject(record['command'])['requestId']}';
      final prior = await store.read(history);
      if (prior == null && !await store.compareAndSet(history, null, raw)) continue;
      if (await store.compareAndSet(key, raw, _seal({'scope': scope, 'command': null}))) return;
    }
  }

  Future<Map<String, dynamic>> execute({
    required Map<String, dynamic> scope,
    required String target,
    required bool Function() isCurrent,
    String? customerId,
    String? saleId,
    int? amountCents,
    bool recoverOnly = false,
  }) async {
    void check() {
      if (!isCurrent()) throw StateError('Conta ou loja mudou. Consulte na sessão original.');
    }
    check();
    final key = _key(scope, target);
    String raw;
    Map<String, dynamic> record;
    while (true) {
      final saved = await store.read(key);
      check();
      record = saved == null ? {'scope': scope, 'command': null} : _read(saved, scope);
      if (record['command'] != null) { raw = saved!; break; }
      if (recoverOnly) throw StateError('Nenhum recebimento pendente neste dispositivo e sessão.');
      if (amountCents == null || amountCents <= 0 || amountCents > 100000000000) {
        throw ArgumentError('Valor inválido.');
      }
      final command = {'schemaVersion': 1, 'requestId': SaleMutationCommand.newIdentity(),
        'scope': scope, 'customerId': customerId, 'saleId': saleId, 'amountCents': amountCents};
      raw = _seal({'scope': scope, 'command': command});
      if (await store.compareAndSet(key, saved, raw)) { record = _read(raw, scope); break; }
    }
    final command = saleObject(record['command']);
    if (recoverOnly && saleId != null && command['saleId'] != saleId) {
      throw StateError('O último recebimento pertence a outra operação. Consulte a conta do cliente.');
    }
    if (!recoverOnly && (command['amountCents'] != amountCents ||
        command['customerId'] != customerId || command['saleId'] != saleId)) {
      throw StateError('Há outro recebimento pendente. Consulte o resultado original.');
    }
    check();
    // Always query before a retry; not-recorded can only resend this frozen
    // command. A new identity is never inferred from timeout or remaining debt.
    var result = await call('getDebtPaymentResultV1', command);
    check();
    if (result['status'] == 'not-recorded') {
      result = await call('receiveDebtPaymentV1', command);
      check();
    }
    if (result['requestId'] != command['requestId'] ||
        !['confirmed', 'rejected', 'identity-conflict', 'not-recorded'].contains(result['status'])) {
      throw const FormatException('Resposta não confirmada. Consulte o recebimento.');
    }
    if (['confirmed', 'rejected', 'identity-conflict'].contains(result['status'])) {
      // A competing response never replaces a newer command or terminal result.
      await store.compareAndSet(key, raw, _seal({...record, 'result': result}));
      check();
    }
    return result;
  }
}
