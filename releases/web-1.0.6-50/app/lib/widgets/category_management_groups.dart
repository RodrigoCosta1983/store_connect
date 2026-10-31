import 'package:flutter/material.dart';

class CategoryManagementEntry {
  final String id;
  final String name;
  final String imageUrl;
  final Object? parentId;

  const CategoryManagementEntry({
    required this.id,
    required this.name,
    this.imageUrl = '',
    this.parentId,
  });
}

/// Presentation only: the screen retains all administrative operations.
class CategoryManagementGroups extends StatefulWidget {
  final List<CategoryManagementEntry> entries;
  final bool canDelete;
  final ValueChanged<String> onEdit;
  final ValueChanged<String> onDelete;

  const CategoryManagementGroups({
    super.key,
    required this.entries,
    required this.canDelete,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  State<CategoryManagementGroups> createState() =>
      _CategoryManagementGroupsState();
}

class _CategoryManagementGroupsState extends State<CategoryManagementGroups> {
  final Set<String> _expanded = {};

  Widget _name(CategoryManagementEntry entry, bool root, bool mobile) {
    final style = (Theme.of(context).textTheme.titleMedium ?? const TextStyle())
        .copyWith(fontWeight: root ? FontWeight.w600 : FontWeight.w400);
    return LayoutBuilder(
      builder: (context, constraints) {
        if (!mobile) return Text(entry.name, style: style);
        final scaler = MediaQuery.textScalerOf(context);
        var size = 15.0;
        // Match F9's 14–15 px range without undoing accessibility scaling.
        if (scaler.scale(size) <= size) {
          for (; size > 14; size -= 0.5) {
            final painter = TextPainter(
              text: TextSpan(
                text: entry.name,
                style: style.copyWith(fontSize: size),
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
          entry.name,
          style: style.copyWith(fontSize: size),
          softWrap: true,
        );
      },
    );
  }

  Widget _row(
    CategoryManagementEntry entry, {
    required bool mobile,
    bool root = false,
    bool invalid = false,
    bool expandable = false,
  }) {
    final open = _expanded.contains(entry.id);
    return Padding(
      key: ValueKey('category-row-${entry.id}'),
      padding: EdgeInsets.only(left: root || invalid ? 4 : 16, right: 4),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (expandable)
              IconButton(
                key: ValueKey('category-expand-${entry.id}'),
                tooltip: open
                    ? 'Recolher subcategorias'
                    : 'Expandir subcategorias',
                onPressed: () => setState(() {
                  if (open) {
                    _expanded.remove(entry.id);
                  } else {
                    _expanded.add(entry.id);
                  }
                }),
                icon: Icon(open ? Icons.expand_less : Icons.expand_more),
              )
            else if (entry.imageUrl.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child: Icon(
                  invalid ? Icons.warning_amber : Icons.category_outlined,
                  size: 24,
                  color: invalid ? Colors.orange : Colors.indigo,
                ),
              ),
            if (entry.imageUrl.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(4),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Image.network(
                    entry.imageUrl,
                    width: 32,
                    height: 32,
                    fit: BoxFit.cover,
                    errorBuilder: (_, _, _) => const SizedBox(
                      width: 32,
                      height: 32,
                      child: Icon(Icons.category_outlined),
                    ),
                  ),
                ),
              ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _name(entry, root, mobile),
                    if (invalid)
                      const Text(
                        'Vínculo hierárquico inválido — edite para corrigir',
                        style: TextStyle(fontSize: 12),
                      ),
                  ],
                ),
              ),
            ),
            IconButton(
              key: ValueKey('category-edit-${entry.id}'),
              tooltip: 'Editar Categoria',
              onPressed: () => widget.onEdit(entry.id),
              icon: const Icon(Icons.edit_outlined, color: Colors.blueAccent),
            ),
            if (widget.canDelete)
              IconButton(
                key: ValueKey('category-delete-${entry.id}'),
                tooltip: 'Eliminar Categoria',
                onPressed: () => widget.onDelete(entry.id),
                icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final roots = widget.entries
        .where((entry) => entry.parentId == null)
        .toList();
    final rootIds = roots.map((entry) => entry.id).toSet();
    final invalid = widget.entries.where(
      (entry) => entry.parentId != null && !rootIds.contains(entry.parentId),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 700 ? 2 : 1;
        final width = (constraints.maxWidth - (columns - 1) * 12) / columns;
        final mobile = MediaQuery.sizeOf(context).width < 700;
        return Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            for (final root in roots)
              SizedBox(
                key: ValueKey('category-group-${root.id}'),
                width: width,
                child: Card(
                  margin: EdgeInsets.zero,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _row(
                        root,
                        mobile: mobile,
                        root: true,
                        expandable: widget.entries.any(
                          (e) => e.parentId == root.id,
                        ),
                      ),
                      if (_expanded.contains(root.id)) ...[
                        const Divider(height: 1),
                        for (final child in widget.entries.where(
                          (e) => e.parentId == root.id,
                        ))
                          _row(child, mobile: mobile),
                      ],
                    ],
                  ),
                ),
              ),
            // Never hide malformed/orphaned documents from administrative repair.
            for (final entry in invalid)
              SizedBox(
                width: width,
                child: Card(
                  margin: EdgeInsets.zero,
                  child: _row(entry, mobile: mobile, invalid: true),
                ),
              ),
          ],
        );
      },
    );
  }
}
