import 'package:intl/intl.dart';

const instantPaymentMethods = ['Dinheiro', 'PIX', 'Cartão de crédito', 'Cartão de débito'];
const splitPaymentMethod = 'Misto';

class SalePaymentAllocation {
  final String method;
  final int amountCents;
  const SalePaymentAllocation(this.method, this.amountCents);

  Map<String, dynamic> toJson() => {'method': method, 'amountCents': amountCents};

  factory SalePaymentAllocation.fromJson(Map<String, dynamic> value) {
    if (value.length != 2 || !value.containsKey('method') || !value.containsKey('amountCents') ||
        value['method'] is! String || value['amountCents'] is! int) {
      throw const FormatException('Detalhamento do pagamento inválido.');
    }
    return SalePaymentAllocation(value['method'] as String, value['amountCents'] as int);
  }
}

List<SalePaymentAllocation> validateSplitPayments(List<SalePaymentAllocation> payments, int totalCents) {
  if (payments.length < 2 || payments.length > instantPaymentMethods.length || totalCents <= 0 ||
      totalCents > 9007199254740991) {
    throw const FormatException('Escolha pelo menos duas formas de pagamento.');
  }
  final methods = <String>{};
  var sum = 0;
  for (final payment in payments) {
    if (!instantPaymentMethods.contains(payment.method) || !methods.add(payment.method) ||
        payment.amountCents <= 0 || payment.amountCents > 9007199254740991) {
      throw const FormatException('Revise as formas e os valores do pagamento.');
    }
    if (parsePaymentCents((payment.amountCents / 100).toStringAsFixed(2)) != payment.amountCents) {
      throw const FormatException('Valor não representável em centavos exatos.');
    }
    sum += payment.amountCents;
    if (sum > 9007199254740991) throw const FormatException('Valor fora do limite.');
  }
  if (sum != totalCents || parsePaymentCents((totalCents / 100).toStringAsFixed(2)) != totalCents) {
    throw const FormatException('A soma dos pagamentos deve ser igual ao total da venda.');
  }
  final ordered = [...payments]..sort((a, b) =>
    instantPaymentMethods.indexOf(a.method).compareTo(instantPaymentMethods.indexOf(b.method)));
  return List.unmodifiable(ordered);
}

int? parsePaymentCents(String text) {
  final match = RegExp(r'^(\d+)(?:[,.](\d{1,2}))?$').firstMatch(text.trim());
  if (match == null) return null;
  final whole = int.tryParse(match[1]!);
  if (whole == null || whole > 90071992547409) return null;
  final cents = whole * 100 + int.parse((match[2] ?? '').padRight(2, '0'));
  return cents <= 9007199254740991 ? cents : null;
}

String paymentMoney(int cents) => NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$').format(cents / 100);

String describeSplitPayments(List<SalePaymentAllocation> payments) => payments
  .map((payment) => '${payment.method}: ${paymentMoney(payment.amountCents)}').join(' + ');
