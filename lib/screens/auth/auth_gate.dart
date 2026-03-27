// lib/screens/auth/auth_gate.dart

import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';
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

  /// Registra a versão apenas se o UID mudar (ou seja, novo login)
  Future<void> _registrarLoginEVersao(String uid) async {
    if (_lastUidProcessed == uid)
      return; // Já processou este usuário nesta sessão
    _lastUidProcessed = uid;

    try {
      PackageInfo packageInfo = await PackageInfo.fromPlatform();
      String versaoAtual = "${packageInfo.version}+${packageInfo.buildNumber}";

      await FirebaseFirestore.instance.collection('users').doc(uid).set({
        'versao_app': versaoAtual,
        'ultimo_login': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      debugPrint("🚀 Info de login/versão sincronizada para: $uid");
    } catch (e) {
      debugPrint("❌ Erro ao registrar versão: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, authSnapshot) {
        if (authSnapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final user = authSnapshot.data;
        if (user == null) {
          _lastUidProcessed = null;
          _lastStoreIdProcessed = null;
          return const LoginScreen();
        }

        // Executa o registro de versão FORA do fluxo de build principal
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => _registrarLoginEVersao(user.uid),
        );

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

            if (storeId == null || storeId.isEmpty) {
              return const CreateStoreScreen();
            }

            // Atualiza o Provider apenas se o StoreId mudar
            if (_lastStoreIdProcessed != storeId) {
              _lastStoreIdProcessed = storeId;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                Provider.of<SalesProvider>(
                  context,
                  listen: false,
                ).updateStoreId(storeId);
              });
            }

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
                if (storeData == null)
                  return const SubscriptionScreen(storeId: '');

                // Lógica de Assinatura
                final status =
                    storeData['subscriptionStatus'] as String? ?? 'trial';
                final type = storeData['subscriptionType'] as String? ?? 'free';
                final trialEndDate = storeData['trialEndDate'] as String?;

                bool isTrialValid = false;
                if (trialEndDate != null) {
                  try {
                    isTrialValid = DateTime.now().isBefore(
                      DateTime.parse(trialEndDate),
                    );
                  } catch (_) {}
                }

                // --- GATILHO AUTOMÁTICO DE EXPIRAÇÃO ---
                // Se o status está ativo, MAS não é plano PRO, E o trial já expirou:
                if (status == 'active' && type != 'pro' && !isTrialValid) {
                  // 1. Atualiza o banco de dados de forma invisível para 'inactive'
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    FirebaseFirestore.instance
                        .collection('stores')
                        .doc(storeId)
                        .update({'subscriptionStatus': 'inactive'});
                  });

                  // 2. Bloqueia o ecrã imediatamente
                  return SubscriptionScreen(storeId: storeId);
                }

                // 🚪 Regra de Acesso Corrigida:
                // Só entra se o status for ativo E (for plano PRO OU o trial for válido)
                if (status == 'active' && (type == 'pro' || isTrialValid)) {
                  return HomeScreen(storeId: storeId);
                } else {
                  return SubscriptionScreen(storeId: storeId);
                }
              },
            );
          },
        );
      },
    );
  }
}
