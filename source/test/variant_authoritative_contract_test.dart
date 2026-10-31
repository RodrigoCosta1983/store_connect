import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/variant_authoritative_contract.dart';
import 'package:store_connect/services/variant_intent_ledger.dart';
import 'package:store_connect/data/local/variant_intent_store.dart';
import 'support/variant_ledger_cases.dart';

class MemoryStore implements VariantIntentStore {
  String? value;
  @override
  Future<String?> read(String key) async => value;
  @override
  Future<bool> compareAndSet(String key, String? expected, String next) async {
    if (value != expected) return false;
    value = next;
    return true;
  }

  @override
  Future<List<String>> keys(String prefix) async => [];
  @override
  Future<void> close() async {}
}

void main() {
  test(
    'C3 receipts preserve both baselines and reject corrupt audit and result',
    () async {
      for (final archive in [false, true]) {
        final intent = variantIntent(archive: archive);
        final scope = Map<String, dynamic>.from(intent.command['scope'] as Map);
        final access = VariantLocalAccess(scope, sessionToken: 'epoch');
        final ledger = VariantIntentLedger(
          store: MemoryStore(),
          scope: scope,
          sessionToken: 'epoch',
          activeAccess: () async => access,
        );
        await ledger.prepare('intent', intent);
        await ledger.claimForFutureTransport(intent.requestId);
        final attempt = await ledger.load(intent.requestId);
        final raw = <String, dynamic>{
          'status': 'confirmed',
          'operation': intent.operation,
          'persistedOperation': intent.operation,
          'receipt': {
            'path':
                'stores/${scope['storeId']}/auditLogs/f10-c1-${sha256.convert(utf8.encode(jsonEncode([scope['uid'], intent.requestId])))}',
            'updateTime': {'seconds': '999', 'nanoseconds': 0},
            'data': {
              'schemaVersion': 1,
              'operation': intent.operation,
              'createdAt': {'seconds': '999', 'nanoseconds': 123},
              'command': jsonDecode(jsonEncode(intent.command)),
              'result': {
                'schemaVersion': 1,
                'productId': intent.command['productId'],
                'variantId': intent.command['variantId'],
                'requestId': intent.requestId,
                'status': archive ? 'archived' : 'adjusted',
                'changed': true,
                'replayed': false,
              },
              'audit': {
                'reason': intent.command['reason'],
                'before': archive
                    ? {'isArchived': false}
                    : {'quantidade': 0, 'lotes': []},
                'after': archive
                    ? {'isArchived': true}
                    : {'quantidade': 7, 'lotes': []},
              },
            },
          },
        };
        expect(
          inspectVariantResponse(
            attempt,
            VariantAuthoritativeResponse.decode(
              raw,
              origin: VariantResponseOrigin.syntheticFixture,
            ),
            access,
            expectedSessionToken: 'epoch',
          ).compatibleConfirmed,
          true,
        );
        final data = (raw['receipt'] as Map)['data'] as Map;
        data['command']['expectedVariantUpdateTime']['nanoseconds'] = 0;
        expect(
          inspectVariantResponse(
            attempt,
            VariantAuthoritativeResponse.decode(raw),
            access,
            expectedSessionToken: 'epoch',
          ).compatibleConfirmed,
          false,
        );
        expect(attempt.intent.encoded, intent.encoded);
        data['result']['replayed'] = true;
        expect(
          () => VariantAuthoritativeResponse.decode(raw),
          throwsFormatException,
        );
      }
    },
  );
  final original = variantIntent(create: true);
  final scope = Map<String, dynamic>.from(original.command['scope'] as Map);
  final access = VariantLocalAccess(scope, sessionToken: 'epoch');
  Map<String, dynamic> receipt() => {
    'status': 'confirmed',
    'operation': original.operation,
    'persistedOperation': 'createVariantC1',
    'receipt': {
      'path':
          'stores/${scope['storeId']}/auditLogs/f10-c1-${sha256.convert(utf8.encode(jsonEncode([scope['uid'], original.requestId])))}',
      'updateTime': {'seconds': '123', 'nanoseconds': 123456000},
      'data': {
        'schemaVersion': 1,
        'operation': 'createVariantC1',
        'createdAt': {'seconds': '122', 'nanoseconds': 0},
        'command': jsonDecode(jsonEncode(original.command)),
        'result': {
          'schemaVersion': 1,
          'productId': original.command['productId'],
          'variantId': original.command['variantId'],
          'status': 'created',
          'replayed': false,
        },
      },
    },
  };
  test(
    'synthetic confirmed compatibility never grants commit; CAS keeps original unknown',
    () async {
      final store = MemoryStore();
      VariantIntentLedger ledger() => VariantIntentLedger(
        store: store,
        scope: scope,
        sessionToken: 'epoch',
        activeAccess: () async => access,
      );
      await ledger().prepare('intent', original);
      final claims = await Future.wait([
        for (var i = 0; i < 2; i++)
          ledger()
              .claimForFutureTransport(original.requestId)
              .then((_) => true)
              .catchError((Object _) => false),
      ]);
      expect(claims.where((v) => v).length, 1);
      final attempt = await ledger().load(original.requestId);
      final bytes = store.value;
      for (final origin in VariantResponseOrigin.values) {
        final response = VariantAuthoritativeResponse.decode(
          receipt(),
          origin: origin,
        );
        final plan = inspectVariantResponse(
          attempt,
          response,
          access,
          expectedSessionToken: 'epoch',
        );
        expect(plan.compatibleConfirmed, true);
        expect(plan.mayCommit, false);
        expect(plan.mayCreateNewIntent, false);
        expect(response.isTrustedCommitProof, false);
        expect(plan.originalEncoded, original.encoded);
        expect(plan.fingerprint, attempt.fingerprint);
      }
      expect(store.value, bytes);
      expect(
        (await ledger().load(original.requestId)).status,
        VariantIntentStatus.unknown,
      );
      await expectLater(
        ledger().prepare('new', variantIntent(id: 'new')),
        throwsStateError,
      );
      await expectLater(
        ledger().reconcileLocal(
          VariantLocalResolution(
            original: original,
            status: VariantIntentStatus.committed,
            reason: 'fixture',
          ),
        ),
        throwsUnsupportedError,
      );
      for (final status in [
        'identity-conflict',
        'access-denied',
        'inconsistent-state',
        'unknown',
      ]) {
        final response = VariantAuthoritativeResponse.decode({
          'status': status,
          'reason': 'synthetic',
        });
        expect(
          inspectVariantResponse(
            attempt,
            response,
            access,
            expectedSessionToken: 'epoch',
          ).mayCommit,
          false,
        );
      }
      expect(
        inspectVariantResponse(
          attempt,
          null,
          access,
          expectedSessionToken: 'epoch',
        ).compatibleConfirmed,
        false,
      );
      for (final changed in [
        VariantLocalAccess({...scope, 'uid': 'other'}, sessionToken: 'epoch'),
        VariantLocalAccess({
          ...scope,
          'storeId': 'other',
        }, sessionToken: 'epoch'),
        VariantLocalAccess({
          ...scope,
          'projectId': 'demo-other',
        }, sessionToken: 'epoch'),
        VariantLocalAccess(scope, sessionToken: 'other'),
        VariantLocalAccess(scope, sessionToken: 'epoch', revoked: true),
      ]) {
        expect(
          () => inspectVariantResponse(
            attempt,
            null,
            changed,
            expectedSessionToken: 'epoch',
          ),
          throwsStateError,
        );
      }
      final divergent = receipt();
      ((divergent['receipt'] as Map)['data']
              as Map)['command']['variant']['cod'] =
          '';
      expect(
        inspectVariantResponse(
          attempt,
          VariantAuthoritativeResponse.decode(divergent),
          access,
          expectedSessionToken: 'epoch',
        ).compatibleConfirmed,
        false,
      );
    },
  );
  test('strict envelope, receipt identity and types', () {
    for (final raw in [
      null,
      {},
      {'status': 'rejected'},
      {'status': 'unknown'},
      {'status': 'unknown', 'reason': 1},
      {'status': 'unknown', 'reason': 'x', 'trusted': true},
    ]) {
      expect(
        () => VariantAuthoritativeResponse.decode(raw),
        throwsFormatException,
      );
    }
    for (final field in ['path', 'updateTime', 'data']) {
      final raw = receipt();
      (raw['receipt'] as Map).remove(field);
      expect(
        () => VariantAuthoritativeResponse.decode(raw),
        throwsFormatException,
      );
    }
    final raw = receipt()..['persistedOperation'] = 'createVariantC2';
    expect(
      () => VariantAuthoritativeResponse.decode(raw),
      throwsFormatException,
    );
    final alias = receipt()..['operation'] = 'createVariantC1';
    ((alias['receipt'] as Map)['data'] as Map)['command']['variant'].remove(
      'cod',
    );
    expect(
      VariantAuthoritativeResponse.decode(alias).persistedOperation,
      'createVariantC1',
    );
  });
  test(
    'available preserves data and exact timestamp without commit authority',
    () {
      final raw = {
        'status': 'available',
        'scope': scope,
        'identity': {'productId': 'p', 'variantId': null},
        'parent': {
          'isSellable': false,
          'updateTime': {'seconds': '123', 'nanoseconds': 999999000},
          'data': {
            'variantSchemaVersion': 1,
            'productKind': 'variantParent',
            'attributeDefinitions': [
              {
                'attributeId': 'color',
                'values': [
                  {'valueId': 'blue'},
                ],
              },
            ],
            'isArchived': false,
            'future': null,
          },
        },
      };
      final response = VariantAuthoritativeResponse.decode(raw);
      expect(response.parent!.updateTime['nanoseconds'], 999999000);
      expect(response.parent!.data.containsKey('future'), true);
      expect(() => response.parent!.data['future'] = 1, throwsUnsupportedError);
      expect(response.isTrustedCommitProof, false);
    },
  );
}
