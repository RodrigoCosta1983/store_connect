# 💾 F5 — BACKUP E RECUPERAÇÃO

Documentação oficial da arquitetura de backup, retenção e recuperação do Store&Connect.

> Este documento registra decisões arquiteturais da F5.
> Alterações nas regras de backup devem ser refletidas aqui.

=====================================================================

# 📌 STATUS DA F5

```text
✅ F5.1 — Definir modelo do snapshot
✅ F5.2 — Definir política de criação
✅ F5.3 — Criar snapshot no backend
✅ F5.4 — Auditoria do backup
✅ F5.5 — Automação diária

🟡 F5.6 — Política de retenção automática

⏳ F5.7 — Tela de backups
⏳ F5.8 — Estratégia de restauração
⏳ F5.9 — Restore pelo backend
⏳ F5.10 — Backup físico de arquivos Storage
⏳ F5.11 — Testes de recuperação
⏳ F5.12 — Backup redundante externo
⏳ F5.13 — Disaster Recovery
```

=====================================================================

# 🏗️ ARQUITETURA ATUAL

## Metadata

Firestore:

```text
storeBackups/{storeId}/snapshots/{backupId}
```

## Controle do backup automático diário

```text
storeBackups/{storeId}/dailyRuns/{dateKey}
```

## Arquivo físico do snapshot

Firebase Storage:

```text
store_backups/{storeId}/{backupId}/snapshot.json.gz
```

=====================================================================

# ⏰ BACKUP AUTOMÁTICO

## Horário oficial

```text
03:00
America/Sao_Paulo
```

## Fluxo

```text
03:00
  ↓
localiza lojas
  ↓
reserva loja + data
  ↓
reserva backupId
  ↓
cria snapshot
  ↓
Storage
+ metadata Firestore
+ auditLog
+ dailyRun
```

## Proteção contra duplicidade

```text
MESMA LOJA
+
MESMA DATA
        ↓
MESMO backupId
        ↓
NÃO CRIA OUTRO SNAPSHOT
```

A idempotência foi validada em produção em **05/09/2026**.

### Teste realizado — 1ª execução

```text
totalStores: 9
successCount: 9
failureCount: 0
skippedCount: 0
```

### Segunda execução no mesmo dia

```text
totalStores: 9
successCount: 0
failureCount: 0
skippedCount: 9
```

### Resultado

```text
✅ Nenhum backup duplicado
```

=====================================================================

# 🟡 F5.6 — POLÍTICA DE RETENÇÃO AUTOMÁTICA

## 🎯 Objetivo

Evitar crescimento indefinido dos backups automáticos, mantendo histórico suficiente para recuperação.

=====================================================================

## 🟦 CARD — BACKUPS DIÁRIOS

```text
┌─────────────────────────────────────────────┐
│ 📅 BACKUPS DIÁRIOS                          │
│                                             │
│ Manter: 7                                   │
│                                             │
│ Regra:                                      │
│ manter os 7 backups automáticos             │
│ mais recentes da loja.                      │
└─────────────────────────────────────────────┘
```

## 🟨 CARD — BACKUPS SEMANAIS

```text
┌─────────────────────────────────────────────┐
│ 📆 BACKUPS SEMANAIS                         │
│                                             │
│ Manter: 4                                   │
│                                             │
│ Depois da faixa diária, manter              │
│ 1 backup representativo por semana          │
│ durante 4 semanas.                          │
└─────────────────────────────────────────────┘
```

O backup escolhido será o mais recente disponível dentro daquela semana.

## 🟪 CARD — BACKUPS MENSAIS

```text
┌─────────────────────────────────────────────┐
│ 🗓️ BACKUPS MENSAIS                         │
│                                             │
│ Manter: 6                                   │
│                                             │
│ Depois da faixa semanal, manter             │
│ 1 backup representativo por mês             │
│ durante 6 meses.                            │
└─────────────────────────────────────────────┘
```

O backup escolhido será o mais recente disponível dentro daquele mês.

=====================================================================

# 📚 VISÃO DA RETENÇÃO

```text
HOJE
 ↓

[ D ][ D ][ D ][ D ][ D ][ D ][ D ]
               7 DIÁRIOS

                 ↓

[ W ][ W ][ W ][ W ]
       4 SEMANAIS

                 ↓

[ M ][ M ][ M ][ M ][ M ][ M ]
            6 MENSAIS
```

Máximo aproximado:

```text
7 + 4 + 6 = 17 backups automáticos por loja
```

=====================================================================

# 🛡️ BACKUPS PROTEGIDOS

A retenção automática somente poderá considerar:

```text
type = "automatic"
status = "ready"
```

Não poderão ser apagados automaticamente:

```text
✅ backups manuais

✅ backups cujo status não seja "ready"

✅ auditLogs

✅ dailyRuns

✅ futuros backups marcados como protegidos

✅ futuros backups gerados antes de operações críticas
```

=====================================================================

# ⚠️ PRINCÍPIO DE SEGURANÇA DA RETENÇÃO

A rotina nunca começará apagando arquivos.

Fluxo obrigatório:

```text
ler backups
     ↓
calcular KEEP
     ↓
calcular DELETE
     ↓
validar novamente
     ↓
somente então excluir
```

=====================================================================

# 🧪 DRY RUN OBRIGATÓRIO

A primeira versão da retenção deverá funcionar em:

```text
dryRun = true
```

Nesse modo:

```text
✅ calcula backups mantidos

✅ calcula candidatos à exclusão

✅ gera logs

❌ NÃO remove Firestore

❌ NÃO remove Storage
```

Somente após validação real dos resultados a exclusão será habilitada.




=====================================================================

# 🌎 TIMEZONE OFICIAL

Todas as decisões de dia, semana e mês devem usar:

```text
America/Sao_Paulo
```

Nunca depender do timezone padrão do servidor.

=====================================================================

=====================================================================

# 🧪 VALIDAÇÃO DO MOTOR DE RETENÇÃO

Motor testado localmente em **05/09/2026** com dados simulados.

```text
eligible: 25

KEEP
├── daily:   7
├── weekly:  4
└── monthly: 6

keepTotal: 17

deleteCandidates: 8
```

## Caso de borda validado

```text
06/09/2026
→ selecionado como WEEKLY

05/09/2026
→ pertence à mesma semana ISO
→ NÃO pode ser selecionado como MONTHLY
→ candidato à exclusão
```

