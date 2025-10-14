import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/subscription_provider.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';
import 'package:store_connect/services/navigation_service.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  int _refreshCounter = 0;
  int _retryCount = 0;
  static const int _maxRetries = 3;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final subscriptionProvider = Provider.of<SubscriptionProvider>(context, listen: false);
      subscriptionProvider.setOnPurchaseSuccessCallback(_forceRefresh);
    });
  }

  void _forceRefresh() async {
    print('🔄 AuthGate: Forçando refresh após compra...');

    try {
      print('⏱️ Aguardando 500ms...');
      await Future.delayed(const Duration(milliseconds: 500));

      print('👤 Verificando usuário atual...');
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        print('❌ Usuário não encontrado');
        return;
      }
      print('✅ Usuário encontrado: ${user.uid}');

      print('📄 Consultando documento do usuário...');
      final userDoc = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get(const GetOptions(source: Source.server))
          .timeout(const Duration(seconds: 10));

      if (!userDoc.exists) {
        print('❌ Documento do usuário não existe');
        return;
      }

      final storeId = userDoc.data()?['storeId'] as String?;
      if (storeId == null || storeId.isEmpty) {
        print('❌ StoreId não encontrado no documento do usuário');
        return;
      }
      print('✅ StoreId encontrado: $storeId');

      print('🏪 Consultando documento da loja...');
      final storeDoc = await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .get(const GetOptions(source: Source.server))
          .timeout(const Duration(seconds: 10));

      if (!storeDoc.exists) {
        print('❌ Documento da loja não existe');
        return;
      }

      final subscriptionStatus = storeDoc.data()?['subscriptionStatus'] as String?;

      print('🔍 Consulta direta após callback:');
      print('   storeId: $storeId');
      print('   subscriptionStatus: $subscriptionStatus');

      if (subscriptionStatus == 'active') {
        print('✅ Status ativo detectado! Navegando para HomeScreen...');
        NavigationService.navigateToHome(storeId);
      } else {
        print('⚠️ Status ainda não ativo ($subscriptionStatus), forçando rebuild...');
        if (mounted) {
          setState(() {
            _refreshCounter++;
          });
        }
      }
    } catch (e, stackTrace) {
      print('❌ Erro na consulta direta: $e');
      print('📋 Stack trace: $stackTrace');
      NavigationService.refreshAuthGate();
    }
  }

  Future<void> _retryLoad() async {
    if (_retryCount < _maxRetries) {
      _retryCount++;
      print('🔄 Tentativa ${_retryCount}/$_maxRetries');

      // Log analytics
      await FirebaseAnalytics.instance.logEvent(
        name: 'auth_gate_retry',
        parameters: {
          'retry_count': _retryCount,
          'max_retries': _maxRetries,
        },
      );

      setState(() {
        _refreshCounter++;
      });
    } else {
      print('❌ Máximo de tentativas alcançado');

      // Log quando alcança máximo
      await FirebaseAnalytics.instance.logEvent(
        name: 'auth_gate_max_retries_reached',
        parameters: {
          'retry_count': _retryCount,
        },
      );
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
                  width: 80,
                  height: 80,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.red, width: 3),
                  ),
                  child: const Icon(
                    Icons.error_outline,
                    color: Colors.red,
                    size: 48,
                  ),
                ),
                const SizedBox(height: 32),
                const Text(
                  'Erro ao carregar dados da loja',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                Text(
                  message,
                  style: TextStyle(
                    color: Colors.grey[400],
                    fontSize: 16,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 40),
                ElevatedButton.icon(
                  onPressed: onRetry ?? _retryLoad,
                  icon: const Icon(Icons.refresh),
                  label: Text(
                    _retryCount >= _maxRetries
                        ? 'Tentar novamente'
                        : 'Tentar novamente ($_retryCount/$_maxRetries)',
                    style: const TextStyle(fontSize: 16),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.deepPurple,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 16,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                TextButton.icon(
                  onPressed: () async {
                    await FirebaseAuth.instance.signOut();
                  },
                  icon: const Icon(Icons.logout),
                  label: const Text('Sair e fazer login novamente'),
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.grey[400],
                  ),
                ),
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.grey[900],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.lightbulb_outline,
                              color: Colors.amber[700],
                              size: 20
                          ),
                          const SizedBox(width: 8),
                          const Text(
                            'Dicas:',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _buildTip('Verifique sua conexão com a internet'),
                      _buildTip('Aguarde alguns segundos e tente novamente'),
                      _buildTip('Se o problema persistir, faça logout e entre novamente'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildTip(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '• ',
            style: TextStyle(color: Colors.grey[400]),
          ),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                color: Colors.grey[400],
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      key: ValueKey('auth_$_refreshCounter'),
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, userSnapshot) {
        if (userSnapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (!userSnapshot.hasData || userSnapshot.data == null) {
          return const LoginScreen();
        }

        final user = userSnapshot.data!;

        return StreamBuilder<DocumentSnapshot>(
          key: ValueKey('user_${user.uid}_$_refreshCounter'),
          stream: FirebaseFirestore.instance
              .collection('users')
              .doc(user.uid)
              .snapshots()
              .timeout(
            const Duration(seconds: 15),
            onTimeout: (sink) => sink.close(),
          )
              .handleError((error) {
            print('❌ Erro no stream do usuário: $error');
          }),
          builder: (context, userDocSnapshot) {
            if (userDocSnapshot.connectionState == ConnectionState.waiting) {
              return const Scaffold(
                body: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Carregando seus dados...'),
                    ],
                  ),
                ),
              );
            }

            // Tratamento de erro no carregamento do usuário
            if (userDocSnapshot.hasError) {
              print('❌ Erro no snapshot do usuário: ${userDocSnapshot.error}');

              // Log erro do usuário
              FirebaseAnalytics.instance.logEvent(
                name: 'auth_gate_error',
                parameters: {
                  'error_type': 'user_load_failed',
                  'error_message': userDocSnapshot.error.toString(),
                },
              );

              return _buildErrorScreen(
                'Não foi possível carregar seus dados.\nVerifique sua conexão e tente novamente.',
              );
            }

            if (!userDocSnapshot.hasData || !userDocSnapshot.data!.exists) {
              return const CreateStoreScreen();
            }

            final userData = userDocSnapshot.data!.data() as Map<String, dynamic>?;
            final storeId = userData?['storeId'] as String?;

            if (storeId == null || storeId.isEmpty) {
              return const CreateStoreScreen();
            }

            WidgetsBinding.instance.addPostFrameCallback((_) {
              Provider.of<SalesProvider>(context, listen: false)
                  .updateStoreId(storeId);
            });

            return StreamBuilder<DocumentSnapshot>(
              key: ValueKey('store_${storeId}_$_refreshCounter'),
              stream: FirebaseFirestore.instance
                  .collection('stores')
                  .doc(storeId)
                  .snapshots(includeMetadataChanges: true)
                  .timeout(
                const Duration(seconds: 15),
                onTimeout: (sink) => sink.close(),
              )
                  .handleError((error) {
                print('❌ Erro no stream da loja: $error');
              }),
              builder: (context, storeDocSnapshot) {
                if (storeDocSnapshot.connectionState == ConnectionState.waiting) {
                  return const Scaffold(
                    body: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          CircularProgressIndicator(),
                          SizedBox(height: 16),
                          Text('Verificando sua assinatura...'),
                        ],
                      ),
                    ),
                  );
                }

                // Tratamento de erro no carregamento da loja
                if (storeDocSnapshot.hasError) {
                  print('❌ Erro no snapshot da loja: ${storeDocSnapshot.error}');

                  // Log erro da loja
                  FirebaseAnalytics.instance.logEvent(
                    name: 'auth_gate_error',
                    parameters: {
                      'error_type': 'store_load_failed',
                      'error_message': storeDocSnapshot.error.toString(),
                      'store_id': storeId,
                    },
                  );

                  return _buildErrorScreen(
                    'Não foi possível carregar os dados da loja.\nVerifique sua conexão e tente novamente.',
                    onRetry: _retryLoad,
                  );
                }

                if (!storeDocSnapshot.hasData || !storeDocSnapshot.data!.exists) {
                  // Log loja não encontrada
                  FirebaseAnalytics.instance.logEvent(
                    name: 'auth_gate_error',
                    parameters: {
                      'error_type': 'store_not_found',
                      'store_id': storeId,
                    },
                  );

                  return _buildErrorScreen(
                    'A loja não foi encontrada.\nPode ser necessário recriar sua conta.',
                    onRetry: _retryLoad,
                  );
                }

                final docSnapshot = storeDocSnapshot.data!;
                final storeData = docSnapshot.data() as Map<String, dynamic>?;
                final subscriptionStatus = storeData?['subscriptionStatus'] as String?;

                final now = DateTime.now();
                final isFromCache = docSnapshot.metadata.isFromCache;
                final hasPendingWrites = docSnapshot.metadata.hasPendingWrites;

                print('===== AuthGate Debug [$now] =====');
                print('   refreshCounter: $_refreshCounter');
                print('   retryCount: $_retryCount');
                print('   storeId: $storeId');
                print('   subscriptionStatus: $subscriptionStatus');
                print('   isFromCache: $isFromCache');
                print('   hasPendingWrites: $hasPendingWrites');
                print('================================');

                // Reset retry count on success
                if (_retryCount > 0) {
                  _retryCount = 0;
                }

                if (subscriptionStatus == 'active') {
                  print('✅ Navegando para HomeScreen');
                  return HomeScreen(storeId: storeId);
                } else {
                  print('⚠️ Navegando para SubscriptionScreen (status: $subscriptionStatus)');
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