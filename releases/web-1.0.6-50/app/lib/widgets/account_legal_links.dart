import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

class AccountLegalLinks extends StatelessWidget {
  const AccountLegalLinks({super.key, this.compact = true, this.openUrl});

  final bool compact;
  final Future<bool> Function(Uri)? openUrl;

  static final privacy = Uri.parse('https://www.storeconnect.com.br/politica.html');
  static final terms = Uri.parse('https://www.storeconnect.com.br/termos.html');
  static final deletion = Uri.parse('https://www.storeconnect.com.br/exclusao_conta.html');

  Future<void> _open(BuildContext context, Uri uri) async {
    var opened = false;
    try {
      opened = await (openUrl?.call(uri) ?? launchUrl(uri, mode: LaunchMode.externalApplication));
    } catch (_) {
      // Keep native/plugin details out of the user-facing message.
    }
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Não foi possível abrir a página. Tente novamente.'),
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final links = <(String, Uri)>[
      ('Política de privacidade', privacy),
      ('Termos de uso', terms),
      ('Solicitar exclusão da conta', deletion),
    ];
    if (compact) {
      return Wrap(alignment: WrapAlignment.center, children: [
        for (final (label, uri) in links)
          TextButton(onPressed: () => _open(context, uri), child: Text(label)),
      ]);
    }
    return Column(children: [
      for (final (label, uri) in links)
        ListTile(title: Text(label), trailing: const Icon(Icons.open_in_new),
          onTap: () => _open(context, uri)),
    ]);
  }
}