Resultado final:

```text
✅ TODOS OS TESTES DE RETENÇÃO PASSARAM
```

Nenhum dado real do Firebase foi alterado durante este teste.

=====================================================================

# ✅ F5.6 — VALIDAÇÃO REAL DO DRY RUN EM PRODUÇÃO

## Primeiro dry run real

Data da validação:

```text
05/09/2026
```

A política de retenção foi executada pela primeira vez utilizando
os snapshots reais de uma loja em produção.

A execução ocorreu através da Cloud Function:

```text
previewBackupRetention
```

## Fluxo validado

```text
Flutter autenticado como Admin
        ↓
previewBackupRetention
        ↓
validação Firebase Auth
        ↓
validação users/{uid}
        ↓
role == admin
        ↓
validação storeId
        ↓
leitura dos snapshots reais
        ↓
backupRetention.js
        ↓
DRY RUN
```

Nenhuma operação de exclusão faz parte desse fluxo.

## 📊 Resultado real

Loja utilizada na validação:

```text
storeId:
KYTgLo1elkQ2T0cIBrik
```

Resultado:

```text
totalSnapshots:       4

eligible:             1

KEEP
├── daily:            1
├── weekly:           0
└── monthly:          0

keepTotal:            1

deleteCandidates:     0
```

Snapshot automático classificado como DAILY:

```text
backupId:
6gcsmJRhzJGreldnLtu8

data:
05/09/2026

week:
2026-W36

month:
2026-09
```

O resultado é esperado porque a política de retenção considera
automaticamente somente snapshots com:

```text
type == automatic
status == ready
```

Os outros snapshots encontrados permanecem fora do motor de retenção
quando não atendem aos critérios de elegibilidade.

## 🛡️ Segurança validada

Durante o teste real:

```text
✅ Firebase Auth validado
✅ usuário real consultado no Firestore
✅ acesso restrito a role == admin
✅ vínculo entre usuário e loja validado
✅ snapshots reais lidos do Firestore
✅ política de retenção executada
✅ resposta marcada como dryRun == true
✅ nenhum documento Firestore foi excluído
✅ nenhum arquivo do Storage foi excluído
✅ nenhum dailyRun foi alterado
✅ nenhum auditLog foi alterado
```

## 🧪 Cobertura dos testes

A validação da retenção passa agora por duas camadas:

```text
1. TESTE SIMULADO
   ↓
   25 snapshots fictícios

   ✅ 7 DAILY
   ✅ 4 WEEKLY
   ✅ 6 MONTHLY
   ✅ DELETE CANDIDATES
   ✅ backups manuais protegidos
   ✅ backups não-ready protegidos
   ✅ caso de borda da mesma semana


2. DRY RUN REAL
   ↓
   snapshots reais do Firestore

   ✅ autenticação
   ✅ autorização
   ✅ leitura real
   ✅ classificação DAILY
   ✅ retorno seguro
   ✅ zero exclusões
```

O ambiente real ainda não possui histórico automático suficiente para
validar naturalmente as faixas:

```text
WEEKLY
MONTHLY
DELETE CANDIDATES
```

Essas regras já foram validadas através dos testes simulados e deverão
continuar sendo observadas conforme o histórico real de backups crescer.

## ⚠️ App Check

Durante o teste foi observado novamente aviso de App Check no ambiente
Android de desenvolvimento:

```text
403
App attestation failed
```

Esse aviso NÃO bloqueou a execução da Cloud Function:

```text
previewBackupRetention
```

A chamada autenticada chegou ao backend e o resultado do dry run foi
retornado corretamente.

O ajuste do App Check deve ser tratado separadamente da política de
retenção e não altera o resultado desta validação.

## ✅ Estado após esta validação

```text
F5.6-A
✅ Política de retenção definida e documentada

F5.6-B1
✅ Motor puro de retenção

F5.6-B2
✅ Testes simulados

F5.6-B3
✅ Leitura segura dos snapshots reais

F5.6-B4
✅ Primeiro dry run real em produção

F5.6-C1
✅ Scheduler de retenção em dry run criado

F5.6-C2
✅ Sintaxe validada

F5.6-C3
✅ Revisão de segurança aprovada

F5.6-C4
✅ Export no index.js

F5.6-C5
✅ Carregamento local validado

F5.6-C6
✅ Deploy concluído

F5.6-C7
✅ Primeira execução controlada via Cloud Scheduler

F5.6-C8
✅ Execução natural das 04:00 observada em produção

F5.6-D1
✅ Camada lógica de autorização para futura exclusão

F5.6-D2
✅ Travas integradas ao scheduler em DRY RUN
✅ Classificação ALLOWED / BLOCKED
✅ Validação controlada em produção

F5.6-D3-A
✅ Protocolo geral da exclusão segura e resumível

F5.6-D3-B
✅ Schema de retentionDeletes + máquina de estados

F5.6-D3-C
✅ Desenho da transação atômica de CLAIM

F5.6-D3-D
⏳ Próxima etapa: Pure Claim Planner + testes

RETENÇÃO COM EXCLUSÃO REAL
⏳ NÃO IMPLEMENTADA
```

Nenhum backup real foi removido durante estas etapas.

=====================================================================

# ✅ F5.6 — RETENÇÃO AUTOMÁTICA EM DRY RUN

## Scheduler oficial

A rotina automática de retenção foi implantada como Cloud Function agendada:

```text
scheduledBackupRetention
```

Agendamento:

```text
04:00
America/Sao_Paulo
```

A ordem operacional diária fica:

```text
02:00 → checkOverdueSubscriptions

03:00 → syncAsaasSubscriptionPrices
03:00 → scheduledStoreBackups

04:00 → scheduledBackupRetention
```

A retenção roda uma hora após o backup automático para evitar concorrência
entre a criação do snapshot e a análise da política de retenção.

## 🛡️ Modo operacional atual

A rotina continua obrigatoriamente em:

```text
dryRun = true
```

Ela pode:

```text
✅ localizar todas as lojas
✅ ler metadata dos snapshots
✅ executar backupRetention.js
✅ calcular DAILY
✅ calcular WEEKLY
✅ calcular MONTHLY
✅ calcular DELETE CANDIDATES
✅ registrar resultados nos logs
```

Ela ainda NÃO pode:

