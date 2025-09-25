// lib/screens/auth/auth_gate.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:store_connect/screens/auth/login_screen.dart';
import 'package:store_connect/screens/home_screen.dart';
import 'package:store_connect/screens/subscription_screen.dart';
// Importamos a tela de criação de loja, que será nosso novo destino
import 'package:store_connect/screens/auth/create_store_screen.dart';

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

        // Se o usuário está logado, verificamos se ele já tem um registro no nosso banco
        return FutureBuilder<DocumentSnapshot>(
          future: FirebaseFirestore.instance.collection('users').doc(snapshot.data!.uid).get(),
          builder: (context, userDocSnapshot) {
            if (userDocSnapshot.connectionState == ConnectionState.waiting) {
              return const Scaffold(body: Center(child: CircularProgressIndicator()));
            }

            // --- LÓGICA CORRIGIDA AQUI ---
            // Se o documento do usuário NÃO EXISTE, ele é um novo usuário.
            // Direcionamos para a tela de criação de loja.
            if (!userDocSnapshot.data!.exists) {
              return const CreateStoreScreen();
            }
            // ---------------------------------

            if (userDocSnapshot.hasError) {
              return const Scaffold(body: Center(child: Text('Erro ao carregar dados do usuário.')));
            }

            final userData = userDocSnapshot.data!.data() as Map<String, dynamic>;
            final storeId = userData['storeId'] as String?;

            if (storeId == null || storeId.isEmpty) {
              return const Scaffold(body: Center(child: Text('Nenhuma loja associada a este usuário.')));
            }

            // A lógica de verificação de assinatura continua a mesma
            return FutureBuilder<DocumentSnapshot>(
              future: FirebaseFirestore.instance.collection('stores').doc(storeId).get(),
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