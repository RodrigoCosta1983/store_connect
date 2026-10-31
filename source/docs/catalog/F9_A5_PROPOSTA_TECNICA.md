# F9 — proposta A5 e plano da alternativa B

Data: 14/10/2026. **PROPOSTA PARA APROVAÇÃO — NÃO IMPLEMENTADA.**
Branch: feat/f7-intelligent-catalog.
HEAD: 30f4f8db2a4a59d21696fde3d673144aded31154, preservado.

## 1. Base, conclusão e escopo

Lidos integralmente F9_AUDITORIA_FINAL.md, F9_HARDENING_PRE_DEPLOY.md,
F9_CONTINUACAO_VALIDACAO.md em build e docs/backups/F9_RESTORE_INTEGRIDADE.md.
Conferidos AGENTS/CURRENT_WORK, contratos/código atual, revisão A3/A5,
documentação de backup e regra F8 de preservação do custo histórico.
Os relatórios são históricos: as correções locais posteriores A1/A2/A3
permanecem válidas; A5 continua aberto. CURRENT_WORK não é baseline F9.

Recomendação: endpoint versionado de patch cadastral, com fiscal/categorias/
COD na mesma transação; ajuste de estoque separado; concorrência pela versão
real do documento; fechamento dos writers antigos no corte final.

Três causas confirmadas: snapshot antigo de estoque é reenviado pelo cadastro;
fiscal enviado substitui o mapa inteiro; categorias são persistidas antes de
upload/update comercial. Apenas colocar o snapshot antigo em transação não
corrige sua intenção. Nenhuma mudança incompatível está implementada aqui.

## 2. Contrato atual

updateProduct recebe requestId, productId e product. Loja deriva de users/uid;
roles admin/gerente/operador/caixa/vendedor, perfil não revogado e loja existente
são revalidados inclusive no replay. Campos desconhecidos, taxonomia e
arquivamento não são aceitos no payload comercial.

| Campo | Omitido | Null explícito | Valor enviado |
| --- | --- | --- | --- |
| name | Rejeita | Rejeita | Trim não vazio; deriva name_lowercase |
| price | Rejeita | Rejeita | Finito não negativo |
| quantidade | Rejeita | Rejeita | Inteiro seguro >=0; zero é alteração válida |
| lotes | Rejeita | Rejeita | Substitui lista; [] é válido |
| minimumStock | Rejeita | Rejeita | Inteiro seguro >=0 |
| imageUrl | Rejeita | Rejeita | String; vazio limpa referência |
| cod | Preserva e valida reserva | Rejeita | Trim/uppercase, até 40; vazio remove quando permitido |
| barcode | Preserva | Rejeita | Vazio normaliza para omissão; não remove |
| costPrice | Preserva | Rejeita | Finito >=0; zero explícito é zero |
| fiscal | Preserva mapa | Rejeita | Substitui mapa; {} deixa apenas updatedAt servidor |
| fiscal.campo permitido | Perdido se mapa enviado sem ele | Grava null | String |

Lotes exigem quantidade inteira positiva, validadeMs inteiro seguro convertível
em Timestamp; lista não vazia deve somar quantidade. Serializer não representa
metadados extras legados. transaction.update preserva outros campos de primeiro
nível omitidos. Não há intenção/baseline de estoque nem patch fiscal.

Produto/reservas/receipt confirmam na mesma transação. Receipt por operação/
loja/uid/requestId usa hash normalizado. Correspondência retorna replay antes
de reavaliar produto/reserva; conteúdo diferente rejeita request-id-reused.
COD arquivado é imutável, inclusive atribuição a arquivado sem COD. Reserva
ausente/inconsistente falha fechado; reserva legada válida não é migrada;
owner variant não é apropriado. Preservar essas garantias.

## 3. Inventário de consumidores e writers relacionados

Inventário estático do repositório, sem comprovação de clientes externos.

