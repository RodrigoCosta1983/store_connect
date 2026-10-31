import 'package:flutter/material.dart';

/// Existing dates are never converted for a quantity-only patch.
class ProductStockLotsEditor extends StatefulWidget {
  final List<Map<String, dynamic>> lots;
  final bool conversion;
  final bool enabled;
  const ProductStockLotsEditor({
    super.key,
    required this.lots,
    required this.conversion,
    required this.enabled,
  });
  @override
  State<ProductStockLotsEditor> createState() => ProductStockLotsEditorState();
}

class ProductStockLotsEditorState extends State<ProductStockLotsEditor> {
  final patches = <int, Map<String, String>>{};
  final removed = <int>{};
  final added = <Map<String, String>>[];
  List<Map<String, dynamic>> command() {
    Map<String, dynamic> values(Map<String, String> raw) {
      final result = <String, dynamic>{};
      if (raw.containsKey('quantidade')) {
        final n = int.tryParse(raw['quantidade']!);
        if (n == null) {
          throw const FormatException('Quantidade de lote inválida.');
        }
        result['quantidade'] = n;
      }
      if (raw.containsKey('validade')) {
        final date = raw['validade']!;
        // Explicit UTC avoids device timezone changes and ambiguous dates.
        if (!date.endsWith('Z')) {
          throw const FormatException(
            'Informe validade em UTC, terminando em Z.',
          );
        }
        final parsed = DateTime.tryParse(date);
        if (parsed == null ||
            parsed.microsecondsSinceEpoch % 1000 != 0 ||
            parsed.toIso8601String() != date) {
          throw const FormatException(
            'Nova validade deve ter precisão de milissegundos.',
          );
        }
        result['validadeMs'] = parsed.millisecondsSinceEpoch;
      }
      return result;
    }

    final result = <Map<String, dynamic>>[];
    if (!widget.conversion) {
      for (final lot in widget.lots) {
        final index = lot['index'] as int;
        if (removed.contains(index)) {
          result.add({'op': 'remove', 'index': index});
        } else if (patches[index]?.isNotEmpty == true) {
          result.add({
            'op': 'update',
            'index': index,
            'set': values(patches[index]!),
          });
        }
      }
    }
    for (final row in added) {
      if (!row.containsKey('quantidade') || !row.containsKey('validade')) {
        throw const FormatException(
          'Informe quantidade e validade do novo lote.',
        );
      }
      result.add({if (!widget.conversion) 'op': 'add', ...values(row)});
    }
    return result;
  }

  Widget fields(
    String identity,
    Map<String, String> values, {
    String? quantity,
    String? date,
    bool enabled = true,
  }) => Wrap(
    spacing: 12,
    runSpacing: 8,
    children: [
      SizedBox(
        width: 160,
        child: TextFormField(
          key: ValueKey('$identity-quantity'),
          initialValue: quantity,
          enabled: widget.enabled && enabled,
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(labelText: 'Quantidade do lote'),
          onChanged: (v) => values['quantidade'] = v,
        ),
      ),
      SizedBox(
        width: 280,
        child: TextFormField(
          key: ValueKey('$identity-date'),
          initialValue: date,
          enabled: widget.enabled && enabled,
          decoration: const InputDecoration(
            labelText: 'Validade UTC',
            hintText: '2027-01-31T00:00:00.000Z',
          ),
          onChanged: (v) => values['validade'] = v,
        ),
      ),
    ],
  );
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (!widget.conversion)
        for (final lot in widget.lots) ...[
          Text(
            'Lote ${lot['index']} — validade original preservada até edição explícita',
          ),
          fields(
            'original-${lot['index']}',
            patches.putIfAbsent(lot['index'] as int, () => {}),
            quantity: '${lot['quantidade']}',
            enabled: !removed.contains(lot['index']),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('Remover lote ${lot['index']}'),
            value: removed.contains(lot['index']),
            onChanged: widget.enabled
                ? (v) => setState(() {
                    if (v!) {
                      removed.add(lot['index'] as int);
                    } else {
                      removed.remove(lot['index']);
                    }
                  })
                : null,
          ),
        ],
      for (var i = 0; i < added.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Text('Novo lote ${i + 1}'), fields('new-$i', added[i])],
          ),
        ),
      TextButton.icon(
        onPressed: widget.enabled ? () => setState(() => added.add({})) : null,
        icon: const Icon(Icons.add),
        label: const Text('Adicionar lote'),
      ),
    ],
  );
}
