import 'sale_mutation_store.dart';

Future<SaleMutationStore> openStore() =>
    Future.error(UnsupportedError('Persistência de venda indisponível.'));
