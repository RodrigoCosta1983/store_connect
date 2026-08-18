// lib/screens/auth/auth_gate.dart

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  // 🛡️ TRAVAS DE SEGURANÇA CONTRA LOOPS
  String? _lastUidProcessed;
  String? _lastStoreIdProcessed;

  /// Registra a versão apenas se o UID mudar,
  /// ou seja, somente em um novo login nesta sessão.
  Future<void> _registrarLoginEVersao(String uid) async {
    if (_lastUidProcessed == uid) {
      return;
    }

    _lastUidProcessed = uid;

    try {
      final packageInfo = await PackageInfo.fromPlatform();

      final versaoAtual =
          '${packageInfo.version}+${packageInfo.buildNumber}';

      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .set(
        {
          'versao_app': versaoAtual,
          'ultimo_login': FieldValue.serverTimestamp(),
        },
        SetOptions(merge: true),
      );

      debugPrint(
        '🚀 Info de login/versão sincronizada para: $uid',
      );
    } catch (e) {
      debugPrint(
        '❌ Erro ao registrar versão: $e',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, authSnapshot) {
        // -----------------------------------------------------------------
        // AGUARDANDO FIREBASE AUTH
        // -----------------------------------------------------------------

        if (authSnapshot.connectionState ==
            ConnectionState.waiting) {
          return const Scaffold(
            body: Center(
              child: CircularProgressIndicator(),
            ),
          );
        }

        // -----------------------------------------------------------------
        // USUÁRIO NÃO LOGADO
        // -----------------------------------------------------------------

        final user = authSnapshot.data;

        if (user == null) {
          _lastUidProcessed = null;
          _lastStoreIdProcessed = null;

          return const LoginScreen();
        }

        // -----------------------------------------------------------------
        // REGISTRA LOGIN / VERSÃO
        // -----------------------------------------------------------------

        WidgetsBinding.instance.addPostFrameCallback(
              (_) => _registrarLoginEVersao(user.uid),
        );

        // -----------------------------------------------------------------
        // BUSCA DADOS DO USUÁRIO
        // -----------------------------------------------------------------

        return StreamBuilder<DocumentSnapshot>(
          stream: FirebaseFirestore.instance
              .collection('users')
              .doc(user.uid)
              .snapshots(),
          builder: (context, userDocSnapshot) {
            if (userDocSnapshot.connectionState ==
                ConnectionState.waiting) {
              return const Scaffold(
                body: Center(
                  child: CircularProgressIndicator(),
                ),
              );
            }

            final userData =
            userDocSnapshot.data?.data()
            as Map<String, dynamic>?;

            final storeId =
            userData?['storeId'] as String?;

            // -----------------------------------------------------------------
            // USUÁRIO AINDA NÃO POSSUI LOJA
            // -----------------------------------------------------------------

            if (storeId == null || storeId.isEmpty) {
              return const CreateStoreScreen();
            }

            // -----------------------------------------------------------------
            // ATUALIZA PROVIDER SOMENTE QUANDO O STORE ID MUDAR
            // -----------------------------------------------------------------

            if (_lastStoreIdProcessed != storeId) {
              _lastStoreIdProcessed = storeId;

              WidgetsBinding.instance.addPostFrameCallback(
                    (_) {
                  Provider.of<SalesProvider>(
                    context,
                    listen: false,
                  ).updateStoreId(storeId);
                },
              );
            }

            // -----------------------------------------------------------------
            // ESCUTA DADOS DA LOJA
            // -----------------------------------------------------------------

            return StreamBuilder<DocumentSnapshot>(
              stream: FirebaseFirestore.instance
                  .collection('stores')
                  .doc(storeId)
                  .snapshots(),
              builder: (context, storeSnapshot) {
                if (storeSnapshot.connectionState ==
                    ConnectionState.waiting) {
                  return const Scaffold(
                    body: Center(
                      child: CircularProgressIndicator(),
                    ),
                  );
                }

                final storeData =
                storeSnapshot.data?.data()
                as Map<String, dynamic>?;

                // -----------------------------------------------------------------
                // LOJA NÃO ENCONTRADA
                // -----------------------------------------------------------------

                if (storeData == null) {
                  return SubscriptionScreen(
                    storeId: storeId,
                  );
                }

                // =================================================================
                // DADOS DA ASSINATURA
                // =================================================================

                final status =
                    storeData['subscriptionStatus']
                    as String? ??
                        'trial';

                final type =
                    storeData['subscriptionType']
                    as String? ??
                        'free';

                final trialEndDate =
                storeData['trialEndDate']
                as String?;

                // =================================================================
                // PLANOS PAGOS VÁLIDOS
                // =================================================================

                final bool isPaidPlan =
                    type == 'pro' ||
                        type == 'business';

                // =================================================================
                // VERIFICA SE O TRIAL AINDA É VÁLIDO
                // =================================================================

                bool isTrialValid = false;

                if (trialEndDate != null) {
                  try {
                    String normalizedTrialDate = trialEndDate.trim();

                    final fractionalMatch = RegExp(
                      r'(\.\d{3})\d+',
                    );

                    normalizedTrialDate = normalizedTrialDate.replaceFirstMapped(
                      fractionalMatch,
                          (match) => match.group(1)!,
                    );

                    isTrialValid = DateTime.now().isBefore(
                      DateTime.parse(normalizedTrialDate),
                    );
                  } catch (e) {
                    debugPrint(
                      '⚠️ Erro ao interpretar trialEndDate: $e',
                    );
                  }
                }

                // =================================================================
                // DEBUG
                // =================================================================

                debugPrint(
                  '=== 🔐 AUTH GATE ===',
                );

                debugPrint(
                  'Status: $status',
                );

                debugPrint(
                  'Tipo: $type',
                );

                debugPrint(
                  'Plano pago: $isPaidPlan',
                );

                debugPrint(
                  'Trial válido: $isTrialValid',
                );

                debugPrint(
                  '====================',
                );

                // =================================================================
                // EXPIRAÇÃO DE LOJA SEM PLANO PAGO
                // =================================================================

                if (status == 'active' &&
                    !isPaidPlan &&
                    !isTrialValid) {
                  WidgetsBinding.instance
                      .addPostFrameCallback(
                        (_) async {
                      try {
                        await FirebaseFirestore
                            .instance
                            .collection('stores')
                            .doc(storeId)
                            .update({
                          'subscriptionStatus':
                          'inactive',
                        });

                        debugPrint(
                          '🔒 Loja $storeId inativada: '
                              'trial expirado e sem plano pago.',
                        );
                      } catch (e) {
                        debugPrint(
                          '❌ Erro ao inativar loja: $e',
                        );
                      }
                    },
                  );

                  return SubscriptionScreen(
                    storeId: storeId,
                  );
                }

                // =================================================================
                // EXPIRAÇÃO DO TRIAL
                // =================================================================

                if (!isPaidPlan &&
                    !isTrialValid &&
                    (status == 'active' ||
                        status == 'trial')) {
                  WidgetsBinding.instance
                      .addPostFrameCallback(
                        (_) async {
                      try {
                        await FirebaseFirestore
                            .instance
                            .collection('stores')
                            .doc(storeId)
                            .update({
                          'subscriptionStatus':
                          'inactive',
                        });

                        debugPrint(
                          '🔒 Trial encerrado. '
                              'Loja $storeId marcada como inactive.',
                        );
                      } catch (e) {
                        debugPrint(
                          '❌ Erro ao finalizar trial: $e',
                        );
                      }
                    },
                  );

                  return SubscriptionScreen(
                    storeId: storeId,
                  );
                }

                // =================================================================
                // ACESSO AO SISTEMA
                //
                // ACTIVE
                // → PRO ou BUSINESS
                //
                // TRIAL
                // → enquanto estiver dentro do período válido
                //
                // OVERDUE
                // → permanece com acesso durante o período de tolerância
                // =================================================================

                if (status == 'active' ||
                    status == 'trial' ||
                    status == 'overdue') {
                  return HomeScreen(
                    storeId: storeId,
                  );
                }

                // =================================================================
                // INACTIVE / PENDING / OUTROS STATUS
                // =================================================================

                return SubscriptionScreen(
                  storeId: storeId,
                );
              },
            );
          },
        );
      },
    );
  }
}