```text
❌ excluir metadata do Firestore
❌ excluir arquivos do Firebase Storage
❌ alterar snapshots
❌ alterar dailyRuns
❌ alterar auditLogs
❌ criar backups
```

## 🧪 Primeira execução controlada em produção

Data da validação:

```text
05/09/2026
```

A execução foi disparada manualmente através do próprio Cloud Scheduler
para validar o fluxo real antes de depender apenas do horário automático.

Importante:

```text
✅ o Scheduler está configurado e ENABLED para 04:00
✅ esta validação foi uma execução controlada/manual do job
⏳ a execução espontânea das 04:00 ainda será apenas observada naturalmente
```

Resultado global:

```text
totalStores:              9
successCount:             9
failureCount:             0
totalEligible:            9
totalDeleteCandidates:    0
```

Resultado:

```text
✅ 9 de 9 lojas processadas
✅ nenhuma falha
✅ 9 backups automáticos elegíveis
✅ nenhum candidato à exclusão
✅ nenhum backup removido
```

## Loja principal — conferência

Para a loja:

```text
KYTgLo1elkQ2T0cIBrik
```

o scheduler encontrou:

```text
totalSnapshots:      4
eligible:            1

KEEP
├── daily:           1
├── weekly:          0
└── monthly:         0

keepTotal:           1
deleteCandidates:    0
```

Esse resultado coincidiu com o dry run individual executado anteriormente
pela Cloud Function `previewBackupRetention`.

## ✅ Validação da automação

```text
✅ Scheduler criado
✅ schedule 0 4 * * *
✅ timezone America/Sao_Paulo
✅ estado ENABLED
✅ leitura das 9 lojas
✅ 9 execuções bem-sucedidas
✅ 0 falhas
✅ dryRun confirmado
✅ nenhuma escrita de retenção
✅ nenhuma exclusão
```

Após essa validação, a F5.6 avançou para as etapas D1 e D2,
adicionando travas fail closed e integrando a classificação
ALLOWED / BLOCKED ao scheduler, ainda sem qualquer exclusão real.

## ✅ Execução natural das 04:00 observada

Além da execução controlada, foi posteriormente confirmada uma execução
natural do scheduler no horário oficial de:

```text
04:00
America/Sao_Paulo
```

Nos logs da execução automática foram confirmados:

```text
totalStores: 9
successCount: 9
failureCount: 0
totalEligible: 18
totalDeleteCandidates: 0
```

Essa execução ocorreu antes do deploy da F5.6-D2 e, por isso, ainda não
possuía os novos contadores ALLOWED / BLOCKED.

Mesmo assim, ela validou em produção que:

```text
✅ o agendamento natural das 04:00 está funcionando
✅ todas as 9 lojas foram processadas
✅ nenhuma loja falhou
✅ a rotina permaneceu em DRY RUN
```

=====================================================================

# ✅ F5.6-D1 — TRAVAS LÓGICAS PARA FUTURA EXCLUSÃO

## 🎯 Objetivo

Antes de permitir qualquer exclusão real de backup, foi criada uma camada
independente de validação responsável por responder somente:

```text
PODE SER CANDIDATO À FUTURA EXCLUSÃO
ou
BLOQUEADO + MOTIVO
```

A função implementada foi:

```text
validateRetentionDeleteCandidate()
```

localizada no motor:

```text
functions/backups/backupRetention.js
```

Essa função NÃO possui qualquer operação de exclusão.

```text
❌ zero Firestore delete()
❌ zero Storage delete()
❌ zero escrita
❌ zero alteração de snapshot
```

=====================================================================

## 🛡️ Estratégia FAIL CLOSED

A validação segue a política:

```text
qualquer inconsistência
        ↓
     BLOQUEIA
```

Ou seja, uma condição desconhecida, inválida ou divergente nunca é
interpretada como autorização para remoção.

Fluxo lógico:

```text
CANDIDATO
   ↓
metadata íntegra?
   ↓
automatic?
   ↓
ready?
   ↓
protected != true?
   ↓
storeId correto?
   ↓
backupId correto?
   ↓
storagePath canônico?
   ↓
createdAt válido?
   ↓
existe exatamente uma vez na visão atual?
   ↓
recalcula política AGORA
   ↓
está em KEEP?
   ├── SIM → ❌ BLOQUEADO
   ↓ NÃO
continua em DELETE CANDIDATES?
   ├── NÃO → ❌ BLOQUEADO
   ↓ SIM
✅ ALLOWED
```

Importante:

```text
ALLOWED
≠
DELETED
```

`allowed == true` significa apenas que o backup passou pelas travas lógicas
para uma futura etapa de exclusão.

=====================================================================

## 🔐 Regras obrigatórias validadas

A camada de segurança bloqueia automaticamente:

```text
✅ backup pertencente ao KEEP
✅ backup manual
✅ backup com status diferente de ready
✅ backup com protected == true
✅ campo protected com tipo inválido
✅ storeId divergente
✅ backupId divergente
✅ storagePath fora do caminho canônico esperado
✅ createdAt inválido
✅ backup ausente ou duplicado na visão atual
✅ backup que deixou de ser candidato após mudança do estado
```

A identidade canônica do backup continua sendo:

```text
doc.id
```

Se existir `backupId` dentro da metadata e ele divergir do `doc.id`,
a operação é bloqueada.

=====================================================================

## 📁 Validação rígida do Storage Path

Para um backup ser considerado válido para futura exclusão, o caminho deve
ser exatamente:

```text
store_backups/{storeId}/{backupId}/snapshot.json.gz
```

Qualquer divergência bloqueia a operação.

Essa trava reduz o risco de uma rotina de retenção apontar acidentalmente
para:

```text
❌ outra loja
❌ outro backup
❌ outro arquivo do Storage
```

=====================================================================

## 🛡️ Campo protected

Foi oficializada a regra:

```text
protected: true
→ NUNCA participa da retenção automática
```

Comportamento:

```text
protected ausente
→ elegível normalmente

protected: false
→ elegível normalmente

protected: true
→ fora da retenção automática

protected com valor inválido
→ bloqueado por segurança
```

O próprio `calculateBackupRetention()` foi atualizado para retirar
`protected == true` da lista de backups elegíveis.

Assim, um backup protegido:

```text
❌ não entra em DAILY
❌ não entra em WEEKLY
❌ não entra em MONTHLY
❌ não entra em DELETE CANDIDATES
```

