// ============================================================================
// ARQUIVO: home_screen.dart
// ============================================================================
//
// OBJETIVO:
//
// Tela de entrada da loja após autenticação e validação de assinatura.
//
// NOVO PAPEL DA HOME:
//
// Esta tela funciona como uma central de acesso rápido, permitindo ao usuário
// escolher entre:
//
// • iniciar uma venda imediatamente;
// • abrir o Radar da Loja para visualizar insights, alertas e prioridades.
//
// FLUXO:
//
// Login
//   ↓
// AuthGate
//   ↓
// HomeScreen
//   ├── Nova Venda → NewSaleScreen
//   └── Radar da Loja → SmartHomeScreen
//
// RESPONSABILIDADES:
//
// • Exibir nome da loja.
// • Exibir WarningBanner.
// • Manter acesso ao AppDrawer.
// • Validar visualmente o status da assinatura já liberada pelo AuthGate.
// • Oferecer dois caminhos principais sem obrigar o usuário a passar pelo
//   Radar para registrar uma venda.
//
// UX:
//
// • "Nova Venda" é a ação principal e mais rápida.
// • "Radar da Loja" é a ação secundária para análise e inteligência.
// • A tela deve permanecer limpa e objetiva.
//
// MANUTENÇÃO:
//
// • Não remover WarningBanner sem revisar o fluxo financeiro/assinatura.
// • As validações críticas de assinatura continuam sendo responsabilidade
//   principal do AuthGate/backend.
// • NewSaleScreen deve permanecer acessível diretamente por esta Home.
// • SmartHomeScreen deve continuar com acesso próprio à Nova Venda.
// • Evitar adicionar muitos atalhos nesta tela; o objetivo é manter uma escolha
//   rápida entre Operação e Inteligência.
//
// ============================================================================

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'package:store_connect/screens/sales/new_sale_screen.dart';
import 'package:store_connect/services/home/smart_home_screen.dart';

import '../widgets/app_drawer.dart';
import '../widgets/warning_banner.dart';
import 'auth/auth_gate.dart';

class HomeScreen extends StatefulWidget {
  final String storeId;

  const HomeScreen({super.key, required this.storeId});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      drawer: AppDrawer(storeId: widget.storeId),
      appBar: AppBar(
        title: StreamBuilder<DocumentSnapshot>(
          stream: FirebaseFirestore.instance
              .collection('stores')
              .doc(widget.storeId)
              .snapshots(),
          builder: (context, snapshot) {
            if (snapshot.hasData && snapshot.data!.exists) {
              final storeData = snapshot.data!.data() as Map<String, dynamic>;

              final storeName =
                  storeData['name'] ?? storeData['storeName'] ?? 'Minha Loja';

              return Text(storeName);
            }

            return const Text('Store&Connect');
          },
        ),
        actions: [
          IconButton(
            tooltip: 'Sair',
            icon: const Icon(Icons.logout),
            onPressed: () {
              FirebaseAuth.instance.signOut();
            },
          ),
        ],
      ),
      body: StreamBuilder<DocumentSnapshot>(
        stream: FirebaseFirestore.instance
            .collection('stores')
            .doc(widget.storeId)
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasData && snapshot.data!.exists) {
            final storeData = snapshot.data!.data() as Map<String, dynamic>;

            final status =
                storeData['subscriptionStatus'] as String? ?? 'trial';

            // ----------------------------------------------------------------
            // VIGIA DE ASSINATURA
            //
            // Permite acesso quando:
            // • active
            // • trial
            // • overdue
            // ----------------------------------------------------------------

            if (status == 'inactive' ||
                (status != 'active' &&
                    status != 'trial' &&
                    status != 'overdue')) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (ctx) => const AuthGate()),
                  (route) => false,
                );
              });

              return const Center(
                child: Text('Assinatura inativa ou expirada...'),
              );
            }
          }

          if (!snapshot.hasData || !snapshot.data!.exists) {
            return const Center(child: Text('Loja não encontrada.'));
          }

          final storeData = snapshot.data!.data() as Map<String, dynamic>;

          final storeName =
              storeData['name'] ??
              storeData['storeName'] ??
              'Nome da Loja Indisponível';

          return Column(
            children: [
              WarningBanner(storeId: widget.storeId),
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 520),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Bem-vindo à',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            storeName,
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.headlineMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 40),

                          // ==================================================
                          // AÇÃO PRINCIPAL: NOVA VENDA
                          // ==================================================
                          _HomeActionCard(
                            icon: Icons.shopping_cart_checkout,
                            title: 'Nova Venda',
                            subtitle: 'Registrar uma venda agora',
                            isPrimary: true,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (ctx) =>
                                      NewSaleScreen(storeId: widget.storeId),
                                ),
                              );
                            },
                          ),

                          const SizedBox(height: 16),

                          // ==================================================
                          // AÇÃO SECUNDÁRIA: RADAR DA LOJA
                          // ==================================================
                          _HomeActionCard(
                            icon: Icons.auto_awesome_outlined,
                            title: 'Radar da Loja',
                            subtitle:
                                'Insights, alertas e prioridades do negócio',
                            isPrimary: false,
                            onTap: () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (ctx) =>
                                      SmartHomeScreen(storeId: widget.storeId),
                                ),
                              );
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _HomeActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool isPrimary;
  final VoidCallback onTap;

  const _HomeActionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.isPrimary,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final backgroundColor = isPrimary
        ? theme.colorScheme.primary
        : theme.colorScheme.surface;

    final foregroundColor = isPrimary
        ? theme.colorScheme.onPrimary
        : theme.colorScheme.onSurface;

    final subtitleColor = isPrimary
        ? theme.colorScheme.onPrimary.withValues(alpha: 0.80)
        : theme.colorScheme.onSurfaceVariant;

    final borderColor = isPrimary
        ? theme.colorScheme.primary
        : theme.colorScheme.outlineVariant;

    return Material(
      color: backgroundColor,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: borderColor),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: isPrimary
                      ? theme.colorScheme.onPrimary.withValues(alpha: 0.14)
                      : theme.colorScheme.primary.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(
                  icon,
                  color: isPrimary
                      ? theme.colorScheme.onPrimary
                      : theme.colorScheme.primary,
                  size: 28,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: foregroundColor,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: subtitleColor,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Icon(
                Icons.arrow_forward_ios_rounded,
                size: 18,
                color: foregroundColor.withValues(alpha: 0.75),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
