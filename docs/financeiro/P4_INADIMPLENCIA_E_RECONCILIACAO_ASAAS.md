# 💰 P4 — INADIMPLÊNCIA, TOLERÂNCIA E RECONCILIAÇÃO ASAAS

Documentação oficial da arquitetura de detecção de inadimplência, período de tolerância, reconciliação financeira, bloqueio de acesso e integração com o Asaas no Store&Connect.

> Este documento é a referência oficial da P4 financeira.
> Toda alteração relevante nas regras de inadimplência, cobrança, tolerância, reconciliação ou bloqueio deve ser registrada aqui.

=====================================================================

# 📌 STATUS DA P4

```text
✅ P4-A — Diagnóstico do webhook de cobrança
✅ P4-B — Correção da classificação financeira
✅ P4-D — Isolamento financeiro por assinatura
✅ P4-E — Auditoria de histórico Asaas
✅ P4-F1 — Diagnóstico completo de inadimplência
✅ P4-F2 — Proteção do bloqueio
✅ P4-F3 — Reconciliação financeira

🟡 P4-F4 — Interface de aviso de inadimplência
⏳ P4-F5 — Validação do bloqueio real no dia 4
⏳ P4-F6 — Validação completa de pagamento e reativação
```

=====================================================================

# 🎯 OBJETIVO

O sistema financeiro deve garantir que o estado de acesso da loja no Store&Connect represente corretamente a situação real da assinatura no Asaas.

```text
COBRANÇA REGULAR
      ↓
LOJA ACTIVE

COBRANÇA VENCIDA
      ↓
LOJA OVERDUE
      ↓
3 DIAS DE TOLERÂNCIA
      ↓
DIA 4
      ↓
LOJA INACTIVE
```

O bloqueio do Store&Connect não deve cancelar a assinatura recorrente no Asaas.

=====================================================================

# 🏗️ PRINCÍPIO ARQUITETURAL

```text
ASAAS
  ↓
realidade financeira
  ↓
WEBHOOK
+
RECONCILIADOR
  ↓
FIRESTORE
  ↓
subscriptionStatus
  ↓
APP STORE&CONNECT
```

```text
ASAAS
→ autoridade sobre cobranças e pagamentos

BACKEND / CLOUD FUNCTIONS
→ autoridade sobre interpretação financeira
→ autoridade sobre subscriptionStatus

FLUTTER
→ apresenta o estado
→ NÃO deve definir a situação financeira
```

=====================================================================

# 🔑 IDENTIFICADORES IMPORTANTES

```text
asaasCustomerId
asaasSubscriptionId
```

`asaasCustomerId` identifica o customer no Asaas, mas não deve ser usado sozinho para determinar quais cobranças pertencem à loja.

A referência financeira oficial da loja é:

```text
stores/{storeId}.asaasSubscriptionId
            ↓
GET /payments?subscription={asaasSubscriptionId}
```

Regra:

```text
✅ cobranças sempre isoladas pela assinatura oficial
❌ não consultar cobranças da loja somente por customer
```

=====================================================================

# 🛡️ VÍNCULO DA ASSINATURA COM A LOJA

O backend valida:

```text
subscription.id
subscription.externalReference
subscription.customer
```

A assinatura somente é válida para a loja quando:

```text
subscription.id = store.asaasSubscriptionId
subscription.externalReference = storeId
```

Quando `asaasCustomerId` está disponível:

```text
subscription.customer = store.asaasCustomerId
```

=====================================================================

# 📅 CAMPOS DE DATA FINANCEIRA

## `nextDueDate`

Tipo:

```text
string YYYY-MM-DD
```

Representa o vencimento financeiro atualmente relevante para a assinatura.

Quando regular:

```text
nextDueDate → próxima cobrança
```

Quando existe atraso, pode representar a cobrança vencida relevante.

