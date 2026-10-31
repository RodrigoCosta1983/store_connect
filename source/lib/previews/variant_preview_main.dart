import 'package:flutter/material.dart';
import '../fixtures/variant_preview_fixture.dart';
import '../services/variant_preview_state.dart';
import '../widgets/variant_preview_panel.dart';

// Separate entrypoint: no Firebase initialization or operational app navigation.
void main() => runApp(const VariantPreviewApp());

class VariantPreviewApp extends StatefulWidget {
  const VariantPreviewApp({super.key});
  @override
  State<VariantPreviewApp> createState() => _VariantPreviewAppState();
}

class _VariantPreviewAppState extends State<VariantPreviewApp> {
  late final VariantPreviewSession session;
  @override
  void initState() {
    super.initState();
    session = VariantPreviewSession(syntheticVariantPreview())..open();
  }

  @override
  void dispose() {
    session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Prévia sintética F10-C4-A',
    theme: ThemeData(useMaterial3: true),
    home: VariantPreviewPanel(session: session),
  );
}
