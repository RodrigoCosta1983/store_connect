import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import '../../public/public_catalog_screen.dart';

class CatalogPreviewButton extends StatefulWidget {
  const CatalogPreviewButton({
    super.key,
    required this.isEditing,
    required this.draft,
    required this.onLoadingChanged,
  });

  final bool isEditing;
  final Map<String, dynamic>? Function() draft;
  final ValueChanged<bool> onLoadingChanged;

  @override
  State<CatalogPreviewButton> createState() => _CatalogPreviewButtonState();
}

class _CatalogPreviewButtonState extends State<CatalogPreviewButton> {
  bool _loading = false;

  Future<void> _preview() async {
    final draft = widget.draft();
    if (draft == null || _loading) return;
    setState(() => _loading = true);
    widget.onLoadingChanged(true);
    try {
      final response = await FirebaseFunctions.instance.httpsCallable(
        'previewCatalog',
        options: HttpsCallableOptions(timeout: const Duration(seconds: 30)),
      ).call(draft);
      if (!mounted) return;
      final data = Map<String, dynamic>.from(response.data as Map);
      if (data['success'] != true || data['store'] is! Map ||
          data['catalog'] is! Map || data['products'] is! List) {
        throw const FormatException('Prévia inválida.');
      }
      await Navigator.of(context).push<void>(MaterialPageRoute(
        builder: (_) => PublicCatalogScreen.preview(data: data),
      ));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Não foi possível visualizar o catálogo. Revise a configuração e tente novamente.'),
        ));
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
        widget.onLoadingChanged(false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => OutlinedButton.icon(
    onPressed: _loading ? null : _preview,
    icon: const Icon(Icons.visibility_outlined),
    label: Text(_loading ? 'Carregando prévia...' : widget.isEditing
        ? 'Visualizar alterações' : 'Visualizar catálogo'),
  );
}
