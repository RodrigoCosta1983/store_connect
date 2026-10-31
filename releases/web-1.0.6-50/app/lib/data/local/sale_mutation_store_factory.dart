import 'sale_mutation_store.dart';
import 'sale_mutation_store_unsupported.dart'
    if (dart.library.io) 'sale_mutation_store_native.dart'
    if (dart.library.js_interop) 'sale_mutation_store_web.dart'
    as platform;

Future<SaleMutationStore> openSaleMutationStore() => platform.openStore();