=====================================================================

## 🔄 Recálculo obrigatório antes de autorizar

Uma das travas mais importantes da F5.6-D1 é não confiar em uma decisão
antiga.

Exemplo:

```text
backup era DELETE CANDIDATE
        ↓
outro backup é removido / estado muda
        ↓
política é recalculada
        ↓
backup passa a representar uma faixa KEEP
        ↓
❌ futura exclusão é bloqueada
```

A política é recalculada novamente utilizando o estado atual dos snapshots
antes de devolver `allowed == true`.

=====================================================================

## 🧪 Testes de segurança

Arquivo de teste:

```text
functions/tests/backups/backupRetentionSafety.test.js
```

Cenários validados:

```text
✅ candidato legítimo → ALLOWED
✅ backup em KEEP → BLOQUEADO
✅ backup manual → BLOQUEADO
✅ backup não-ready → BLOQUEADO
✅ protected=true → BLOQUEADO
✅ protected inválido → BLOQUEADO
✅ storeId divergente → BLOQUEADO
✅ backupId divergente → BLOQUEADO
✅ storagePath incorreto → BLOQUEADO
✅ createdAt inválido → BLOQUEADO
✅ backup ausente da lista atual → BLOQUEADO
✅ candidato antigo que virou KEEP → BLOQUEADO
```

Resultado:

```text
✅ TODAS AS TRAVAS DE SEGURANÇA PASSARAM
```

=====================================================================

## 🧪 Testes de regressão do motor

Após a inclusão das novas travas, o teste original da política de retenção
foi executado novamente.

Resultado:

```text
eligible:          25
keepDaily:          7
keepWeekly:         4
keepMonthly:        6
keepTotal:         17
deleteCandidates:   8
```

Também foi acrescentado um teste específico para confirmar:

```text
protected=true ficou fora de KEEP e DELETE CANDIDATES
```

Resultado final:

```text
✅ TODOS OS TESTES DE RETENÇÃO PASSARAM
```

Portanto, a nova camada de segurança não provocou regressão na política
já validada.

=====================================================================

## ✅ Estado da F5.6-D1

```text
✅ validateRetentionDeleteCandidate()
✅ estratégia fail closed
✅ recálculo da política antes de autorizar
✅ proteção de backups KEEP
✅ proteção de backups manuais
✅ proteção de backups não-ready
✅ proteção de protected=true
✅ validação de protected inválido
✅ validação de storeId
✅ validação de backupId
✅ validação de storagePath
✅ validação de createdAt
✅ validação da visão atual dos snapshots
✅ candidato antigo que virou KEEP é bloqueado
✅ protected=true removido do próprio motor
✅ testes de segurança aprovados
✅ testes de regressão aprovados

❌ nenhum delete() implementado
❌ nenhuma alteração no Firebase nesta etapa
❌ nenhuma exclusão real
```

A etapa seguinte, F5.6-D2, integrou essas travas ao scheduler
sem adicionar capacidade de exclusão.

=====================================================================

# ✅ F5.6-D2 — TRAVAS INTEGRADAS AO SCHEDULER EM DRY RUN

## 🎯 Objetivo

Integrar `validateRetentionDeleteCandidate()` ao scheduler automático
de retenção, de forma que um backup calculado pelo motor como
`DELETE CANDIDATE` ainda precise passar pelas travas de segurança antes
de ser considerado autorizado para uma futura exclusão.

A regra oficial passou a ser:

```text
DELETE CANDIDATE calculado
        ↓
validateRetentionDeleteCandidate()
        ↓
├── ALLOWED
└── BLOCKED + motivo
        ↓
somente LOG / DRY RUN
```

Importante:

```text
DELETE CANDIDATE
≠
AUTORIZAÇÃO DE EXCLUSÃO

ALLOWED
≠
DELETED
```

Nenhum `delete()` foi introduzido nesta etapa.

=====================================================================

## 🧩 Metadata original preservada

O scheduler mantém duas visões do mesmo snapshot.

```text
METADATA ORIGINAL DO FIRESTORE
→ usada pelas travas de segurança

METADATA NORMALIZADA
→ usada pelo motor de retenção
→ backupId canônico = doc.id
```

Essa separação é necessária para impedir que uma inconsistência existente
dentro da própria metadata seja escondida pela normalização do motor.

Exemplo:

```text
doc.id = backup-real-123
metadata.backupId = backup-incorreto-999
```

O motor continua utilizando:

```text
backupId = doc.id
```

mas o validador recebe a metadata original e consegue bloquear:

```text
backup-id-mismatch
```

=====================================================================

## 🔐 Classificação obrigatória dos candidatos

Após o cálculo da política:

```text
calculateBackupRetention()
```

cada item de:

```text
result.deleteCandidates
```

é validado individualmente por:

```text
validateRetentionDeleteCandidate()
```

O resultado é dividido em:

```text
allowedDeleteCandidates
blockedDeleteCandidates
```

O scheduler registra as duas classificações separadamente.

Mesmo um item `ALLOWED` continua sendo apenas uma autorização lógica
em DRY RUN.

=====================================================================

## 🛡️ Trava de consistência da classificação

Foi adicionada uma trava matemática para garantir que nenhum candidato
desapareça durante a classificação.

Regra:

```text
DELETE CANDIDATES
=
ALLOWED
+
BLOCKED
```

Exemplo:

```text
8 DELETE CANDIDATES

5 ALLOWED
+
3 BLOCKED

= 8
```

Se a igualdade não for verdadeira, a loja falha com erro de inconsistência
em vez de continuar silenciosamente.

Essa trava segue o mesmo princípio:

```text
FAIL CLOSED
```

=====================================================================

## 📊 Novos contadores por loja

Cada loja passou a registrar:

```text
totalSnapshots
eligible
keepTotal
deleteCandidates
allowedDeleteCandidates
blockedDeleteCandidates
```

=====================================================================

## 📊 Novos contadores globais

O resumo final do scheduler passou a registrar:

```text
totalStores
successCount
failureCount
totalEligible
totalDeleteCandidates
totalAllowedDeleteCandidates
totalBlockedDeleteCandidates
```

Assim é possível auditar a classificação da retenção no conjunto de
todas as lojas.

=====================================================================

## 🧪 Validação local antes do deploy

