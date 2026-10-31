# 💰 P4 — INADIMPLÊNCIA, TOLERÂNCIA E RECONCILIAÇÃO ASAAS

> **ATUALIZAÇÃO OFICIAL DE ESTADO — 20/10/2026**
> Esta revisão registra as evidências disponíveis; **não constitui homologação Asaas PROD**, confirmação de deploy ou alteração de regras financeiras. O conteúdo histórico abaixo permanece preservado como trilha de decisões e testes. Onde há divergência de *status*, prevalece a revisão de 20/10, com conferência local dirigida descrita abaixo; os projetos publicados não foram consultados. Nenhum segredo ou dado real foi consultado ou alterado nesta revisão.

## Estado atual da P4 em 20/10/2026

| Entrega | Estado documental atualizado | Base / limite |
| --- | --- | --- |
| P4-A, B, D, E; P4-F1, F2, F3, F4 | **Registradas como concluídas na P4 histórica** | Testes, correções e commits citados mais abaixo; a conclusão histórica **não certifica** revisão mais recente publicada em HML/PROD. |
| P4-F3 | **Há evidência histórica de execução controlada em 15/09/2026** | Duas correções de metadados de vencimento; sem operação de alteração no Asaas nessa execução. |
| P4-F4 | **Há evidência histórica de correção validada em 15/09/2026** | Banner usa `overdueDueDate`; commit `0d1ef94` registrado. |
| P4-F5 | **Validação real do bloqueio no 4º dia: NÃO COMPROVADA aqui** | Documento original ainda planeja checagem para 16/09; falta resultado da execução, estado final e evidência da assinatura preservada. |
| P4-F6 | **Pagamento após bloqueio e reativação: NÃO COMPROVADOS aqui** | Exige validação do caso `inactive`, webhook perdido e reconciliação; não promover automaticamente para PASS. |
| Aplicação da separação HML/PROD a P4 | **Parcialmente implementada/testada em código local; efeito remoto desconhecido** | Asaas A1 de 19/10 validou projeto/ambiente/credencial e token do webhook, sem deploy. A origem já é verificada no reconciliador local; o cron de bloqueio ainda precisa proteção equivalente, conforme conferência abaixo. |
| Ledger/idempotência nova de webhook | **Trabalho local reportado, integração operacional ainda sem prova** | Testes locais relatados em 20/10 não equivalem a processamento do endpoint Asaas PROD publicado. |

### Regras P4 que permanecem válidas

- Asaas é autoridade das cobranças/pagamentos; o backend decide `subscriptionStatus`; o Flutter apenas apresenta. A assinatura financeira é escopada por `stores/{storeId}.asaasSubscriptionId`, com prova `subscription.id`, `externalReference` e customer quando aplicável.
- `overdueDueDate` é a **data civil canônica do vencimento**; `overdueSince` é histórico da detecção. Calcular dias em `America/Sao_Paulo`: atraso 1–3 dias com tolerância; **bloqueio de acesso no dia 4**.
- Bloquear a loja **não cancela** a assinatura Asaas nem apaga produtos, vendas ou histórico. `blockedAt` é evidência do bloqueio, não prova de cancelamento.
- `reconcileAsaasBilling` (01:30) antecede `checkOverdueSubscriptions` (02:00), **conforme contrato documentado**; o escalonamento remoto efetivamente publicado ainda exige inventário. Reconciliação somente leitura no Asaas; atualização condicional do Firestore para não sobrescrever estado novo.
- A documentação histórica exclui `inactive` do reconciliador. Portanto, **não presumir reativação automática após pagamento**. P4-F6 deve formalizar decisão e recuperação segura antes de habilitar cobrança PROD com bloqueio.

### Novas condicionantes impostas pelo modelo de ambientes (P4 × P5)

