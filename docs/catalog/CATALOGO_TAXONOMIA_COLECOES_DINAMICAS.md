# Store&Connect — Catálogo Inteligente
## Taxonomia, Coleções Comerciais e Seções Dinâmicas

**Status:** proposta arquitetural / backlog técnico — **não implementada**
**Data:** 16/09/2026
**Objetivo:** registrar a evolução planejada do catálogo público antes de alterar o modelo de dados, aproveitando que o projeto ainda está majoritariamente em ambiente de testes e sem clientes reais.

---

# 1. Contexto e origem da ideia

A evolução nasceu de um problema real observado em uma farmácia.

Uma cliente entrou em contato pelo WhatsApp perguntando o preço de um produto. A atendente respondeu enviando uma foto da prateleira com vários produtos, sem identificação clara, sem preços e com baixa qualidade. A cliente não insistiu no atendimento e desistiu da compra.

A partir dessa situação surgiu a ideia de transformar o catálogo do Store&Connect em uma ferramenta que:

- apresente produtos de forma organizada;
- reduza atrito no atendimento por WhatsApp;
- permita que o cliente monte sua seleção;
- envie uma solicitação estruturada para a loja;
- ajude a loja a apresentar produtos complementares e promoções;
- aumente oportunidades de venda sem obrigar a compra de itens adicionais.

Farmácias são, portanto, um forte candidato a primeiro segmento de validação do catálogo inteligente, sem limitar o Store&Connect exclusivamente a esse mercado.

---

# 2. Princípio central

O catálogo não deve ser apenas uma vitrine de produtos.

A direção desejada é:

> **Transformar o catálogo em uma ferramenta comercial conectada à operação da loja.**

O cliente deve conseguir encontrar, selecionar e solicitar produtos com clareza, enquanto a loja pode utilizar o mesmo catálogo para destacar ofertas e produtos complementares.

---

# 3. Experiência desejada no catálogo público

A estrutura visual planejada é:

```text
────────────────────────────────────────
              SUA SELEÇÃO
────────────────────────────────────────
Produto A                 1x   R$ 29,90
Produto B                 2x   R$ 39,80

Subtotal                       R$ 69,70
────────────────────────────────────────

          COMPLETE SEU PEDIDO
────────────────────────────────────────
[ produto ] [ produto ] [ produto ]

────────────────────────────────────────
           OFERTAS PARA VOCÊ
────────────────────────────────────────
[ produto ] [ produto ] [ produto ]

────────────────────────────────────────
               CATÁLOGO
────────────────────────────────────────
Categorias / produtos / busca / etc.
```

## 3.1. “Sua seleção”

Área superior com o pedido atual do cliente.

Deve permitir visualizar, no mínimo:

- produtos selecionados;
- quantidade;
- preço;
- subtotal por item;
- total parcial;
- possibilidade de alterar/remover itens conforme UX definida.

Nenhum produto adicional pode ser inserido automaticamente na seleção do cliente.

---

# 4. Cross-sell, upsell e promoções

Abaixo da seleção atual, o catálogo poderá exibir seções comerciais.

Exemplos:

- **Complete seu pedido**
- **Você também pode gostar**
- **Ofertas para você**
- **Promoções**
- **Destaques**
- **Novidades**
- **Mais vendidos**

Essas áreas representam **cross-sell/upsell opcional**.

## Importante

Evitar o termo “venda casada” no produto, documentação comercial ou interface.

O Store&Connect deverá apenas sugerir itens adicionais. A decisão de adicionar qualquer produto continua sendo do cliente.

---

# 5. Problema de manutenção que precisamos evitar

Não queremos que a loja precise selecionar manualmente produto por produto para cada seção.

Exemplo indesejado:

```text
Seção: Promoção

- Produto A
- Produto B
- Produto C
- Produto D
- Produto E
- Produto F
...
```

Com milhares de produtos, essa estratégia seria difícil de manter.

A proposta é usar **grupos reutilizáveis**.

---

# 6. Separação conceitual: Categorias x Coleções Comerciais

A arquitetura proposta separa dois conceitos.

## 6.1. Categorias

Respondem:

> **O que é este produto / onde ele deve ser encontrado?**

Exemplos:

- Feminino
- Masculino
- Infantil
- Cabelo
- Higiene
- Cuidados com a pele
- Proteção solar
- Bebê

Categorias são principalmente organizacionais e de navegação.

---

## 6.2. Coleções comerciais

Respondem:

> **Por que a loja quer destacar este produto neste momento?**

Exemplos:

- Promoção
- Destaques
- Novidades
- Mais vendidos
- Ofertas da semana
- Complete seu pedido
- Semana da beleza
- Campanha de verão