Foram executados novamente:

```text
node --check functions/backups/scheduledBackupRetention.js
```

Resultado:

```text
✅ sintaxe válida
```

Teste da política:

```text
node functions/tests/backups/backupRetention.test.js
```

Resultado:

```text
eligible:          25
keepDaily:          7
keepWeekly:         4
keepMonthly:        6
keepTotal:         17
deleteCandidates:   8

✅ protected=true fora de KEEP e DELETE CANDIDATES
✅ TODOS OS TESTES DE RETENÇÃO PASSARAM
```

Teste das travas:

```text
node functions/tests/backups/backupRetentionSafety.test.js
```

Resultado:

```text
✅ candidato legítimo → ALLOWED
✅ backup em KEEP → BLOQUEADO
✅ backup manual → BLOQUEADO
✅ backup não-ready → BLOQUEADO
✅ protected=true → BLOQUEADO
✅ protected inválido → BLOQUEADO
✅ storeId divergente → BLOQUEADO
✅ backupId divergente → BLOQUEADO
✅ storagePath incorreto → BLOQUEADO
✅ createdAt inválido → BLOQUEADO
✅ backup ausente da lista atual → BLOQUEADO
✅ candidato antigo que virou KEEP → BLOQUEADO

✅ TODAS AS TRAVAS DE SEGURANÇA PASSARAM
```

=====================================================================

## 🚀 Deploy da F5.6-D2

A nova versão do scheduler foi implantada em produção mantendo:

```text
dryRun = true
```

Função:

```text
scheduledBackupRetention
```

Não foi adicionada qualquer operação de exclusão.

=====================================================================

## 🧪 Execução controlada da F5.6-D2 em produção

Após o deploy, o Cloud Scheduler foi disparado manualmente para validar
a versão implantada.

Execution ID observado:

```text
pv5ykfygob3r
```

Resumo final:

```text
dryRun: true

totalStores: 9
successCount: 9
failureCount: 0

totalEligible: 18
totalDeleteCandidates: 0
totalAllowedDeleteCandidates: 0
totalBlockedDeleteCandidates: 0
```

A relação obrigatória foi satisfeita:

```text
0 = 0 + 0
```

Portanto:

```text
DELETE CANDIDATES
=
ALLOWED
+
BLOCKED
```

permaneceu consistente na execução real.

=====================================================================

## 🏪 Loja principal validada

Para a loja principal utilizada durante a validação, o scheduler observou:

```text
totalSnapshots: 5
eligible: 2

keepDaily: 2
keepWeekly: 0
keepMonthly: 0
keepTotal: 2

deleteCandidates: 0
allowedDeleteCandidates: 0
blockedDeleteCandidates: 0
```

Ou seja:

```text
✅ os dois backups automáticos elegíveis ficaram em KEEP
✅ nenhum candidato real foi produzido
✅ nenhuma exclusão ocorreu
```

=====================================================================

## ⚠️ Limitação atual da evidência de produção

No momento da validação ainda não existia histórico suficiente para gerar
um `DELETE CANDIDATE` real nas lojas.

Portanto, a produção validou diretamente:

```text
✅ caminho com zero candidatos
✅ integração dos novos contadores
✅ execução em todas as lojas
✅ ausência de falhas
✅ dryRun
```

Já os caminhos:

```text
DELETE CANDIDATE → ALLOWED
DELETE CANDIDATE → BLOCKED
```

foram comprovados pelos testes simulados de segurança, mas ainda não foram
observados com candidatos reais em produção.

Essa distinção deve ser mantida na documentação para não declarar uma
validação que ainda não aconteceu naturalmente.

=====================================================================

## ✅ Estado da F5.6-D2

```text
✅ metadata original preservada
✅ metadata normalizada separadamente
✅ validateRetentionDeleteCandidate integrado ao scheduler
✅ DELETE CANDIDATE não implica autorização
✅ classificação ALLOWED / BLOCKED
✅ motivos de bloqueio registrados
✅ contadores por loja
✅ contadores globais
✅ trava DELETE = ALLOWED + BLOCKED
✅ sintaxe validada
✅ testes do motor aprovados
✅ testes das travas aprovados
✅ deploy concluído
✅ execução controlada em produção
✅ 9 lojas processadas
✅ 0 falhas
✅ execução natural das 04:00 também observada

❌ zero Firestore delete()
❌ zero Storage delete()
❌ zero exclusão real
```

Próxima etapa arquitetural:

```text
F5.6-D3 — DESENHO DA EXCLUSÃO SEGURA E RESUMÍVEL

objetivo:
definir como uma futura exclusão real poderá ser executada
sem depender de uma operação atômica inexistente entre
Firestore e Firebase Storage.
```

A D3 começa pelo desenho do protocolo e estados de operação.
Nenhum delete será implementado antes desse desenho ser aprovado.

=====================================================================

# ✅ F5.6-D3 — DESENHO DA EXCLUSÃO SEGURA E RESUMÍVEL

A F5.6-D3 foi iniciada antes de qualquer implementação de exclusão real.

Objetivo:

```text
definir um protocolo idempotente, retomável e fail closed
para futura exclusão automática de backups
```

Motivação principal:

```text
Firestore
e
Firebase Storage

não podem ser excluídos atomicamente em uma única operação.
```

Por isso, a exclusão precisa ser controlada por estados persistentes.

Nesta fase:

```text
❌ nenhum Firestore delete()
❌ nenhum Storage delete()
❌ nenhuma escrita implementada
❌ nenhum deploy
```

=====================================================================

# ✅ F5.6-D3-A — PROTOCOLO GERAL DE EXCLUSÃO

## 🎯 Princípio central

A metadata do snapshot NÃO será removida antes do arquivo físico.

Fluxo oficial:

```text
BACKUP ready
     ↓
recalcula política
     ↓
validateRetentionDeleteCandidate()
     ↓
✅ ALLOWED
     ↓
cria operação persistente
+
snapshot passa para deleting
     ↓
remove arquivo do Storage
     ↓
marca storage_deleted
     ↓
finaliza Firestore
├── cria auditLog
├── remove metadata do snapshot
└── marca operação completed
```

Regra:

```text
NUNCA:

DELETE metadata Firestore
        ↓
tentar apagar Storage depois
```

Porque uma falha no Storage poderia deixar:

```text
arquivo órfão
sem metadata correspondente
```

