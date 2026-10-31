import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/services/debt_payment_error_message.dart';

void main() {
  test('missing service does not leak plugin message or claim a payment succeeded', () {
    final message = debtPaymentErrorMessage(FirebaseFunctionsException(
      code: 'not-found', message: 'NOT_FOUND\n#0 platform internal trace'));
    expect(message, contains('indisponível neste ambiente'));
    expect(message, isNot(contains('platform')));
    expect(message, isNot(contains('sucesso')));
  });
  test('lost response directs the operator to check instead of paying twice', () {
    final message = debtPaymentErrorMessage(FirebaseFunctionsException(code: 'deadline-exceeded', message: 'lost response'));
    expect(message, contains('consulte o resultado antes de repetir'));
  });
  test('pending intent remains pending and technical exception prefix is hidden', () {
    final message = debtPaymentErrorMessage(StateError('Recebimento pendente. Use Consultar recebimento'));
    expect(message, contains('aguardando confirmação'));
    expect(message, isNot(contains('Bad state')));
  });
  test('unexpected errors do not leak traces or pretend a payment was reversed', () {
    expect(debtPaymentErrorMessage(Exception('private details')), 'Recebimento não confirmado. Consulte o resultado antes de tentar novamente.');
  });
}
