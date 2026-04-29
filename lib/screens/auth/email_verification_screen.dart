// lib/screens/auth/email_verification_screen.dart

import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:store_connect/screens/dashboard_screen.dart';

import 'create_store_screen.dart';

class EmailVerificationScreen extends StatefulWidget {
  const EmailVerificationScreen({super.key});

  @override
  State<EmailVerificationScreen> createState() =>
      _EmailVerificationScreenState();
}

class _EmailVerificationScreenState extends State<EmailVerificationScreen> {
  bool _isEmailVerified = false;
  bool _canResendEmail = false;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _isEmailVerified =
        FirebaseAuth.instance.currentUser?.emailVerified ?? false;
    if (!_isEmailVerified) {
      _timer = Timer.periodic(
        const Duration(seconds: 3),
        (_) => _checkEmailVerified(),
      );
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _checkEmailVerified() async {
    await FirebaseAuth.instance.currentUser?.reload();
    setState(() {
      _isEmailVerified =
          FirebaseAuth.instance.currentUser?.emailVerified ?? false;
    });

    if (_isEmailVerified) {
      _timer?.cancel();

      // --- A MÁGICA DO REDIRECIONAMENTO ---
      // Vamos perguntar ao banco de dados se ele já tem um storeId salvo
      final user = FirebaseAuth.instance.currentUser!;
      final userDoc = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();

      final storeId = userDoc.data()?['storeId'] ?? '';

      if (mounted) {
        if (storeId.isEmpty) {
          // É conta nova! O storeId está vazio. Vamos obrigá-lo a criar a loja:
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (context) => const CreateStoreScreen(),
            ), // Importe esta tela no topo!
          );
        } else {
          // É um cliente antigo (já tem loja) que só precisou verificar o e-mail agora:
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(
              builder: (context) => DashboardScreen(storeId: storeId),
            ),
          );
        }
      }
    }
  }

  Future<void> _resendVerificationEmail() async {
    try {
      await FirebaseAuth.instance.currentUser?.sendEmailVerification();
      setState(() => _canResendEmail = false);
      await Future.delayed(const Duration(seconds: 60));
      if (mounted) setState(() => _canResendEmail = true);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Erro ao reenviar: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Confirme seu E-mail'),
        centerTitle: true,
      ),
      body: Center(
        // O Center garante que fique tudo no meio se a tela for muito grande
        child: SingleChildScrollView(
          // <-- A MÁGICA ESTÁ AQUI
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Icon(
                Icons.mark_email_unread_outlined,
                size: 100,
                color: Colors.deepPurple,
              ),
              const SizedBox(height: 24),
              const Text(
                'Quase lá!',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                'Enviamos um link de confirmação para:\n${FirebaseAuth.instance.currentUser?.email}',
                style: const TextStyle(fontSize: 16),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              const CircularProgressIndicator(color: Colors.deepPurple),
              const SizedBox(height: 24),
              const Text(
                'Aguardando sua confirmação...\nO aplicativo será liberado automaticamente.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
              const SizedBox(height: 40),
              ElevatedButton.icon(
                icon: const Icon(Icons.email),
                label: const Text(
                  'Reenviar E-mail',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                onPressed: _canResendEmail ? _resendVerificationEmail : null,
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size.fromHeight(50),
                  backgroundColor: Colors.deepPurple,
                  foregroundColor: Colors.white,
                ),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () {
                  FirebaseAuth.instance.signOut();
                  Navigator.of(context).pop();
                },
                child: const Text(
                  'Cancelar e Sair',
                  style: TextStyle(
                    color: Colors.red,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
