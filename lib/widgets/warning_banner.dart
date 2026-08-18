// lib/widgets/warning_banner.dart

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

import '../screens/finance/invoices_screen.dart';

class WarningBanner extends StatefulWidget {
  final String storeId;

  const WarningBanner({super.key, required this.storeId});

  @override
  State<WarningBanner> createState() => _WarningBannerState();
}

class _WarningBannerState extends State<WarningBanner> {
  bool _isLoadingPayment = false;

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

      final storeDoc = await FirebaseFirestore.instance.collection('stores').doc(widget.storeId).get();
      final storeData = storeDoc.data() as Map<String, dynamic>?;

      if (storeData == null) throw Exception("Loja não encontrada.");

      final asaasCustomerId = storeData['asaasCustomerId'] as String?;
      final functionName = (asaasCustomerId != null && asaasCustomerId.isNotEmpty)
          ? 'getAsaasPortalUrl'
          : 'createAsaasSubscription';

      final HttpsCallable callable = FirebaseFunctions.instance.httpsCallable(functionName);
      final response = await callable.call(<String, dynamic>{
        'storeId': widget.storeId,
        'cpfCnpj': storeData['document'],
        'name': storeData['name'],
        'email': FirebaseAuth.instance.currentUser?.email,
        'phone': storeData['phone']
      });

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

