# F8 — Inteligência de Vendas e Lucratividade

## 1. Visão do módulo

O objetivo do F8 é permitir ao lojista entender não apenas quanto vendeu,
mas quanto efetivamente ganhou com os produtos. O módulo deverá responder:

- Quanto vendi hoje?
- Quanto os produtos vendidos me custaram?
- Qual foi meu lucro bruto no dia?
- Qual foi minha margem?
- Qual produto me deu mais lucro?
- Qual produto tem maior margem?
- Quais produtos vendem bem mas têm margem baixa?
- Houve venda com margem negativa?
- Quanto lucrei em determinado período?

O Store&Connect passa a fornecer inteligência de negócio, e não apenas
controle de vendas/estoque. Este documento define o planejamento funcional
e técnico; não implementa código, UI ou arquitetura de agregação.

## 2. Definições financeiras

**Faturamento / receita bruta da venda:** valor efetivamente considerado
como receita dos produtos vendidos, observando descontos e regras já
existentes na venda.

**Custo dos produtos vendidos (CPV):** custo histórico dos itens no momento
da venda.

**Lucro bruto:** `receita considerada - custo dos produtos vendidos`.

**Margem bruta (%):** `lucro bruto / receita considerada * 100`.

F8 inicialmente calcula **LUCRO BRUTO**. Não chamar isso de lucro líquido.
Lucro líquido exigiria considerar também:

- impostos;
- taxas de cartão/maquininha;
- frete;
- aluguel;
- salários;
- energia;
- despesas administrativas;
- outras entradas/saídas.

Essa evolução poderá futuramente integrar `cash_flow`.

## 3. Regra mais importante — custo histórico

Regra arquitetural obrigatória: o relatório **NÃO pode consultar o custo
atual do produto para recalcular uma venda histórica**. No momento da venda
deve ser criado um snapshot do custo daquele item.

Exemplo — Produto X:

| Informação | Valor |
| --- | --- |
| Custo no momento da venda | R$ 12,00 |
| Preço de venda | R$ 20,00 |
| Quantidade | 3 |
| Receita | R$ 60,00 |
| Custo | R$ 36,00 |
| Lucro bruto | R$ 24,00 |
| Margem bruta | 40% |

Se amanhã o produto passar a custar R$ 15,00, a venda histórica continua
com custo de R$ 12,00. Venda histórica é imutável em relação ao custo
posterior do cadastro.

## 4. Preço de custo do produto

O produto deverá possuir conceito de preço de custo. Nome conceitual
sugerido: `costPrice`, ou nomenclatura final compatível com o modelo existente.

Regras:

- custo pode não estar informado;
- custo não informado **NÃO significa custo zero**;
- nunca assumir automaticamente zero;
- valor zero somente é válido se for explicitamente um custo real permitido
  pelo domínio;
- validar valores negativos;
- definir posteriormente regra de edição no cadastro.

Não decidir nome definitivo do campo sem auditar o modelo atual.

## 5. Snapshot no item da venda

Cada item vendido deverá preservar dados suficientes para o cálculo
histórico. Modelo conceitual:

```text
productId
productName
quantity
unitCostAtSale
unitSalePrice
unitDiscount / discount, conforme modelo existente
totalCost
totalRevenue
grossProfit
```

Não duplicar campos desnecessários se o modelo existente já guardar
informação equivalente. Antes da implementação, auditar o modelo real
de `sales`. Os nomes acima são conceituais, não um schema definitivo.

## 6. Custo não informado

Se o produto não possuir custo no momento da venda:

- **NÃO gravar custo fictício**;
- **NÃO assumir zero**;
- **NÃO considerar a venda como lucro de 100%**.

O item deve ser identificável como **CUSTO NÃO INFORMADO**. O relatório
deve conseguir indicar cobertura do cálculo, por exemplo:

> Lucro calculado sobre 91% do valor vendido.
>
> 3 produtos vendidos estão sem preço de custo.

Devem existir indicadores como:

- itens com custo conhecido;
- itens sem custo conhecido;
- receita coberta pelo cálculo;
- receita sem custo conhecido.

## 7. Vendas antigas / legacy

Vendas históricas anteriores ao F8 podem não possuir snapshot de custo.
**NÃO usar automaticamente o custo atual do produto para reconstruir o
lucro antigo. NÃO alterar vendas antigas silenciosamente.**

Essas vendas devem ser classificadas como:

- custo histórico indisponível; ou
- não calculável com segurança.

Uma eventual estratégia de migração deverá ser uma decisão futura,
explícita e separada.

## 8. Relatório geral

Planejar relatório com indicadores principais:

- Faturamento;
- Custo dos produtos vendidos;
- Lucro bruto;
- Margem bruta média;
- Quantidade de vendas;
- Unidades vendidas;
- Produtos diferentes vendidos;
- Receita sem custo conhecido;
- Itens sem custo conhecido.

Exemplo visual:

```text
Faturamento                 R$ 2.480,00
Custo dos produtos          R$ 1.540,00
Lucro bruto                   R$ 940,00
Margem bruta                     37,9%
Vendas                               34
Unidades vendidas                    86
```

## 9. Relatório por produto

Planejar detalhamento contendo produto, quantidade vendida, receita,
custo, lucro bruto e margem.

Exemplo:

```text
Produto A
Qtd: 10
Receita: R$ 200
Custo: R$ 120
Lucro bruto: R$ 80
Margem: 40%
```

## 10. Rankings e inteligência

Planejar indicadores:

- produto com maior faturamento;
- produto com maior lucro bruto;
- produto com maior margem;
- produto mais vendido em unidades;
- produtos com menor margem;
- produtos com margem negativa;
- produtos vendidos sem custo cadastrado.

**MAIOR FATURAMENTO não é necessariamente MAIOR LUCRO.**