Importante: o `subscription.nextDueDate` do objeto Subscription do Asaas não deve ser usado sozinho para determinar inadimplência, porque pode apontar para uma data futura mesmo quando existe uma cobrança antiga ainda `PENDING` ou `OVERDUE`.

=====================================================================

# 🚨 `overdueDueDate`

Tipo:

```text
string YYYY-MM-DD
```

É a data canônica da cobrança vencida mais antiga que mantém a loja inadimplente.

Exemplo:

```text
overdueDueDate = 2026-09-12
```

Usado para:

```text
✅ calcular dias reais de atraso
✅ calcular tolerância
✅ determinar último dia de graça
✅ determinar quando bloquear
```

Quando a loja volta a ficar regular, o campo é removido.

=====================================================================

# 🕒 `overdueSince`

`overdueSince` NÃO representa o vencimento financeiro.

Ele representa quando o Store&Connect detectou ou registrou o atraso.

Exemplo real:

```text
overdueDueDate = 2026-09-12
overdueSince   = 2026-09-15T05:02:00Z
```

Portanto:

```text
overdueDueDate → regra financeira
overdueSince   → auditoria
```

O período de tolerância NÃO deve ser calculado usando `overdueSince`.

=====================================================================

# 🧮 REGRA OFICIAL DE TOLERÂNCIA

Para:

```text
dueDate = 2026-09-12
```

```text
12/09 → vencimento, regular durante o próprio dia
13/09 → dia 1 de atraso, acesso permitido
14/09 → dia 2 de atraso, acesso permitido
15/09 → dia 3 de atraso, último dia de tolerância
16/09 → dia 4 de atraso, bloqueio
```

Forma geral:

```text
daysLate = 0 → regular
daysLate = 1 → overdue / graça
daysLate = 2 → overdue / graça
daysLate = 3 → overdue / último dia de graça
daysLate >= 4 → inactive
```

=====================================================================

# 🌎 REGRA DE DATA CIVIL

Cálculos financeiros usam:

```text
America/Sao_Paulo
```

A regra trabalha com data civil `YYYY-MM-DD`, e não com quantidade bruta de horas desde um Timestamp.

=====================================================================

# 🔔 WEBHOOK ASAAS

Arquivo principal:

```text
functions/financeiro/asaasWebhook.js
```

Eventos relevantes:

```text
PAYMENT_OVERDUE
PAYMENT_RECEIVED
PAYMENT_CONFIRMED
PAYMENT_CREATED
SUBSCRIPTION_DELETED
```

Uma cobrança é considerada efetivamente vencida quando:

```text
status = OVERDUE
```

ou:

```text
status = PENDING
AND
dueDate < hoje em America/Sao_Paulo
```

Cobrança `PENDING` com `dueDate = hoje` continua regular.

Quando existem várias cobranças vencidas, o backend escolhe a mais antiga e grava essa data em `overdueDueDate`.

=====================================================================

# 🔄 PAGAMENTO PARCIAL

Receber um pagamento não significa automaticamente que a loja está regular.

Após `PAYMENT_RECEIVED` ou `PAYMENT_CONFIRMED`, o backend consulta novamente as cobranças da assinatura oficial.

Se ainda existir cobrança vencida:

```text
subscriptionStatus = overdue
overdueDueDate = vencimento mais antigo ainda pendente
```

Se não existir mais cobrança vencida:

```text
subscriptionStatus = active
overdueSince removido
overdueDueDate removido
nextDueDate atualizado
```

=====================================================================

# 🧠 AUTO-CURA PELO PAYMENT_CREATED

O evento `PAYMENT_CREATED` também pode identificar cobrança anterior ainda vencida e corrigir:

```text
subscriptionStatus = overdue
overdueDueDate = vencimento real
```

=====================================================================

# 🔍 RECONCILIAÇÃO FINANCEIRA

Arquivo:

```text
functions/financeiro/reconcileAsaasBilling.js
```

Function:

```text
reconcileAsaasBilling
```

Objetivo:

```text
corrigir divergências caso webhook seja perdido,
atrasado ou tenha ocorrido antes de uma correção de código
```

Horário:

```text
01:30
America/Sao_Paulo
```

Fluxo:

```text
01:30
  ↓
reconcileAsaasBilling
  ↓
consulta lojas ACTIVE + OVERDUE
  ↓
consulta assinatura oficial
  ↓
consulta pagamentos
  ↓
corrige Firestore quando necessário

02:00
  ↓
checkOverdueSubscriptions
  ↓
avalia bloqueio
```

=====================================================================

# 🔎 ESCOPO DO RECONCILIADOR

Estados analisados:

```text
active
overdue
```

Estado excluído:

```text
inactive
```

Uma loja `inactive` pode representar bloqueio já realizado. Reativação automática desse estado deve ter regra própria.

=====================================================================

# 🔄 ACTIVE COM COBRANÇA VENCIDA

```text
subscriptionStatus = active
```

mas Asaas mostra cobrança vencida:

```text
subscriptionStatus → overdue
nextDueDate         → dueDate real
overdueDueDate      → dueDate real
overdueSince        → serverTimestamp() se ainda não existir
```

=====================================================================

# 🛠️ OVERDUE COM METADADO INCOMPLETO

Exemplo real:

```text
subscriptionStatus = overdue
nextDueDate = 2026-09-12
overdueDueDate = null
overdueSince = existente
```

Correção:

```text
subscriptionStatus = overdue
nextDueDate = 2026-09-12
overdueDueDate = 2026-09-12
overdueSince = PRESERVADO
```

Regra:

```text
❌ NÃO reiniciar overdueSince
```

=====================================================================

# ✅ OVERDUE QUE VOLTOU A FICAR REGULAR

Quando não existe mais cobrança vencida:

```text
subscriptionStatus = active
overdueSince removido
overdueDueDate removido
nextDueDate recebe próxima cobrança
```

=====================================================================

# 🔐 PROTEÇÃO CONTRA CONCORRÊNCIA

Webhook e reconciliador podem atuar próximos no tempo.

A reconciliação usa o `updateTime` observado inicialmente para impedir sobrescrita de estado mais novo.

```text
lê documento
     ↓
guarda updateTime
     ↓
consulta Asaas
     ↓
escreve somente se o documento ainda tiver a mesma versão
```

Se mudou:

```text
SKIP_CONCURRENT_CHANGE
```

=====================================================================

# 🚫 O RECONCILIADOR NÃO ALTERA O ASAAS

Permitido:

```text
GET /subscriptions/{id}
GET /payments
```

Não utilizado:

```text
❌ POST
❌ PUT
❌ PATCH
❌ DELETE
```

=====================================================================

# ⛔ BLOQUEIO POR INADIMPLÊNCIA

Function:

```text
checkOverdueSubscriptions
```

Horário:

```text
02:00
America/Sao_Paulo
```

O cron usa:

```text
subscriptionStatus = overdue
overdueDueDate
```

Regra:

```text
daysLate < 4  → mantém overdue e acesso
daysLate >= 4 → subscriptionStatus = inactive
```

O bloqueio é realizado no Firestore.

A assinatura Asaas NÃO é cancelada.

=====================================================================

# 🚫 NÃO CANCELAR A ASSINATURA ASAAS

Fluxo antigo perigoso:

```text
loja atrasada
      ↓
DELETE assinatura Asaas
```

Fluxo atual:

```text
loja atrasada por 4+ dias
      ↓
Firestore:
subscriptionStatus = inactive
blockedAt = serverTimestamp()
      ↓
assinatura Asaas permanece existente
```

Motivos:

```text
✅ preservar cobrança recorrente
✅ permitir recuperação posterior
✅ evitar destruição de dados financeiros
✅ separar bloqueio de acesso de cancelamento comercial
```

=====================================================================

# 🔐 ISOLAMENTO DE FATURAS

