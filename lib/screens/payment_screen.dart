import 'package:flutter/material.dart';
// Importe o botão inteligente que criamos (Verifique se o caminho está correto)
import 'package:store_connect/widgets/subscription_button.dart';



class PaymentScreen extends StatelessWidget {
  final String userId;

  const PaymentScreen({super.key, required this.userId});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: const Text('Renovar Assinatura'),
        centerTitle: true,
        elevation: 0,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Ícone ou Logo
              const Icon(
                  Icons.workspace_premium,
                  size: 80,
                  color: Colors.deepPurple
              ),
              const SizedBox(height: 24),

              const Text(
                'Desbloqueie todo o potencial!',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),

              const Text(
                'Renove sua assinatura para continuar gerenciando sua loja com acesso ilimitado.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey,
                ),
              ),
              const SizedBox(height: 40),

              // Card de Preço
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.05),
                      blurRadius: 10,
                      offset: const Offset(0, 4),
                    )
                  ],
                  border: Border.all(color: Colors.deepPurple.withOpacity(0.1)),
                ),
                child: Column(
                  children: [
                    const Text(
                      'Plano Pro',
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: Colors.deepPurple
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: const [
                        Text(
                          'R\$ 29,90',
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: Colors.black87,
                          ),
                        ),
                        Text(
                          ' /mês',
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // AQUI ESTÁ A MÁGICA: Usamos o botão que já configura tudo
                    const SubscriptionButton(),

                    const SizedBox(height: 12),
                    const Text(
                      'Cancelamento a qualquer momento.',
                      style: TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}