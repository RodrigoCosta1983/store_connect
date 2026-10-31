# F9/A5 — B07-A — contratos propostos de vendas

Data: 15/10/2026. Base: `F9_A5_B06_RESULTADO.txt` e código local atual.
Branch `feat/f7-intelligent-catalog`, HEAD `30f4f8db2a4a59d21696fde3d673144aded31154`.

**Status: PROPOSTA PARA REVISÃO. Nenhuma alternativa abaixo está automaticamente
aprovada. Não implementa confirmSaleV2, não migra writers, não altera Rules,
contratos B01–B05, permissões, configurações ou ambientes remotos.**

## 1. Caracterização e regra futura são coisas diferentes

Os testes novos executam os widgets/providers reais S01, S02, S06 e S07,
substituindo somente a plataforma Firestore por um fake local. S03 executa
o handler real no Firestore Emulator. O backlog usa o repository/Drift reais
em diretório temporário, seguido de leitura em conexão SQLite independente.
Não foram copiadas as fórmulas de parcelas, FIFO ou cascata para um writer de teste.

Expectativas `CURRENT DEFECT` preservam a evidência do legado; **não são critérios
de aceitação para o writer futuro**. Ao implementar uma versão aditiva, manter
esta caracterização ligada aos writers antigos e criar outra suíte para a nova
regra aprovada. Não alterar uma expectativa para ocultar mudança financeira.

Fontes principais: payment_options_sheet.dart, confirm_fiado_dialog.dart,
sales_provider.dart, cash_flow_provider.dart, syncOfflineSale.js,
offline_sales_repository.dart e app_database.dart. Referências detalhadas e
chamadores estão no B06; esta etapa não repete a auditoria global do F9.

## 2. Comportamento observado e diferenças de migração

| Fluxo | Atual caracterizado | Consequência para o contrato futuro |
| --- | --- | --- |
| S01 instantânea | Transação cliente baixa produto e grava venda paga; nome/preço vêm do carrinho, sem custo histórico, parcelas ou caixa | Backend deve preservar a intenção comercial e explicitar política de preço; não introduzir caixa silenciosamente |
| S01 retry | Perda de resposta após commit + callback do Snackbar gera outro ID, outra venda e outra baixa | Identidade precisa nascer e persistir antes da rede; retry não pode criar nova intenção |
| S01 FIFO | Consome por validade, mantém metadados/timestamp dos mapas remanescentes | Preserve os mapas lidos; não serialize lotes a partir da UI |
| S02 fiado | Batch grava parcelas, dueDate legado, isPaid=false e incrementa quantidade; sem leitura de saldo/FIFO | Autoridade de estoque deve mudar explicitamente, mantendo formato e plano financeiro aprovado |
| S02 retry | Resposta perdida do batch permite novo ID e nova dívida/baixa | Mesmo problema de identidade da venda instantânea |
| S02 R$ 100 / 3 | 33,33; 33,33; 33,34; residual na última | Divisão que distribui sobra nas primeiras parcelas não é paridade |
| S02 R$ 0,06 / 12 | Onze parcelas de 0,01; última -0,05 | Defeito atual comprovado; rejeitar plano inválido ou adotar outra divisão exige decisão explícita |
| S02 datas | 31/jan/2032 → 29/fev → 31/mar, com datas civis locais | Não somar durações fixas de 30 dias nem deslocar a data por UTC |
| S02 saldo | Aceita quantidade negativa e mantém lotes inalterados, no fake sem Rules | Batch atômico não prova validade do saldo; novo writer precisa revalidar e baixar lotes |
| S03 offline | Transação Admin, histórico de preço/data, isPaid=true, sem caixa/parcelas | Não redirecionar fiado para esse contrato |
| S03 replay | Mesmo ID retorna alreadyProcessed sem comparar payload; aceita documento legado sem localSaleId | Não fabricar receipt novo a partir de mera existência de sales |
| S03 permissões | Owner-only; assinatura inativa impede até replay existente | Matriz futura e consulta de confirmação precisam decisão própria |
| S03 lote duplicado | Duas linhas do mesmo produto podem registrar duas unidades e baixar só uma no lote | Rejeitar duplicatas antes de transacionar na versão nova |
| S03 dinheiro | Number coercivo; preço 1.005 normaliza para 1.00; total 1.01 pode ser rejeitado pela diferença binária >0.01 | Novo contrato deve usar centavos exatos; não assumir tolerância decimal ideal do legado |
| S06 recebimento | Cascata por dueDate; parcial/integral, paidAt ao quitar, resumos e uma entrada de caixa na mesma transação | Preservar alocação aprovada e dar identidade ao pagamento |
| S06 retry | Duas chamadas iguais podem abater duas vezes e gerar dois lançamentos | Não usar dívida restante como mecanismo de deduplicação |
| S07 legado | isPaid muda antes do caixa; falha no caixa deixa venda paga; nova chamada pode duplicar caixa | Quitação legada exige reconciliação e commit/identidade próprios |
| Backlog | Mesmo localId retém payload original por INSERT OR IGNORE, sem comparar conteúdo; não há uid/project_id | Não migrar contexto desconhecido usando a sessão atual |
| Reserva local | Mesmo productId em outra loja compartilha reservas na query atual | Novo storage/filtro deve ser por ambiente/conta/loja, com preservação dos registros antigos |
| Interrupção local | syncing → pending mantém ID/payload/createdAt e syncAttempts; banco persiste após fechar | Preservar esse conteúdo e o reconhecimento dos IDs existentes |

