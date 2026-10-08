import 'package:flutter/material.dart';

class CatalogConfigurationDialog extends StatelessWidget {
  const CatalogConfigurationDialog({
    super.key,
    required this.title,
    required this.content,
    required this.actions,
  });

  final Widget title;
  final Widget content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final mobile = MediaQuery.sizeOf(context).width < 600;
    return AlertDialog(
      scrollable: true,
      title: title,
      content: content,
      contentPadding: mobile
          ? const EdgeInsets.fromLTRB(24, 20, 24, 24)
          : null,
      actionsPadding: mobile
          ? const EdgeInsets.fromLTRB(16, 0, 16, 12)
          : null,
      actions: mobile
          ? [
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var index = 0; index < actions.length; index++) ...[
                    if (index > 0) const SizedBox(height: 4),
                    ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 48),
                      child: actions[index],
                    ),
                  ],
                ],
              ),
            ]
          : actions,
    );
  }
}