1. **Origem financeira e projeto:** nenhum job P4 deve consultar, reativar ou bloquear uma loja com ID financeiro de Sandbox/ambiente desconhecido como se fosse Asaas PROD. Exigir prova do vínculo antes de efeitos; legado não classificado deve ser preservado e encaminhado para regularização controlada.
2. **Rotinas autônomas:** antes de implantar P4 em `store-connect-app`, mapear revisões e agendas de `checkOverdueSubscriptions`, `reconcileAsaasBilling`, `syncAsaasSubscriptionPrices` e `expireTrials`. Um bloqueio de operações iniciadas pelo cliente não protege automaticamente jobs agendados nem código Admin.
3. **Webhook:** A1 implementou *localmente* `asaas-access-token` com `ASAAS_WEBHOOK_TOKEN` independente e falha fechada; ainda requer provisionamento remoto e evidência do endpoint publicado. Ledger, concorrência, evento repetido/fora de ordem, status de erro e recuperação não devem ser declarados homologados sem integração E2E.
4. **Trial:** sete dias gratuitos do primeiro piloto começam no primeiro dia **efetivo** de uso após configuração, sem pagamento inesperado. `trialEndDate` histórico ou `blockedAt` antigo não deve iniciar cobrança, desbloquear acesso ou converter Sandbox em PROD por inferência.
5. **Recebimento após bloqueio:** desenhar/verificar função de regularização para `inactive` que só reative após prova da assinatura oficial, origem e ausência de cobranças vencidas; recuperar falta de webhook por reconciliação direcionada e auditar toda transição. Não criar exceção automática ainda.
6. **CPF/CNPJ e registros antigos:** `cpfs_cadastrados` e vínculos financeiros de lojas pré-PROD precisam de verificação de ownership e estratégia não destrutiva antes do cadastro comercial amplo.

### Critérios objetivos de aceite P4 para cobrança real controlada

- Resultado de P4-F5 e P4-F6 registrado para os fluxos aplicáveis. Eventual limitação operacional para um teste controlado depende de decisão específica; este documento não aprova retirada de funcionalidades nem bloqueios indevidos da cliente gratuita.
- Webhook e jobs de efeito financeiro comprovadamente não tratam vínculo sem origem verificada como assinatura PROD.
- Eventos de pagamento repetidos/falhos têm comportamento idempotente e recuperação definida; sem HTTP 200 para falha que precise de retry antes de uma persistência durável confiável.
- Mecanismo de contingência: suspender novas cobranças/efeitos financeiros de maneira autorizada, mantendo leitura, rastreabilidade e dados; não usar exclusão como fallback.
- Teste E2E com pagamento verdadeiro limitado **somente após autorização específica**, nunca na loja de perfumaria usada para o piloto gratuito.

### Evidências e referências da revisão

- `P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md` histórico: estados, períodos, crons, evidência 15/09, F5/F6 ainda pendentes.
- `StoreConnect_ASAAS_A1_RESULTADO.txt` (19/10): configuração e autenticação implementadas/testadas **somente localmente**, bloqueio PROD ativo.
- `StoreConnect_ASAAS_AUDITORIA_CONFIG_PROD.txt` (19/10): lacunas em criação, webhook, rotinas, ligações legadas e atualização de cobranças; é fotografia anterior à A1, não atualizar automaticamente como resolvidas.
- Questionário `Texto pegado(20261020-181712).txt` (20/10): inventário de riscos e observações remotas declaradas; perguntas não são evidência de PASS.
- Relatos de testes de ledger em 20/10: 57 testes locais + 18 Emulator reportados como aprovados pelos documentos de revisão; logs primários não localizados nesta conferência. Sem prova de implantação ou conexão à Function pública.

---


## Conferência local dirigida e limites da atualização oficial

Fontes de revisão: [P4 revisada](../revisao_p4_p5_20261020/P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md), [P5 revisada](../revisao_p4_p5_20261020/P5_PREPARACAO_PRODUCAO_ASAAS.md) e [matriz das 50 questões](../revisao_p4_p5_20261020/P4_P5_MATRIZ_50_QUESTOES_E_EVIDENCIAS.md). A matriz declara não ter lido o código; a presente atualização acrescenta a inspeção local abaixo, sem executar testes ou consultar ambientes remotos.

