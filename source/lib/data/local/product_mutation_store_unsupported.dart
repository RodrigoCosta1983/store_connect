import 'product_mutation_store.dart';

Future<ProductMutationStore> openStore() =>
    Future.error(UnsupportedError('Persistência de produto indisponível.'));
