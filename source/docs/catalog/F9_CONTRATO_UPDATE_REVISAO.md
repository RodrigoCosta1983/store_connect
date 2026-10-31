# F9 — revisão A3/A5 de create/update

Data: 14/10/2026. Revisão local; não representa liberação HML.

## Contrato existente e consumidores

createProduct recebe requestId, product e categoryIds. A importação chama
createProduct; não é consumidor de updateProduct. O único consumidor de
updateProduct encontrado em lib é o diálogo de ManageProductsScreen, através
de ProductUpdateService. Update compartilha a validação comercial de create,
mas rejeita taxonomia/arquivamento. Não é uma API de patch parcial.

| Campo/intenção | Semântica atual |
| --- | --- |
| name, price, quantidade, lotes, minimumStock, imageUrl | Obrigatórios. Omissão ou null rejeita antes de qualquer escrita. Update válido substitui os valores enviados. |
| quantidade=0, lotes=[] | Alteração explícita válida; zera estoque sem lotes. Não pode ser usada como representação de “não alterar”. |
| lotes não vazios | Quantidades positivas, validadeMs inteiro, soma igual à quantidade. Lista inteira é substituída. |
| cod omitido | Preserva COD atual e valida reserva. |
| cod vazio/espaços | Remove COD/libera reserva apenas de produto ativo consistente. |
| cod=null | Rejeita; não equivale a omissão/remoção. |
| barcode omitido ou string vazia | Normalizador não inclui a chave; barcode anterior permanece. Não há operação explícita de remoção neste contrato. |
| costPrice omitido | Preserva; zero explícito grava zero; null rejeita. |
| fiscal omitido | Preserva mapa inteiro, inclusive campos legados. |
| fiscal enviado | Substitui mapa inteiro com os campos fornecidos e updatedAt servidor. {} resulta apenas em updatedAt. null no mapa rejeita; valores internos string/null são aceitos e null explícito é gravado. |
| campos de primeiro nível não enviados, como histórico/createdAt | transaction.update preserva. Taxonomia e arquivamento não são aceitos no payload comercial. |

O writer anterior ao F9 já enviava quantidade/lotes completos e substituía o
mapa fiscal. O serializer F9 converte lotes para quantidade/validadeMs e omite
outros atributos: metadados extras de lotes legados não têm representação no
contrato atual e podem ser perdidos ao salvar. A UI também calcula quantidade
pela soma dos lotes e filtra lotes sem saldo. Isso não é “preservar sem alteração”.

## A3 — correção compatível aplicada

A primeira tentativa mantém pré-checagem de COD. Após gerar requestId para
uma chamada create/update, o retry pula essa consulta e chega ao backend,
que valida receipt antes de reavaliar reservas. Isso cobre resposta perdida
depois do commit e replay após uma operação posterior liberar/reocupar COD.
O ID não é regenerado para contornar conflito. URL de imagem já enviada é
reutilizado para a mesma seleção também em edição. Envio em andamento tem
guard local. request-id-reused recebe orientação explícita, preservando dados.

Mesmo ID com conteúdo normalizado diferente é rejeitado se existir receipt;
não cria outra operação. Se a tentativa anterior não gravou, uma nova tentativa
pode usar o mesmo ID e conteúdo corrigido. Timeout não prova ausência de commit.
Idempotência permanece limitada ao diálogo aberto: cancelar/fechar e abrir
outro diálogo gera outra tentativa, sem garantia de deduplicação entre diálogos.
COD opcional também não é uma chave de idempotência.

## A5 — diagnóstico confirmado; alteração de API interrompida

Payload incompleto não zera estoque nem apaga produto: é rejeitado. Omissões
opcionais de primeiro nível são preservadas. Entretanto:

1. Formulário completo e antigo pode sobrescrever estoque/lotes de uma venda
   ou de outro operador. Servidor valida tipos/soma, mas não recebe intenção
   de alteração nem baseline de estoque.
2. Mapa fiscal parcial substitui o mapa anterior e perde campos internos
   omitidos. Transformá-lo em merge mudaria a semântica existente de {} e de
   substituição. Metadados de lotes também exigem política própria.
3. setProductCategories, upload Storage e updateProduct são operações separadas.
   Categorias podem persistir quando a etapa comercial é rejeitada por COD.
   Idempotência de cada etapa não torna a edição inteira atômica.

As três condições foram reproduzidas no Emulator. Não foi aplicado merge
implícito, omissão automática de quantidade/lotes nem rollback compensatório.
Essas mudanças poderiam perder solicitações explícitas ou desfazer trabalho
concorrente. A5 permanece bloqueador alto de integridade para liberação.

## Proposta de contrato — depende de decisão antes da implementação

- Manter o contrato completo existente para consumidores atuais; desenhar
  versão/entrada explícita para edição comercial sem estoque. Ausência de
  estoque deve significar preservação no servidor, sem defaults de cliente.
- Alteração de estoque/lotes deve exigir intenção explícita e baseline
  validado na transação, ou operação própria de ajuste com replay. Estado
  divergente deve rejeitar sem escrita; não somar ou sobrescrever silenciosamente.
- Decidir se fiscal é substituição explícita ou patch por campos. No patch,
  diferenciar omitido, null, vazio e remoção, preservando desconhecidos/legados
  segundo política aprovada. Fazer o mesmo para metadados de lotes.
- Decidir se taxonomia e dados comerciais precisam de endpoint transacional
  único. Alternativamente, assumir etapas independentes com confirmação e
  resultado parcial explícitos; isso não oferece atomicidade global.
- Inventariar consumidores e manter compatibilidade de receipts/requestHash
  durante rollout. Não reinterpretar payloads completos antigos como patches.

Estimativa inicial: 2–4 dias úteis para intenção/baseline de estoque com rollout
compatível e testes; 3–6 adicionais se incluir atomização de taxonomia e nova
semântica fiscal/lotes. São estimativas sujeitas ao contrato escolhido.
