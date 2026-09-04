// ============================================================================
// STORE CONNECT - AUTH GATE / CONTROLE DE ACESSO PRINCIPAL
// ============================================================================
//
// Arquivo:
//   lib/screens/auth/auth_gate.dart
//
// OBJETIVO:
//
// Controlar a entrada principal do Store&Connect após a autenticação.
//
// RESPONSABILIDADES:
//
// • observar o estado de autenticação do Firebase;
// • redirecionar usuários não autenticados para LoginScreen;
// • encaminhar usuários sem storeId para CreateStoreScreen;
// • registrar versão/último login sem repetir a operação em rebuilds;
// • atualizar SalesProvider quando o storeId muda;
// • LER o estado da assinatura da loja;
// • validar localmente a validade visual/operacional do trial;
// • encaminhar contas autorizadas para SmartHomeScreen;
// • encaminhar contas sem acesso para SubscriptionScreen.
//
// P6 - AUTORIDADE DE ASSINATURA:
//
// Este arquivo NÃO possui mais autoridade para alterar subscriptionStatus.
//
// O Flutter pode:
//   - ler subscriptionStatus;
//   - ler subscriptionType;
//   - ler trialEndDate;
//   - decidir qual tela deve ser exibida.
//
// O Flutter NÃO pode:
//   - mudar trial -> inactive;
//   - mudar active -> inactive;
//   - ativar plano;
//   - alterar estado financeiro da assinatura.
//
// A expiração persistente do trial é responsabilidade do backend, através da
// função agendada expireTrials, usando o relógio do servidor.
//
// IMPORTANTE SOBRE SEGURANÇA:
//
// A remoção das escritas deste arquivo elimina a autoridade legítima do cliente
// sobre subscriptionStatus, mas o bloqueio técnico definitivo dessas escritas
// será feito no P7 através das Firestore Rules.
//
// FLUXO PRINCIPAL:
//
// Firebase Auth
//      ↓
// users/{uid}
//      ↓
// storeId
//      ↓
// stores/{storeId}
//      ↓
// assinatura válida? ── não ──> SubscriptionScreen
//      │
//     sim
//      ↓
// SmartHomeScreen
//
// COMPATIBILIDADE DO TRIAL:
//
// trialEndDate historicamente é salvo como String ISO-8601. O parser também
// aceita Timestamp para permitir uma migração futura sem quebrar contas antigas.
//
// CUIDADOS DE MANUTENÇÃO:
//
// • Não reintroduzir update/set de subscriptionStatus neste arquivo.
// • Não confiar no relógio do dispositivo para persistir estado financeiro.
// • O cálculo local do trial serve apenas para roteamento imediato da interface.
// • A fonte persistente de autoridade é o backend + Firestore.
// • A proteção final contra writes indevidos depende das Firestore Rules (P7).
// • Evitar navegação imperativa dentro do build quando um retorno de Widget
//   resolve o fluxo declarativamente.
//
// ============================================================================

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';
import 'package:store_connect/screens/home_screen.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  // ===========================================================================
  // TRAVAS CONTRA OPERAÇÕES REPETIDAS EM REBUILDS
  // ===========================================================================

  String? _lastUidProcessed;
  String? _lastStoreIdProcessed;

  // ===========================================================================
  // LOGIN / VERSÃO
  // ===========================================================================

  /// Registra a versão apenas se o UID mudar nesta sessão.
  ///
  /// Esta escrita ocorre em users/{uid} e não altera qualquer campo financeiro
  /// ou de assinatura da loja.
  Future<void> _registrarLoginEVersao(String uid) async {
    if (_lastUidProcessed == uid) {
      return;
    }

    _lastUidProcessed = uid;

    try {
      final packageInfo = await PackageInfo.fromPlatform();
      final versaoAtual = '${packageInfo.version}+${packageInfo.buildNumber}';

      await FirebaseFirestore.instance.collection('users').doc(uid).set({
        'versao_app': versaoAtual,
        'ultimo_login': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      debugPrint('🚀 Info de login/versão sincronizada para: $uid');
    } catch (e) {
      debugPrint('❌ Erro ao registrar versão: $e');
    }
  }

  // ===========================================================================
  // PARSER DE trialEndDate
  // ===========================================================================

  DateTime? _parseTrialEndDate(dynamic rawValue) {
    if (rawValue == null) {
      return null;
    }

    if (rawValue is Timestamp) {
      return rawValue.toDate();
    }

    if (rawValue is DateTime) {
      return rawValue;
    }

    if (rawValue is! String || rawValue.trim().isEmpty) {
      return null;
    }

    try {
      String normalizedTrialDate = rawValue.trim();

      // Mantém compatibilidade com strings antigas que possuam precisão de
      // frações de segundo maior que a esperada pelo parser em alguns runtimes.
      final fractionalMatch = RegExp(r'(\.\d{3})\d+');

      normalizedTrialDate = normalizedTrialDate.replaceFirstMapped(
        fractionalMatch,
        (match) => match.group(1)!,
      );

      return DateTime.parse(normalizedTrialDate);
    } catch (e) {
      debugPrint('⚠️ Erro ao interpretar trialEndDate: $e');
      return null;
    }
  }

  // ===========================================================================
  // BUILD
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, authSnapshot) {
        // -----------------------------------------------------------------------
        // AGUARDANDO FIREBASE AUTH
        // -----------------------------------------------------------------------

        if (authSnapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        // -----------------------------------------------------------------------
        // USUÁRIO NÃO LOGADO
        // -----------------------------------------------------------------------

        final user = authSnapshot.data;

        if (user == null) {
          _lastUidProcessed = null;
          _lastStoreIdProcessed = null;

          return const LoginScreen();
        }

        // -----------------------------------------------------------------------
        // REGISTRA LOGIN / VERSÃO
        // -----------------------------------------------------------------------

        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _registrarLoginEVersao(user.uid),
        );

        // -----------------------------------------------------------------------
        // BUSCA DADOS DO USUÁRIO
        // -----------------------------------------------------------------------

        return StreamBuilder<DocumentSnapshot>(
          stream: FirebaseFirestore.instance
              .collection('users')
              .doc(user.uid)
              .snapshots(),
          builder: (context, userDocSnapshot) {
            if (userDocSnapshot.connectionState == ConnectionState.waiting) {
              return const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              );
            }

            final userData =
                userDocSnapshot.data?.data() as Map<String, dynamic>?;

            final storeId = userData?['storeId'] as String?;

            // ---------------------------------------------------------------------
            // USUÁRIO AINDA NÃO POSSUI LOJA
            // ---------------------------------------------------------------------

            if (storeId == null || storeId.isEmpty) {
              return const CreateStoreScreen();
            }

            // ---------------------------------------------------------------------
            // ATUALIZA PROVIDER SOMENTE QUANDO O STORE ID MUDAR
            // ---------------------------------------------------------------------

            if (_lastStoreIdProcessed != storeId) {
              _lastStoreIdProcessed = storeId;

              WidgetsBinding.instance.addPostFrameCallback((_) {
                Provider.of<SalesProvider>(
                  context,
                  listen: false,
                ).updateStoreId(storeId);
              });
            }

            // ---------------------------------------------------------------------
            // ESCUTA DADOS DA LOJA
            // ---------------------------------------------------------------------

            return StreamBuilder<DocumentSnapshot>(
              stream: FirebaseFirestore.instance
                  .collection('stores')
                  .doc(storeId)
                  .snapshots(),
              builder: (context, storeSnapshot) {
                if (storeSnapshot.connectionState == ConnectionState.waiting) {
                  return const Scaffold(
                    body: Center(child: CircularProgressIndicator()),
                  );
                }

                final storeData =
                    storeSnapshot.data?.data() as Map<String, dynamic>?;

                // -------------------------------------------------------------------
                // LOJA NÃO ENCONTRADA
                // -------------------------------------------------------------------

                if (storeData == null) {
                  return SubscriptionScreen(storeId: storeId);
                }

                // ===================================================================
                // DADOS DA ASSINATURA - SOMENTE LEITURA
                // ===================================================================

                final status =
                    (storeData['subscriptionStatus']?.toString() ?? 'trial')
                        .trim()
                        .toLowerCase();

                final type =
                    (storeData['subscriptionType']?.toString() ?? 'free')
                        .trim()
                        .toLowerCase();

                final trialEndDate = _parseTrialEndDate(
                  storeData['trialEndDate'],
                );

                final now = DateTime.now();

                final bool isTrialValid =
                    trialEndDate != null && now.isBefore(trialEndDate);

                final bool isPaidPlanType = type == 'pro' || type == 'business';

                // ===================================================================
                // MATRIZ DE ACESSO
                // ===================================================================
                //
                // active + pro/business
                //   → plano pago ativo
                //
                // trial + trial válido
                //   → teste gratuito ativo
                //
                // active + free + trial válido
                //   → compatibilidade com lojas legadas que usavam active durante
                //     o período de teste
                //
                // overdue
                //   → permanece com acesso durante a tolerância financeira
                //
                // pending / inactive / trial vencido / combinações inválidas
                //   → SubscriptionScreen
                // ===================================================================

                final bool hasPaidAccess = status == 'active' && isPaidPlanType;

                final bool hasTrialAccess =
                    (status == 'trial' ||
                        (status == 'active' && !isPaidPlanType)) &&
                    isTrialValid;

                final bool hasOverdueGraceAccess = status == 'overdue';

                final bool hasAccess =
                    hasPaidAccess || hasTrialAccess || hasOverdueGraceAccess;

                // ===================================================================
                // DEBUG
                // ===================================================================

                debugPrint('=== 🔐 AUTH GATE / P6 ===');
                debugPrint('Status: $status');
                debugPrint('Tipo: $type');
                debugPrint('Plano pago ativo: $hasPaidAccess');
                debugPrint('Trial válido: $isTrialValid');
                debugPrint('Acesso por trial: $hasTrialAccess');
                debugPrint('Tolerância overdue: $hasOverdueGraceAccess');
                debugPrint('Acesso final: $hasAccess');
                debugPrint('=========================');

                // ===================================================================
                // P6 - NENHUMA ESCRITA EM subscriptionStatus
                // ===================================================================
                //
                // Mesmo quando o trial está vencido, o AuthGate apenas bloqueia a
                // interface. A persistência de `inactive` é feita pelo backend.
                // ===================================================================

                if (!hasAccess) {
                  return SubscriptionScreen(storeId: storeId);
                }

                return HomeScreen(storeId: storeId);
              },
            );
          },
        );
      },
    );
  }
}