```text
storeId
  ↓
Firestore
  ↓
asaasSubscriptionId oficial
  ↓
GET /payments?subscription={id}
```

Isso evita exposição ou mistura de cobranças entre assinaturas.

=====================================================================

# 🌐 PORTAL FINANCEIRO

O portal financeiro também usa a assinatura oficial.

Quando existem várias cobranças `OVERDUE` / `PENDING`, o backend prioriza a cobrança acionável mais antiga.

=====================================================================

# 🧪 CASOS REAIS UTILIZADOS NA VALIDAÇÃO

## Master Gelo

```text
Plano: pro
Vencimento real: 2026-09-12
Estado: overdue
```

## H_Carl@_

```text
Plano: business
Vencimento real: 2026-09-12
Estado: overdue
```

=====================================================================

# 🧪 DRY-RUN — 15/09/2026

```text
Documentos analisados: 5
Ações necessárias: 2
Regulares: 3
Erros: 0
```

Para Master Gelo e H_Carl:

```text
WOULD_REPAIR_OVERDUE_METADATA
Vencimento real: 2026-09-12
Dias em atraso: 3
Dia da graça: 3
Pode bloquear: false
Estado atual: overdue
Estado desejado: overdue
overdueDueDate: 2026-09-12
overdueSince: PRESERVE_EXISTING
Alteraria Asaas: false
```

=====================================================================

# ✅ EXECUÇÃO CONTROLADA P4-F3F

Em 15/09/2026:

```text
candidates: 2
markedOverdue: 0
repairedOverdueMetadata: 2
reactivatedOverdue: 0
unchanged: 0
skipped: 0
errors: 0
```

Resultado final das duas lojas:

```text
subscriptionStatus = overdue
nextDueDate = 2026-09-12
overdueDueDate = 2026-09-12
overdueSince = preservado
blockedAt = null
```

Nenhuma alteração foi realizada no Asaas.

=====================================================================

# 🔄 FLUXO COMPLETO DE INADIMPLÊNCIA

```text
COBRANÇA ASAAS
      ↓
vence
      ↓
WEBHOOK
      ↓
detecta OVERDUE
ou PENDING vencida
      ↓
subscriptionStatus = overdue
overdueDueDate = vencimento real
overdueSince = auditoria
      ↓
DIA 1
acesso permitido
      ↓
DIA 2
acesso permitido
      ↓
DIA 3
último dia
      ↓
RECONCILIADOR 01:30
confirma realidade financeira
      ↓
CRON 02:00
      ↓
se daysLate >= 4
      ↓
subscriptionStatus = inactive
blockedAt = timestamp
      ↓
APP BLOQUEADO
```

=====================================================================

# 🔄 FLUXO DE REGULARIZAÇÃO

```text
CLIENTE PAGA
      ↓
ASAAS
      ↓
PAYMENT_RECEIVED
ou
PAYMENT_CONFIRMED
      ↓
backend verifica cobranças
da assinatura oficial
      ↓
AINDA EXISTE VENCIDA?
```

Se SIM:

```text
continua overdue
overdueDueDate permanece na mais antiga
```

Se NÃO:

```text
subscriptionStatus = active
overdueDueDate removido
overdueSince removido
nextDueDate atualizado
```

=====================================================================

# ⚠️ INTERFACE FLUTTER — PENDÊNCIA ATUAL

O backend usa `overdueDueDate` como fonte oficial para o período de tolerância.

A interface Flutter ainda precisa ser auditada para confirmar se o banner de aviso continua usando `overdueSince`.

Exemplo real:

```text
overdueDueDate = 12/09
overdueSince   = 15/09
```

Financeiramente:

```text
15/09 = dia 3
```

Se a interface usar `overdueSince`, poderá calcular o período de forma incorreta.

=====================================================================

# 📁 ARQUIVOS PRINCIPAIS