| Caminho | Papel | Mudança proposta |
| --- | --- | --- |
| lib/screens/management/manage_products_screen.dart | Único chamador de aplicação de ProductUpdateService; setProductCategories separado | Baseline autoritativo, dirty fields, cadastro/categorias juntos e ação Ajustar estoque separada |
| lib/services/product_update_service.dart | Único httpsCallable updateProduct em lib; buildProductUpdatePayload | Serializer V2 sem estoque; preservar presença/null/remove; serviço próprio de ajuste |
| functions/index.js | Export V1 | Adicionar endpoints versionados e gate de corte V1 |
| functions/products/updateProduct.js e updateProductContract.js | Handler/validador V1 | Preservar hash/receipts; rejeitar novos writes V1 no corte, sem reinterpretar |
| test/product_update_service_test.dart | Consumidor do serializer | Manter baseline V1 e acrescentar V2 |
| test/product_dialog_retry_test.dart | Diálogo com callable simulada | V2, conflitos, transação combinada e recovery |
| functions/tests/products/updateProductContract.test.js | Validador V1 | Preservar V1; testes V2 separados |
| functions/tests/products/productCodeAtomic.emulator.test.js | Chamadas updateProduct.run | V1/replay, equivalentes V2 e concorrência |
| functions/tests/products/updateProductIntegrity.emulator.test.js | Chamadas updateProduct.run | Preservar baseline; novas garantias V2 |
| build/f9-step2-a5-probes.cjs | Diagnóstico local, não produção | Preservar como evidência de risco V1 |

Importação usa createProduct, não updateProduct. Create continua definindo
estoque inicial e COD atomicamente; não convertê-lo em ajuste de existentes.

Dependências para garantir integridade:

- setProductCategories.js: endpoint isolado permanece para manutenção
  exclusivamente taxonômica, com baseline/projeção/D7 atuais. Extrair helper
  transacional reutilizável; V2 não chama outra callable na transação.
- functions/sales/syncOfflineSale.js: venda/baixa FIFO transacionais. Preservar
  idempotência, arquivados/offline, pagamentos e snapshots históricos.
- lib/widgets/payment_options_sheet.dart: venda online escreve produto/venda
  em transação cliente. CartScreen ainda referencia esse widget; não presumir
  caminho morto.
- lib/widgets/confirm_fiado_dialog.dart: batch de venda com decremento de
  quantidade, sem a mesma revalidação/FIFO do servidor. Chamado pelo fluxo
  anterior; deve entrar na paridade/migração antes de bloquear writes diretos.
- Archive/restore de produto: preservar proteções COD, distintos de backup.
  SalesProvider auditado escreve pagamentos/recebíveis, não estoque; não
  refatorar por A5.
- Rules permitem atualização operacional direta de produto. Endpoint novo
  sozinho não impede que writer antigo sobrescreva dados depois.

Antes de rollout em ambiente já utilizado, inventariar versões distribuídas
e consumidores externos; busca local não comprova sua ausência.

## 4. Contrato recomendado: cadastro V2

Nomes propostos, ainda inexistentes: getProductEditState, updateProductV2,
adjustProductStockV1 e getProductMutationResult. Endpoints separados não
reinterpretam payloads/hashes antigos. Loja nunca vem do cliente.

### 4.1 Leitura e concorrência

getProductEditState({productId}) retorna projeção explícita necessária à edição
e expectedUpdateTime={seconds: string decimal, nanoseconds: inteiro}, obtidos
do MESMO DocumentSnapshot Admin. Distinguir ausente de null; serializar tipos
sem perda, lotes na ordem persistida. Atributos desconhecidos ficam no servidor.

Token é snapshot.updateTime real, não updatedAt de negócio, DateTime local ou
contador opcional. Reconstruir Timestamp sem truncar para milissegundos.
Token não é autorização. Produtos legados já têm updateTime Firestore; não
precisam receber revisão/migração para participar.

### 4.2 Envelope e semântica

updateProductV2 recebe:

    {
      schemaVersion: 2,
      requestId: "identidade-estavel",
      productId: "produto",
      expectedUpdateTime: {seconds: "1791970000", nanoseconds: 123456000},
      changes: {
        set: {name: "Nome corrigido", price: 12.5},
        remove: ["barcode"],
        fiscal: {set: {ncm: "12345678", cest: null}, remove: []},
        categories: {ids: ["categoria"]}
      }
    }

