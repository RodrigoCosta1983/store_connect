import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'sale_mutation_command.dart';
import 'sale_mutation_ledger.dart';

// No default Firebase instance or remote-enabled constructor. The backend B07-B
// gate remains mandatory and unchanged. These endpoints are not exported there.
class SaleMutationApi implements SaleMutationTransport {
  final FirebaseApp app;
  final bool enableLocalEmulator;
  final String host;
  final int port;
  final Future<SaleMutationScope?> Function() activeScope;
  SaleMutationApi({
    required this.app,
    required this.activeScope,
    this.enableLocalEmulator = false,
    this.host = '127.0.0.1',
    this.port = 5001,
  });

  static void validateGate({
    required bool enabled,
    required String projectId,
    required String host,
    required int port,
  }) {
    if (!enabled ||
        !projectId.startsWith('demo-') ||
        !{'127.0.0.1', 'localhost'}.contains(host) ||
        port < 1 ||
        port > 65535) {
      throw StateError(
        'Transporte de vendas desabilitado: somente demo/loopback explícito.',
      );
    }
  }

  Future<Map<String, dynamic>> _call(
    String endpoint,
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) async {
    validateGate(
      enabled: enableLocalEmulator,
      projectId: app.options.projectId,
      host: host,
      port: port,
    );
    final frozen = SaleMutationCommand.fromJson(command);
    final active = await activeScope();
    if (frozen.scope.prefix != scope.prefix ||
        scope.projectId != app.options.projectId ||
        scope.uid != FirebaseAuth.instanceFor(app: app).currentUser?.uid ||
        active?.prefix != scope.prefix) {
      throw StateError('Escopo de vendas mudou. Envio suspenso.');
    }
    final functions = FirebaseFunctions.instanceFor(app: app);
    functions.useFunctionsEmulator(host, port);
    final result = await functions
        .httpsCallable(
          endpoint,
          options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
        )
        .call(frozen.payload);
    return saleObject(result.data);
  }

  @override
  Future<Map<String, dynamic>> send(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) => _call('confirmSaleV2', scope, command);
  @override
  Future<Map<String, dynamic>> recover(
    SaleMutationScope scope,
    Map<String, dynamic> command,
  ) => _call('getSaleMutationResultV1', scope, command);
}