=====================================================================

## 🔄 Operação resumível

Se a Function falhar no meio:

```text
snapshot.status = deleting
+
retentionDelete persistido
```

permitem continuar de onde a execução parou.

Exemplo:

```text
Storage foi removido
        ↓
Function caiu antes da finalização
        ↓
nova execução
        ↓
arquivo já não existe
        ↓
etapa considerada satisfeita
        ↓
continua a finalização
```

A exclusão física do Storage será tratada como idempotente.

=====================================================================

## 📌 dailyRuns

A política oficial para `dailyRuns` é:

```text
✅ manter
❌ não alterar
❌ não excluir pela retenção
```

O `dailyRun` permanece como histórico da execução daquele dia,
mesmo que o snapshot antigo seja posteriormente removido pela política.

=====================================================================

## 🧾 Auditoria futura da exclusão

A finalização deverá registrar um auditLog com informações suficientes
para identificar o backup removido mesmo após o snapshot desaparecer.

Campos conceituais:

```text
action:
store_backup_retention_deleted

storeId
backupId
storagePath
checksum
createdAt original
operationId
performedBy: system
reason: retention_policy
```

=====================================================================

## ✅ Estado da D3-A

```text
✅ metadata não é apagada primeiro
✅ operação persistente
✅ snapshot entra em deleting
✅ Storage antes da remoção da metadata
✅ delete físico idempotente
✅ finalização Firestore depois
✅ audit preservado
✅ retries retomáveis
✅ deleting fora do motor normal
✅ dailyRuns preservados

❌ nenhum delete implementado
```

=====================================================================

# ✅ F5.6-D3-B — SCHEMA E MÁQUINA DE ESTADOS

## 📁 Caminho oficial da operação

Cada backup terá no máximo uma operação de retenção:

```text
storeBackups/{storeId}/retentionDeletes/{backupId}
```

Regra:

```text
1 backup
=
1 operação de retenção
```

Usar o próprio `backupId` como ID da operação evita duplicidade
quando o scheduler ou um retry processar o mesmo snapshot novamente.

=====================================================================

## 🔄 Máquina de estados

Estados oficiais:

```text
claimed
   ↓
storage_deleted
   ↓
completed
```

Estado excepcional:

```text
blocked
```

`blocked` representa inconsistência de segurança ou integridade.

Ele NÃO representa erro temporário.

=====================================================================

## ⚠️ Erros temporários

Falhas transitórias não mudam automaticamente a operação para `blocked`.

Exemplo:

```text
status = claimed

Storage timeout
        ↓
status continua claimed
lastError atualizado
attemptCount++
        ↓
retry futuro
```

Assim a operação permanece resumível.

=====================================================================

## 🧩 Schema conceitual

```js
{
  version: 1,

  storeId,
  backupId,

  status: "claimed",
  reason: "retention_policy",

  snapshot: {
    type: "automatic",
    originalStatus: "ready",
    createdAt,
    storagePath,
    checksum,
    compressedBytes
  },

  createdAt,
  updatedAt,
  claimedAt,

  storageDeletedAt: null,
  completedAt: null,
  blockedAt: null,

  attemptCount: 1,
  lastAttemptAt,
  lastError: null,

  leaseOwner,
  leaseAcquiredAt,
  leaseExpiresAt
}
```

O bloco `snapshot` é uma cópia congelada da identidade do backup
no momento em que a exclusão foi assumida.

Mesmo depois da remoção da metadata original, a operação continua sabendo:

```text
backupId
createdAt original
storagePath
checksum
tamanho comprimido quando disponível
```

=====================================================================

## 🟡 Estado claimed

Significa:

```text
✅ candidato recalculado
✅ validator aprovado
✅ operação criada
✅ snapshot reservado
✅ snapshot passou de ready → deleting

❌ remoção do Storage ainda não confirmada
```

O snapshot passará conceitualmente a conter:

```js
{
  status: "deleting",

  retentionDeleteOperationId: backupId,

  retentionDeleteStartedAt: serverTimestamp(),

  retentionDeleteReason: "retention_policy"
}
```

Como o motor normal trabalha somente com:

```text
type == automatic
status == ready
```

um snapshot `deleting` fica automaticamente fora da retenção normal.

=====================================================================

## 🟠 Estado storage_deleted

Significa:

```text
✅ arquivo físico já não existe
✅ metadata do snapshot ainda existe
✅ operação permanece persistida

⏳ falta finalizar Firestore + auditoria
```

Documento conceitual:

```js
{
  status: "storage_deleted",
  storageDeletedAt: serverTimestamp()
}
```

Se o arquivo já não existir em um retry, a etapa é considerada concluída.

=====================================================================

## 🟢 Estado completed

Estado terminal normal.

A finalização Firestore deverá ocorrer de forma agrupada:

```text
WRITE auditLog
+
DELETE snapshot metadata
+
UPDATE retentionDelete → completed
```

A operação `retentionDeletes/{backupId}` NÃO será apagada.

Ela permanece como:

```text
histórico técnico
+
controle de idempotência
```

Campos finais conceituais:

```js
{
  status: "completed",

  completedAt: serverTimestamp(),

  leaseOwner: null,
  leaseAcquiredAt: null,
  leaseExpiresAt: null,

  lastError: null
}
```

=====================================================================

## 🔴 Estado blocked

Reservado para inconsistências como:

```text
storagePath inesperado
storeId divergente
backupId divergente
snapshot em estado impossível
operação apontando para outro snapshot
checksum esperado ausente ou inválido
dados necessários divergentes
```

Exemplo conceitual:

```js
{
  status: "blocked",

  blockedAt: serverTimestamp(),

  lastError: {
    stage: "validation",
    code: "snapshot-state-mismatch",
    message: "...",
    at: serverTimestamp()
  }
}
```

Regra:

```text
blocked
→ NÃO continua automaticamente
```

=====================================================================

## 🔒 Lease de concorrência

A operação terá:

```text
leaseOwner
leaseAcquiredAt
leaseExpiresAt
```

Duração planejada:

```text
15 minutos
```

Uma execução poderá assumir a operação somente quando:

```text
não existe lease
OU
lease expirou
OU
ela já é dona do lease
```

Caso contrário:

```text
SKIP
```

Essa proteção evita processamento concorrente por:

```text
scheduler
+
retry automático
+
segunda instância
```

