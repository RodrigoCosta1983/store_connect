// lib/screens/auth/auth_gate.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }

        if (!snapshot.hasData) {
          return const LoginScreen();
        }

        return FutureBuilder<DocumentSnapshot>(
          future: FirebaseFirestore.instance.collection('users').doc(snapshot.data!.uid).get(),
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

            // --- MODIFICADO: Trocado FutureBuilder por StreamBuilder para ouvir em tempo real ---
            return StreamBuilder<DocumentSnapshot>(
              // .snapshots() fica ouvindo por mudanças, ao contrário de .get() que busca só uma vez
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
            // --- FIM DA MODIFICAÇÃO ---
          },
        );
      },
    );
  }
}