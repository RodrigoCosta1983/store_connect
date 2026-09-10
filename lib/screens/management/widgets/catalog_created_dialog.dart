import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

Future<void> showCatalogCreatedDialog({
  required BuildContext context,
  required String publicUrl,
}) async {
  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        title: const Text('Catálogo criado com sucesso'),
        content: SizedBox(
          width: 520,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Compartilhe este link com o cliente:'),
              const SizedBox(height: 12),
              SelectableText(publicUrl),
            ],
          ),
        ),
        actions: [
          TextButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: publicUrl));

              if (!context.mounted) {
                return;
              }

              ScaffoldMessenger.of(context)
                ..clearSnackBars()
                ..showSnackBar(const SnackBar(content: Text('Link copiado.')));
            },
            icon: const Icon(Icons.copy_outlined),
            label: const Text('Copiar link'),
          ),
          TextButton.icon(
            onPressed: () async {
              await SharePlus.instance.share(
                ShareParams(text: 'Confira este catálogo:\n\n$publicUrl'),
              );
            },
            icon: const Icon(Icons.share_outlined),
            label: const Text('Compartilhar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Fechar'),
          ),
        ],
      );
    },
  );
}