=====================================================================

## 🧯 lastError

Será armazenado somente diagnóstico controlado:

```js
lastError: {
  stage: "storage_delete",
  code: "storage-delete-failed",
  message: "Mensagem sanitizada",
  at: serverTimestamp()
}
```

Stack trace completo permanece no Cloud Logging.

=====================================================================

## 📐 Invariantes da D3-B

```text
1. retentionDeletes/{backupId} é único por backup.

2. claimed exige snapshot ainda existente.

3. snapshot claimed precisa estar status=deleting.

4. deleting nunca passa pelo motor normal.

5. storage_deleted significa ausência física confirmada.

6. completed significa:
   Storage removido
   + metadata removida
   + audit registrado.

7. blocked nunca continua sozinho.

8. erro temporário não vira blocked automaticamente.

9. retries retomam o último estágio concluído.

10. dailyRuns nunca são alterados pela retenção.
```

Separação de responsabilidades:

```text
RETENTION ENGINE
→ decide quem seria candidato

VALIDATOR
→ decide quem está autorizado

RETENTION OPERATION
→ controla a exclusão resumível
```

=====================================================================

## ✅ Estado da D3-B

```text
✅ retentionDeletes/{backupId}
✅ claimed
✅ storage_deleted
✅ completed
✅ blocked
✅ snapshot congelado
✅ retries
✅ lastError
✅ lease de concorrência
✅ vínculo com snapshot deleting
✅ idempotência

❌ nenhuma escrita implementada
❌ nenhum delete()
❌ nenhum deploy
```

=====================================================================

# ✅ F5.6-D3-C — DESENHO DA TRANSAÇÃO DE CLAIM

## 🎯 Objetivo

O CLAIM será a primeira futura operação com escrita.

Ele deverá realizar de forma atômica no Firestore:

```text
snapshot:
ready → deleting

retentionDeletes/{backupId}:
não existe → claimed
```

Regra:

```text
ou as duas escritas acontecem
ou nenhuma acontece
```

=====================================================================

## 🔄 Fluxo oficial do CLAIM

```text
scheduler encontra DELETE CANDIDATE
        ↓
abre Firestore Transaction
        ↓
lê novamente estado atual necessário
        ↓
verifica retentionDeletes/{backupId}
        ↓
operação já existe?
   │
   ├── NÃO
   │     ↓
   │  lê metadata ORIGINAL
   │     ↓
   │  recalcula política
   │     ↓
   │  validateRetentionDeleteCandidate()
   │     ↓
   │  ALLOWED?
   │     ├── NÃO → nenhuma escrita
   │     └── SIM
   │           ↓
   │      cria retentionDelete = claimed
   │           +
   │      snapshot ready → deleting
   │
   └── SIM
         ↓
      fluxo idempotente de retomada
```

Regra crítica:

```text
NÃO confiar no candidato calculado
antes da transaction
```

O estado deve ser recalculado novamente dentro do CLAIM.

=====================================================================

## 🔁 Recálculo dentro da transaction

Antes do primeiro CLAIM serão reaplicados:

```text
calculateBackupRetention()
```

e:

```text
validateRetentionDeleteCandidate()
```

Isso preserva a regra já validada:

```text
candidato antigo
≠
autorização atual
```

=====================================================================

## 🆕 Criação de um novo CLAIM

Se a operação ainda não existir e o candidato continuar autorizado,
a mesma transaction criará:

```text
retentionDeletes/{backupId}
+
UPDATE snapshots/{backupId}
```

Operação conceitual:

```js
{
  version: 1,

  storeId,
  backupId,

  status: "claimed",
  reason: "retention_policy",

  snapshot: {
    type: "automatic",
    originalStatus: "ready",
    createdAt,
    storagePath,
    checksum,
    compressedBytes
  },

  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  claimedAt: serverTimestamp(),

  storageDeletedAt: null,
  completedAt: null,
  blockedAt: null,

  attemptCount: 1,
  lastAttemptAt: serverTimestamp(),
  lastError: null,

  leaseOwner: executionId,
  leaseAcquiredAt: serverTimestamp(),
  leaseExpiresAt: /* agora + 15 minutos */
}
```

Snapshot atualizado na mesma transaction:

```js
{
  status: "deleting",

  retentionDeleteOperationId: backupId,

  retentionDeleteStartedAt: serverTimestamp(),

  retentionDeleteReason: "retention_policy"
}
```

Nenhuma outra metadata do snapshot será removida no CLAIM.

=====================================================================

## 🔐 Travas obrigatórias antes do CLAIM

Antes da criação inicial, será obrigatório confirmar:

```text
snapshot existe

snapshot.status == ready

snapshot.type == automatic

snapshot.storeId == storeId

storagePath == caminho canônico

checksum existe e é válido

retentionDeleteOperationId não existe

retentionDeletes/{backupId} não existe

candidate continua fora de KEEP

candidate continua em DELETE CANDIDATES
```

Se qualquer condição falhar:

```text
❌ não cria operação
❌ não muda snapshot
```

Fail closed.

`compressedBytes` poderá ser preservado quando existir,
mas não será requisito de segurança para o CLAIM.

=====================================================================

## 🔑 Checksum congelado

O CLAIM preservará:

```text
backupId
storagePath
checksum SHA-256
```

Assim a identidade do artefato removido continua disponível mesmo depois
da metadata original desaparecer.

=====================================================================

## ♻️ Operação já existente

Se `retentionDeletes/{backupId}` já existir:

```text
NUNCA criar nova operação
```

Comportamento por estado:

```text
completed
→ ALREADY_COMPLETED
→ não faz nada

blocked
→ BLOCKED
→ não continua

claimed
→ verifica consistência + lease
→ pode RESUME

storage_deleted
→ verifica consistência + lease
→ pode RESUME FINALIZATION
```

A transição:

```text
ready → deleting
```

ocorre somente no primeiro CLAIM.

=====================================================================

## 🔒 Lease no CLAIM

Para operações retomáveis:

```text
leaseOwner == execução atual
→ pode continuar

lease expirou
→ pode assumir novo lease

lease válido de outra execução
→ SKIP
```

Duração planejada:

```text
15 minutos
```

=====================================================================

## 🚨 Estados impossíveis

Combinações impossíveis não serão corrigidas silenciosamente.

Exemplo:

