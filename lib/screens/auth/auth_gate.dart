// lib/screens/auth/auth_gate.dart

import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
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
  int _refreshCounter = 0;
  int _retryCount = 0;
  static const int _maxRetries = 3;
  bool _versaoJaSalva = false;

  // 🛡️ O GUARDIÃO CONTRA O LOOP INFINITO
  String? _lastStoreId;

  Future<void> _atualizarVersaoNoFirebase(String uid) async {
    try {
      PackageInfo packageInfo = await PackageInfo.fromPlatform();
      String versaoAtual = "${packageInfo.version}+${packageInfo.buildNumber}";

      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .set({
        'versao_app': versaoAtual,
        'ultimo_login': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      debugPrint("✅ Versão $versaoAtual salva no Firestore (AuthGate)!");
    } catch (e) {
      debugPrint("❌ Erro ao salvar versão: $e");
    }
  }

  Future<void> _retryLoad() async {
    if (_retryCount < _maxRetries) {
      _retryCount++;
      await FirebaseAnalytics.instance.logEvent(
        name: 'auth_gate_retry',
        parameters: {'retry_count': _retryCount, 'max_retries': _maxRetries},
      );
      setState(() { _refreshCounter++; });
    }
  }

  Widget _buildErrorScreen(String message, {VoidCallback? onRetry}) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 80, height: 80,
                  decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.red, width: 3)),
                  child: const Icon(Icons.error_outline, color: Colors.red, size: 48),
                ),
                const SizedBox(height: 32),
                const Text('Erro ao carregar dados da loja', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
                const SizedBox(height: 16),
                Text(message, style: TextStyle(color: Colors.grey[400], fontSize: 16), textAlign: TextAlign.center),
                const SizedBox(height: 40),
                ElevatedButton.icon(
                  onPressed: onRetry ?? _retryLoad,
                  icon: const Icon(Icons.refresh),
                  label: Text(_retryCount >= _maxRetries ? 'Tentar novamente' : 'Tentar novamente ($_retryCount/$_maxRetries)'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurple, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                ),
                const SizedBox(height: 16),
                TextButton.icon(
                  onPressed: () async => await FirebaseAuth.instance.signOut(),
                  icon: const Icon(Icons.logout),
                  label: const Text('Sair e fazer login novamente'),
                  style: TextButton.styleFrom(foregroundColor: Colors.grey[400]),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, userSnapshot) {
        if (userSnapshot.connectionState == ConnectionState.waiting) return const Scaffold(body: Center(child: CircularProgressIndicator()));

        if (!userSnapshot.hasData || userSnapshot.data == null) {
          _versaoJaSalva = false;
          _lastStoreId = null; // Reseta ao deslogar
          return const LoginScreen();
        }

        final user = userSnapshot.data!;

        if (!_versaoJaSalva) {
          _versaoJaSalva = true;
          _atualizarVersaoNoFirebase(user.uid);
        }

        return StreamBuilder<DocumentSnapshot>(
          stream: FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
          builder: (context, userDocSnapshot) {
            if (userDocSnapshot.connectionState == ConnectionState.waiting) return const Scaffold(body: Center(child: CircularProgressIndicator()));
            if (userDocSnapshot.hasError) return _buildErrorScreen('Erro ao carregar usuário.');
            if (!userDocSnapshot.hasData || !userDocSnapshot.data!.exists) return const CreateStoreScreen();

            final userData = userDocSnapshot.data!.data() as Map<String, dynamic>?;
            final storeId = userData?['storeId'] as String?;

            if (storeId == null || storeId.isEmpty) return const CreateStoreScreen();

            // 🛡️ A CORREÇÃO DO LOOP: Só chama o Provider se o ID for novo
            if (_lastStoreId != storeId) {
              _lastStoreId = storeId;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeId);
              });
            }

            return StreamBuilder<DocumentSnapshot>(
              stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(includeMetadataChanges: true),
              builder: (context, storeDocSnapshot) {
                if (storeDocSnapshot.connectionState == ConnectionState.waiting) return const Scaffold(body: Center(child: CircularProgressIndicator()));
                if (storeDocSnapshot.hasError) return _buildErrorScreen('Erro ao carregar a loja.', onRetry: _retryLoad);
                if (!storeDocSnapshot.hasData || !storeDocSnapshot.data!.exists) return _buildErrorScreen('A loja não foi encontrada.', onRetry: _retryLoad);

                final storeData = storeDocSnapshot.data!.data() as Map<String, dynamic>?;

                // 🧠 LÓGICA DE ACESSO DEFINITIVA
                final subscriptionStatus = storeData?['subscriptionStatus'] as String?;
                final subscriptionType = storeData?['subscriptionType'] as String?;
                final trialEndDate = storeData?['trialEndDate'] as String?;

                bool isTrialActive = false;
                if (trialEndDate != null) {
                  try {
                    isTrialActive = DateTime.now().isBefore(DateTime.parse(trialEndDate));
                  } catch (e) {}
                }

                // ✅ DECISÃO FINAL DE ROTEAMENTO
                bool hasAccess = false;

                if (subscriptionStatus == 'active') {
                  if (subscriptionType == 'pro') {
                    hasAccess = true; // Pagou = Entra
                  } else if (isTrialActive) {
                    hasAccess = true; // Nos 7 dias = Entra
                  }
                }

                if (hasAccess) {
                  debugPrint('✅ Acesso Liberado -> HomeScreen');
                  return HomeScreen(storeId: storeId);
                } else {
                  // Se for pending, inactive, ou trial expirou -> Fica travado na tela de pagamento!
                  debugPrint('⚠️ Acesso Bloqueado -> SubscriptionScreen (status: $subscriptionStatus)');
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