```text
functions/financeiro/asaasWebhook.js
functions/financeiro/reconcileAsaasBilling.js
functions/financeiro/faturas.js
functions/index.js
lib/widgets/warning_banner.dart
```

=====================================================================

# 🧭 FONTE DE VERDADE POR RESPONSABILIDADE

```text
PREÇOS DOS PLANOS
→ subscriptionPricing.js

COBRANÇAS / PAGAMENTOS
→ Asaas

ASSINATURA OFICIAL DA LOJA
→ stores/{storeId}.asaasSubscriptionId

ESTADO OPERACIONAL
→ stores/{storeId}.subscriptionStatus

VENCIMENTO REAL DO ATRASO
→ stores/{storeId}.overdueDueDate

MOMENTO DE DETECÇÃO
→ stores/{storeId}.overdueSince

MOMENTO DO BLOQUEIO
→ stores/{storeId}.blockedAt
```

=====================================================================

# 🚨 REGRAS QUE NÃO DEVEM SER QUEBRADAS

```text
❌ não utilizar customer como escopo financeiro da loja
❌ não confiar apenas em subscription.nextDueDate
❌ não usar overdueSince para contar dias de atraso
❌ não cancelar assinatura Asaas ao bloquear acesso
❌ não reiniciar overdueSince ao reparar metadata
❌ não reativar INACTIVE automaticamente nesta arquitetura
❌ não permitir Flutter alterar subscriptionStatus
```

Obrigatório:

```text
✅ usar asaasSubscriptionId oficial
✅ validar externalReference
✅ consultar cobranças da assinatura
✅ considerar PENDING vencida como atraso
✅ usar overdueDueDate como data canônica
✅ reconciliar antes do cron de bloqueio
✅ manter Asaas somente leitura durante reconciliação
```

=====================================================================

# 🕐 SCHEDULERS FINANCEIROS

```text
01:30 America/Sao_Paulo
reconcileAsaasBilling

02:00 America/Sao_Paulo
checkOverdueSubscriptions
```

Ordem:

```text
01:30 → reconcilia Firestore com a realidade Asaas
02:00 → decide bloqueio
```

=====================================================================

# 🧾 COMMITS IMPORTANTES

```text
aa8374b — fix(financeiro): tratar pending vencida como atraso
99d0f1c — fix(financeiro): proteger e isolar faturas por assinatura
86a33f7 — fix(financeiro): proteger portal e priorizar cobrança correta
a10862d — fix(financeiro): proteger bloqueio por inadimplencia
99f3948 — fix(financeiro): persistir vencimento canonico do atraso
abf6ba5 — fix(financeiro): reconciliar cobrancas Asaas diariamente
```

=====================================================================

# 🚧 PRÓXIMAS ETAPAS

```text
P4-F4
→ auditar warning_banner.dart
→ utilizar overdueDueDate
→ validar contagem visual

P4-F5
→ validar execução real do dia 4
→ confirmar inactive
→ confirmar blockedAt
→ confirmar assinatura Asaas preservada

P4-F6
→ pagar cobrança
→ validar webhook
→ validar regularização
→ definir comportamento seguro de INACTIVE após pagamento
```

=====================================================================

# ✅ PRINCÍPIO FINAL

```text
COBRANÇA VENCIDA
≠
CANCELAR ASSINATURA

BLOQUEAR ACESSO AO APP
≠
DESTRUIR A ASSINATURA NO ASAAS
```

A arquitetura financeira deve preservar a assinatura e os dados financeiros, enquanto o Store&Connect controla o acesso da loja de acordo com a situação real das cobranças.

=====================================================================

# 📌 REGRA DE MANUTENÇÃO DA DOCUMENTAÇÃO

Sempre que houver alteração em:

```text
webhook
reconciliação
tolerância
bloqueio
reativação
campos financeiros
integração Asaas
interface de inadimplência
```

este documento deve ser atualizado.

A documentação é parte da arquitetura do Store&Connect e deve permanecer sincronizada com o código.
