// lib/screens/auth/auth_gate.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import 'package:store_connect/providers/sales_provider.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, userSnapshot) { // <-- Variável definida como userSnapshot
        if (userSnapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }

        if (!userSnapshot.hasData) {
          return const LoginScreen();
        }

        // --- LÓGICA DE ATUALIZAÇÃO EM TEMPO REAL ---

        return StreamBuilder<DocumentSnapshot>(
          // Usamos a variável correta aqui: userSnapshot
          stream: FirebaseFirestore.instance.collection('users').doc(userSnapshot.data!.uid).snapshots(),
          builder: (context, userDocSnapshot) {
            if (userDocSnapshot.connectionState == ConnectionState.waiting) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }

            if (userDocSnapshot.hasError || !userDocSnapshot.data!.exists) {
              return const Scaffold(body: Center(child: Text('Erro ao carregar dados do usuário.')));
            }

            final userData = userDocSnapshot.data!.data() as Map<String, dynamic>;
            final storeId = userData['storeId'] as String?;

            if (storeId == null || storeId.isEmpty) {
              return const Scaffold(body: Center(child: Text('Nenhuma loja associada a este usuário.')));
            }

            Provider.of<SalesProvider>(context, listen: false).updateStoreId(storeId);

            return StreamBuilder<DocumentSnapshot>(
              stream: FirebaseFirestore.instance.collection('stores').doc(storeId).snapshots(),
              builder: (context, storeDocSnapshot) {
                if (storeDocSnapshot.connectionState == ConnectionState.waiting) {
                  return const Scaffold(body: Center(child: CircularProgressIndicator()));
                }

                if (storeDocSnapshot.hasError || !storeDocSnapshot.data!.exists) {
                  return const Scaffold(body: Center(child: Text('Erro ao carregar dados da loja.')));
                }

                final storeData = storeDocSnapshot.data!.data() as Map<String, dynamic>;
                final subscriptionStatus = storeData['subscriptionStatus'] as String?;

                if (subscriptionStatus == 'active') {
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