Limites da evidência: fake não aplica Rules, conflitos reais, retries automáticos
do SDK ou fila offline Firestore. O teste S01 chama o callback real do Snackbar,
não certifica hit-test físico no painel. FIFO S01 preserva o Timestamp em memória;
S03 compara com a fixture efetivamente persistida, pois Firestore/Emulator
armazenou frações em microssegundos. Não atribuir essa quantização ao writer.

## 3. Decisões explícitas pendentes

Todas as linhas D01–D14 precisam revisão/aprovação antes de implementar o
respectivo comportamento novo. Recomendações abaixo não são autorizações.

### D01 — autorização, loja, conta e projeto

Atual: updates de produto exigem role operacional nas Rules locais; S03 exige
ownerId; recebimentos/caixa têm permissões locais próprias de mesma loja.
O backend não pode aceitar role/storeId fornecidos pelo comando como autoridade.

Proposta: capturar escopo imutável `{projectId, uid, expectedStoreId}` antes de
persistir. A execução deve conferir app/projeto, auth atual, perfil/loja e
revogação dentro da transação. Não retargetar ao trocar conta/loja/projeto.
Asserções de escopo não concedem acesso; loja vem de vínculo confiável.

| Operação nova | Recomendação para revisão | Alternativa / risco |
| --- | --- | --- |
| Instantânea e fiado online | Owner com vínculo validado e roles admin/gerente/operador/caixa/vendedor não revogadas, mesma loja | Owner-only quebra funcionários que hoje vendem; copiar permissões amplas de sales ignora gate operacional de products |
| Backlog legado | Manter autorização histórica verificável, hoje owner-only em S03 | Ampliar automaticamente para todos os papéis pode atribuir venda a ator desconhecido |
| Nova venda offline | Autorizar separadamente por papel e evidência offline definida | Herdar automaticamente permissão online não comprova autorização no instante offline |
| Recebimento novo | Proposta conservadora owner/admin/gerente/caixa, sujeita à rotina aprovada | Permitir todos os operadores preserva mais alcance atual, mas aumenta poder financeiro; restringir pode interromper rotina legítima |
| Consulta/replay | Acesso vinculado a escopo/receipt/ator e matriz aprovada | Conhecer saleId não basta; impedir replay por assinatura posterior oculta confirmação legítima |

Nenhuma ampliação/restrição foi feita. Não confiar no comentário antigo de S03
sobre users editáveis: Rules locais atuais protegem role/storeId, mas não se
afirma aqui qual ruleset está publicado. Nova matriz requer testes próprios.

### D02 — identidade e unicidade

Recomendação: para novas vendas, uma identidade durável de intenção; preferir
`requestId = saleId` como aliases do mesmo valor, evitando mapeamento frágil.
Alternativa: IDs diferentes com relação imutável persistida e validada.
Backlog mantém exatamente localId/localSaleId original, sem renomear IDs.

Unicidade comercial é por loja/saleId, mesmo com dois atores ou protocolos.
Receipt inclui protocolo, ator, hash normalizado e resultado mínimo. Chave só
por uid permite colisão entre atores se saleId não for protegido também.
Mesmo ID/payload compatível: replay; mesmo ID divergente: conflito, zero baixa.
Não derivar identidade somente de produtos/valor: duas vendas iguais podem
ser negócios legítimos diferentes. Não compartilhar ID com cadastro/B05/pagamento.