Coleções comerciais podem ser temporárias e ligadas a campanhas.

---

# 7. Relação muitos-para-muitos

Um produto poderá pertencer a:

- zero, uma ou várias categorias;
- zero, uma ou várias coleções comerciais.

Exemplo conceitual:

```text
Produto: Shampoo X

Categorias:
- Feminino
- Cabelo

Coleções comerciais:
- Promoção
- Destaques
```

Outro exemplo:

```text
Produto: Protetor Solar Y

Categorias:
- Feminino
- Proteção solar
- Verão

Coleções comerciais:
- Promoção
- Mais vendidos
```

A relação desejada é **muitos-para-muitos**.

Um produto pode estar em vários grupos e um grupo pode conter vários produtos.

---

# 8. Produto sem categoria também deve ser possível

A proposta inicial é aceitar cardinalidade `0..N`.

Exemplos:

```text
Produto A
Categorias: []

Produto B
Categorias:
- Higiene

Produto C
Categorias:
- Feminino
- Cabelo
- Higiene
```

Isso permite cadastrar produtos ainda não classificados sem bloquear o fluxo operacional.

A obrigatoriedade de pelo menos uma categoria poderá ser reavaliada posteriormente.

---

# 9. Referências por ID, não por nome

A proposta conceitual é que produtos armazenem referências estáveis por ID.

Exemplo:

```text
categoryIds:
- cat_feminino
- cat_cabelo

collectionIds:
- col_promocao
- col_destaques
```

Evitar depender do nome textual como identificador:

```text
categories:
- Feminino
- Cabelo
```

Motivo:

Se a loja renomear:

```text
Feminino
```

para:

```text
Cuidados Femininos
```

não deverá ser necessário atualizar todos os produtos associados.

## Atenção

Essa é uma **proposta arquitetural**, ainda sujeita à auditoria do modelo Firestore atual.

Nenhuma alteração de schema deve ser feita antes dessa auditoria.

---

# 10. Seções dinâmicas do catálogo

Uma seção do catálogo poderá apontar para uma fonte dinâmica.

Exemplo:

```text
Seção:
Ofertas para você

Tipo de fonte:
Coleção comercial

Fonte:
Promoção
```

Resultado:

Todos os produtos atualmente associados à coleção `Promoção` podem aparecer automaticamente nessa seção.

---

Outro exemplo:

```text
Seção:
Cuidados Femininos

Tipo de fonte:
Categoria

Fonte:
Feminino
```

Resultado:

Produtos associados à categoria `Feminino` podem alimentar a seção.

---

# 11. Benefício operacional

Com seções dinâmicas:

```text
Produto entra na coleção "Promoção"
→ passa a ser elegível para aparecer nas seções que usam "Promoção"

Produto sai da coleção "Promoção"
→ deixa de ser elegível
```

A loja não precisa editar cada catálogo individualmente para manter campanhas básicas.

Isso reduz:

- manutenção;
- erros;
- retrabalho;
- risco de promoção desatualizada;
- necessidade de selecionar centenas de produtos manualmente.

---

# 12. Primeira versão das regras de seção

A primeira implementação deve ser simples.

Uma seção poderá usar **uma fonte principal**:

```text
Categoria X
```

ou:

```text
Coleção comercial Y
```

Não implementar inicialmente regras booleanas complexas.

---

# 13. Evolução futura das regras

A arquitetura não deve impedir evoluções como:

```text
Categoria = Feminino
E
Coleção = Promoção
```

Resultado:

> produtos femininos atualmente em promoção.

Outros exemplos futuros:

```text
Categoria = Higiene
E
Preço <= R$ 30
```

ou:

```text
Coleção = Promoção
E
Disponibilidade > 0
```

Essas regras combinadas pertencem a uma etapa posterior.

---

# 14. “Complete seu pedido” — evolução planejada

## Versão inicial

Fonte configurada manualmente pela loja:

```text
Seção:
Complete seu pedido

Fonte:
Coleção "Recomendados"
```

---

## Evolução futura

Relacionamento contextual:

```text
Cliente selecionou:
Fralda

Sugerir:
- Lenço umedecido
- Pomada
- Shampoo infantil
```

---

## Evolução mais avançada

Recomendações baseadas em comportamento real:

```text
Clientes que selecionam Produto X
frequentemente também selecionam Produto Y
```

Esse nível não faz parte da primeira implementação.

---

# 15. “Ofertas para você”

A seção de promoções deve poder ser controlada pela loja.

Exemplo:

```text
Seção:
Ofertas para você

Fonte:
Coleção "Promoção"
```

Isso permite utilizar o catálogo como ferramenta de exposição comercial e não apenas de consulta.

