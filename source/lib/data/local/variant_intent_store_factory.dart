import 'variant_intent_store.dart';
import 'variant_intent_store_unsupported.dart'
    if (dart.library.io) 'variant_intent_store_native.dart'
    if (dart.library.js_interop) 'variant_intent_store_web.dart'
    as platform;

Future<VariantIntentStore> openVariantIntentStore() => platform.openStore();
