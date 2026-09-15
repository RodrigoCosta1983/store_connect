# Store&Connect — Contexto ativo do Codex

Atualizado em: 15/09/2026

Este arquivo registra onde o desenvolvimento está no momento.
O Git é sempre a autoridade sobre o HEAD atual.

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

Ela atualmente:

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

## Próxima etapa

F7.7-D — persistência segura da solicitação.

Antes de implementar:

1. auditar documentação e padrões existentes;
2. identificar estrutura apropriada para solicitação;
3. confirmar que não existe modelo equivalente já oficial;
4. não reutilizar `sales` automaticamente;
5. não reservar nem decrementar estoque;
6. definir quais valores validados pelo servidor devem ser congelados no
   momento da solicitação;
7. definir status inicial e timestamps;
8. considerar idempotência/duplicidade e concorrência.

Se o repositório/documentação não determinar de forma clara uma decisão
arquitetural necessária para a persistência, pare depois da auditoria e
apresente a decisão necessária a Rodrigo.

Não invente silenciosamente uma regra de negócio.

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