### D03 — preço online sem repricing silencioso

Atual: preço mantido no carrinho pode diferir do cadastro, como a fixture 100
contra preço atual 999; a transação não revalida o preço.

Recomendação: online informar preço esperado, servidor validar a política e
retornar conflito de preço com revisão explícita; nunca trocar total no commit
sem consentimento. Alternativas: quote servidor estável por prazo aprovado;
ou aceitar preço do carrinho como condição comercial autorizada por papel.
Cada alternativa muda regras de validade, descontos e confiança. Não selecionar
uma por implementação. Quote não significa reserva de estoque.

### D04 — preço/tempo offline e custo histórico

Recomendação: preservar preço pactuado registrado, sem recalcular com cadastro
atual no sync. Validar finitude/faixa/total e origem/autoridade conforme decisão
offline. Alternativa: quote/lease previamente assinada, que exige arquitetura
e operação próprias; não está implementada nem presumida.
Relógio do aparelho registra occurredAt, não comprova instante criptográfico.
Separar occurredAt de committedAt servidor; não apagar a data histórica no replay.

CartItem e writers atuais não gravam custo histórico. Seguir F8: ausência não
é zero; nunca preencher custo antigo com costPrice atual. Introdução de snapshot
de custo para novas vendas exige contrato F8 próprio, sem backfill de legado.

### D05 — dinheiro, centavos, divisão e planos inválidos

Recomendação: versão nova recebe/normaliza inteiros seguros em centavos;
quantidades inteiras positivas; multiplicações/somas verificadas. Rejeitar
NaN, infinito, coerções textuais inesperadas e overflow. Replays legados não
recebem hash reinterpretado pela normalização nova.

Para planos válidos, preservar residual na última parcela. Proposta de cálculo
inteiro: arredondar `totalCents / count` para inteiro segundo regra explícita
de metade; parcelas iniciais iguais e última = total − soma anterior.
Isso produz 3333,3333,3334 para 10000/3, mas também pode gerar última inválida
em total pequeno: **validar positividade de TODAS as parcelas**.

Recomendação para planos inválidos: rejeitar e pedir número menor de parcelas.
Alternativa: divisão por piso e sobra distribuída, ou plano editável; ambas
mudam a distribuição financeira e precisam aprovação separada. Não manter
parcela negativa como “paridade” nem corrigir silenciosamente plano legado.
Escolher regra decimal para importação de preço com >2 casas; 1.005 em double
não equivale automaticamente a metade exata. Testar exemplos de fronteira.

### D06 — data civil, timezone e vencimento

Recomendação: intenção de calendário como YYYY-MM-DD mais timezone IANA da
loja aprovado. Brasil não implica timezone único para todas as lojas.
Cada vencimento mensal deriva da data inicial, limitado ao último dia do mês;
não deriva sucessivamente de fevereiro nem soma dias fixos.
Definir conversão para Timestamp de compatibilidade da UI (meia-noite local
ou outra convenção explicitamente aprovada) sem deslocar o dia civil.
Alternativa: congelar instantes UTC existentes, preservando vencimentos legados
exatos, sem reinterpretá-los como nova data civil. Ambas podem coexistir por versão.
Timezone não identificado no legado não deve ser inventado a partir do dispositivo
que reabre a operação. Datas presentes fora das folhas solicitadas permanecem exatas.

### D07 — estoque manual, FIFO e legado inválido

Nova venda deve reler todos os produtos na própria transação; é intenção de
consumir unidades atuais, não setManualQuantity nem patch cadastral.
Baixa+sales+receipt no mesmo commit. Não chamar ajuste B05 antes de criar sales.
Rejeitar duplicatas de productId e quantidade/total inseguros antes da execução.

Recomendação FIFO: manter política atual de consumir por validade e remover
esgotados, copiar mapas remanescentes, alterar só quantidade e conservar Timestamp
e metadados. Comparar timestamps sem truncar frações. Aprovar desempate estável
por índice original quando validades iguais. Isso não impõe o contrato editLots
de B05 às vendas: venda pode consumir/remover/reordenar conforme FIFO aprovado.