| Ponto | Evidência local conferida em 20/10 | Limite ou pendência concreta |
| --- | --- | --- |
| Configuração e autenticação | `functions/financeiro/asaasConfig.js`, `asaasSecrets.js` e `asaasWebhookAuth.js`: pares projeto/ambiente, `ASAAS_CREDENTIAL_ENV`, secrets homônimos por projeto e autenticação do token. `operationsEnabled` só é verdadeiro em Sandbox. | Não há liberação PROD por simples variável. Estado de secrets, bindings e código remoto não foi consultado. |
| Origem de vínculo | `asaasBindingOrigin.js`: IDs existentes sem origem explícita são recusados; origem parcial/divergente também. Sem IDs nem origem retorna `new_unbound`; isso não comprova titularidade nem autoriza cobrança. | Provar todos os consumidores e regularizar legados por fluxo autorizado, sem inferir ambiente pelo ID. |
| Reconciliador | `reconcileAsaasBilling.js` contém `SKIP_UNVERIFIED_BINDING_ORIGIN` antes da consulta da assinatura e usa o resolvedor bloqueado em PROD. | Código local não comprova versão agendada em HML/PROD. Continua necessário tratar recuperação de `inactive`. |
| Cron de bloqueio | Corpo de `checkOverdueSubscriptions`, em `functions/index.js`, consulta `overdue`, calcula data civil, grava `inactive`/`blockedAt` em batch e preserva a assinatura. | Não foi encontrado guard de origem dentro desse handler. O batch não demonstra a mesma proteção de versão do reconciliador. Comentário antigo diz cancelar, mas o corpo inspecionado não cancela; não reproduzir esse comentário como regra. |
| Webhook | `asaasWebhook.js` autentica, verifica origem, usa precondição `lastUpdateTime` e contém retornos 503 em falhas/conflitos. Componentes `asaasWebhookLedger.js`, scanner e processor local existem. | O handler não importa esses componentes. Autenticação/precondição não equivalem a ledger integrado nem certificam todos os ACKs/eventos. |
| Pagamento após bloqueio | O ramo `PAYMENT_RECEIVED/PAYMENT_CONFIRMED` pode escrever `active` após verificar ausência de atraso; não deve ser descrito como inexistente. | Há divergência a resolver com a regra histórica de não reativar `inactive` automaticamente. Não homologar todos os motivos de inativação nem recuperação sem webhook. Manter P4-F6 aberta; esta documentação não aprova mudança dessa regra. |
| Trials | `expireTrials.js` contém expiração transacional com auditoria, usa `trialEndDate` e preserva planos pagos ativos. | Não comprova início do piloto após configuração, sete dias efetivos, extensão nem acesso E2E sem cobrança. Expiração de trial não é inadimplência de fatura. |

Os resultados de 62 testes A1 e 57 + 18 do ledger são **relatos das revisões**, não testes executados nesta atualização. `StoreConnect_ASAAS_A1_RESULTADO.txt`, `StoreConnect_ASAAS_AUDITORIA_CONFIG_PROD.txt` e o questionário `Texto pegado(20261020-181712).txt` não foram localizados entre os arquivos versionados/não ignorados pesquisados do repositório; permanecem referências externas da revisão, sem validação primária aqui. Nenhum resultado remoto foi confirmado.

### Decisão preservada sobre recorrência

O histórico de `docs/codex/CURRENT_WORK.md` registra teste **Sandbox** em que pagamento com cartão converteu assinatura e cobrança futura de `UNDEFINED` para `CREDIT_CARD`. Um experimento com `updatePendingPayments=true` reverteu ambas, preservando identificadores e valores. A decisão do proprietário foi **não automatizar** essa normalização após cada pagamento nem inseri-la no webhook. Pix/boleto permanecem hipótese não comprovada; H_Carl sofreu intervenção manual e não é amostra de recorrência espontânea. Esta atualização não muda essa decisão nem a extrapola para PROD.

### Relação com lançamento e P5

Asaas cobra a assinatura do SaaS; vendas de mercadorias, estoque, fiado e caixa do PDV têm contratos F9 próprios. D1–D4 já foram aprovadas e implementadas **localmente**, conforme [execução Android 03](../release/PROD_EXECUCAO_COMERCIAL_ANDROID_03_RESULTADO.txt); não constituem admissão financeira Asaas por loja nem deploy. S01 comercial, recebimentos, fiado e offline ainda exigem integração segura; não declarar exclusividade ou PROD homologado.