  Widget _buildBannerUI(Map<String, dynamic> storeData) {
    final status = storeData['subscriptionStatus'] as String? ?? 'trial';
    final type = storeData['subscriptionType'] as String? ?? 'free';

    // Planos pagos válidos
    final bool isPaidPlan = type == 'pro' || type == 'business';

    // Data final do período de teste
    final trialEndDateStr = storeData['trialEndDate'] as String?;

    // 🔴 1. LÓGICA PARA FATURA EM ATRASO (OVERDUE)
    if (status == 'overdue') {
      final overdueSince = storeData['overdueSince'];
      int diasRestantes = 3;

      if (overdueSince != null) {
        DateTime dataAtraso = (overdueSince as Timestamp).toDate();
        int diasPassados = DateTime.now().difference(dataAtraso).inDays;
        diasRestantes = 3 - diasPassados;
        if (diasRestantes < 0) diasRestantes = 0;
      }

      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        color: diasRestantes == 0 ? Colors.red.shade100 : Colors.amber.shade100,
        child: Row(
          children: [
            Icon(
              Icons.warning_amber_rounded,
              color: diasRestantes == 0 ? Colors.red.shade800 : Colors.amber.shade900,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                diasRestantes == 0
                    ? "URGENTE: Sua fatura venceu e seu acesso será bloqueado HOJE."
                    : "Atenção: Sua fatura venceu. Você tem $diasRestantes dia(s) para pagar antes do bloqueio.",
                style: TextStyle(
                  color: diasRestantes == 0 ? Colors.red.shade900 : Colors.amber.shade900,
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
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (ctx) => InvoicesScreen(storeId: widget.storeId),
                    ),
                  );
                },
                style: TextButton.styleFrom(
                  backgroundColor: diasRestantes == 0 ? Colors.red.shade800 : Colors.blue.shade800,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: const Text("VER FATURA", style: TextStyle(fontWeight: FontWeight.bold)),
              )
          ],
        ),
      );
    }

    // 🟠 2. LÓGICA PARA PERÍODO DE TESTE (TRIAL)
    if ((status == 'trial' || status == 'active') &&
        !isPaidPlan &&
        trialEndDateStr != null) {
      try {
        DateTime dataFimTrial = DateTime.parse(trialEndDateStr);
        DateTime hoje = DateTime.now();
        DateTime dataFimFormatada = DateTime(dataFimTrial.year, dataFimTrial.month, dataFimTrial.day);
        DateTime hojeFormatada = DateTime(hoje.year, hoje.month, hoje.day);

        int diasRestantesTrial = dataFimFormatada.difference(hojeFormatada).inDays;

        if (diasRestantesTrial <= 3 && diasRestantesTrial >= 0) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
            color: diasRestantesTrial == 0 ? Colors.red.shade100 : Colors.orange.shade100,
            child: Row(
              children: [
                Icon(
                  Icons.timer,
                  color: diasRestantesTrial == 0 ? Colors.red.shade800 : Colors.orange.shade800,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    diasRestantesTrial == 0
                        ? "Seu período de teste termina HOJE! Assine o plano Pro para continuar usando."
                        : "Seu período de teste termina em $diasRestantesTrial dia(s).",
                    style: TextStyle(
                      color: diasRestantesTrial == 0 ? Colors.red.shade900 : Colors.orange.shade900,
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
                    onPressed: () {
                      // ✅ Agora ele navega para a nova tela nativa do aplicativo
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (ctx) => InvoicesScreen(storeId: widget.storeId),
                        ),
                      );
                    },
                    style: TextButton.styleFrom(
                      //backgroundColor: diasRestantes == 0 ? Colors.red.shade800 : Colors.blue.shade800,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text("VER FATURA", style: TextStyle(fontWeight: FontWeight.bold)),
                  )
              ],
            ),
          );
        }
      } catch (e) {
        debugPrint("Erro no cálculo do banner: $e");
      }
    }

    // 🔵 3. LÓGICA PARA FATURA A VENCER (PLANO PRO)
    if (status == 'active' && isPaidPlan) {
      // ATENÇÃO: Substitua 'nextDueDate' pelo nome exato do campo onde você salva o vencimento no Firestore
      final nextDueDateStr = storeData['nextDueDate'] as String?;

      if (nextDueDateStr != null) {
        try {
          DateTime dataVencimento = DateTime.parse(nextDueDateStr);
          DateTime hoje = DateTime.now();

          // Zera as horas para calcular dias exatos
          DateTime dataVencFormatada = DateTime(dataVencimento.year, dataVencimento.month, dataVencimento.day);
          DateTime hojeFormatada = DateTime(hoje.year, hoje.month, hoje.day);

          int diasRestantes = dataVencFormatada.difference(hojeFormatada).inDays;

          // 🕵️ O SEU DEBUG AQUI!
          debugPrint('=== 🕵️ DEBUG DO BANNER ASAAS ===');
          debugPrint('Status: $status | Tipo: $type');
          debugPrint('Data atual: $hojeFormatada');
          debugPrint('Data Vencimento (Firebase): $dataVencFormatada');
          debugPrint('Dias restantes: $diasRestantes');
          debugPrint('==================================');

          // Se faltam 3 dias ou menos (e ainda não venceu)
          if (diasRestantes <= 3 && diasRestantes >= 0) {
            return Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
              color: diasRestantes == 0 ? Colors.red.shade100 : Colors.blue.shade100,
              child: Row(
                children: [
                  Icon(
                    Icons.calendar_today,
                    color: diasRestantes == 0 ? Colors.red.shade800 : Colors.blue.shade800,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      diasRestantes == 0
                          ? "Sua fatura vence HOJE! Efetue o pagamento para evitar o bloqueio."
                          : "Sua próxima fatura vence em $diasRestantes dia(s).",
                      style: TextStyle(
                        color: diasRestantes == 0 ? Colors.red.shade900 : Colors.blue.shade900,
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
                      onPressed: () {
                        // ✅ Agora ele navega para a nova tela nativa do aplicativo
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (ctx) => InvoicesScreen(storeId: widget.storeId),
                          ),
                        );
                      },
                      style: TextButton.styleFrom(
                        backgroundColor: diasRestantes == 0 ? Colors.red.shade800 : Colors.blue.shade800,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text("VER FATURA", style: TextStyle(fontWeight: FontWeight.bold)),
                    )
                ],
              ),
            );
          }
        } catch (e) {
          debugPrint("Erro no cálculo do banner Pro: $e");
        }
      }
    }

    return const SizedBox.shrink();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance.collection('stores').doc(widget.storeId).snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const SizedBox.shrink();
        }
        final storeData = snapshot.data!.data() as Map<String, dynamic>;
        return _buildBannerUI(storeData);
      },
    );
  }
}