Recomendação para estado legado divergente/inválido: bloquear sem reparar.
Alternativa de compatibilidade permissiva mantém riscos atuais e exige contrato
específico; não aplicar clamps de cache como autoridade no servidor.
Archive: online novo deve ter política explícita de elegibilidade; backlog
anterior ao arquivamento precisa manter regra histórica aprovada e sua auditoria.
Não mudar S03 para sempre rejeitar arquivado nem usar relógio cliente como prova.

### D08 — fiado e compatibilidade do documento

Recomendação: modo `deferred` próprio, cliente validado da loja, plano aprovado,
isPaid=false inicial, paidAmount de parcela zero e paidAt=null. Campos atuais
installmentCount/installments/dueDate mantidos para leitores existentes.
Definir explicitamente presença de totalPaidAmount/paidAmount no documento novo;
ausência nos antigos continua suportada. Não transformar venda paga sem parcelas
em dívida por inferência do paymentMethod, ou vice-versa.

Decisão: servidor gera plano a partir de intenção e valida preview esperado,
ou recebe calendário congelado e valida cada parcela. Recomenda-se gerar plano
determinístico servidor, comparando os valores/datas que o usuário confirmou.
Não aceitar paidAt/isPaid/fiscal/cash_flow como efeitos finais do cliente.
Não habilitar fiado offline por este contrato: etapa própria se desejada.

### D09 — recebimento, cascata e caixa

Operação financeira separada, com paymentId e receipt próprios. Proposta:
valor inteiro em centavos, customerId, escopo e seleção/alocação esperada.
Atualizar dívidas+um lançamento de caixa+receipt no mesmo commit.
Uma venda pode ter vários recebimentos; saleId não é paymentId.
Venda nova não cria caixa automaticamente, pois S01/S02/S03 não o fazem hoje.

Preservar cascata, parciais, paidAt, resumos e mapas desconhecidos; aprovar
desempate por dueDate/saleId/número da parcela e comportamento quando dívida muda.
Recomendação: apresentar alocação e conferir versão/seleção na confirmação;
conflito exige revisão. Alternativa: usuário autoriza alocação dinâmica sobre
dívida atual, com semântica explícita. Não realocar retry antigo silenciosamente.

Replays independem de a dívida ainda existir. Evitar segunda entrada de caixa.
Manter shape de cash_flow atual ou revisar schema/Rules em etapa própria;
hasOnly das Rules não permite acrescentar paymentId cliente por conveniência.

### D10 — quitação e recibos legados

S07 está alcançável e não pode ser descartado como código morto. Recomenda-se
adapter futuro de quitação legada que confira pagamento/caixa verificáveis.
Documento isPaid=true sem caixa pode ser resultado parcial antigo, não prova
para inventar novo recebimento. Duplicidade/caixa incerto exige reconciliação
visível. Alternativa: manter rotina antiga até migração específica, deixando
o risco aberto e bloqueando fechamento genérico das permissões financeiras.
Nenhuma correção histórica, compensação ou escrita em dados reais é autorizada.

### D11 — backlog com contexto incompleto

Recomendação: filas/ledgers novos separados/versionados por projeto/uid/loja;
classificar linhas antigas sem apagar nem atribuir automaticamente ao login atual.
Conservar bytes de productsJson, localId, datas, status, tentativas e vínculo
serverSaleId. Reserva só no contexto comprovado. Linha ambígua fica suspensa
e visível, com motivo e caminho de reconciliação a aprovar.

Alternativas para contexto legado: recuperar evidência verificável da instalação
e confirmação servidor; ou confirmação operacional explícita sob procedimento
aprovado. Confirmação humana não transforma relógio/preço legado em prova técnica.
Não copiar linha para outro projeto, regenerar ID ou limpar failed/syncing.
No futuro, migração local deve ser transacional, retomável e testada sobre banco
antigo clonado sinteticamente. Esta etapa não migrou banco algum.

### D12 — resultado, retry, recuperação e ponte de protocolos

Proposta: API própria de resultado de venda, com comando/identidade e escopo
validados. Status confirmed, rejected definitivo, identity-conflict, ou
not-recorded não definitivo. Timeout não prova rollback. Persistir antes de
enviar e reutilizar ID, payload e política da tentativa; bloquear nova intenção
incompatível enquanto unknown. Consultar antes de retry; não trocar protocolo
de uma venda pendente sem ponte contratada.