Exemplo ilustrativo; não executar. Cinco campos de envelope obrigatórios.
requestId não vazio, máximo 128 caracteres. changes deve conter solicitação
não vazia. Rejeitar chaves desconhecidas, caminhos arbitrários, transforms,
duplicações e conflito set/remove. Bloco omitido significa preservar.

| Intenção | Semântica V2 |
| --- | --- |
| changes.set | Somente name, price, minimumStock, imageUrl, cod, barcode, costPrice; escrever somente presentes |
| changes.remove | Somente cod, barcode, costPrice; excluir explicitamente, sem atribuir zero/null |
| Campo omitido | Não escrever nem sintetizar default, incluindo legados desconhecidos |
| Null em set cadastral | Rejeitar; remoção só quando permitida via remove |
| name | Trim não vazio; name_lowercase somente quando name mudar |
| price/costPrice | Finito >=0; custo ausente é distinto de zero |
| minimumStock | Inteiro seguro >=0; configuração, não saldo |
| imageUrl | String; vazio limpa referência, não apaga arquivo |
| cod | String normalizada não vazia, até 40; vazio/null rejeitam; remoção via remove |
| barcode | String trim não vazia; remoção via remove |
| fiscal omitido | Preservar mapa inteiro e updatedAt |
| fiscal.set | Patch por folha permitida; preservar irmãos/legados desconhecidos |
| fiscal.set.campo=null | Gravar null explícito; não excluir |
| fiscal.remove | Excluir somente folhas permitidas; nunca mapa inteiro/updatedAt |
| fiscal:{} ou blocos vazios | No-op fiscal; não apagar nem atualizar timestamp |
| categories omitido | Preservar taxonomia |
| categories.ids=[] | Remover associações via projeção canônica existente |
| quantidade/lotes no cadastro | Rejeitar; exclusivos da operação de estoque |

Whitelist fiscal permanece a atual: ncm, origem, cfop, unidade, cest,
icmsSituacaoTributaria, pisSituacaoTributaria, cofinsSituacaoTributaria,
ibsCbsSituacaoTributaria, ibsCbsClassificacaoTributaria. Tipos string/null
atuais preservados; sem novo gate de assinatura na edição.

Usar FieldPath validado para folhas fiscais; não substituir mapa. updatedAt
servidor somente se houver alteração fiscal efetiva. Fiscal ausente pode
receber folhas; fiscal presente inválido/null bloqueia mudança fiscal com
invalid-current-fiscal, sem reparação silenciosa. Edição de outro campo não
precisa reconstruí-lo. Dados omitidos malformados não recebem defaults.
Exceção conservadora mantida: COD/reserva inconsistente continua bloqueando
update, mesmo omitido, conforme hardening atual.

Categorias: máximo dez, validação por loja, projeção legada e D7 atuais.
Ler categorias na mesma transação de cadastro. Nenhuma callable taxonômica
separada antecede o salvar combinado.

## 5. Transação, atomicidade e falhas

Ordem obrigatória:

1. Validar/normalizar comando; hash canônico inclui versão, baseline, presença,
   set/remove e ordem semântica das listas. Ausente/null/remove não colapsam.
2. Na transação, ler perfil/loja e validar autorização atual.
3. Ler receipt por versão/operação/loja/uid/requestId. Correspondente retorna
   resultado confirmado; hash diferente rejeita request-id-reused.
4. Sem receipt, ler produto e comparar updateTime exato. Divergência:
   aborted/product-version-conflict, zero writes.
5. Ler categorias, reservas/produtos exigidos pelo helper COD atual; concluir
   TODAS as leituras antes das escritas.
6. Gravar folhas solicitadas/derivadas, projeção taxonômica, reserva/liberação
   COD e receipt/auditoria numa transação.

Retry automático compara novamente o token ORIGINAL; nunca adotar token
recém-lido para reaplicar intenção antiga. Nenhum upload/efeito externo/UI
dentro do callback. Categoria válida + COD ocupado/fiscal inválido/conflito
deve resultar em zero alteração cadastral/taxonômica/reserva/receipt.

Token de documento é conservador: até venda ou edição não relacionada pode
invalidar cadastro. Aceitar conflito adicional de UX; revisão por domínio
seria otimização posterior, exigindo adesão de todos os writers.

