import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/providers/subscription_provider.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/auth/create_store_screen.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';
// ADICIONADO: Serviço de navegação
import 'package:store_connect/services/navigation_service.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  int _refreshCounter = 0;

  @override
  void initState() {
    super.initState();
    // Configura o callback do SubscriptionProvider para forçar refresh
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
          .get(const GetOptions(source: Source.server));

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
          .get(const GetOptions(source: Source.server));

      if (!storeDoc.exists) {
        print('❌ Documento da loja não existe');
        return;
      }

      final subscriptionStatus = storeDoc.data()?['subscriptionStatus'] as String?;

      print('🔍 Consulta direta após callback:');
      print('   storeId: $storeId');
      print('   subscriptionStatus: $subscriptionStatus');
      print('   dados completos: ${storeDoc.data()}');

      if (subscriptionStatus == 'active') {
        print('✅ Status ativo detectado! Navegando para HomeScreen...');
        // Navegação global via NavigationService
        NavigationService.navigateToHome(storeId);
      } else {
        print('❌ Status ainda não ativo ($subscriptionStatus), forçando rebuild dos StreamBuilders...');
        if (mounted) {
          setState(() {
            _refreshCounter++;
          });
        }
      }
    } catch (e, stackTrace) {
      print('❌ Erro na consulta direta: $e');
      print('📋 Stack trace: $stackTrace');
      // Fallback: navegação global para forçar AuthGate
      NavigationService.refreshAuthGate();
    }
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      key: ValueKey('auth_$_refreshCounter'), // Força rebuild quando refresh
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
              .snapshots(),
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

            if (userDocSnapshot.hasError ||
                !userDocSnapshot.hasData ||
                !userDocSnapshot.data!.exists) {
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
                  .snapshots(includeMetadataChanges: true),
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

                if (storeDocSnapshot.hasError ||
                    !storeDocSnapshot.hasData ||
                    !storeDocSnapshot.data!.exists) {
                  return Scaffold(
                    body: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.error_outline, size: 64, color: Colors.red),
                          const SizedBox(height: 16),
                          const Text('Erro ao carregar dados da loja.'),
                          const SizedBox(height: 16),
                          ElevatedButton(
                            onPressed: _forceRefresh,
                            child: const Text('Tentar novamente'),
                          ),
                        ],
                      ),
                    ),
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
                print('   storeId: $storeId');
                print('   subscriptionStatus: $subscriptionStatus');
                print('   isFromCache: $isFromCache');
                print('   hasPendingWrites: $hasPendingWrites');
                print('   storeData completo: $storeData');
                print('================================');

                if (subscriptionStatus == 'active') {
                  print('✅ Navegando para HomeScreen');
                  return HomeScreen(storeId: storeId);
                } else {
                  print('❌ Navegando para SubscriptionScreen (status: $subscriptionStatus)');
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