---

# 16. Campanhas comerciais futuras

Coleções poderão futuramente suportar metadados adicionais.

Exemplo conceitual:

```text
Coleção:
Semana da Beleza

Ativa de:
16/09/2026

Até:
22/09/2026
```

Possíveis evoluções:

- data de início;
- data de término;
- ativação automática;
- desativação automática;
- prioridade;
- banner;
- ordem de exibição;
- público-alvo;
- regras por catálogo.

Não implementar esses campos antes de fechar o contrato da primeira versão.

---

# 17. Cadastro e edição de produto

A futura interface de produto deverá considerar seleção múltipla.

Exemplo conceitual:

```text
PRODUTO
Nome: Shampoo X
Preço: R$ 29,90

Categorias:
[x] Feminino
[x] Cabelo
[ ] Infantil
[ ] Masculino

Coleções / grupos comerciais:
[x] Promoção
[x] Destaques
[ ] Novidades
[ ] Mais vendidos
```

A UX final será definida depois da auditoria do fluxo atual de cadastro.

---

# 18. Configuração de seções no catálogo

Exemplo conceitual:

```text
SEÇÃO 1

Título:
Ofertas para você

Tipo:
Coleção comercial

Origem:
Promoção
```

```text
SEÇÃO 2

Título:
Complete seus cuidados

Tipo:
Categoria

Origem:
Cabelo
```

A seção deve referenciar o grupo por ID estável.

---

# 19. Regras de segurança e integridade

As novas funcionalidades não devem mudar princípios já adotados no catálogo público:

- o cliente público não é autoridade sobre preço;
- o cliente público não é autoridade sobre estoque;
- o cliente público não é autoridade sobre identidade do produto;
- dados enviados pelo cliente devem continuar sendo revalidados no backend;
- nenhuma sugestão pode inserir produto automaticamente no pedido;
- totais devem continuar sendo calculados/validados pelo backend no envio da solicitação.

As seções comerciais alteram **descoberta e apresentação**, não a autoridade sobre os dados.

---

# 20. Considerações específicas para farmácias

Farmácias são um forte caso de uso inicial, mas exigem atenção especial.

Algumas categorias podem estar sujeitas a regras legais, sanitárias ou publicitárias específicas.

Portanto, futuramente será necessário avaliar:

- quais tipos de produtos podem ser destacados;
- quais podem ser promovidos;
- quais podem receber recomendações comerciais;
- restrições por categoria;
- restrições por tipo de medicamento;
- regras de publicidade aplicáveis.

A arquitetura deve permitir futuramente bloquear ou restringir determinados tipos de promoção/recomendação.

Não implementar regras regulatórias por suposição. Elas deverão ser pesquisadas e documentadas separadamente quando o escopo comercial para farmácias avançar.

---

# 21. Métricas futuras

Quando houver clientes reais, poderemos medir:

- seção exibida;
- produto recomendado exibido;
- produto recomendado clicado;
- produto recomendado adicionado;
- produto removido;
- taxa de adição após recomendação;
- ticket médio sem recomendação;
- ticket médio com recomendação;
- desempenho de cada coleção/campanha;
- conversão de catálogo em solicitação.

Esses eventos não fazem parte da primeira implementação desta arquitetura.

---

# 22. Migração e compatibilidade

O projeto ainda está majoritariamente com lojas e produtos de teste.

Isso cria uma janela favorável para rever o modelo antes da entrada de clientes reais.

Mesmo assim:

> **não assumir que podemos apagar ou transformar dados sem auditoria.**

Antes de qualquer mudança de schema:

1. mapear estrutura atual;
2. localizar todos os leitores/escritores;
3. identificar dependências no Flutter;
4. identificar dependências nas Cloud Functions;
5. mapear testes;
6. decidir estratégia de compatibilidade;
7. decidir se dados de teste serão migrados ou recriados;
8. criar testes de regressão;
9. implementar de forma incremental.

---

# 23. Auditoria obrigatória antes da implementação

A próxima etapa desta frente deve ser **somente leitura**.

Precisamos descobrir no código atual:

- como categorias são persistidas;
- se produto possui uma categoria, várias ou nenhuma;
- campos exatos usados atualmente;
- onde categorias são criadas;
- onde são editadas;
- onde são lidas;
- onde produtos são filtrados por categoria;
- como catálogo público usa categorias atualmente;
- dependências do cadastro/edição de produto;
- dependências no backend;
- testes existentes;
- regras Firestore relacionadas;
- necessidade ou não de migração.

Nenhuma decisão de schema deverá ser tratada como definitiva sem essa auditoria.

---

# 24. Bloco técnico proposto