Resultado: {success:true, productId, requestId, replayed, changed}. Receipt
guarda hash/versão/ator/resultado mínimo estável; não retorna snapshot antigo
como estado atual. Após sucesso, recarregar getProductEditState. Falha desse
refresh não desfaz confirmação nem autoriza repetir com ID novo.

Receipt precede baseline/estado mutável: replay após venda/edição/archive
posterior não reaplica nem desfaz trabalho. Namespace/hash V1 permanecem
intactos; V2 não herda ID de tentativa V1. Não expirar receipts sem política
de continuidade de idempotência aprovada.

Congelar payload e requestId antes do envio. Guard de simultaneidade e retry
do MESMO comando. Timeout/unavailable/resposta incompleta mantêm pendência;
não permitir mudar campos e iniciar outro ID enquanto resultado é desconhecido.
Conflito definitivo sem commit permite recarregar/revisar e iniciar nova ação
explicitamente; jamais retry silencioso com baseline novo.

getProductMutationResult({operation,requestId}) lê receipt autenticado da
própria loja/uid e retorna confirmed ou not-recorded, sem hashes/dados fiscais.
not-recorded não prova que uma chamada em curso não confirmará. Recuperar
pelo mesmo comando/ID; não criar uma operação substituta por esse resultado.

Para fechar/reabrir/reiniciar, registrar tentativa pendente localmente ANTES
de enviar, por ambiente/uid/loja/operação: ID, comando congelado, estado.
Adapter com armazenamento já disponível, privacidade e validação Web/Android;
não presumir durabilidade de shared_preferences. Falha de persistência impede
envio. Só concluir após confirmação; não reexecutar para outra conta/loja.
A escolha e validação do adapter é requisito da implementação, sem instalar
dependência nesta proposta. Perda de armazenamento local impede prometer
deduplicação de um novo ID; recuperar por receipt quando ID estiver disponível.

Storage não compartilha transação Firestore: upload antes do comando, objeto
por tentativa e referência reutilizada. Produto só referencia imagem no commit
com categorias/fiscal/COD. Falha de upload: zero escrita cadastral. Falha de
commit: possível arquivo órfão, produto intacto. Não apagar imagem antiga nem
compensar mudanças concorrentes. Limpeza de órfãos requer plano próprio e
prova de ausência de referência; atomicidade prometida limita-se ao Firestore.

## 6. Estoque, lotes e vendas

adjustProductStockV1 recebe schemaVersion:1, requestId, productId,
expectedUpdateTime, reason obrigatório e stockChange. Mesmas roles operacionais
atuais; loja derivada. Recomendação para aprovação: rejeitar ajuste de arquivado,
sem alterar política histórica de sincronização de venda offline de arquivado.

Operação escreve quantidade/lotes/receipt juntos; rejeita cadastro, fiscal,
categorias e COD no payload. Não escreve sales/cash_flow nem cria reserva.

| stockChange.kind | Contrato |
| --- | --- |
| setManualQuantity | quantity inteiro seguro >=0; só se lotes ausentes ou [] |
| editLots | operations não vazias sobre snapshot original, preservando metadados omitidos |
| convertToLots | lots não vazios, quantidade positiva/validade válida; conversão explícita manual→lotes |
| convertToManual | quantity explícita >=0, acknowledgement=true; aviso de remoção de lotes/metadados |

editLots: operações discriminadas update {index,set:{quantidade?,validadeMs?}},
remove {index} e add {quantidade,validadeMs}. Índices referem-se à ordem EXATA
do snapshot com expectedUpdateTime; resolver alvos antes de remover/reordenar,
sem índice duplicado. Token antigo rejeita, impedindo editar outro lote após
venda/reordenação. Não exigir ID de lote nem migrar arrays legados.

Update copia mapa ORIGINAL do servidor, muda apenas folhas solicitadas.
Quantidade zero explícita em lote existente preserva o lote; lote novo exige
quantidade positiva. Não filtrar/ordenar automaticamente ao salvar. Remoção de
todos os lotes exige convertToManual e saldo explícito. Derivar total no
servidor, soma inteira segura. Dados legados inválidos bloqueiam ajuste, sem
defaults/arredondamentos/validade fictícia; cadastro sem estoque os preserva.