O acesso à faixa Produção da Google Play e a questão das políticas Asaas/Play já estão resolvidos pelo proprietário. Permanecem as validações técnicas da candidata específica. O piloto gratuito e a proteção das duas lojas seguem a [P5](P5_PREPARACAO_PRODUCAO_ASAAS.md), com sete dias iniciados no primeiro uso efetivo, ausência de cobrança inesperada e conciliação diária.

O corpo abaixo conserva evidências históricas, inclusive lojas e commits de setembro; essas observações não certificam a revisão atual nem identificam por si o ambiente Asaas financeiro usado. A agenda de 16/09 é histórica, não a próxima data de execução. Não foi localizada evidência posterior suficiente para encerrar F5/F6.

---
Documentação oficial da arquitetura de detecção de inadimplência, período de tolerância, reconciliação financeira, bloqueio de acesso e integração com o Asaas no Store&Connect.

> Este documento é a referência oficial da P4 financeira.
> Toda alteração relevante nas regras de inadimplência, cobrança, tolerância, reconciliação ou bloqueio deve ser registrada aqui.

=====================================================================

# 📌 STATUS HISTÓRICO DA P4 — veja a atualização de 20/10 acima

```text
✅ P4-A — Diagnóstico do webhook de cobrança
✅ P4-B — Correção da classificação financeira
✅ P4-D — Isolamento financeiro por assinatura
✅ P4-E — Auditoria de histórico Asaas
✅ P4-F1 — Diagnóstico completo de inadimplência
✅ P4-F2 — Proteção do bloqueio
✅ P4-F3 — Reconciliação financeira
✅ P4-F4 — Interface de aviso de inadimplência

🟡 P4-F5 — Validação do bloqueio real no dia 4
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

## H_Carl

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

# ✅ INTERFACE FLUTTER — P4-F4 CONCLUÍDA

A P4-F4 foi concluída e validada em 15/09/2026.

A auditoria identificou que o `warning_banner.dart` ainda utilizava:

```text
overdueSince
```

para calcular os dias restantes de tolerância.

Esse comportamento era incorreto porque `overdueSince` representa o momento em que o Store&Connect detectou o atraso, e não a data real de vencimento da cobrança.

A interface foi corrigida para utilizar:

```text
overdueDueDate
```

como fonte canônica do cálculo visual.

A regra aplicada ficou:

```text
Vencimento: 12/09/2026

13/09 → 3 dias antes do bloqueio
14/09 → 2 dias antes do bloqueio
15/09 → último dia de tolerância
16/09 → dia de bloqueio
```

O campo:

```text
overdueSince
```

permanece somente como informação de auditoria.

## Validação real — Master Gelo

Em 15/09/2026:

```text
subscriptionStatus = overdue
overdueDueDate      = 2026-09-12
dias de atraso      = 3
```

O Asaas confirmou a cobrança de 12/09/2026 como vencida há 3 dias.

O Store&Connect exibiu corretamente:

```text
Atenção: Hoje é o último dia de tolerância.
Seu acesso será bloqueado amanhã se o pagamento não for identificado.
```

Também foi validado que o botão:

```text
VER FATURA
```

continua abrindo normalmente a tela `Minha Assinatura`.

Na tela financeira foram confirmadas as cobranças:

```text
12/08/2026 → PAGO
12/09/2026 → ATRASADO
12/10/2026 → A VENCER
```

Nenhuma alteração foi realizada no Asaas durante a correção do banner.

Commit da correção:

```text
0d1ef94 — fix(financeiro): alinhar banner ao vencimento canonico
```

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
99529d1 — docs(financeiro): documentar inadimplencia e reconciliacao Asaas
0d1ef94 — fix(financeiro): alinhar banner ao vencimento canonico
```

=====================================================================

# 🚧 PRÓXIMAS ETAPAS

```text
P4-F5
→ roteiro histórico previsto para 16/09/2026; obter evidência de execução ou reagendar validação autorizada
→ validar reconcileAsaasBilling às 01:30
→ validar checkOverdueSubscriptions às 02:00
→ confirmar subscriptionStatus = inactive
→ confirmar blockedAt
→ confirmar overdueDueDate preservado
→ confirmar assinatura Asaas preservada

P4-F6
→ pagar cobrança após bloqueio
→ validar webhook
→ validar regularização
→ validar reativação do acesso
→ definir comportamento seguro de INACTIVE se o webhook de recuperação for perdido
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
