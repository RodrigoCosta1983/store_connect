import 'product_mutation_store.dart';
import 'product_mutation_store_unsupported.dart'
    if (dart.library.io) 'product_mutation_store_native.dart'
    if (dart.library.js_interop) 'product_mutation_store_web.dart'
    as platform;

Future<ProductMutationStore> openProductMutationStore() => platform.openStore();