Receipt compatível precede estoque/estado mutável, depois de auth/escopo atuais.
Replay não reescreve sales após recebimento ou NFC-e. Separar consulta/replay
de elegibilidade para nova venda é recomendação; S03 hoje bloqueia replay por
assinatura inativa, portanto alterar essa ordem exige aprovação.

Venda antiga sem hash: mera existência, inclusive sem localSaleId, não permite
criar receipt V2 retroativo. Alternativas: confirmação legada explícita quando
há evidência compatível, ou suspensão/reconciliação. Comparar sales atual inteiro
ao payload antigo é incorreto após alterações financeiras/fiscais legítimas.

Rejeição offline por insuficiência precisa decisão: terminal com revisão
operacional, ou pendência comercial tratada por política específica de backlog.
Não rejeitar definitivamente e depois reaplicar automaticamente após reposição.

### D13 — separação fiscal

Recomendação: confirmação comercial termina em venda+baixa+receipt; emissão
fiscal é etapa posterior com resultado próprio. Falha fiscal/refresh não desfaz
nem duplica venda. Manter identidade de referência fiscal e respeitar permissão
owner/plano/configuração atual até contrato próprio; não ampliar função fiscal
por efeito da matriz de vendas. Não prometer atomicidade com provedor externo.

### D14 — limites, escopo da próxima subetapa e corte

Proposta para discussão: teto inicial conservador de 100 produtos distintos,
1–12 parcelas, IDs até 128 caracteres, notas até 2048 caracteres e payload
canônico até 256 KiB; montantes/quantidades inteiros seguros com limite comercial
menor a definir. Valores são sugestões de contrato, não limites atuais do SDK
nem funcionalidades já aprovadas. Medir fixtures/carga antes de fixar o contrato.

Recomendação B07-B somente após decisões: núcleo aditivo local/Emulator,
inicialmente venda instantânea e consulta/receipt, sem seleção de UI ativa.
Parcelas, persistência/ponte e recebimentos têm subetapas próprias. Alternativa:
contratar todos os modos antes do núcleo, com maior escopo inicial e custo de teste.

Barreira, drenagem de writers antigos, gate V1 e Rules finais são etapas futuras.
Não negar products/sales/create/update indiscriminadamente enquanto houver
dependências de fiado/recebimentos. Nenhuma aprovação local autoriza ativação.
Auditoria global F9 continua reservada ao encerramento, antes de remoto.

## 4. Envelope ilustrativo e invariantes de compatibilidade

Nomes `confirmSaleV2`, `getSaleMutationResultV1`, `receiveCustomerDebtPaymentV1`
são ilustrativos. Não existem implementações novas nesta etapa.

```text
schemaVersion, requestId, saleId, expectedScope
origin: online | offline
saleKind: instant | deferred
items: [{productId, quantity, expectedUnitPriceCents}]
expectedTotalCents, paymentMethod, customerId?, notes
occurredAt?, installmentIntent?
```

Server é autoridade de autorização, baixa e invariantes; preço e calendário
seguem D03–D08 aprovadas, sem “servidor autoridade” como justificativa para
mudar valor pactuado. Snapshot da venda confirmada é histórico; resultado de
replay é mínimo, sem sobrescrever esse snapshot.

B01 não fornece snapshot multproduto; B02 não consulta vendas; B03 aceita
somente operações de produto. Reutilizar padrões de durabilidade é possível,
injetar sale no normalizador/namespace existente não é. Ledger/slot de venda
separados de B04/B05. Não alterar seus contratos para acomodar esta proposta.
Venda concorrente pode invalidar versão de ajuste B05; não atualizar o token
pendente automaticamente para forçar o ajuste antigo sobre saldo novo.

## 5. Aceitação futura e lacunas desta caracterização

Além dos testes atuais, nova implementação precisará: matriz de papéis completa,
troca de conta/projeto em voo, duas abas/processos, persistência durável Web/Android,
falhas em cada fronteira commit/receipt/local, Rules reais locais com Auth,
limites/carga, empates/nanos FIFO, calendários em timezones distintos, ponte
legada com dados incompletos, pagamento concorrente/seleção que muda, fila SDK,
rollback/contenção e integração fiscal simulada sem efeito externo.

Esta etapa não certifica Android físico, Chrome, rede Flutter→Functions,
Rules/roles financeiras pelo fake, timezone multirregião ou provedor fiscal.
Passar caracterização de defeito confirma o diagnóstico, não aprova o defeito.
Decisões D01–D14 permanecem pendentes da revisão de Rodrigo.
