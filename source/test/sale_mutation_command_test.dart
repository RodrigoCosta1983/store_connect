import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/sale_mutation_command.dart';
import 'package:store_connect/services/sale_mutation_api.dart';

void main() {
  final fixtures = saleObject(
    jsonDecode(
      File('test/fixtures/sale_v2_command_cases.json').readAsStringSync(),
    ),
  );
  for (final raw in fixtures['cases'] as List) {
    final fixture = saleObject(raw);
    test('B07-C shared client/backend fixture: ${fixture['name']}', () {
      final input = {
        ...saleObject(fixtures['base']),
        ...saleObject(fixture['patch']),
      };
      if (fixture['valid'] != true) {
        expect(
          () => SaleMutationCommand.fromJson(input),
          throwsFormatException,
        );
        return;
      }
      final items =
          List<Map<String, dynamic>>.from(
            (input['items'] as List).map(saleObject),
          )..sort(
            (a, b) =>
                (a['productId'] as String).compareTo(b['productId'] as String),
          );
      final expected = {
        ...input,
        'notes': input['notes'],
        'customerId': input['customerId'],
        'items': items,
      };
      expect(SaleMutationCommand.fromJson(input).payload, expected);
    });
  }
  test('negative zero is rejected before JSON normalization', () {
    final input = saleObject(fixtures['base']);
    input['expectedTotalCents'] = -0.0;
    expect(() => SaleMutationCommand.fromJson(input), throwsFormatException);
  });
  test(
    'transport gate rejects default, remote projects, nonloopback and invalid ports',
    () {
      for (final config in [
        [false, 'demo-test', 'localhost', 5001],
        [true, 'prod-test', 'localhost', 5001],
        [true, 'demo-test', '10.0.2.2', 5001],
        [true, 'demo-test', 'localhost.evil', 5001],
        [true, 'demo-test', '::1', 5001],
        [true, 'demo-test', 'localhost', 0],
      ]) {
        expect(
          () => SaleMutationApi.validateGate(
            enabled: config[0] as bool,
            projectId: config[1] as String,
            host: config[2] as String,
            port: config[3] as int,
          ),
          throwsStateError,
        );
      }
      SaleMutationApi.validateGate(
        enabled: true,
        projectId: 'demo-test',
        host: '127.0.0.1',
        port: 5001,
      );
    },
  );
}
