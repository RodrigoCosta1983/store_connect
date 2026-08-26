// ============================================================================
// ARQUIVO: radar_preferences_screen.dart
// ============================================================================
//
// OBJETIVO:
//
// Permitir que cada loja escolha quais categorias deseja visualizar no
// Radar da Loja.
//
// PERSISTÊNCIA:
//
// stores/{storeId}
//   radarPreferences: {
//     salesPerformance: true,
//     lowStock: true,
//     expiry: true,
//     receivables: true,
//     slowMoving: true,
//   }
//
// PADRÕES:
//
// • Campos ausentes são tratados como true.
// • Isso preserva o comportamento das lojas já existentes.
// • A preferência é da loja, portanto acompanha a conta em outros dispositivos.
//
// IMPORTANTE:
//
// • Esta tela controla apenas a VISIBILIDADE dos insights.
// • Ela não altera dados de vendas, estoque, recebíveis ou validade.
// • "Capital parado em estoque" ainda não aparece aqui porque o cálculo depende
//   da definição/validação do campo de custo do produto.
// • As regras dos insights continuam no BusinessInsightsService.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

class RadarPreferencesScreen extends StatelessWidget {
  final String storeId;

  const RadarPreferencesScreen({super.key, required this.storeId});

  DocumentReference<Map<String, dynamic>> _storeRef() {
    return FirebaseFirestore.instance.collection('stores').doc(storeId);
  }

  Future<void> _setPreference(
    BuildContext context,
    String key,
    bool value,
  ) async {
    try {
      await _storeRef().update({'radarPreferences.$key': value});
    } catch (e) {
      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Não foi possível salvar a preferência: $e'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  Future<void> _restoreDefaults(BuildContext context) async {
    try {
      await _storeRef().update({
        'radarPreferences.salesPerformance': true,
        'radarPreferences.lowStock': true,
        'radarPreferences.expiry': true,
        'radarPreferences.receivables': true,
        'radarPreferences.slowMoving': true,
      });

      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Preferências padrão restauradas.')),
      );
    } catch (e) {
      if (!context.mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Não foi possível restaurar as preferências: $e'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  bool _readPreference(Map<String, dynamic> storeData, String key) {
    final rawPreferences = storeData['radarPreferences'];

    if (rawPreferences is! Map) {
      return true;
    }

    final value = rawPreferences[key];

    return value is bool ? value : true;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Personalizar Radar'),
        actions: [
          IconButton(
            tooltip: 'Restaurar padrão',
            onPressed: () => _restoreDefaults(context),
            icon: const Icon(Icons.restart_alt_rounded),
          ),
        ],
      ),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: _storeRef().snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasError) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'Não foi possível carregar as preferências do Radar.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }

          final storeData = snapshot.data?.data() ?? <String, dynamic>{};

          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Text(
                'Escolha o que merece aparecer no seu Radar.',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Você pode mudar essas opções quando quiser. '
                'Desativar uma categoria apenas esconde os insights dela.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),
              _PreferenceTile(
                icon: Icons.trending_up_rounded,
                title: 'Desempenho das vendas',
                subtitle: 'Comparações com o ritmo habitual de vendas da loja.',
                value: _readPreference(storeData, 'salesPerformance'),
                onChanged: (value) =>
                    _setPreference(context, 'salesPerformance', value),
              ),
              _PreferenceTile(
                icon: Icons.inventory_2_outlined,
                title: 'Estoque baixo',
                subtitle:
                    'Alertas de reposição e produtos de alta saída perto de acabar.',
                value: _readPreference(storeData, 'lowStock'),
                onChanged: (value) =>
                    _setPreference(context, 'lowStock', value),
              ),
              _PreferenceTile(
                icon: Icons.event_busy_outlined,
                title: 'Validade dos produtos',
                subtitle: 'Produtos vencidos ou próximos do vencimento.',
                value: _readPreference(storeData, 'expiry'),
                onChanged: (value) => _setPreference(context, 'expiry', value),
              ),
              _PreferenceTile(
                icon: Icons.account_balance_wallet_outlined,
                title: 'Valores a receber',
                subtitle: 'Acompanhamento de vendas a prazo ainda em aberto.',
                value: _readPreference(storeData, 'receivables'),
                onChanged: (value) =>
                    _setPreference(context, 'receivables', value),
              ),
              _PreferenceTile(
                icon: Icons.lightbulb_outline,
                title: 'Produtos com pouca saída',
                subtitle:
                    'Produtos com estoque há pelo menos 30 dias e sem vendas no período.',
                value: _readPreference(storeData, 'slowMoving'),
                onChanged: (value) =>
                    _setPreference(context, 'slowMoving', value),
              ),
              const SizedBox(height: 16),
              Card(
                margin: EdgeInsets.zero,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.info_outline,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'Novas categorias poderão ser adicionadas aqui no '
                          'futuro. Assim cada lojista monta um Radar mais útil '
                          'para a própria rotina.',
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _PreferenceTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _PreferenceTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: SwitchListTile(
        secondary: Icon(icon),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle),
        value: value,
        onChanged: onChanged,
      ),
    );
  }
}
