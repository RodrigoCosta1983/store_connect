import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'dashboard_screen.dart';

class PaymentScreen extends StatefulWidget {
  final String userId;

  const PaymentScreen({super.key, required this.userId});


  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  bool _isLoading = false;

  Future<void> _realizarPagamento() async {
    setState(() {
      _isLoading = true;
    });

    try {
      // 1. Chamar a Cloud Function
      final functions = FirebaseFunctions.instanceFor(region: 'us-central1');
      final result = await functions
          .httpsCallable('createPaymentIntent')
          .call();
      final clientSecret = result.data['clientSecret'];

      if (clientSecret == null) {
        throw Exception('clientSecret recebido do backend é nulo.');
      }

      // 2. Inicializar a tela de pagamento do Stripe
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          merchantDisplayName: 'Store Connect',
          paymentIntentClientSecret: clientSecret,
        ),
      );

      // 3. Apresentar a tela de pagamento para o usuário
      await Stripe.instance.presentPaymentSheet();

      // ---- INÍCIO DA LÓGICA ADICIONADA ----

      // 4. ATUALIZAR O FIRESTORE APÓS SUCESSO
      // A coleção pode ser 'stores' ou 'users', dependendo da sua estrutura.
      // Usamos o widget.userId que recebemos no construtor.
      final userDoc = await FirebaseFirestore.instance.collection('users').doc(widget.userId).get();
      final storeId = userDoc.data()?['storeId'] as String?;

      if (storeId == null) {
        throw Exception('storeId não encontrado no documento do usuário.');
      }

      // 2. ATUALIZAR O DOCUMENTO DA LOJA USANDO O storeId CORRETO
      await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId) // USA O storeId QUE ACABAMOS DE BUSCAR
          .update({
        'subscriptionStatus': 'active',
        'lastPaymentDate': Timestamp.now(),
      });

      // 5. MOSTRAR MENSAGEM DE SUCESSO
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Pagamento concluído com sucesso! Acesso liberado.'),
          backgroundColor: Colors.green,
        ),
      );

      // 6. NAVEGAR PARA A HOME E LIMPAR O HISTÓRICO
      await Future.delayed(const Duration(seconds: 2));
      if (!mounted) return;

      // IMPORTANTE: Substitua 'HomePage()' pela sua tela principal,
      // a primeira tela que o usuário vê quando está com o acesso liberado.
      // Não se esqueça de importar o arquivo da sua HomePage no topo.
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (context) =>  DashboardScreen(storeId: storeId)), // <<-- SUBSTITUA AQUI
            (Route<dynamic> route) => false, // Este predicado remove todas as rotas anteriores
      );

      // ---- FIM DA LÓGICA ADICIONADA ----

    } on StripeException catch (e) {
      if (e.error.code != FailureCode.Canceled && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Erro no pagamento: ${e.error.localizedMessage}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } catch (e) {
      print("Erro geral: $e");
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ocorreu um erro inesperado: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pagamento da Assinatura'),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Renove sua assinatura para continuar com acesso completo à plataforma.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 18),
              ),
              const SizedBox(height: 20),
              const Text(
                'Valor: R\$ 50,00',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 40),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  textStyle: const TextStyle(fontSize: 18),
                ),
                onPressed: _isLoading ? null : _realizarPagamento,
                child: _isLoading
                    ? const CircularProgressIndicator(
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                )
                    : const Text('Pagar Agora'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}