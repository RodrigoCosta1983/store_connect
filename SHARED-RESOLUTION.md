# Directed resolution of the 19 shared files

Each original file has one authoritative owner in this branch. No function body, model, Rules check or import was rewritten to organize commits. Splitting mixed callbacks would change the application; instead the complete development composition is versioned once.

## firestore.rules

Boundary única de autorização e campos financeiros/F9/F10; preservar regras completas na integração, sem publicar ou flexibilizar.

SHA256: 14c69566c4fd87e9f0678ac166cf9ade8cf01c35cca632df3b953cadc0e09b6f

Reviewed diff sections: 20

## functions-bootstrap/auth/bootstrapStore.js

Bootstrap de identidade/loja cruza dados iniciais e assinatura; único proprietário compartilhado, sem duplicar em financeiro/produtos.

SHA256: 2d4df0a0385ff819f72b5b5df9cfcd1cb130fab3ba6e611ed467e9e91824a491

Reviewed diff sections: 7

## functions-bootstrap/tests/bootstrapStore.emulator.test.js

Teste do contrato de bootstrap; acompanha o bootstrap compartilhado.

SHA256: 3cd38c4d642ab319d1a6f1f0bd22e9b1f1d07f6edc79147fc0d0aa14d2ea2bd7

Reviewed diff sections: 4

## functions/index.js

Composition root mistura exports financeiros e comerciais; pertence somente à integração em desenvolvimento. PROD operacional tem index próprio no pacote canônico.

SHA256: 90cc9272fa8851c5df55a0b85a8c09d3befc12898525b49e5c2df0bc8c78ccb5

Reviewed diff sections: 42

## lib/app_bootstrap.dart

Inicialização Firebase/App Check e composição opcional do checkout; snapshot de desenvolvimento distinto da Web congelada.

SHA256: fe3248fa0a16f9da162c3475eefb364fac75012c82ab7815ca6f5153c5c32034

Reviewed diff sections: 11

## lib/models/cart_item_model.dart

Contrato de item, quantidade e identidade compartilhado por F9/F10; não criar variantes por branch.

SHA256: 799c1e99a4525cb707405389c320b3f24e69ab0f59ccffbd3bc9e1ca1811ed0b

Reviewed diff sections: 10

## lib/models/product_model.dart

Modelo de produto/variantes usado por leituras e vendas; contrato único compartilhado.

SHA256: 573ba2c71d45918f1b3c66ee307bed5937a01f9b7ad0f0b461363a0ad98dc137

Reviewed diff sections: 4

## lib/models/sale_order_model.dart

Modelo de venda/alocações e relatórios usado por vendas e variantes; contrato único.

SHA256: b1b99cecac011c7e1ee54a7becb259eb5fd9de018a4ff1dd60b8cdcda4654fc3

Reviewed diff sections: 5

## lib/providers/cart_provider.dart

Revisão/sessão e itens do carrinho atravessam UIs e vendas; preservar implementação única.

SHA256: 7b5d1a2bb36e0ddfb6b2049dc97d617be6aca1c30cdccf598583365915ab9840

Reviewed diff sections: 8

## lib/providers/sales_provider.dart

Orquestração financeira/comercial de cliente em desenvolvimento; não confundir com writer legado da Web publicada.

SHA256: 7817e94bf4f0be0fc11fa36e611ddc99aa7cbd5e0339dd3303a230f4560e3861

Reviewed diff sections: 28

## lib/screens/auth/auth_gate.dart

Controle de acesso e primeira entrada; contrato de autenticação e assinatura transversal.

SHA256: b1a3d2a0d7d4e3d1d62161a2a909a8c43b5a1a606b4fb6d6899de532e21079eb

Reviewed diff sections: 2

## lib/screens/cart/cart_screen.dart

Composição de checkout e variantes; preservar arquivo integral sob integração, sem recortar callbacks por feature.

SHA256: 5e265870093a1ff7142058f53afcaa529b790cfb6e000f714b7a130f002260c8

Reviewed diff sections: 11

## lib/screens/sales/new_sale_screen.dart

PDV integra estoque, fila e variantes; preservar única composição e registrar dependências.

SHA256: 19d5ee4934704905782662e79d4b469b8772bd94426e8493bc6f74a931e0c594

Reviewed diff sections: 19

## lib/screens/settings_screen.dart

Navegação/configuração cruza financeiro e produto; único proprietário da integração.

SHA256: f112388d3b91ec00f5d3f40168eb0e4d662c545e8ad85b38fc46c8e2cad12f0e

Reviewed diff sections: 2

## lib/widgets/app_drawer.dart

Navegação transversal para caixa/configurações; não duplicar versões por domínio.

SHA256: 38695798f92a81debec0d466f6b69a2ea96d4f17246e71c830e59ce9cdaccd0f

Reviewed diff sections: 3

## lib/widgets/order_item_widget.dart

Ações de venda/recebimento e apresentação compartilhadas; manter contrato único.

SHA256: b0592783ed99fe6d14ad04d6791e51c155cc55b06199de15272a6295b658c0c3

Reviewed diff sections: 4

## lib/widgets/payment_options_sheet.dart

Checkout e escolha de pagamento cruzam F9/F10; fonte corrente é desenvolvimento, distinta da Web compatível congelada.

SHA256: 5057fe997c12c988487f35fa969945c1330b703da74d317240354df31bf8d907

Reviewed diff sections: 53

## pubspec.lock

Lockfile único da composição de desenvolvimento; preservar junto ao pubspec, sem resolver dependências novas.

SHA256: 00222efda04c56ec1f9d36e9e7c1e555a9da8e66987b95249f662c33c242cf77

Reviewed diff sections: 3

## pubspec.yaml

Versão e dependências Flutter compartilhadas; preservar junto ao lockfile sem alterar SDK/bibliotecas.

SHA256: 1bebbcb6e25705f59dda2bc4213c79ea8e3ad5028d88eef7e9225ff0db4ac4a0

Reviewed diff sections: 2

Consumers: F9 and F10 must compose these exact files and their dependency snapshots before any build validation. Operational Asaas uses its own canonical entrypoint; published Web remains a separate frozen snapshot.