## 11. Filtros

Planejar filtros:

- Hoje;
- Ontem;
- Últimos 7 dias;
- Este mês;
- Mês anterior;
- Período personalizado.

Posteriormente considerar:

- categoria;
- produto;
- forma de pagamento;
- cliente;
- vendedor/usuário, se compatível com arquitetura existente.

## 12. Relatório diário

Cenário prioritário: o lojista abre o Store&Connect ao final do dia e
visualiza:

- quanto vendeu;
- quanto custaram os produtos vendidos;
- quanto teve de lucro bruto;
- margem;
- produtos mais lucrativos;
- produtos com margem baixa;
- itens vendidos sem custo informado.

Esse será um dos principais casos de uso do F8.

## 13. Descontos

Descontos devem afetar corretamente a receita e, consequentemente, o lucro.

Exemplo:

| Informação | Valor |
| --- | --- |
| Preço normal | R$ 20 |
| Desconto | R$ 5 |
| Valor efetivamente vendido | R$ 15 |
| Custo histórico | R$ 12 |
| Lucro bruto | R$ 3 |

**NÃO calcular lucro utilizando os R$ 20 originais se a venda realmente
ocorreu por R$ 15.** Antes da implementação, auditar como descontos já
são armazenados.

## 14. Cancelamentos / estornos

Planejar regra explícita para:

- venda cancelada;
- item cancelado;
- estorno;
- devolução, caso exista futuramente.

Venda integralmente cancelada não pode continuar compondo faturamento e
lucro como venda válida. Não implementar regra sem auditar o modelo atual
de status das vendas.

## 15. Precisão monetária

Cálculos financeiros devem evitar erros de ponto flutuante e seguir o
padrão financeiro já utilizado pelo Store&Connect.

Antes de implementação, auditar a representação monetária atual.
**Não introduzir uma segunda convenção de dinheiro no projeto.**

## 16. Multi-store

Todos os relatórios devem respeitar isolamento por `storeId`. Dados de
uma loja jamais podem participar do relatório de outra loja.
**Nenhuma agregação global entre lojas.**

## 17. Segurança e autorização

Relatórios só podem ser acessados por usuários autorizados para a loja.
Reutilizar o modelo atual de autenticação/autorização. Não criar novo
mecanismo paralelo de permissões sem necessidade.

## 18. Performance

A implementação não deve decidir prematuramente entre:

- agregação em tempo real;
- documentos agregados;
- índices;
- Cloud Functions;
- cálculo client-side;
- cálculo backend.

Primeiro auditar:

- estrutura de `sales`;
- volume esperado;
- consultas existentes;
- Firestore indexes;
- modelo multi-store.

A arquitetura de agregação será definida em etapa própria.

## 19. Fonte de verdade

**Produto atual:** fonte para custo de NOVAS vendas.

**Item da venda:** fonte histórica para relatórios de vendas passadas.

Depois que a venda ocorreu, o relatório deve utilizar o snapshot da venda.

## 20. UI conceitual

Planejar área:

```text
Relatórios
  └── Lucratividade
```

Cabeçalho:

- seletor de período.

Cards:

- Faturamento;
- Custo;
- Lucro bruto;
- Margem.

Seções:

- Evolução no período;
- Produtos mais lucrativos;
- Produtos com maior margem;
- Produtos com margem baixa/negativa;
- Detalhamento por produto;
- Alertas de custo não informado.

Não implementar UI nesta etapa.

## 21. Alertas futuros

Backlog possível:

- "5 produtos foram vendidos hoje sem custo cadastrado";
- "Este produto teve margem negativa";
- "A margem deste produto caiu";
- "Seu lucro bruto desta semana subiu X%";
- "Produto vende muito, mas possui margem baixa".

Não implementar agora.

## 22. Evolução futura — lucro líquido

Futura integração com `cash_flow` poderá permitir:

```text
Receita
- CPV
= Lucro bruto

Lucro bruto
- despesas operacionais
- taxas
- impostos
= Resultado/lucro líquido estimado
```

Isso **NÃO faz parte da primeira versão do F8**.

## 23. Fases propostas

**F8.0 — auditoria do modelo atual**

- `products`;
- `sales`;
- itens da venda;
- descontos;
- cancelamentos;
- money representation (representação monetária).

**F8.1 — preço de custo no produto**

**F8.2 — snapshot de custo na venda**

**F8.3 — contratos e cálculo puro de lucratividade**

**F8.4 — relatório diário**

**F8.5 — relatório por período**

**F8.6 — relatório por produto**

**F8.7 — rankings/insights**

**F8.8 — tratamento de legacy/cobertura de custo**

**F8.9 — testes, performance e fechamento**

**F8.10 — evoluções futuras**

- lucro líquido;
- `cash_flow`;
- taxas;
- alertas;
- comparativos.

A ordem poderá ser refinada depois da auditoria F8.0.

## 24. Critérios de aceite do módulo

Critérios mínimos:

- alterar custo atual não altera lucro histórico;
- desconto reduz corretamente receita/lucro;
- custo ausente nunca é tratado automaticamente como zero;
- vendas antigas sem snapshot não recebem lucro inventado;
- relatórios respeitam `storeId`;
- venda cancelada não compõe resultado como venda válida;
- soma por produto fecha com total do período;
- tipos monetários seguem padrão do projeto;
- relatórios apresentam lucro bruto, não chamam de lucro líquido;
- dados históricos permanecem determinísticos.

## 25. Princípio do F8

"Vender mais não significa necessariamente lucrar mais.

O F8 deve permitir que o lojista compreenda quanto vendeu, quanto os
produtos vendidos lhe custaram e quanto de lucro bruto foi efetivamente
gerado, preservando o custo histórico de cada venda."
