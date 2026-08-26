// ============================================================================
// ARQUIVO: smart_home_screen.dart
// ============================================================================
//
// OBJETIVO:
// Nova Home principal do Store&Connect.
//
// PROPOSTA:
// - Dashboard: "quais são os meus números?"
// - Home: "como está meu negócio e onde devo agir agora?"
//
// V1.3:
// - resumo compacto do dia;
// - comparação com o mesmo dia da semana nas semanas anteriores;
// - Radar da Loja com prioridades e oportunidades;
// - acesso rápido à Nova Venda e Dashboard;
// - base pronta para futura camada de IA;
// - preferências do Radar controladas pela própria loja.
//
// RESPONSIVIDADE:
// - mobile: largura natural;
// - web/desktop: conteúdo centralizado com maxWidth 1100.
//
// MANUTENÇÃO:
// - não duplicar consultas Firestore nesta tela;
// - regras pertencem ao BusinessInsightsService;
// - não remover o Dashboard;
// - a IA futura deve interpretar métricas já calculadas.
// ============================================================================

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:store_connect/models/business_insight.dart';
import 'package:store_connect/screens/dashboard_screen.dart';
import 'package:store_connect/screens/reports/low_stock_report_screen.dart';
import 'package:store_connect/screens/sales/new_sale_screen.dart';
import 'package:store_connect/screens/sales/sales_history_screen.dart';
import 'package:store_connect/services/business_insights_service.dart';
import 'package:store_connect/services/home/radar_preferences_screen.dart';
import 'package:store_connect/widgets/dynamic_background.dart';

class SmartHomeScreen extends StatefulWidget {
  final String storeId;

  const SmartHomeScreen({super.key, required this.storeId});

  @override
  State<SmartHomeScreen> createState() => _SmartHomeScreenState();
}

class _SmartHomeScreenState extends State<SmartHomeScreen> {
  final BusinessInsightsService _service = BusinessInsightsService();
  late Future<BusinessHomeSnapshot> _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    _future = _service.load(storeId: widget.storeId);
  }

  Future<void> _refresh() async {
    setState(_reload);
    await _future;
  }

  Future<void> _openRadarPreferences() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RadarPreferencesScreen(storeId: widget.storeId),
      ),
    );

    if (!mounted) return;

    setState(_reload);
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  String _comparisonText(BusinessHomeSnapshot data) {
    final percent = data.salesVsSameWeekdayAveragePercent;
    if (percent == null) return 'Construindo seu histórico';
    if (percent.abs() < 1) return 'No ritmo da média';
    if (percent > 0) return '+${percent.toStringAsFixed(0)}% vs. média';
    return '${percent.toStringAsFixed(0)}% vs. média';
  }

  Color _comparisonColor(BuildContext context, BusinessHomeSnapshot data) {
    final percent = data.salesVsSameWeekdayAveragePercent;
    if (percent == null || percent.abs() < 1) {
      return Theme.of(context).colorScheme.onSurfaceVariant;
    }
    return percent > 0 ? Colors.green.shade700 : Colors.orange.shade800;
  }

  Color _insightColor(BusinessInsightLevel level) {
    switch (level) {
      case BusinessInsightLevel.critical:
        return Colors.red.shade700;
      case BusinessInsightLevel.attention:
        return Colors.orange.shade800;
      case BusinessInsightLevel.opportunity:
        return Colors.amber.shade800;
      case BusinessInsightLevel.positive:
        return Colors.green.shade700;
      case BusinessInsightLevel.neutral:
        return Colors.blueGrey;
    }
  }

  void _openInsightAction(BusinessInsight insight) {
    switch (insight.action) {
      case BusinessInsightAction.openLowStock:
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => LowStockReportScreen(storeId: widget.storeId),
          ),
        );
        break;
      case BusinessInsightAction.openDashboard:
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => DashboardScreen(storeId: widget.storeId),
          ),
        );
        break;
      case BusinessInsightAction.openSalesHistory:
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => SalesHistoryScreen(storeId: widget.storeId),
          ),
        );
        break;
      case null:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Início'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Personalizar Radar',
            onPressed: _openRadarPreferences,
            icon: const Icon(Icons.tune_rounded),
          ),
          IconButton(
            tooltip: 'Atualizar',
            onPressed: () => setState(_reload),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      extendBodyBehindAppBar: true,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => NewSaleScreen(storeId: widget.storeId),
            ),
          );
        },
        icon: const Icon(Icons.point_of_sale_outlined),
        label: const Text('NOVA VENDA'),
      ),
      body: Stack(
        children: [
          const DynamicBackground(),
          SafeArea(
            child: FutureBuilder<BusinessHomeSnapshot>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting &&
                    !snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError || !snapshot.hasData) {
                  return _ErrorState(onRetry: () => setState(_reload));
                }

                final data = snapshot.data!;

                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 1100),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _HeroHeader(
                              greeting: _greeting(),
                              storeName: data.storeName,
                              onSaleTap: () {
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        NewSaleScreen(storeId: widget.storeId),
                                  ),
                                );
                              },
                            ),
                            const SizedBox(height: 16),
                            _CompactTodayCard(
                              salesToday: currency.format(data.salesToday),
                              salesCount: data.salesCountToday,
                              averageTicket: currency.format(
                                data.averageTicketToday,
                              ),
                              comparison: _comparisonText(data),
                              comparisonColor: _comparisonColor(context, data),
                            ),
                            const SizedBox(height: 24),
                            Row(
                              children: [
                                Icon(
                                  Icons.auto_awesome_outlined,
                                  color: Theme.of(context).colorScheme.primary,
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  'Radar da Loja',
                                  style: Theme.of(context).textTheme.titleLarge
                                      ?.copyWith(fontWeight: FontWeight.bold),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'O que merece sua atenção agora.',
                              style: Theme.of(context).textTheme.bodyMedium
                                  ?.copyWith(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                                  ),
                            ),
                            const SizedBox(height: 12),
                            ...data.insights.map(
                              (insight) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: _InsightCard(
                                  insight: insight,
                                  accentColor: _insightColor(insight.level),
                                  onTap: insight.action == null
                                      ? null
                                      : () => _openInsightAction(insight),
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            _FutureAiCard(
                              onDashboardTap: () {
                                Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => DashboardScreen(
                                      storeId: widget.storeId,
                                    ),
                                  ),
                                );
                              },
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroHeader extends StatelessWidget {
  final String greeting;
  final String storeName;
  final VoidCallback onSaleTap;

  const _HeroHeader({
    required this.greeting,
    required this.storeName,
    required this.onSaleTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.90),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.60),
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 620;
          final text = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$greeting 👋', style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(
                storeName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Veja como o seu negócio está e onde vale agir hoje.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          );
          final button = FilledButton.icon(
            onPressed: onSaleTap,
            icon: const Icon(Icons.point_of_sale_outlined),
            label: const Text('Nova venda'),
          );

          if (compact) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [text, const SizedBox(height: 16), button],
            );
          }

          return Row(
            children: [
              Expanded(child: text),
              const SizedBox(width: 20),
              button,
            ],
          );
        },
      ),
    );
  }
}

