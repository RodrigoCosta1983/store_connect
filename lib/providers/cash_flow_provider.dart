// ============================================================================
// STORE&CONNECT - CASH FLOW PROVIDER
// ============================================================================
//
// Arquivo:
//   lib/providers/cash_flow_provider.dart
//
// OBJETIVO:
//
// Centralizar as operações do aplicativo relacionadas ao fluxo de caixa
// da loja.
//
// RESPONSABILIDADES ATUAIS:
//
// • registrar lançamentos financeiros em:
//     stores/{storeId}/cash_flow/{entryId}
//
// • criar entradas e saídas com os campos:
//     - description
//     - amount
//     - type
//     - createdAt
//
// • servir como ponto reutilizável para operações que precisam registrar
//   movimentações financeiras, como recebimentos de vendas a prazo.
//
// MODELO ATUAL DO DOCUMENTO:
//
// {
//   description: String,
//   amount: double,
//   type: 'Entrada' | 'Saída',
//   createdAt: Timestamp
// }
//
// SEGURANÇA - P7.8:
//
// A coleção cash_flow possui regra específica no Firestore.
//
// O aplicativo pode:
//
// • consultar lançamentos da própria loja;
// • criar novos lançamentos dentro do formato permitido.
//
// O aplicativo NÃO pode:
//
// • editar um lançamento já criado;
// • excluir fisicamente um lançamento.
//
// Portanto, os registros de cash_flow são tratados como APPEND-ONLY:
// depois de gravados, permanecem imutáveis pelo cliente.
//
// IMPORTANTE:
//
// Neste estágio, a criação do lançamento ainda acontece diretamente pelo
// Flutter porque fluxos atuais, como recebimento de dívida de cliente,
// dependem dessa gravação.
//
// Mesmo assim, as Firestore Rules validam:
//
// • usuário pertence à mesma loja;
// • somente os campos esperados podem ser enviados;
// • todos os campos obrigatórios estão presentes;
// • description deve ser String;
// • amount deve ser numérico e maior que zero;
// • type deve ser exclusivamente 'Entrada' ou 'Saída';
// • createdAt deve ser Timestamp.
//
// EVOLUÇÃO FUTURA:
//
// A criação de movimentações financeiras deverá migrar gradualmente para
// Cloud Functions, tornando o backend a autoridade definitiva do caixa.
//
// Quando isso acontecer:
//
// • o Flutter solicitará a operação ao backend;
// • o backend validará a origem da movimentação;
// • o backend criará o registro em cash_flow;
// • as Firestore Rules poderão bloquear também o create direto pelo cliente.
//
// CUIDADOS DE MANUTENÇÃO:
//
// • Não adicionar métodos de update/delete direto em cash_flow.
// • Não permitir valores negativos para representar saída;
//   utilizar type = 'Saída' com amount positivo.
// • Não alterar os nomes dos campos sem atualizar também as Firestore Rules.
// • Não adicionar novos campos ao documento sem revisar o hasOnly() das Rules.
// • Operações financeiras críticas devem, sempre que possível, evoluir para
//   execução transacional no backend.
// • O futuro cancelamento de venda não deve apagar lançamentos antigos;
//   deverá gerar movimentações compensatórias e manter o histórico.
//
// ============================================================================

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class CashFlowProvider with ChangeNotifier {
  // Seus outros métodos e variáveis do provider ficam aqui...

  // --- ADICIONE ESTE MÉTODO COMPLETO ---
  Future<void> addCashFlowEntry({
    required String description,
    required double amount,
    required String type, // Será 'Entrada' ou 'Saída'
    required String storeId,
  }) async {
    try {
      await FirebaseFirestore.instance
          .collection('stores')
          .doc(storeId)
          .collection('cash_flow')
          .add({
        'description': description,
        'amount': amount,
        'type': type,
        'createdAt': Timestamp.now(),
      });

      // Opcional: notificar ouvintes se você tiver uma tela que mostra o fluxo de caixa em tempo real.
      // notifyListeners();

    } catch (error) {
      print('Erro ao adicionar entrada no fluxo de caixa: $error');
      // Lançar o erro novamente para que a função que chamou saiba que algo deu errado
      throw error;
    }
  }
}