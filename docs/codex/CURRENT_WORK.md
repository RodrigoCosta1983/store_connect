# Store&Connect — Contexto ativo do Codex

Atualizado em: 15/09/2026

Este arquivo registra onde o desenvolvimento está no momento.
O Git é sempre a autoridade sobre o HEAD atual.

## Estado atual — F7.8-C1

Esta seção prevalece sobre os registros históricos abaixo.
F7.7 concluída e validada em produção conforme informado por Rodrigo;
`submitPublicCatalogSelection` já está exportada no index.
F7.8-A auditada; contrato F7.8-B aprovado. F7.8-C1 implementa localmente
somente `listCatalogRequests`, exportada no módulo e no index, sem deploy.

- Autorização semanticamente igual a `listCatalogs`, sem bloqueio por assinatura.
- Entrada ausente, null ou objeto vazio; outros payloads são rejeitados.
- Leitura exclusiva dos 50 pais mais recentes por `createdAt DESC` em
  `stores/{storeId}/catalogRequests`, sem paginação ou enriquecimento.
- Resposta explícita com requestId e os oito campos persistidos do pai.
- Campos estruturais inválidos geram erro internal genérico; timestamps
  inválidos/ausentes retornam null. Documentos sem createdAt são omitidos
  pela ordenação do Firestore.
- Sem escrita, atualização de status, leitura de itens ou integração Flutter.
- Novo teste: `functions/tests/catalog/listCatalogRequests.emulator.test.js`.
- Validação: teste isolado aprovado; regressão oficial 8/8 no Emulator com
  JDK 21; checks de sintaxe Node e git diff --check aprovados.
- F7.8-C2 / getCatalogRequest não iniciada. Sem commit, push ou deploy nesta etapa.

## Branch

`feat/f7-intelligent-catalog`

Baseline antes da configuração do Codex:

`8176add feat(f7): validar submit publico do catalogo`

Naquele checkpoint:

- Local = Origin;
- Git limpo;
- nenhum deploy da nova Function;
- `submitPublicCatalogSelection` não estava exportada em
  `functions/index.js`.

## Projeto atual

F7 — Catálogo Inteligente e Compartilhamento de Produtos.

Etapas:

- F7.1 concluída — arquitetura/modelo;
- F7.2 concluída — backend seguro de criação;
- F7.3 concluída — seleção de produtos;
- F7.4 concluída — link público temporário;
- F7.5 concluída — página pública responsiva;
- F7.5-P implementação concluída, com auditorias específicas documentadas;
- F7.6 concluída — seleção pública de quantidades;
- F7.7 em andamento — resumo e envio;
- F7.8 pendente — recebimento interno;
- F7.9 pendente — expiração/bloqueio/retenção;
- F7.10 pendente — testes completos;
- F7.11 pendente — demo comercial.

## F7.7 já concluído

### A — contrato/auditoria

Concluído.

Contrato público definido:

cliente envia somente:

- `publicSlug`;
- `publicToken`;
- `items[{productId, quantity}]`.

Cliente não é autoridade para:

- storeId;
- catalogId;
- nome;
- preço;
- estoque;
- imagem;
- categoria;
- subtotal;
- total.

### B — resumo local

Concluído.

Inclui:

- resumo da seleção;
- total local;
- CTA mobile;
- cabeçalho compacto.

### C — validação segura do backend

Concluído e checkpointado em:

`8176add`

Function no módulo:

`submitPublicCatalogSelection`

Arquivo:

`functions/catalog/createCatalog.js`

No checkpoint C, ela:

- valida slug/token;
- limita seleção a `MAX_PRODUCTS = 200`;
- valida quantidade inteira positiva;
- bloqueia productId duplicado;
- resolve store/catalog pelo hash do token;
- confirma slug e hash;
- confirma assinatura permitida;
- confirma catálogo ativo e não expirado;
- confirma pertencimento do produto ao catálogo;
- reconsulta produto atual;
- bloqueia produto inexistente;
- bloqueia produto arquivado;
- reconsulta estoque atual;
- bloqueia quantidade indisponível;
- usa preço atual do servidor;
- NÃO persiste solicitação;
- NÃO reserva estoque;
- NÃO decrementa estoque.

Teste:

`functions/tests/catalog/submitPublicCatalogSelection.emulator.test.js`

Regressão validada:

`6/6`

## Estado proposital atual

`submitPublicCatalogSelection` está exportada pelo módulo
`functions/catalog/createCatalog.js`, mas ainda NÃO está exposta em
`functions/index.js`.

Portanto ela ainda não deve ser considerada publicada em produção.

Não adicionar ao `functions/index.js` e não fazer deploy até a etapa
correta e autorização explícita de Rodrigo.

## F7.7-D — persistência segura da solicitação

Concluída localmente, sem publicação da Function ou deploy.

- Coleção: `stores/{storeId}/catalogRequests/{requestId}`.
- Itens: subcoleção `items/{itemId}`; ambos os IDs gerados pelo Firestore.
- Pai: `catalogId`, `status: pending`, `itemCount`, `totalUnits`,
  `totalAmount`, `createdAt`, `updatedAt`, `source: public_catalog`.