```text
operation.status = claimed
snapshot.status = ready
```

Como criação da operação e transição para `deleting` deverão ocorrer
na mesma transaction, essa combinação indica quebra de integridade.

Também serão tratados como inconsistência:

```text
claimed + snapshot inexistente

storage_deleted + snapshot inexistente

snapshot deleting apontando para outro operationId

storeId divergente

storagePath divergente do snapshot congelado

checksum divergente
```

Regra:

```text
não tentar consertar automaticamente
→ BLOCKED
```

=====================================================================

## 📋 Matriz oficial de decisão

```text
OP NÃO EXISTE
snapshot ready + candidate ALLOWED
→ CREATE_CLAIM

OP NÃO EXISTE
snapshot não permitido
→ NOT_ALLOWED / nenhuma escrita


OP claimed
snapshot deleting correto
lease disponível
→ RESUME

OP claimed
snapshot deleting correto
lease de outro worker
→ SKIP_LEASED


OP storage_deleted
snapshot deleting correto
→ RESUME


OP completed
→ ALREADY_COMPLETED


OP blocked
→ BLOCKED


qualquer combinação impossível
→ BLOCKED
```

=====================================================================

## ✅ Estado da D3-C

```text
✅ Firestore Transaction atômica desenhada
✅ recálculo dentro do CLAIM
✅ validator reaplicado
✅ ready → deleting
✅ criação claimed
✅ snapshot congelado
✅ checksum preservado
✅ operação única por backup
✅ lease de 15 minutos
✅ retomada idempotente
✅ estados impossíveis bloqueados

❌ nenhuma escrita implementada
❌ nenhum delete()
❌ nenhum deploy
```

=====================================================================

# ⏳ F5.6-D3-D — PURE CLAIM PLANNER + TESTES

Antes de conectar qualquer decisão a uma Firestore Transaction real,
será criada uma função pura, sem Firebase.

Ela receberá conceitualmente:

```text
snapshot
operation
allBackups
lease
```

e responderá somente uma decisão:

```text
CREATE_CLAIM
RESUME
SKIP_LEASED
ALREADY_COMPLETED
BLOCKED
NOT_ALLOWED
```

Objetivo:

```text
testar toda a máquina de estados
antes da primeira escrita real
```

A D3-D deverá validar, entre outros:

```text
novo candidato legítimo

candidato que virou KEEP

operação completed

operação blocked

claimed com snapshot deleting correto

claimed com lease ativo de outro worker

claimed com lease expirado

storage_deleted retomável

snapshot ausente

storeId divergente

backupId divergente

storagePath divergente

checksum divergente

operationId divergente

combinações impossíveis
```

Somente após os testes do planner puro passarem será considerada
a implementação da transaction de CLAIM no Firebase.

=====================================================================

## 📌 Estado atual da F5.6-D3

```text
✅ D3-A — protocolo geral
✅ D3-B — schema + máquina de estados
✅ D3-C — desenho do CLAIM
⏳ D3-D — pure claim planner + testes

❌ zero delete()
❌ zero escrita nova
❌ zero deploy desta fase
```

=====================================================================

# 📌 REGRA DE MANUTENÇÃO DESTA DOCUMENTAÇÃO

Ao concluir uma etapa da F5:

1. atualizar o status;
2. registrar a decisão arquitetural;
3. registrar regras importantes;
4. registrar testes realizados;
5. registrar qualquer exceção de segurança.

Este arquivo é a referência oficial da F5.



=====================================================================

# 🟡 F5.6 — ESTADO CONSOLIDADO APÓS D3 E G9

Data da consolidação:

```text
09/09/2026
```

Esta seção consolida as etapas implementadas depois da documentação
original da F5.6-D3-C.

## ✅ F5.6-D3 — Exclusão segura e resumível

```text
✅ CLAIM transacional
✅ ready → deleting
✅ operação persistente retentionDeletes
✅ lease de 15 minutos
✅ resume e takeover
✅ exclusão do Storage antes da metadata
✅ validação de storagePath, checksum e generation
✅ storage_deleted
✅ finalização transacional
✅ auditoria determinística
✅ operação completed
```

## ✅ F5.6-G9 — Integração controlada ao Scheduler

```text
✅ operações persistentes são retomadas primeiro
✅ candidatos novos são processados depois
✅ limite de novas exclusões por execução
✅ erros isolados por backup
✅ dailyRuns permanece independente
```

## 🔒 Estado atual em produção

```text
RETENTION_EXECUTION_ENABLED = false
RETENTION_EXECUTION_STORE_IDS = vazio
RETENTION_MAX_FRESH_DELETES_PER_STORE = 1
```

Portanto:

```text
✅ código destrutivo implementado e testado
✅ execução destrutiva controlada validada em Emulator
❌ exclusão automática destrutiva NÃO habilitada em produção
```

A F5.6 permanece em validação final antes de qualquer habilitação
controlada da retenção destrutiva em produção.

=====================================================================

## ✅ Proteção contra retry do Scheduler

```text
scheduleTime + jobName
→ SHA-256
→ runId determinístico

primeira execução → GRANT_FRESH_BUDGET
retry do mesmo evento → RESUME_ONLY
retry → maxFreshDeletes = 0
```

O ledger persistente impede que um retry do mesmo evento receba
novo orçamento para exclusões frescas.

## ✅ Regressão automatizada da F5.6

Estrutura oficial:

```text
functions/backups/
→ código de produção

functions/tests/backups/
→ 38 testes da retenção
→ runBackupRetentionTests.js

functions/tests/security/
→ storageRules.test.mjs
```

Validação runtime:

```text
✅ F5.6 — 38/38 PASSARAM
✅ Storage Rules — 8/8 PASSARAM
✅ exit code 0
```

## ✅ Testes fora do deploy das Functions

O firebase.json contém:

```text
tests/**
```

Portanto os testes permanecem versionados no Git,
mas não entram no pacote de deploy das Cloud Functions.

## 📌 Estado atual da F5.6

```text
✅ política de retenção
✅ dry run
✅ validator fail closed
✅ exclusão segura e resumível
✅ lease / resume / takeover
✅ integração controlada ao Scheduler
✅ proteção contra retry
✅ regressão automatizada 38/38
✅ Storage Rules 8/8
✅ testes separados do código de produção

⚠️ execução destrutiva em produção permanece DESATIVADA
```
