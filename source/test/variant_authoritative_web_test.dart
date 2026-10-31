@TestOn('browser')
library;

import 'package:flutter_test/flutter_test.dart' show TestOn;
import 'variant_authoritative_contract_test.dart' as contract;
import 'variant_intent_ledger_web_test.dart' as ledger;
import 'variant_preview_state_test.dart' as preview;
import 'variant_preview_panel_test.dart' as panel;

void main() {
  contract.main();
  ledger.main();
  preview.main();
  panel.main();
}
