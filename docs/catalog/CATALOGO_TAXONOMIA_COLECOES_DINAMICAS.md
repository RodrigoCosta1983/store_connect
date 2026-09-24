# Store&Connect — Catálogo Inteligente
## Taxonomia, Coleções Comerciais e Seções Dinâmicas

**Status:** implementação parcial — **taxonomia de categorias/subcategorias implementada e validada**; **coleções comerciais e seções dinâmicas permanecem em backlog**
**Documento original:** 16/09/2026
**Última atualização:** 23/09/2026
**Objetivo:** registrar a arquitetura e o estado real da evolução do catálogo público, separando com clareza o que já foi implementado na taxonomia de produtos do que continua planejado para coleções comerciais, seções dinâmicas e recomendações.

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

# 2.1. Estado implementado em 23/09/2026

A arquitetura deixou de ser apenas proposta na parte de **taxonomia de categorias**.

Estado atual confirmado:

```text
TAXONOMIA DE CATEGORIAS
✅ categoryIds como associação canônica nos fluxos novos
✅ produto pode possuir zero, uma ou várias categorias/subcategorias
✅ limite operacional atual de até 10 associações por produto
✅ categoria raiz e subcategoria representadas na hierarquia atual
✅ associação por ID estável
✅ edição múltipla no cadastro/edição de produto
✅ criação de produto integrada à taxonomia
✅ importação de produtos integrada à taxonomia
✅ criação/edição segura de categorias via backend
✅ exclusão segura de categorias via backend
✅ compatibilidade com dados legados preservada nos pontos necessários
✅ validações backend/emulador e validações Flutter realizadas
✅ Functions de taxonomia publicadas

INTERFACE
✅ seleção independente de categorias e subcategorias
✅ contador de seleção até 10
✅ layout responsivo da lista no Editar Produto
   - mobile: 2 colunas
   - tela média/tablet: até 3 colunas conforme espaço
   - desktop/web: até 4 colunas conforme espaço
✅ validação visual realizada
✅ Web atualizada para 1.0.3+46

AINDA NÃO IMPLEMENTADO NESTA FRENTE
❌ collectionIds / coleções comerciais
❌ gestão de coleções comerciais
❌ seções dinâmicas alimentadas por coleção/categoria
❌ “Complete seu pedido” baseado em coleção/recomendação
❌ “Ofertas para você” baseado em coleção
❌ recomendações comportamentais/IA
```

As Cloud Functions atualmente envolvidas na taxonomia incluem:

```text
createProduct
setProductCategories
upsertCategory
deleteCategory
```

A publicação das alterações específicas de **Firestore Rules** preparadas para a taxonomia continua sendo uma etapa operacional separada e não deve ser presumida como concluída apenas porque as Functions e a interface já estão funcionando.

A referência `1.0.3+46` acima corresponde ao estado Flutter/Web validado nesta atualização e não deve ser interpretada, por si só, como confirmação de publicação do build `+46` na Play Store.

---

# 3. Experiência desejada no catálogo público

A seleção/resumo/envio básico do cliente já existe no fluxo atual do Catálogo Inteligente. A composição comercial abaixo continua sendo a visão planejada para integrar essa seleção às futuras seções de recomendação e oferta:

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

A arquitetura separa dois conceitos. A parte de **categorias** já possui implementação técnica; a parte de **coleções comerciais** continua conceitual/backlog.

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

# 7. Relação muitos-para-muitos — estado atual

A relação muitos-para-muitos já está implementada para **categorias**.

Um produto pode possuir de zero a várias associações de categoria/subcategoria dentro do limite operacional atual de 10 associações.

Exemplo atual:

```text
Produto: Shampoo X

categoryIds:
- cat_feminino
- cat_cabelo
```

Isso significa:

```text
um produto
→ pode pertencer a várias categorias/subcategorias

uma categoria/subcategoria
→ pode estar associada a vários produtos
```

A associação utiliza IDs estáveis, não o nome textual da categoria como identidade.