Venda antes do ajuste invalida token; ajuste antes da venda faz venda reler
saldo novo. Dois ajustes distintos com baseline igual têm um vencedor.
Mesmo ID/receipt produz um efeito. Ajuste não chama venda nem altera histórico.

UI: Salvar cadastro e Ajustar estoque são ações com confirmação/resultado
próprios. Não executar dois comandos sob um único botão com sucesso global.
Se houver ambos pendentes, concluir uma ação ou descartar explicitamente antes
da outra. Create mantém estoque inicial junto do produto.

Venda continua baixando estoque atual/FIFO em transação própria. Preservar
metadados de lotes remanescentes e política atual de remoção de consumidos.
Cadastro não altera snapshots históricos de custo/preço, parcelas, caixa,
NFC-e ou lucro histórico. Migrar writers clientes exige paridade financeira:
não redirecionar fiado cegamente ao syncOfflineSale sem validar installments.

## 7. Incompatibilidades e estratégia de transição

| Mudança | Efeito incompatível se aplicada a V1 |
| --- | --- |
| Estoque proibido no cadastro | Payload completo atual rejeitado |
| Baseline obrigatório | Cliente atual não envia |
| Fiscal patch e {} no-op | Hoje substitui mapa e {} apaga irmãos |
| remove explícito | COD vazio hoje remove; barcode vazio hoje preserva |
| Categorias no cadastro | Hoje validador rejeita |
| Negar produto direto nas Rules | Quebra os dois writers clientes de venda sem migração |
| V1 sem novos writes | Cliente antigo deixa de editar; replay confirmado permanece |

Transição aditiva de API é possível; convivência indefinida de writers
inseguros NÃO satisfaz A5. Preservar V1 escrevendo ou Rules permissivas mantém
o risco mesmo com V2 correto.

Plano:

1. Implementar/testar endpoints V2/read/stock/result e clientes localmente;
   manter contrato/hash/receipts V1 para replay, sem mudar create à força.
2. Migrar os dois writers clientes de venda para autoridade backend com
   idempotência/paridade, reutilizando validadores quando compatíveis.
   Divergência financeira exige proposta própria antes de alteração.
3. Preparar corte coordenado sem writes: V1 verifica receipt antigo e aceita
   somente replay; tentativa nova rejeita failed-precondition com
   client-upgrade-required antes de produto/reserva. Sem defaults/adaptação
   semântica silenciosa. Testar cliente antigo recebendo erro explícito.
4. Rules finais negam TODA escrita direta de produto por cliente, inclusive
   quantidade/lotes/fiscal/cadastro; preservam leitura e demais coleções.
   Revisar permissivos sobrepostos; productCodes continua backend-only.
   Admin writers são controlados por handlers, não por Rules.
5. Publicação futura somente autorizada: janela, Rules completas/backend
   compatíveis, cliente por último, smoke tests e abertura. Não prometer
   continuidade de edição dos clientes antigos no corte.

HML inventariado anteriormente ainda não tem V1/dependências operacionais,
facilitando primeiro rollout. Isso não substitui inspeção anterior ao deploy.
Nenhuma operação PROD nesta etapa. Rollback mantém Rules/reservas, suspende
writes e usa pacote compatível, sem reabrir endpoint inseguro.

## 8. Implementação e testes A5 após aprovação

Incrementos: contratos puros e fixtures; helpers transacionais/endpoints;
UI/dirty fields/pendência/upload; migração/paridade das vendas e Rules; regressão
integrada e pacote de liberação. Sem refatoração geral de vendas/recebíveis.

