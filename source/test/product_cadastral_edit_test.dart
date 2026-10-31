import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/product_cadastral_edit.dart';
import 'package:store_connect/services/product_mutation_ledger.dart';
import 'support/product_cadastral_harness.dart';

void main() {
  late CadastralHarness h;
  final sessions = <ProductCadastralEditSession>[];
  ProductCadastralEditSession session({bool fiscal = true}) {
    final s = h.session(fiscal: fiscal);
    sessions.add(s);
    return s;
  }

  setUp(() {
    h = CadastralHarness();
  });
  tearDown(() async {
    for (final s in sessions) {
      s.dispose();
    }
    sessions.clear();
    await h.close();
  });
  test(
    'name only and price only use B01 baseline, exact dirty fields and no stock',
    () async {
      for (final field in ['name', 'price']) {
        final s = session();
        await s.open();
        s.setText(field, field == 'name' ? 'Novo nome' : '12,50');
        await s.save();
        final command = h.remote.commands.last;
        expect(command['changes'], {
          'set': {field: field == 'name' ? 'Novo nome' : 12.5},
          'remove': [],
        });
        expect(command.containsKey('quantidade'), false);
        expect(command['changes'].containsKey('lotes'), false);
        expect(h.product['quantidade'], 5);
        expect(s.status, CadastralEditStatus.confirmed);
        await s.reviewCurrentState();
      }
    },
  );
  test(
    'COD and categories form one command; archive blocks COD but permits name',
    () async {
      final s = session();
      await s.open();
      s.setText('cod', ' new ');
      s.selectCategories(['c2', 'c1']);
      await s.save();
      expect(h.remote.commands.single['changes'], {
        'set': {'cod': 'NEW'},
        'remove': [],
        'categories': {
          'ids': ['c2', 'c1'],
        },
      });
      expect(h.remote.commands.single['scope']['storeId'], 's');
      await s.reviewCurrentState();
      h.product['isArchived'] = true;
      final archived = session();
      await archived.open();
      archived.setText('cod', 'FORBIDDEN');
      expect(archived.errorFor('cod'), isNotNull);
      archived.fieldAction('cod', 'reset');
      archived.setText('name', 'Arquivado');
      await archived.save();
      expect(h.product['cod'], 'NEW');
    },
  );
  test(
    'legacy missing/null fields remain absent/null and empty patch sends nothing',
    () async {
      h.product = {'name': 'Legacy', 'price': 10, 'barcode': null};
      final s = session();
      await s.open();
      await s.save();
      expect(s.status, CadastralEditStatus.noChanges);
      expect(h.remote.commands, isEmpty);
      s.setText('name', 'Novo');
      s.setText('name', 'Legacy');
      await s.save();
      expect(h.remote.commands, isEmpty);
      s.setText('price', '0');
      await s.save();
      expect(h.remote.commands.single['changes']['set'], {'price': 0});
      expect(h.product['barcode'], null);
      expect(h.product.containsKey('minimumStock'), false);
    },
  );
  test(
    'fiscal leaves preserve internals; null, empty, omission and remove are explicit',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      await s.save();
      expect(h.product['fiscal']['internalTax'], 'keep');
      expect(h.remote.commands.single['changes'].containsKey('fiscal'), false);
      await s.reviewCurrentState();
      s.fieldAction('ncm', 'null', fiscal: true);
      s.setText('cfop', '', fiscal: true);
      s.fieldAction('cest', 'remove', fiscal: true);
      await s.save();
      expect(h.remote.commands.last['changes']['fiscal'], {
        'set': {'ncm': null, 'cfop': ''},
        'remove': ['cest'],
      });
      expect(h.product['fiscal']['internalTax'], 'keep');
      expect(h.product['fiscal'].containsKey('cest'), false);
    },
  );
  test(
    'invalid fiscal map and malformed taxonomy are preserved on ordinary edits',
    () async {
      h.product['fiscal'] = null;
      h.product['categoryIds'] = null;
      final s = session();
      await s.open();
      expect(s.draft!.fiscalLocked, true);
      expect(s.draft!.categoriesLocked, true);
      s.setText('name', 'Nome');
      await s.save();
      expect(h.remote.commands.single['changes']['set'], {'name': 'Nome'});
      expect(h.product['fiscal'], null);
      expect(h.product['categoryIds'], null);
    },
  );
  test(
    'business downgrade does not send fiscal and explicit removal cannot be inferred from blank COD',
    () async {
      final s = session(fiscal: false);
      await s.open();
      s.setText('ncm', '87654321', fiscal: true);
      s.setText('cod', '');
      await s.save();
      expect(s.status, CadastralEditStatus.validationError);
      expect(h.remote.commands, isEmpty);
      s.fieldAction('cod', 'remove');
      await s.save();
      expect(h.remote.commands.single['changes'], {
        'set': {},
        'remove': ['cod'],
      });
      expect(h.product['fiscal']['ncm'], '12345678');
    },
  );
  test(
    'concurrent stock change causes conflict; review explicitly loads a new DTO without reapplying draft',
    () async {
      final s = session();
      await s.open();
      final original = s.draft!.baseline.expectedUpdateTime;
      s.setText('name', 'Obsoleto');
      h.product['quantidade'] = 4;
      h.revision++;
      expect(s.draft!.baseline.expectedUpdateTime, original);
      await s.save();
      expect(s.status, CadastralEditStatus.versionConflict);
      expect(h.product['name'], 'Original');
      expect(h.product['quantidade'], 4);
      final oldId = s.requestId;
      s.setText('name', 'Silent retry');
      expect(s.requestId, oldId);
      await s.reviewCurrentState();
      expect(s.draft!.changes, isEmpty);
      expect(s.draft!.baseline.expectedUpdateTime, h.token);
      s.setText('name', 'Revisado');
      await s.save();
      expect(s.requestId, isNot(oldId));
      expect(h.product['quantidade'], 4);
    },
  );
  test(
    'lost response after commit waits for B02; no premature confirmation or duplicate',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      h.remote.loseResponse = true;
      h.remote.recovery = Completer<Map<String, dynamic>>();
      final saving = s.save();
      while (!h.remote.events.any((e) => e.startsWith('recover:'))) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(s.status, CadastralEditStatus.checking);
      expect(s.canEdit, false);
      expect(h.remote.writes, 1);
      h.remote.recovery!.complete({});
      await saving;
      expect(s.status, CadastralEditStatus.confirmed);
      await s.save();
      expect(h.remote.writes, 1);
      expect(h.remote.commands.length, 1);
    },
  );
  test(
    'unknown locks UI; retry queries B02 first and preserves exact ID, token and command',
    () async {
      final s = session();
      await s.open();
      s.setText('price', '15');
      h.remote.unknown = true;
      await s.save();
      expect(s.status, CadastralEditStatus.unknown);
      final frozen = s.frozenCommand!;
      s.setText('price', '99');
      s.draft!.setField('name', 'UI later');
      final count = h.remote.events.length;
      h.remote.unknown = false;
      await s.retrySameCommand();
      expect(h.remote.events[count], 'recover:${frozen['requestId']}');
      expect(h.remote.commands[0], h.remote.commands[1]);
      expect(s.frozenCommand, frozen);
      expect(h.product['price'], 15);
      expect(h.product['name'], 'Original');
      expect(h.remote.writes, 1);
    },
  );
  test(
    'close/reopen consults pending command and cannot create a new intention',
    () async {
      final first = session();
      await first.open();
      first.setText('name', 'Nome');
      h.remote.unknown = true;
      await first.save();
      final id = first.requestId;
      final reopened = session();
      await reopened.open();
      expect(reopened.requestId, id);
      expect(reopened.draft, null);
      expect(h.reads, 1);
      expect(reopened.status, CadastralEditStatus.unknown);
      expect(reopened.canEdit, false);
      h.remote.unknown = false;
      await reopened.retrySameCommand();
      expect(h.remote.commands.last['requestId'], id);
      expect(h.remote.writes, 1);
    },
  );
  test(
    'concurrent dialogs reserve one active identity and never send a competing UI command',
    () async {
      final a = session();
      final b = session();
      await a.open();
      await b.open();
      a.setText('name', 'A');
      b.setText('name', 'B');
      await Future.wait([a.save(), b.save()]);
      expect(a.requestId, b.requestId);
      expect(h.remote.writes, 1);
      expect(h.remote.commands.map((c) => c['requestId']).toSet().length, 1);
      expect(b.draft, null);
    },
  );
  test(
    'storage unavailable before persistence blocks send; recovery keeps allocated ID',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      h.store.fail = true;
      await s.save();
      expect(s.status, CadastralEditStatus.persistenceFailure);
      expect(h.remote.commands, isEmpty);
      final frozen = s.frozenCommand!;
      h.store.fail = false;
      await s.checkResult();
      await s.retrySameCommand();
      expect(s.frozenCommand, frozen);
      expect(h.remote.writes, 1);
    },
  );
  test(
    'corrupt active slot blocks reopening and does not erase the record',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      h.remote.unknown = true;
      await s.save();
      final key = h.store.values.keys.firstWhere(
        (k) => k.startsWith('b04-active-v1:'),
      );
      h.store.values[key] = '{broken';
      final reopened = session();
      await reopened.open();
      expect(reopened.status, CadastralEditStatus.persistenceFailure);
      expect(reopened.canEdit, false);
      expect(h.store.values[key], '{broken');
      expect(h.remote.writes, 0);
    },
  );
  test(
    'account/project/store changes suspend the interface and keep original ledger scoped',
    () async {
      for (final other in [
        const ProductMutationScope(
          projectId: 'demo-b04',
          uid: 'other',
          storeId: 's',
        ),
        const ProductMutationScope(
          projectId: 'demo-other',
          uid: 'u',
          storeId: 's',
        ),
        const ProductMutationScope(
          projectId: 'demo-b04',
          uid: 'u',
          storeId: 'other',
        ),
      ]) {
        h.active = const ProductMutationScope(
          projectId: 'demo-b04',
          uid: 'u',
          storeId: 's',
        );
        final s = session();
        await s.open();
        s.setText('name', 'Nome');
        h.move(other);
        expect(s.status, CadastralEditStatus.scopeChanged);
        expect(s.draft, null);
        await s.save();
        expect(h.remote.commands, isEmpty);
      }
    },
  );
  test(
    'failure storing confirmation queries the existing result and never duplicates the committed change',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      h.remote.afterCommit = () {
        h.store.fail = true;
      };
      await s.save();
      expect(s.status, CadastralEditStatus.persistenceFailure);
      expect(h.remote.writes, 1);
      final id = s.requestId;
      h.store.fail = false;
      h.remote.afterCommit = null;
      await s.checkResult();
      expect(s.status, CadastralEditStatus.confirmed);
      expect(s.requestId, id);
      expect(h.remote.writes, 1);
      expect(h.remote.commands.length, 1);
    },
  );
  test(
    'corrupt terminal metadata cannot synthesize a false success on reopening',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      h.remote.unknown = true;
      await s.save();
      final key = h.store.values.keys.firstWhere(
        (key) => !key.startsWith('b04-active-v1:'),
      );
      final record = jsonDecode(h.store.values[key]!) as Map;
      record['state'] = 'confirmed';
      h.store.values[key] = jsonEncode(record);
      final reopened = session();
      await reopened.open();
      expect(reopened.status, CadastralEditStatus.persistenceFailure);
      expect(h.remote.writes, 0);
      expect(reopened.canEdit, false);
    },
  );
  test(
    'identity/hash conflict blocks new intentions and same-command retry',
    () async {
      final s = session();
      await s.open();
      s.setText('name', 'Nome');
      h.remote.unknown = true;
      await s.save();
      final id = s.requestId!;
      h.remote.receipts[id] = {'hash': 'other-command', 'status': 'confirmed'};
      await s.checkResult();
      expect(s.status, CadastralEditStatus.identityConflict);
      await s.reviewCurrentState();
      await s.retrySameCommand();
      expect(s.requestId, id);
      expect(s.canEdit, false);
      expect(h.remote.commands.length, 1);
    },
  );
  test(
    'default disabled and remote projects cannot load B01 or send any mutation',
    () async {
      for (final project in [
        'demo-b04',
        'store-connect-hml',
        'store-connect-app',
      ]) {
        final s = ProductCadastralEditSession(
          access: h.access(enabled: project != 'demo-b04', projectId: project),
          productId: 'p',
          storeId: 's',
          allowFiscal: true,
        );
        sessions.add(s);
        await s.open();
        expect(s.status, CadastralEditStatus.disabled);
      }
      expect(h.reads, 0);
      expect(h.remote.commands, isEmpty);
    },
  );
}