class _CompactTodayCard extends StatelessWidget {
  final String salesToday;
  final int salesCount;
  final String averageTicket;
  final String comparison;
  final Color comparisonColor;

  const _CompactTodayCard({
    required this.salesToday,
    required this.salesCount,
    required this.averageTicket,
    required this.comparison,
    required this.comparisonColor,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 18,
          runSpacing: 14,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _MiniMetric(
              label: 'Hoje',
              value: salesToday,
              icon: Icons.payments_outlined,
            ),
            _MiniMetric(
              label: 'Vendas',
              value: '$salesCount',
              icon: Icons.receipt_long_outlined,
            ),
            _MiniMetric(
              label: 'Ticket médio',
              value: averageTicket,
              icon: Icons.price_check_outlined,
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: comparisonColor.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(99),
              ),
              child: Text(
                comparison,
                style: TextStyle(
                  color: comparisonColor,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MiniMetric extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _MiniMetric({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 150,
      child: Row(
        children: [
          Icon(icon, size: 21, color: theme.colorScheme.primary),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.bodySmall),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InsightCard extends StatelessWidget {
  final BusinessInsight insight;
  final Color accentColor;
  final VoidCallback? onTap;

  const _InsightCard({
    required this.insight,
    required this.accentColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface.withValues(alpha: 0.92),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border(left: BorderSide(color: accentColor, width: 4)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: accentColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(insight.icon, color: accentColor),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      insight.title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      insight.message,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (insight.actionLabel != null && onTap != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        insight.actionLabel!,
                        style: theme.textTheme.labelLarge?.copyWith(
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (onTap != null)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Icon(Icons.chevron_right),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FutureAiCard extends StatelessWidget {
  final VoidCallback onDashboardTap;

  const _FutureAiCard({required this.onDashboardTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            theme.colorScheme.primary.withValues(alpha: 0.13),
            theme.colorScheme.secondary.withValues(alpha: 0.08),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.primary.withValues(alpha: 0.20),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Text(
                'Assistente do negócio',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'O Radar já analisa seus dados automaticamente. Na próxima etapa, '
            'vamos adicionar perguntas em linguagem natural como “o que preciso '
            'melhorar esta semana?”.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: onDashboardTap,
            icon: const Icon(Icons.dashboard_outlined),
            label: const Text('Ver Dashboard'),
          ),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final VoidCallback onRetry;

  const _ErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_outlined, size: 54),
            const SizedBox(height: 12),
            const Text(
              'Não foi possível montar o Radar da Loja agora.',
              textAlign: TextAlign.center,
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'Verifique a conexão ou tente novamente.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}