| Grupo | Critérios obrigatórios |
| --- | --- |
| Patch | Nome/preço somente preservam estoque/lotes/createdAt/legados; omitido/null/remove distintos; zero explícito; unknown keys rejeitadas |
| Fiscal | ncm não remove cest/legado; null grava null; remove só folha; {} no-op; tipo inválido não reparado; timestamp só por alteração |
| Estoque | Venda 5→4 e ajuste antigo para 5 rejeita; venda posterior usa novo saldo; concorrência/negativos/overflow |
| Lotes | Metadados preservados, índice antigo rejeitado, soma/validade exata, zero/remove/conversão explícitos, legado inválido sem defaults |
| Atomicidade | Categoria válida+COD ocupado/fiscal inválido/token antigo: nenhum write; falha antes do commit também zero |
| COD | Create/V2 e V2/V2 concorrentes; omitido/troca/remove; arquivados/legados/reserva ausente/variant/lojas |
| Retry | Perda de resposta/timeout antes e depois, incompleta, replay após venda/archive/edição; hash diferente rejeita; duplo clique/restart |
| Segurança | Roles/revogação no replay, loja/IDs forjados, Rules diretas/matches genéricos, V1 novo bloqueado e receipt antigo preservado |
| Vendas | Dois caminhos migrados, online/offline/fiado/parcelas/FIFO; replay uma venda/baixa; custo histórico intacto |
| UI/Storage | Sem categoria parcial, imagem reutilizada, upload falho sem cadastro, refresh falho após sucesso não repete, conflito exige revisão |

Node syntax, contratos, Emulator COD/segurança/concorrência/restore, categorias
e catálogo; Flutter exclusivamente 3.32.6 indicado, --no-pub/--flavor hml,
analyze direcionado/geral e diff --check. Sem gravação remota. Falha legada
widget_test e baseline analyze continuam declarados até correção própria.

## 9. Restore: aplicação da alternativa B

### Backend

Manter bloqueio incondicional de QUALQUER materialização antes do primeiro
batch: MERGE/REPLACE, sem COD, settings, plano rehash adulterado e >800
operações. Sem bypass admin/flag cliente/retry/requestId novo/modo parcial.
Critério: zero commits de destino, todas as coleções/reservas intactas.

Executor atual é Emulator-only; não há callable de backup restore exportada.
Não criar/publicar executor remoto em B. R2A/R2B continuam contrato/autorização/
planejamento. restoreProduct é operação distinta e mantém proteções atuais.

RESTORE_EXECUTION_BLOCKED_INTEGRITY é terminal. Hoje flow converte em
EXECUTION_FAILED. Proposta compatível: manter status e acrescentar reason
allowlisted RESTORE_EXECUTION_BLOCKED_INTEGRITY e retryable:false apenas para
causa conhecida; atualizar contrato/result/testes explicitamente. Demais erros
continuam sanitizados, sem stack/payload arbitrário. No-op pode retornar zero
writes, sem anunciar recuperação realizada.

### Interface e outras funções

Em lib/screens/profile/profile_screen.dart, antes dos botões da seção admin
Backup e Recuperação, aviso legível Web/mobile/escala de texto:

> Restauração de backups temporariamente indisponível.
> Você pode criar cópias de segurança, mas elas ainda não podem ser restauradas
> pelo aplicativo. A restauração será liberada após validação de integridade.

Sem botão ativo/atalho para executor; não depender apenas de cor/tooltip.
Criar Backup Agora e preview de retenção continuam ações distintas, com
autorização e confirmação real de resultado. Não anunciar v1 como recuperação
completa: reservas e arquivos físicos não integram o snapshot.

Preservar exportações/downloads/relatórios existentes quando autorizados,
isolados por loja e sem escrita no destino. Não criar exportação nova nem
imprimir tokens. Parsing/transform/dry-run/verificação read-only permanecem,
mas plano não implica execução autorizada. Não alterar produtor/scheduler/
retenção nem habilitar exclusões automaticamente; preview não exclui.

HML anterior tem Storage/Functions de backup indisponíveis: preservar código
não os torna operacionais. Tratar erro honestamente, sem sucesso fictício,
enable de API/provisionamento/deploy incidental.

### Adaptação rastreável dos testes

Preservar logs/relatórios originais: 649 testes, 603 aprovados, 46 falhas;
34 bloqueios diretos e 12 expectativas de sucesso/fixtures/commits. Não
reescrever histórico como aprovado nem usar skip/expected-fail genérico.

1. Gerar manifesto a partir do log original: nome/arquivo de cada uma das 46
   falhas, causa, expectativa antiga, substituição e justificativa. Revisar
   item a item; baseline/cópia histórica continuam consultáveis.