Para **coleções comerciais**, a mesma relação muitos-para-muitos continua sendo a direção arquitetural planejada, mas ainda não foi implementada.

Exemplo futuro:

```text
Produto: Shampoo X

Categorias — IMPLEMENTADO:
- Feminino
- Cabelo

Coleções comerciais — BACKLOG:
- Promoção
- Destaques
```

Portanto, a regra consolidada é:

> **Múltiplas categorias já fazem parte do modelo atual; múltiplas coleções comerciais permanecem no desenho futuro.**

---

# 8. Produto sem categoria — regra implementada

A cardinalidade da taxonomia atual permite `0..10` associações por produto.

Exemplos conceituais compatíveis com o contrato atual:

```text
Produto A
categoryIds: []

Produto B
categoryIds:
- cat_higiene

Produto C
categoryIds:
- cat_feminino
- cat_cabelo
- cat_higiene
```

Isso permite cadastrar ou manter um produto ainda não classificado sem bloquear o fluxo operacional.

A interface de edição exibe a quantidade selecionada em relação ao limite atual, por exemplo `1/10`, e impede ultrapassar 10 associações.

A obrigatoriedade futura de ao menos uma categoria, se algum dia for desejada, deverá ser tratada como uma mudança explícita de contrato — não é a regra atual.

---

# 9. Referências por ID, não por nome — implementado para categorias

A decisão arquitetural foi confirmada na implementação de categorias: produtos utilizam referências estáveis por ID.

Contrato canônico atual da taxonomia:

```text
categoryIds:
- cat_feminino
- cat_cabelo
```

O nome textual da categoria não é a identidade da associação.

Motivo:

Se a loja renomear:

```text
Feminino
```

para:

```text
Cuidados Femininos
```

a relação do produto continua apontando para o mesmo ID da categoria e não depende de regravar todos os produtos apenas por causa da alteração do nome.

A hierarquia atual também utiliza referência por ID para representar subcategorias através de `parentCategoryId`.

Para coleções comerciais, permanece planejado aplicar o mesmo princípio:

```text
collectionIds:
- col_promocao
- col_destaques
```

`collectionIds` ainda não faz parte do modelo implementado; é backlog arquitetural.

---

# 10. Seções dinâmicas do catálogo — backlog

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

# 14. “Complete seu pedido” — backlog / evolução planejada

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

# 15. “Ofertas para você” — backlog

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

# 16. Campanhas comerciais futuras — backlog

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

# 17. Cadastro e edição de produto — estado atual

A interface de produto já suporta **seleção múltipla de categorias e subcategorias**.

Estado implementado:

```text
PRODUTO
Nome: Shampoo X
Preço: R$ 29,90

Categorias / subcategorias:
[x] Feminino
[x] Cabelo
[ ] Infantil
[ ] Masculino

Limite atual:
0..10 associações
```

Regras preservadas na interface atual:

- categorias e subcategorias podem ser selecionadas de forma independente;
- o contador mostra a quantidade selecionada em relação ao limite de 10;
- a tentativa de ultrapassar 10 associações é bloqueada;
- associações indisponíveis são tratadas de forma explícita pela interface atual;
- a taxonomia canônica utiliza `categoryIds`;
- a compatibilidade com dados legados é tratada sem transformar o nome da categoria em identidade canônica.

## 17.1. Layout responsivo validado em 23/09/2026

A lista deixou de ser exclusivamente vertical e passou a distribuir as opções conforme a largura disponível:

```text
mobile / largura estreita
→ 2 colunas

tela média / tablet
→ até 3 colunas

desktop / web
→ até 4 colunas
```

O ajuste foi validado visualmente e faz parte da Web `1.0.3+46` publicada no Hosting.

## 17.2. Coleções comerciais

A segunda parte da interface originalmente imaginada continua em backlog:

```text
Coleções / grupos comerciais:
[x] Promoção
[x] Destaques
[ ] Novidades
[ ] Mais vendidos
```