Nome provisório:

```text
F7-CAT-TAXONOMIA
```

## Etapas

```text
A. Auditar modelo atual de categorias
B. Fechar contrato de múltiplas categorias
C. Fechar contrato de coleções comerciais
D. Fechar contrato de seções dinâmicas
E. Planejar compatibilidade/migração
F. Implementar modelo de dados
G. Adaptar cadastro e edição de produto
H. Adaptar gestão de categorias/coleções
I. Adaptar catálogo público
J. Criar área "Sua seleção"
K. Criar seções dinâmicas
L. Criar "Complete seu pedido"
M. Criar "Ofertas para você"
N. Testes backend
O. Testes Flutter
P. Validação visual
Q. Validação comercial
```

Esse bloco não substitui nem mistura responsabilidades com a F7.8 atual.

---

# 25. Relação com a F7.8

A F7.8 atual trata do fluxo:

```text
Cliente envia seleção
→ backend persiste solicitação
→ Store&Connect lista solicitações
→ Store&Connect abre detalhe
```

O trabalho de taxonomia/coleções/seções dinâmicas é uma evolução paralela do **catálogo público e da gestão de produtos**.

A recomendação é:

1. concluir a F7.8-D e fechar o fluxo interno já iniciado;
2. auditar a arquitetura atual de categorias;
3. só então iniciar alterações estruturais de taxonomia.

---

# 26. Não objetivos da primeira implementação

Não incluir inicialmente:

- IA de recomendação;
- recomendação baseada em comportamento histórico;
- regras booleanas complexas;
- campanhas automáticas por calendário;
- segmentação por cliente;
- personalização individual;
- criação automática de promoções;
- alteração automática de preço;
- reserva automática de estoque;
- inclusão automática de item no pedido;
- analytics avançado;
- regras regulatórias presumidas.

---

# 27. Critérios de sucesso da arquitetura

A arquitetura será considerada adequada se permitir:

- produto em múltiplas categorias;
- produto em múltiplas coleções comerciais;
- categoria e coleção como conceitos separados;
- seções alimentadas dinamicamente;
- manutenção sem selecionar produto por produto;
- renomear grupos sem alterar cada produto;
- reutilizar o mesmo grupo em diferentes catálogos;
- evoluir futuramente para filtros combinados;
- preservar segurança e validação do backend;
- suportar catálogos grandes;
- continuar compreensível para pequenos comerciantes.

---

# 28. Decisões já aceitas conceitualmente

Até o momento:

1. Um produto poderá ter múltiplas categorias.
2. Um produto poderá participar de múltiplos grupos/coleções comerciais.
3. `Promoção` é melhor tratada como coleção comercial do que como categoria permanente.
4. Categorias e coleções devem ter identificadores estáveis.
5. Seções do catálogo poderão usar categorias ou coleções como fonte.
6. A entrada/saída de produtos das seções deve ser dinâmica conforme associação.
7. Recomendações são opcionais.
8. Nenhum item adicional entra automaticamente na seleção do cliente.
9. A primeira versão deve ser simples.
10. Regras combinadas e recomendação inteligente ficam para evolução futura.

Essas decisões ainda precisam ser confrontadas com a auditoria do modelo atual antes de virar schema definitivo.

---

# 29. Questões ainda em aberto

A auditoria deverá ajudar a responder:

- categoria será coleção Firestore própria?
- coleção comercial será coleção Firestore própria?
- associações ficarão no produto ou em subcoleções?
- será necessário índice adicional?
- como ordenar categorias?
- como ordenar produtos dentro de uma seção?
- como tratar produto sem estoque?
- como tratar produto arquivado?
- como lidar com produto pertencente simultaneamente a várias seções?
- haverá limite de seções por catálogo?
- haverá limite de produtos por seção?
- uma seção poderá ter título e descrição customizados?
- loja poderá ocultar uma seção temporariamente?
- coleções serão por loja?
- coleções poderão ser reutilizadas em todos os catálogos da loja?
- campanhas futuras terão período de validade?
- como será feita a migração dos dados atuais?

Nenhuma dessas respostas deve ser inventada antes da auditoria técnica.

---

# 30. Próximo passo

**Próxima ação recomendada: auditoria técnica somente leitura do modelo atual de categorias/produtos.**

Objetivo:

> descobrir o que já existe antes de definir a estrutura final.

Depois da auditoria:

```text
modelo atual
→ riscos
→ alternativas
→ contrato
→ implementação incremental
```

---

# 31. Princípio de projeto

A regra para essa evolução será:

> **Desenhar para milhares de produtos, mas implementar primeiro a solução mais simples que preserve essa capacidade de crescimento.**
