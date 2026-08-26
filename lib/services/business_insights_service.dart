// ============================================================================
// ARQUIVO: business_insights_service.dart
// ============================================================================
//
// OBJETIVO:
// Construir a leitura inteligente do negócio exibida na Home.
//
// DIFERENÇA PARA O DASHBOARD:
// - Dashboard: mostra KPIs.
// - Home: interpreta os KPIs e destaca prioridades e oportunidades.
//
// V1.3:
// Esta versão é determinística e não depende de IA externa.
//
// PERSONALIZAÇÃO DO RADAR:
// - cada loja pode escolher quais categorias de insight deseja visualizar;
// - as preferências ficam em stores/{storeId}.radarPreferences;
// - categorias ausentes usam true como padrão para preservar o comportamento
//   já existente;
// - esta versão não implementa ainda o cálculo de "capital parado", porque o
//   campo de custo do produto ainda precisa ser definido/validado.
//
// MELHORIAS ACUMULADAS:
// - separa produtos vencidos de produtos próximos do vencimento;
// - exibe o valor real em reais no insight de contas a receber;
// - considera como produto com pouca saída somente itens com estoque,
//   cadastrados há pelo menos 30 dias e sem vendas nos últimos 30 dias;
// - produtos sem createdAt confiável não entram no alerta de pouca saída;
// - mantém as demais regras sem alterar a arquitetura da Home Inteligente.
//
// CUIDADOS:
// - ignora vendas com status cancelled/canceled;
// - quantidades continuam inteiras;
// - não grava nada no Firestore;
// - tolera documentos antigos com campos opcionais ausentes.
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'package:store_connect/models/business_insight.dart';

