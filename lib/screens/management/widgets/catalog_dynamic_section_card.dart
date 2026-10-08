import 'package:flutter/material.dart';

class CatalogDynamicSectionCard extends StatelessWidget {
  const CatalogDynamicSectionCard({
    super.key,
    required this.title,
    required this.description,
    required this.enabled,
    required this.categoryLabels,
    required this.onEnabledChanged,
    required this.onSelectCategories,
    this.showError = false,
  });

  final String title;
  final String description;
  final bool enabled;
  final List<String> categoryLabels;
  final ValueChanged<bool> onEnabledChanged;
  final VoidCallback onSelectCategories;
  final bool showError;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          Text(description),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Ativar seção'),
            value: enabled,
            onChanged: onEnabledChanged,
          ),
          if (enabled) ...[
            Text('${categoryLabels.length} categorias selecionadas'),
            for (final label in categoryLabels)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(label),
              ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: onSelectCategories,
              icon: const Icon(Icons.category_outlined),
              label: const Text('Selecionar categorias'),
            ),
            if (showError)
              Text(
                'Selecione pelo menos uma categoria para esta seção.',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
          ],
        ],
      ),
    );
  }
}