Essa área só deverá ser implementada depois de fechado o contrato de coleções comerciais.

---

# 18. Configuração de seções no catálogo — backlog

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

# 22. Migração e compatibilidade — estado após implementação da taxonomia

A auditoria que era obrigatória antes da mudança de schema foi realizada para a frente de categorias, e a implementação adotou uma estratégia incremental de compatibilidade.

Estado atual:

```text
categoryIds
→ contrato canônico para múltiplas associações nos fluxos novos

categoryId / categoryName legados
→ não devem voltar a ser a autoridade do novo modelo
→ compatibilidade é preservada nos pontos de leitura/transição necessários
```

A implementação foi distribuída entre backend, Flutter, importação, gestão de categorias e testes, evitando uma conversão cega de toda a base.

Princípios que permanecem válidos para qualquer evolução futura:

1. mapear estrutura existente;
2. localizar todos os leitores e escritores;
3. identificar dependências Flutter;
4. identificar dependências nas Cloud Functions;
5. mapear testes e regras de segurança;
6. definir compatibilidade antes da escrita;
7. testar regressão;
8. implementar de forma incremental;
9. validar em runtime antes de considerar a etapa concluída.

Esses cuidados deverão ser repetidos quando a implementação avançar para `collectionIds`, coleções comerciais e seções dinâmicas.

---

# 23. Auditoria técnica — concluída para categorias

A auditoria somente leitura prevista na versão inicial deste documento já foi executada para a taxonomia de categorias/produtos.

Ela permitiu localizar e adaptar os principais pontos de leitura e escrita relacionados a:

- criação e edição de categorias;
- hierarquia por `parentCategoryId`;
- criação de produto;
- edição das associações do produto;
- importação de produtos;
- exclusão segura de categoria;
- compatibilidade com campos legados;
- testes backend/emulador;
- regras Firestore relacionadas;
- telas Flutter dependentes da taxonomia.

O resultado dessa auditoria levou ao contrato atual com `categoryIds` e às Functions dedicadas de taxonomia.

## Auditorias futuras ainda necessárias

Antes de implementar coleções comerciais e seções dinâmicas, uma nova auditoria deverá responder especificamente:

- onde `collectionIds` será persistido;
- como coleções serão criadas, editadas e removidas;
- como uma seção dinâmica resolverá produtos por categoria ou coleção;
- quais índices serão necessários;
- como o catálogo público receberá essas seções sem expor dados privados;
- como preço, estoque e arquivamento continuarão sendo revalidados;
- como compatibilizar catálogos já existentes.

Portanto, a regra continua sendo:

> **Não transformar uma ideia de backlog em schema definitivo sem auditoria do impacto real no código atual.**

---

# 24. Bloco técnico `F7-CAT-TAXONOMIA` — andamento

O bloco deixou de ser apenas proposto. A parte de **taxonomia de categorias** foi implementada; a parte de **coleções e seções dinâmicas** continua pendente.

## Etapas atualizadas

```text
✅ A. Auditar modelo atual de categorias
✅ B. Fechar contrato de múltiplas categorias
❌ C. Fechar contrato de coleções comerciais
❌ D. Fechar contrato de seções dinâmicas
✅ E. Planejar compatibilidade/migração da taxonomia de categorias
✅ F. Implementar modelo de dados de categorias/subcategorias
✅ G. Adaptar cadastro e edição de produto
🟡 H. Adaptar gestão de categorias/coleções
      ✅ categorias/subcategorias
      ❌ coleções comerciais
🟡 I. Adaptar catálogo público
      ✅ catálogo atual continua funcional com dados atuais
      ❌ seções dinâmicas por categoria/coleção
❌ J. Criar área comercial “Sua seleção” integrada às novas seções
❌ K. Criar seções dinâmicas
❌ L. Criar “Complete seu pedido” por coleção/recomendação
❌ M. Criar “Ofertas para você” por coleção
🟡 N. Testes backend
      ✅ taxonomia de categorias
      ❌ coleções/seções futuras
🟡 O. Testes Flutter
      ✅ taxonomia de categorias
      ❌ coleções/seções futuras
✅ P. Validação visual da taxonomia atual
❌ Q. Validação comercial das coleções/seções futuras
```