class BusinessInsightsService {
  BusinessInsightsService({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  Future<BusinessHomeSnapshot> load({required String storeId}) async {
    final now = DateTime.now();
    final todayStart = DateTime(now.year, now.month, now.day);
    final tomorrowStart = todayStart.add(const Duration(days: 1));
    final historyStart = todayStart.subtract(const Duration(days: 35));
    final last30DaysStart = todayStart.subtract(const Duration(days: 30));
    final last7DaysStart = todayStart.subtract(const Duration(days: 7));

    final storeRef = _firestore.collection('stores').doc(storeId);

    final results = await Future.wait<dynamic>([
      storeRef.get(),
      storeRef
          .collection('sales')
          .where('createdAt', isGreaterThanOrEqualTo: historyStart)
          .get(),
      storeRef.collection('products').get(),
      storeRef.collection('sales').where('isPaid', isEqualTo: false).get(),
    ]);

    final storeDoc = results[0] as DocumentSnapshot<Map<String, dynamic>>;
    final recentSales = results[1] as QuerySnapshot<Map<String, dynamic>>;
    final products = results[2] as QuerySnapshot<Map<String, dynamic>>;
    final receivableSales = results[3] as QuerySnapshot<Map<String, dynamic>>;

    final storeData = storeDoc.data() ?? <String, dynamic>{};
    final rawStoreName = storeData['name']?.toString().trim() ?? '';
    final storeName = rawStoreName.isEmpty ? 'Minha Loja' : rawStoreName;

    final fallbackLowStockThreshold =
        (storeData['lowStockThreshold'] as num? ?? 5).toInt();
    final expiryThresholdDays = (storeData['expiryThreshold'] as num? ?? 30)
        .toInt();

    // =======================================================================
    // PREFERÊNCIAS DO RADAR
    //
    // Ausência de configuração mantém todas as categorias atuais habilitadas,
    // preservando compatibilidade com lojas existentes.
    // =======================================================================

    final radarPreferences = _readRadarPreferences(storeData);

    final activeRecentSales = recentSales.docs
        .where((doc) => !_isCancelled(doc.data()))
        .toList();

    final todaySales = activeRecentSales.where((doc) {
      final createdAt = _readDate(doc.data()['createdAt']);
      if (createdAt == null) return false;
      return !createdAt.isBefore(todayStart) &&
          createdAt.isBefore(tomorrowStart);
    }).toList();

    double salesToday = 0;
    for (final doc in todaySales) {
      salesToday += (doc.data()['totalAmount'] as num? ?? 0).toDouble();
    }

    final salesCountToday = todaySales.length;
    final averageTicketToday = salesCountToday > 0
        ? salesToday / salesCountToday
        : 0.0;

    final sameWeekdayTotals = _previousSameWeekdayTotals(
      sales: activeRecentSales,
      todayStart: todayStart,
      occurrences: 4,
    );

    double? comparisonPercent;
    if (sameWeekdayTotals.isNotEmpty) {
      final historicalAverage =
          sameWeekdayTotals.reduce((a, b) => a + b) / sameWeekdayTotals.length;
      if (historicalAverage > 0) {
        comparisonPercent =
            ((salesToday - historicalAverage) / historicalAverage) * 100;
      } else if (salesToday > 0) {
        comparisonPercent = 100;
      }
    }

    final lowStockProducts = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    int expiredProductsCount = 0;
    int expiringProductsCount = 0;
    final expiryLimit = now.add(Duration(days: expiryThresholdDays));

    for (final productDoc in products.docs) {
      final data = productDoc.data();
      final quantity = (data['quantidade'] as num? ?? 0).toInt();
      final productMinimum = (data['minimumStock'] as num?)?.toInt();
      final threshold = productMinimum ?? fallbackLowStockThreshold;

      if (quantity <= threshold) {
        lowStockProducts.add(productDoc);
      }

      final lots = data['lotes'];
      if (lots is List) {
        bool hasExpiredLot = false;
        bool hasExpiringLot = false;

        for (final rawLot in lots) {
          if (rawLot is! Map) continue;

          final lotQuantity = (rawLot['quantidade'] as num? ?? 0).toInt();
          if (lotQuantity <= 0) continue;

          final expiry = _readDate(rawLot['validade']);
          if (expiry == null) continue;

          // Consideramos vencido somente quando a validade ficou antes
          // do início do dia atual. Um lote que vence hoje ainda entra
          // como "próximo do vencimento".
          if (expiry.isBefore(todayStart)) {
            hasExpiredLot = true;
            continue;
          }

          if (expiry.isBefore(expiryLimit)) {
            hasExpiringLot = true;
          }
        }

        if (hasExpiredLot) expiredProductsCount++;
        if (hasExpiringLot) expiringProductsCount++;
      }
    }

    double totalReceivable = 0;
    for (final doc in receivableSales.docs) {
      final data = doc.data();
      if (_isCancelled(data)) continue;
      totalReceivable += (data['totalAmount'] as num? ?? 0).toDouble();
    }

    final soldLast7Days = <String, int>{};
    final soldLast30Days = <String>{};

    for (final saleDoc in activeRecentSales) {
      final data = saleDoc.data();
      final createdAt = _readDate(data['createdAt']);
      if (createdAt == null) continue;
      final rawProducts = data['products'];
      if (rawProducts is! List) continue;

      for (final rawProduct in rawProducts) {
        if (rawProduct is! Map) continue;
        final productId = rawProduct['productId']?.toString() ?? '';
        if (productId.isEmpty) continue;

        if (!createdAt.isBefore(last30DaysStart)) {
          soldLast30Days.add(productId);
        }
        if (!createdAt.isBefore(last7DaysStart)) {
          final quantity = (rawProduct['quantity'] as num? ?? 0).toInt();
          soldLast7Days.update(
            productId,
            (current) => current + quantity,
            ifAbsent: () => quantity,
          );
        }
      }
    }

    final insights = _buildInsights(
      comparisonPercent: comparisonPercent,
      totalReceivable: totalReceivable,
      lowStockProducts: lowStockProducts,
      expiredProductsCount: expiredProductsCount,
      expiringProductsCount: expiringProductsCount,
      allProducts: products.docs,
      soldLast7Days: soldLast7Days,
      soldLast30Days: soldLast30Days,
      radarPreferences: radarPreferences,
    );

    return BusinessHomeSnapshot(
      storeName: storeName,
      salesToday: salesToday,
      salesCountToday: salesCountToday,
      averageTicketToday: averageTicketToday,
      salesVsSameWeekdayAveragePercent: comparisonPercent,
      totalReceivable: totalReceivable,
      lowStockCount: lowStockProducts.length,
      expiringProductsCount: expiringProductsCount,
      insights: insights,
    );
  }

  List<double> _previousSameWeekdayTotals({
    required List<QueryDocumentSnapshot<Map<String, dynamic>>> sales,
    required DateTime todayStart,
    required int occurrences,
  }) {
    final totals = <double>[];

    for (var i = 1; i <= occurrences; i++) {
      final targetStart = todayStart.subtract(Duration(days: 7 * i));
      final targetEnd = targetStart.add(const Duration(days: 1));
      double total = 0;
      bool foundDayData = false;

      for (final doc in sales) {
        final data = doc.data();
        final createdAt = _readDate(data['createdAt']);
        if (createdAt == null) continue;
        if (!createdAt.isBefore(targetStart) && createdAt.isBefore(targetEnd)) {
          total += (data['totalAmount'] as num? ?? 0).toDouble();
          foundDayData = true;
        }
      }

      if (foundDayData) totals.add(total);
    }

    return totals;
  }

  List<BusinessInsight> _buildInsights({
    required double? comparisonPercent,
    required double totalReceivable,
    required List<QueryDocumentSnapshot<Map<String, dynamic>>> lowStockProducts,
    required int expiredProductsCount,
    required int expiringProductsCount,
    required List<QueryDocumentSnapshot<Map<String, dynamic>>> allProducts,
    required Map<String, int> soldLast7Days,
    required Set<String> soldLast30Days,
    required _RadarPreferences radarPreferences,
  }) {
    final insights = <BusinessInsight>[];

    if (radarPreferences.salesPerformance && comparisonPercent != null) {
      if (comparisonPercent <= -15) {
        insights.add(
          BusinessInsight(
            level: BusinessInsightLevel.attention,
            title: 'Vendas abaixo do ritmo habitual',
            message:
                'O faturamento de hoje está ${comparisonPercent.abs().toStringAsFixed(0)}% abaixo da média das últimas semanas para este mesmo dia.',
            icon: Icons.trending_down,
            actionLabel: 'Ver vendas',
            action: BusinessInsightAction.openSalesHistory,
          ),
        );
      } else if (comparisonPercent >= 15) {
        insights.add(
          BusinessInsight(
            level: BusinessInsightLevel.positive,
            title: 'Hoje está acima da média',
            message:
                'Seu faturamento está ${comparisonPercent.toStringAsFixed(0)}% acima da média das últimas semanas para este mesmo dia.',
            icon: Icons.trending_up,
            actionLabel: 'Ver detalhes',
            action: BusinessInsightAction.openDashboard,
          ),
        );
      }
    }

    if (radarPreferences.lowStock) {
      final lowStockIds = lowStockProducts.map((doc) => doc.id).toSet();
      String? hotProductName;
      int hotProductSales = 0;

      for (final entry in soldLast7Days.entries) {
        if (!lowStockIds.contains(entry.key) ||
            entry.value <= hotProductSales) {
          continue;
        }
        final productDoc = lowStockProducts.firstWhere(
          (doc) => doc.id == entry.key,
        );
        hotProductName = productDoc.data()['name']?.toString();
        hotProductSales = entry.value;
      }

      if (hotProductName != null && hotProductSales > 0) {
        insights.add(
          BusinessInsight(
            level: BusinessInsightLevel.critical,
            title: 'Produto de alta saída perto de acabar',
            message:
                '$hotProductName vendeu $hotProductSales unidade(s) nos últimos 7 dias e já está no nível de estoque baixo.',
            icon: Icons.local_fire_department_outlined,
            actionLabel: 'Ver estoque',
            action: BusinessInsightAction.openLowStock,
          ),
        );
      } else if (lowStockProducts.isNotEmpty) {
        insights.add(
          BusinessInsight(
            level: BusinessInsightLevel.critical,
            title: 'Estoque precisa de atenção',
            message:
                '${lowStockProducts.length} produto(s) atingiram o nível de estoque baixo definido pela loja.',
            icon: Icons.inventory_2_outlined,
            actionLabel: 'Ver estoque',
            action: BusinessInsightAction.openLowStock,
          ),
        );
      }
    }

    if (radarPreferences.expiry && expiredProductsCount > 0) {
      insights.add(
        BusinessInsight(
          level: BusinessInsightLevel.critical,
          title: 'Produtos vencidos em estoque',
          message:
              '$expiredProductsCount produto(s) possuem lote vencido ainda com quantidade em estoque.',
          icon: Icons.warning_amber_rounded,
        ),
      );
    }

    if (radarPreferences.expiry && expiringProductsCount > 0) {
      insights.add(
        BusinessInsight(
          level: BusinessInsightLevel.attention,
          title: 'Produtos próximos do vencimento',
          message:
              '$expiringProductsCount produto(s) possuem lote com validade dentro do período de alerta configurado.',
          icon: Icons.event_busy_outlined,
        ),
      );
    }

    if (radarPreferences.receivables && totalReceivable > 0) {
      final currency = NumberFormat.currency(locale: 'pt_BR', symbol: 'R\$');

      insights.add(
        BusinessInsight(
          level: BusinessInsightLevel.attention,
          title: 'Valores a receber',
          message:
              'Você tem ${currency.format(totalReceivable)} em vendas a prazo ainda em aberto. Acompanhe esses recebimentos para proteger o caixa.',
          icon: Icons.account_balance_wallet_outlined,
          actionLabel: 'Ver dashboard',
          action: BusinessInsightAction.openDashboard,
        ),
      );
    }

    final stagnantThresholdDate = DateTime.now().subtract(
      const Duration(days: 30),
    );

    final stagnantProducts = allProducts.where((doc) {
      final data = doc.data();

      final quantity = (data['quantidade'] as num? ?? 0).toInt();
      if (quantity <= 0) return false;

      final createdAt = _readDate(data['createdAt']);

      // Produtos sem data confiável não entram automaticamente no alerta.
      if (createdAt == null) return false;

      final isOldEnough = !createdAt.isAfter(stagnantThresholdDate);
      final hasNoSalesInLast30Days = !soldLast30Days.contains(doc.id);

      return isOldEnough && hasNoSalesInLast30Days;
    }).toList();

    if (radarPreferences.slowMoving && stagnantProducts.isNotEmpty) {
      insights.add(
        BusinessInsight(
          level: BusinessInsightLevel.opportunity,
          title: 'Produtos com pouca saída',
          message:
              '${stagnantProducts.length} produto(s) estão em estoque há pelo menos 30 dias e não registraram vendas nesse período.',
          icon: Icons.lightbulb_outline,
        ),
      );
    }

    if (insights.isEmpty) {
      if (radarPreferences.hasAnyEnabledCategory) {
        insights.add(
          const BusinessInsight(
            level: BusinessInsightLevel.positive,
            title: 'Nenhum alerta importante agora',
            message:
                'Os indicadores que você escolheu acompanhar não mostram nenhuma situação urgente neste momento.',
            icon: Icons.check_circle_outline,
          ),
        );
      } else {
        insights.add(
          const BusinessInsight(
            level: BusinessInsightLevel.neutral,
            title: 'Radar sem categorias ativas',
            message:
                'Abra as preferências do Radar e escolha quais informações deseja acompanhar.',
            icon: Icons.tune_outlined,
          ),
        );
      }
    }

    return insights.take(5).toList();
  }

  _RadarPreferences _readRadarPreferences(Map<String, dynamic> storeData) {
    final raw = storeData['radarPreferences'];

    if (raw is! Map) {
      return const _RadarPreferences();
    }

    bool readBool(String key, {bool fallback = true}) {
      final value = raw[key];
      return value is bool ? value : fallback;
    }

    return _RadarPreferences(
      salesPerformance: readBool('salesPerformance'),
      lowStock: readBool('lowStock'),
      expiry: readBool('expiry'),
      receivables: readBool('receivables'),
      slowMoving: readBool('slowMoving'),
    );
  }

  bool _isCancelled(Map<String, dynamic> data) {
    final status = data['status']?.toString().toLowerCase();
    return status == 'cancelled' || status == 'canceled';
  }

  DateTime? _readDate(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value is String) return DateTime.tryParse(value);
    return null;
  }
}

class _RadarPreferences {
  final bool salesPerformance;
  final bool lowStock;
  final bool expiry;
  final bool receivables;
  final bool slowMoving;

  const _RadarPreferences({
    this.salesPerformance = true,
    this.lowStock = true,
    this.expiry = true,
    this.receivables = true,
    this.slowMoving = true,
  });

  bool get hasAnyEnabledCategory =>
      salesPerformance || lowStock || expiry || receivables || slowMoving;
}
