import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:store_connect/widgets/account_legal_links.dart';

void main() {
  for (final compact in [true, false]) {
    testWidgets('legal and deletion actions open the existing public pages (compact=$compact)', (tester) async {
      final opened = <Uri>[];
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: AccountLegalLinks(
        compact: compact, openUrl: (uri) async { opened.add(uri); return true; },
      ))));
      for (final label in ['Política de privacidade', 'Termos de uso', 'Solicitar exclusão da conta']) {
        await tester.tap(find.text(label));
        await tester.pump();
      }
      expect(opened.map((u) => u.toString()), [
        'https://www.storeconnect.com.br/politica.html',
        'https://www.storeconnect.com.br/termos.html',
        'https://www.storeconnect.com.br/exclusao_conta.html',
      ]);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('failed page launch shows an actionable message without changing the account', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AccountLegalLinks(openUrl: (_) async => false))));
    await tester.tap(find.text('Solicitar exclusão da conta'));
    await tester.pump();
    expect(find.text('Não foi possível abrir a página. Tente novamente.'), findsOneWidget);
  });
}