## Estado operacional da taxonomia

As Functions de taxonomia foram publicadas e a interface foi validada em runtime.

A publicação das alterações específicas de Firestore Rules preparadas para essa frente permanece uma pendência separada e requer seu próprio ciclo de autorização e validação.

Este bloco continua separado das responsabilidades de recebimento e tratamento das solicitações do catálogo.

---

# 25. Relação com a F7.8 — estado atualizado

Na versão inicial deste documento, a F7.8 ainda estava em desenvolvimento. Esse contexto mudou.

O fluxo operacional de solicitação do catálogo já avançou para:

```text
Cliente envia seleção
→ backend persiste solicitação
→ Store&Connect lista solicitações
→ Store&Connect abre detalhe
→ solicitação possui ciclo operacional de status
→ loja visualiza contador de solicitações abertas no Catálogo Inteligente
```

O catálogo público V2 também passou a solicitar os dados necessários definidos para o fluxo atual, incluindo nome e WhatsApp do cliente antes do envio da solicitação.

No Store&Connect, o contador operacional considera como abertas as solicitações com status:

```text
pending
in_progress
```

Solicitações `completed` e `cancelled` não entram nesse contador.

A taxonomia/coleções/seções dinâmicas continua sendo uma frente **paralela**: ela melhora classificação, descoberta e exposição comercial dos produtos, mas não substitui o fluxo F7 de criação, envio e atendimento das solicitações.

Regra de separação:

```text
F7 solicitação
→ captura e operação do pedido/solicitação do cliente

F7-CAT-TAXONOMIA
→ classificação e organização de produtos

coleções + seções futuras
→ descoberta comercial, promoção e recomendação opcional
```

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

# 27. Critérios de sucesso — progresso atual

## Já atendidos pela taxonomia de categorias

- produto em múltiplas categorias/subcategorias;
- associação por IDs estáveis;
- produto sem categoria permitido;
- limite operacional explícito de associações;
- cadastro, edição e importação integrados ao modelo;
- gestão segura de categorias;
- compatibilidade incremental com dados legados;
- interface compreensível em mobile, tablet e desktop/web;
- preservação da segurança e validação pelo backend.

## Ainda dependem de coleções/seções futuras

- produto em múltiplas coleções comerciais;
- categoria e coleção existindo como conceitos técnicos separados no modelo implementado;
- seções alimentadas dinamicamente;
- manutenção comercial sem selecionar produto por produto em cada catálogo;
- reutilização da mesma coleção em diferentes catálogos;
- regras combinadas de categoria + coleção + outros filtros;
- ordenação/priorização comercial de seções;
- recomendações contextuais ou comportamentais.

A arquitetura completa desta documentação só poderá ser considerada concluída quando a camada de coleções comerciais e seções dinâmicas também tiver contrato, implementação e validação próprios.

---

# 28. Decisões consolidadas e estado

Até 23/09/2026:

1. ✅ **Um produto pode ter múltiplas categorias/subcategorias.** Implementado por IDs canônicos.
2. ✅ **Produto sem categoria é permitido.** O contrato atual aceita zero associações.
3. ✅ **Existe limite operacional atual de até 10 associações de categoria/subcategoria por produto.**
4. ✅ **Categorias usam identificadores estáveis.** Renomear a categoria não deve redefinir a identidade da associação.
5. ✅ **A hierarquia atual usa `parentCategoryId` para representar a relação de subcategoria.**
6. ✅ **Cadastro, edição e importação foram adaptados à taxonomia atual.**
7. ✅ **A seleção de categorias/subcategorias é independente na interface atual.**
8. 🟡 **Um produto poderá participar de múltiplas coleções comerciais.** Decisão conceitual mantida, implementação pendente.
9. 🟡 **`Promoção` deve ser tratada como coleção comercial, não como categoria estrutural permanente.** Decisão conceitual mantida.
10. 🟡 **Seções do catálogo poderão usar categorias ou coleções como fonte.** Backlog.
11. 🟡 **A entrada/saída de produtos das seções deverá ser dinâmica conforme associação.** Backlog.
12. ✅ **Recomendações adicionais devem ser opcionais e nunca inserir produto automaticamente na seleção.** Regra arquitetural preservada.
13. ✅ **A primeira implementação deve permanecer simples e incremental.**
14. 🟡 **Regras combinadas e recomendação inteligente ficam para evolução futura.**

