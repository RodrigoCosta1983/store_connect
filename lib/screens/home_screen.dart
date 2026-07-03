// lib/screens/home_screen.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:store_connect/screens/sales/new_sale_screen.dart';

import '../widgets/app_drawer.dart';
import 'auth/auth_gate.dart';

class HomeScreen extends StatefulWidget {
  final String storeId;

  const HomeScreen({super.key, required this.storeId});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _isLoadingPayment = false;

  // --- FUNÇÃO PARA CRIAR ASSINATURA DIRETO DO BANNER ---
  Future<void> _callFinanceFunction() async {
    setState(() => _isLoadingPayment = true);
    try {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text("Acessando portal financeiro..."),
            duration: Duration(seconds: 4),
          ),
        );
      }

      // 1. Busca os dados da loja
      final storeDoc = await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).get();
      final storeData = storeDoc.data() as Map<String, dynamic>?;

      if (storeData == null) throw Exception("Loja não encontrada.");

      final asaasCustomerId = storeData['asaasCustomerId'] as String?;
      final functionName = (asaasCustomerId != null && asaasCustomerId.isNotEmpty)
          ? 'getAsaasPortalUrl'
          : 'createAsaasSubscription';

      // 2. Chama a Cloud Function correta
      final HttpsCallable callable = FirebaseFunctions.instance.httpsCallable(functionName);
      final response = await callable.call(<String, dynamic>{
        'storeId': widget.storeId,
        'cpfCnpj': storeData['document'],
        'name': storeData['name'],
        'email': FirebaseAuth.instance.currentUser?.email,
        'phone': storeData['phone']
      });

      // Pega a URL de pagamento ou portal (ajuste as chaves conforme o retorno da sua API Asaas)
      final url = response.data['paymentUrl'] as String? ?? response.data['portalUrl'] as String?;

      if (url != null && url.isNotEmpty) {
        final uri = Uri.parse(url);
        try {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } catch (e) {
          throw 'O celular impediu a abertura do navegador.';
        }
      } else if (response.data['alreadyActive'] == true) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Sua assinatura já está ativa!"), backgroundColor: Colors.green),
          );
        }
      } else {
        throw 'URL não retornada pelo servidor.';
      }
    } catch (e) {
      debugPrint('Erro na função financeira: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Erro ao acessar o portal financeiro. Tente novamente."), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoadingPayment = false);
    }
  }

  // --- WIDGET DO BANNER DE AVISO ---
  Widget _buildTrialWarningBanner(Map<String, dynamic> storeData) {
    final status = storeData['subscriptionStatus'] as String? ?? 'trial';
    final type = storeData['subscriptionType'] as String? ?? 'free';
    final trialEndDateStr = storeData['trialEndDate'] as String?;

    // Se ele já for PRO, inativo, ou não tiver data de trial, não mostra o banner
    if (status != 'active' || type == 'pro' || trialEndDateStr == null) {
      return const SizedBox.shrink();
    }

    try {
      DateTime dataFimTrial = DateTime.parse(trialEndDateStr);
      // Calcula a diferença em dias. Usamos a data de hoje para garantir o fuso correto.
      DateTime hoje = DateTime.now();

      // Zera as horas para calcular dias "corridos" de forma mais exata, evitando que
      // faltem 23 horas e ele conte como 0 dias.
      DateTime dataFimFormatada = DateTime(dataFimTrial.year, dataFimTrial.month, dataFimTrial.day);
      DateTime hojeFormatada = DateTime(hoje.year, hoje.month, hoje.day);

      int diasRestantes = dataFimFormatada.difference(hojeFormatada).inDays;

      // Só mostra o aviso se faltarem 3 dias ou menos E se o trial ainda não estiver negativo (pois o AuthGate já cuidaria de bloquear se passou)
      if (diasRestantes <= 3 && diasRestantes >= 0) {
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          color: diasRestantes == 0 ? Colors.red.shade100 : Colors.orange.shade100, // Vermelho se for hoje!
          child: Row(
            children: [
              Icon(
                Icons.warning_amber_rounded,
                color: diasRestantes == 0 ? Colors.red.shade800 : Colors.orange.shade800,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  diasRestantes == 0
                      ? "Atenção: Seu período de teste termina HOJE! Assine o plano Pro para não perder o acesso amanhã."
                      : "Atenção: Seu período de teste termina em $diasRestantes dia(s).",
                  style: TextStyle(
                    color: diasRestantes == 0 ? Colors.red.shade900 : Colors.orange.shade900,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              ),
              if (_isLoadingPayment)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16.0),
                  child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                )
              else
                TextButton(
                  onPressed: _callFinanceFunction,
                  style: TextButton.styleFrom(
                    backgroundColor: diasRestantes == 0 ? Colors.red.shade800 : Colors.orange.shade800,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: const Text("ASSINAR", style: TextStyle(fontWeight: FontWeight.bold)),
                )
            ],
          ),
        );
      }
    } catch (e) {
      debugPrint("Erro ao calcular dias de teste no Banner: $e");
    }

    return const SizedBox.shrink();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      drawer: AppDrawer(storeId: widget.storeId),
      appBar: AppBar(
        title: StreamBuilder<DocumentSnapshot>(
            stream: FirebaseFirestore.instance.collection('stores').doc(widget.storeId).snapshots(),
            builder: (context, snapshot) {
              if (snapshot.hasData && snapshot.data!.exists) {
                final storeData = snapshot.data!.data() as Map<String, dynamic>;
                final storeName = storeData['name'] ?? storeData['storeName'] ?? 'Minha Loja';
                return Text(storeName);
              }
              return const Text('Store&Connect');
            }
        ),
        actions: [
          IconButton(
            tooltip: 'Sair',
            icon: const Icon(Icons.logout),
            onPressed: () {
              FirebaseAuth.instance.signOut();
            },
          )
        ],
      ),
      body: StreamBuilder<DocumentSnapshot>(
        stream: FirebaseFirestore.instance.collection('stores').doc(widget.storeId).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          if (snapshot.hasData && snapshot.data!.exists) {
            final storeData = snapshot.data!.data() as Map<String, dynamic>;
            final status = storeData['subscriptionStatus'];

            // 🚨 AQUI ESTÁ O VIGIA:
            if (status != 'active') {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                Navigator.of(context).pushAndRemoveUntil(
                  MaterialPageRoute(builder: (ctx) => const AuthGate()),
                      (route) => false,
                );
              });
              return const Center(child: Text('Assinatura expirada...'));
            }
          }
          if (!snapshot.hasData || !snapshot.data!.exists) {
            return const Center(child: Text('Loja não encontrada.'));
          }

          final storeData = snapshot.data!.data() as Map<String, dynamic>;
          final storeName = storeData['name'] ?? storeData['storeName'] ?? 'Nome da Loja Indisponível';

          return Column(
            children: [
              // ------------------------------------------
              // NOVO: Exibe o Banner logo abaixo da AppBar
              // ------------------------------------------
              _buildTrialWarningBanner(storeData),

              // O restante do conteúdo centralizado da tela original
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        'Bem-vindo à',
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        storeName,
                        style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 32),
                      ElevatedButton.icon(
                        icon: const Icon(Icons.storefront),
                        label: const Text('Gerenciar Loja'),
                        style: ElevatedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
                          textStyle: const TextStyle(fontSize: 18),
                        ),
                        onPressed: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (ctx) => NewSaleScreen(storeId: widget.storeId),
                            ),
                          );
                        },
                      )
                    ],
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