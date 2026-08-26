// ============================================================================
// ARQUIVO: business_insight.dart
// ============================================================================
//
// OBJETIVO:
// Modelos usados pela Home Inteligente do Store&Connect.
//
// FLUXO:
// Firestore -> BusinessInsightsService -> BusinessHomeSnapshot -> SmartHomeScreen
//
// MANUTENÇÃO:
// - não colocar consultas Firestore neste arquivo;
// - não colocar widgets neste arquivo;
// - a futura IA deve interpretar estes dados, não inventar métricas.
// ============================================================================

import 'package:flutter/material.dart';

enum BusinessInsightLevel {
  critical,
  attention,
  opportunity,
  positive,
  neutral,
}

enum BusinessInsightAction { openLowStock, openDashboard, openSalesHistory }

class BusinessInsight {
  final BusinessInsightLevel level;
  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final BusinessInsightAction? action;

  const BusinessInsight({
    required this.level,
    required this.title,
    required this.message,
    required this.icon,
    this.actionLabel,
    this.action,
  });
}

class BusinessHomeSnapshot {
  final String storeName;
  final double salesToday;
  final int salesCountToday;
  final double averageTicketToday;
  final double? salesVsSameWeekdayAveragePercent;
  final double totalReceivable;
  final int lowStockCount;
  final int expiringProductsCount;
  final List<BusinessInsight> insights;

  const BusinessHomeSnapshot({
    required this.storeName,
    required this.salesToday,
    required this.salesCountToday,
    required this.averageTicketToday,
    required this.salesVsSameWeekdayAveragePercent,
    required this.totalReceivable,
    required this.lowStockCount,
    required this.expiringProductsCount,
    required this.insights,
  });
}