A distinção mais importante agora é:

```text
DECISÃO IMPLEMENTADA
→ categorias/subcategorias múltiplas

DECISÃO ARQUITETURAL AINDA EM BACKLOG
→ coleções comerciais + seções dinâmicas + recomendações
```

---

# 29. Questões resolvidas e questões ainda em aberto

## 29.1. Resolvido na implementação atual de categorias

```text
Onde ficam as categorias?
→ coleção de categorias da própria loja

Como o produto referencia categorias?
→ categoryIds

Nome é identificador?
→ não; associação usa ID estável

Como representar subcategoria?
→ relação hierárquica através de parentCategoryId

Produto pode ficar sem categoria?
→ sim

Produto pode ter várias categorias/subcategorias?
→ sim

Qual o limite operacional atual?
→ até 10 associações por produto

Como editar associações de produto existente?
→ fluxo seguro dedicado de taxonomia no backend
```

## 29.2. Ainda em aberto para coleções comerciais e seções dinâmicas

- coleção comercial será uma nova coleção Firestore por loja?
- o produto armazenará `collectionIds` diretamente ou haverá outra estrutura de associação?
- haverá índice adicional para resolver seções em escala?
- como ordenar produtos dentro de uma seção comercial?
- como tratar produto sem estoque em uma seção?
- como tratar produto arquivado em uma seção já configurada?
- como lidar com produto pertencente simultaneamente a várias seções?
- haverá limite de seções por catálogo?
- haverá limite de produtos por seção?
- uma seção poderá ter título e descrição customizados?
- a loja poderá ocultar uma seção temporariamente?
- coleções poderão ser reutilizadas em todos os catálogos da loja?
- campanhas terão período de validade?
- como será feita a compatibilidade dos catálogos já existentes?
- como a página pública receberá as seções sem ampliar indevidamente a superfície de dados públicos?

Nenhuma dessas respostas deve ser inventada antes da auditoria específica dessa próxima camada.

---

# 30. Próximo passo

A auditoria e a implementação da taxonomia básica de categorias já não são o próximo passo; essa parte está operacionalmente avançada.

A próxima etapa arquitetural desta documentação é:

> **definir e auditar o contrato de coleções comerciais antes de criar seções dinâmicas no catálogo público.**

Sequência recomendada:

```text
1. auditar impactos de collectionIds / associações comerciais
2. fechar contrato de coleção comercial
3. definir segurança e ciclo de vida da coleção
4. definir como uma seção dinâmica referencia categoria ou coleção
5. definir consulta, ordenação e limites
6. definir contrato público sanitizado dessas seções
7. criar testes backend
8. adaptar Flutter de gestão
9. adaptar catálogo público
10. validar visual e comercialmente
```

Pendência operacional separada da arquitetura de coleções:

```text
Firestore Rules da taxonomia
→ alterações preparadas/validadas localmente
→ publicação não deve ser presumida
→ eventual deploy exige autorização específica
```

O objetivo continua sendo avançar sem misturar a taxonomia já estável com uma implementação prematura de campanhas e recomendações.

---

# 31. Princípio de projeto

A regra para essa evolução será:

> **Desenhar para milhares de produtos, mas implementar primeiro a solução mais simples que preserve essa capacidade de crescimento.**