- Timestamps gerados pelo servidor.
- Item: `productId`, `name`, `quantity`, `price`, `subtotal`.
- Nome e preço vêm do produto atual reconsultado pelo backend.
- Preço deve ser número finito não negativo; zero explícito é permitido.
  Nome vazio e preço ausente/inválido são rejeitados.
- Arredondamento unitário: `Math.round(price * 100)`, seguindo o padrão
  monetário existente. Subtotais e total são calculados em centavos;
  valores persistidos/retornados usam unidade monetária com duas casas.
  Quantidades, centavos e somas precisam permanecer em inteiros seguros.
- Gravação em batch atômico após revalidação: pai e todos os itens,
  ou nenhum deles. Sem alteração de estoque, lotes ou vendas.
- Retorno: `success`, `requestId`, `validatedItemCount`, `totalUnits`,
  `totalAmount`. Sem storeId/catalogId nem token público.
- Solicitação anônima, sem vínculo com customers, sem imagem ou título
  adicional no snapshot nesta etapa.

### Limitações preservadas

- Reenvios independentes podem criar novas solicitações; sem chave de
  idempotência. Prevenção de clique duplo fica para F7.7-E.
- Leituras e escrita não são uma transação conjunta: o snapshot registra
  disponibilidade observada, sem reserva ou garantia futura.
- Sem integração Flutter de envio, recebimento interno, transições de
  status, retenção ou limpeza.
- Function permanece fora de `functions/index.js`.
- Rules não alteradas. O repositório não fornece regras Firestore;
  a suíte com Admin SDK não comprova permissões de clientes diretos.
  A fonte oficial das rules continua pendente para auditoria de acesso.

### Validação

`npm run test:catalog` no Firestore Emulator com JDK 21: 6/6 arquivos.
Cobertura inclui snapshot atual, campos públicos forjados, contrato de
retorno, centavos, dados inválidos, limites numéricos, rollback de batch,
reenvios, limite de 200 itens e ausência de venda/alteração de estoque.
Checks de sintaxe Node e `git diff --check` aprovados.

## F7.7-E — integração Flutter do envio público

Implementação local concluída, sem publicação ou deploy.

- O resumo local existente oferece a ação Enviar.
- Usa `FirebaseFunctions.instance.httpsCallable`, com timeout de 30 segundos,
  seguindo o padrão existente da tela.
- Envia exclusivamente `publicSlug`, `publicToken` e
  `items[{productId, quantity}]`.
- O resumo mantém um snapshot estável durante sua abertura; refresh de
  lifecycle não altera a seleção por trás do diálogo.
- Envio em andamento bloqueia chamadas duplicadas, mostra Enviando e impede
  fechar o diálogo por Voltar/back. Nenhuma chave de idempotência foi criada.
- Sucesso exige confirmação do backend e requestId válido; fecha o resumo,
  limpa a seleção, sai do modo de seleção e confirma solicitação enviada.
  Não cria venda, não reserva e não reduz estoque.
- Erros transitórios ou resposta não confirmada preservam o resumo/seleção,
  mostram mensagem amigável e liberam nova tentativa.
- Erros estruturados de produto/estoque reconciliam a seleção antes do
  refresh existente. availableQuantity limita a quantidade; produtos
  inelegíveis são removidos da seleção. Se o refresh falhar, o ajuste
  conhecido pelo erro do servidor permanece.
- Erros de catálogo provocam refresh pelo caminho existente, que determina
  o estado público de catálogo expirado/inativo/indisponível.
- Backend, contrato F7.7-D e `functions/index.js` não foram alterados.

### Validação e limites

- `flutter analyze --no-pub lib/screens/public/public_catalog_screen.dart test/public_catalog_submission_test.dart`: sem problemas.
- `flutter test --no-pub test/public_catalog_submission_test.dart`: 15 testes passaram.
- Testes de widgets usam canal Firebase simulado, sem acesso a produção:
  payload, clique duplo, mobile/desktop, lifecycle, sucesso, retry,
  resposta incompleta, reconciliação com/sem refresh, catálogo indisponível
  e desmontagem durante chamada.
- `git diff --check` aprovado.
- A integração ainda não foi validada em dispositivo real com Function
  publicada. `submitPublicCatalogSelection` permanece fora do index.
- Reenvios após resposta perdida ainda podem duplicar solicitações:
  a proteção desta etapa cobre somente chamadas simultâneas.
- F7.8, recebimento interno e deploy não iniciados.

## Próxima etapa

F7.8 — recebimento interno, pendente de nova autorização.

Parada obrigatória após F7.7-E, conforme instrução de Rodrigo.
Não iniciar F7.8 nem publicar a Function automaticamente.
Não fazer deploy e não tocar produção.

## Fluxo desejado

Enquanto a próxima ação estiver definida:

auditar
-> implementar pequena etapa
-> testar
-> corrigir se necessário
-> validar diff
-> commit
-> push
-> avançar.

Rodrigo deve ser interrompido apenas nos gates definidos em `AGENTS.md`.

## Documentação de referência

Ler principalmente:

`docs/catalog/F7_CATALOGO_INTELIGENTE.md`

Também respeitar documentação financeira e demais documentos quando a
alteração tocar suas respectivas áreas.

Não atualizar documentos históricos de outras fases sem necessidade.