2. Casos de execução passam a exigir bloqueio terminal, zero batch commits e
   estado/reservas intactos. Isso testa B, não recuperação segura implementada.
3. Verifier/result/parser que usavam restore só como preparação recebem
   fixtures sintéticas diretamente no Emulator por helper exclusivo de teste;
   manter suas assertions de integridade, sem bypass no executor testado.
4. Falhas intermediárias/chunks passam a provar que primeiro chunk não inicia.
   Registrar cobertura antiga de recovery parcial como pendência futura,
   sem declarar ramo inalcançável validado.
5. Acrescentar flow sanitizado/terminal, no-op, settings, origem/destino sem
   COD, reservas legacy/product/variant e UI sem ação restore.
6. Executar suite completa; publicar resultados NOVOS ao lado do baseline,
   com mapa das adaptações. Verde futuro significa contrato B, nunca
   autorização para reabilitar materialização.

### Recuperação transacional posterior

Etapa própria, fora da homologação F9 com B, com aprovação de:

- Snapshot versionado incluindo identidade de reservas e consistência temporal;
  v1 sequencial não é snapshot global.
- Estado final MERGE/REPLACE, ativos/arquivados, duplicidades, interpretação
  de reservas legadas sem migração implícita.
- Reconstrução product somente de origem confiável com validação completa;
  owner variant não é dedutível de products. Dados insuficientes bloqueiam;
  não criar writer/funcionalidade F10.
- Isolamento de TODOS os writers entre baseline/publicação: cliente e Admin
  (vendas/schedulers/etc.). Lock ignorado por writer não oferece garantia.
- Pequenos conjuntos: transação única com limites medidos; excedeu, rejeitar
  sem fallback para batches inseguros.
- Grandes conjuntos: staging/publicação/recovery e contrato de leitores/
  writers aprovado. Ponteiro só funciona se todos respeitarem geração.
- Idempotência/recovery e política de receipts após restore: auditLogs não
  integra v1; ignorar isso pode permitir repetir operações antigas.
- R1/R2/COD/lotes/vendas/referências/Storage, falhas antes/durante/depois,
  retries e limites. Preservar blockers fiscais/de referências existentes
  até política própria aprovada.

## 10. Riscos e ordem recomendada

Riscos restantes: custo/contenção da consulta completa de produtos no helper
COD; conflitos adicionais do token; legado malformado sem reparação; pendência
local perdida; arquivos órfãos; clientes externos desconhecidos; paridade de
vendas e indisponibilidade de clientes antigos no corte; recovery indisponível
em B; HML incompleto; baseline Flutter/analyze não totalmente verde.

Ordem:

1. Aprovar contrato: fiscal patch/null/remove, baseline, estoque separado,
   lotes/conversões, ajuste arquivado, corte V1 e migração necessária de vendas.
2. Aplicar B em etapa pequena: manter bloqueio, aviso UI, manifesto histórico
   e adaptações rastreáveis; validar sem reabilitar.
3. Implementar A5 incrementalmente conforme item 8; preservar A1/A2/A3/F9.1.
4. Concluir paridade vendas/Rules, testes de corte e rollback.
5. Revalidar HML read-only, preparar artefato/whitelist; infraestrutura exige
   etapa autorizada própria.
6. Somente após gates e autorização imediata: publicação coordenada e smoke
   tests sintéticos autorizados. Restore não é rollback de dados.

## 11. Fontes e validação desta etapa

Fontes primárias conferidas: transações são atômicas e podem repetir callback;
updateTime identifica versão real; patch por folha preserva irmãos. Endpoints,
token conservador e rollout acima são recomendações de engenharia para este
repositório, não exigências impostas pelo Firebase.

- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition
- https://firebase.google.com/docs/firestore/manage-data/add-data

Nesta etapa: auditoria estática/documental e criação apenas deste documento.
Testes de aplicação não repetidos porque não houve mudança de comportamento;
resultados anteriores não são apresentados como execução desta proposta.
Sem alteração de código/testes/Rules, commit, push, deploy, instalação,
restauração, escrita remota ou acesso PROD. Parada para aprovação do contrato,
conforme solicitado expressamente por Rodrigo.
