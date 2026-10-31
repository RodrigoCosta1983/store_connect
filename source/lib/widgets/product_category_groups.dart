import 'package:flutter/material.dart';

class ProductCategoryOption {
  final String id;
  final String name;
  final String? parentId;
  final bool invalidHierarchy;
  const ProductCategoryOption(
    this.id,
    this.name, {
    this.parentId,
    this.invalidHierarchy = false,
  });
}

class ProductCategoryGroups extends StatefulWidget {
  final List<ProductCategoryOption> options;
  final List<String> selectedIds;
  final bool locked;
  final void Function(String id, bool selected) onChanged;
  const ProductCategoryGroups({
    super.key,
    required this.options,
    required this.selectedIds,
    required this.onChanged,
    this.locked = false,
  });

  @override
  State<ProductCategoryGroups> createState() => _ProductCategoryGroupsState();
}

class _ProductCategoryGroupsState extends State<ProductCategoryGroups> {
  final Set<String> _expanded = {};

  Widget _label(ProductCategoryOption option, {required bool parent}) {
    final style = Theme.of(context).textTheme.titleMedium ?? const TextStyle();
    final weight = parent ? FontWeight.w600 : style.fontWeight;
    // Use the available title width, after checkbox, indentation and arrow.
    return LayoutBuilder(
      builder: (context, constraints) {
        final mobile = MediaQuery.sizeOf(context).width < 700;
        if (!mobile) {
          return Text(
            option.name,
            style: parent ? const TextStyle(fontWeight: FontWeight.w600) : null,
          );
        }
        final scaler = MediaQuery.textScalerOf(context);
        var size = 15.0;
        // Preserve accessibility scaling instead of compensating for it.
        if (scaler.scale(size) <= size) {
          for (; size > 14; size -= 0.5) {
            final painter = TextPainter(
              text: TextSpan(
                text: option.name,
                style: style.copyWith(fontSize: size, fontWeight: weight),
              ),
              textDirection: Directionality.of(context),
              textScaler: scaler,
              maxLines: 1,
            )..layout(maxWidth: constraints.maxWidth);
            final fits = !painter.didExceedMaxLines;
            painter.dispose();
            if (fits) break;
          }
        }
        return Text(
          option.name,
          style: style.copyWith(fontSize: size, fontWeight: weight),
          softWrap: true,
        );
      },
    );
  }

  Widget _choice(ProductCategoryOption option, {bool parent = false}) {
    final selected = widget.selectedIds.contains(option.id);
    return CheckboxListTile(
      value: selected,
      contentPadding: EdgeInsets.only(left: parent ? 0 : 20, right: 8),
      controlAffinity: ListTileControlAffinity.leading,
      title: _label(option, parent: parent),
      subtitle: option.invalidHierarchy
          ? const Text('Vínculo hierárquico inválido')
          : null,
      onChanged: widget.locked
          ? null
          : (value) {
              if (value == null) return;
              if (value && !selected && widget.selectedIds.length >= 10) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'É possível selecionar no máximo 10 categorias.',
                    ),
                  ),
                );
                return;
              }
              widget.onChanged(option.id, value);
            },
    );
  }

  @override
  Widget build(BuildContext context) {
    final roots = widget.options.where((option) => option.parentId == null);
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 700 ? 2 : 1;
        final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
        return Wrap(
          spacing: 12,
          runSpacing: 8,
          children: roots.map((root) {
            final children = widget.options
                .where((o) => o.parentId == root.id)
                .toList();
            final hasSelection =
                widget.selectedIds.contains(root.id) ||
                children.any((o) => widget.selectedIds.contains(o.id));
            final open = hasSelection || _expanded.contains(root.id);
            return SizedBox(
              width: width,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: Theme.of(context).dividerColor),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(child: _choice(root, parent: true)),
                        if (children.isNotEmpty)
                          IconButton(
                            tooltip: open
                                ? 'Recolher subcategorias'
                                : 'Expandir subcategorias',
                            onPressed: hasSelection
                                ? null
                                : () => setState(() {
                                    if (open) {
                                      _expanded.remove(root.id);
                                    } else {
                                      _expanded.add(root.id);
                                    }
                                  }),
                            icon: Icon(
                              open ? Icons.expand_less : Icons.expand_more,
                            ),
                          ),
                      ],
                    ),
                    if (open) ...children.map(_choice),
                  ],
                ),
              ),
            );
          }).toList(),
        );
      },
    );
  }
}
