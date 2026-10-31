# P5 — Preparação de Produção Asaas

> **ATUALIZAÇÃO OFICIAL 20/10/2026 — P5 EM IMPLEMENTAÇÃO PARCIAL (NÃO HOMOLOGADA EM PROD)**
> O cabeçalho anterior “planejamento documental” referia-se à **criação inicial** da P5; deixou de representar sozinho o estado atual. A base abaixo continua contendo os requisitos originais, mas **esta revisão é a referência para o status**. Nenhuma alteração remota, secret, cobrança ou deploy foi realizada por esta atualização documental.

## Estado executivo e objetivo comercial atual

**Objetivo aprovado:** Store&Connect Android completo e seguro publicado na **Google Play Produção**, com Firebase PROD `store-connect-app`, Asaas PROD para **assinatura do SaaS**, primeira loja própria para teste de transações reais limitadas e segunda loja da cliente de perfumaria com **sete dias efetivos gratuitos**. A cliente manterá planilhas/controles paralelos e registrará as vendas reais no aplicativo para conciliação diária. O teste da loja própria não deve gerar transações nos registros da cliente.

A conta Play Console **já tem acesso à faixa Produção**, e a questão das **políticas de assinatura Asaas na Google Play já foi resolvida pelo proprietário**. Não voltar a listá-las como pendências genéricas. Ainda é necessário compilar, assinar, testar e submeter a **versão específica** à análise da Google.

| Dimensão | Conhecido e documentado até 20/10/2026 | Prova que ainda falta |
| --- | --- | --- |
| Arquitetura HML/PROD | Contrato local `../firebase/PROD_VS_HML_OPERATING_MODEL.md`. HML: `store-connect-hml` + Asaas `sandbox`; PROD: `store-connect-app` + `production`. Configuração/flavors do Flutter descritos; `applicationId` comercial compartilhado historicamente entre HML/PROD. | Validar o **artefato** publicado em cada faixa, revisões remotas, assinatura e seleção de Firebase efetiva no dispositivo. |
| Resolvedor Asaas A1 | **Implementado/testado localmente em 19/10:** exige `ASAAS_ENV`, `ASAAS_CREDENTIAL_ENV`, projeto canônico (`GCLOUD_PROJECT` ou `GOOGLE_CLOUD_PROJECT`) e coerência de combinações; rejeita divergências. 62 testes Node PASS + regressão pura. | Deploy seletivo, bind/env por projeto, validadores de conta/chaves reais e E2E. |
| Autenticação webhook A1 | **Implementada/testada localmente:** `asaas-access-token` validado contra secret próprio `ASAAS_WEBHOOK_TOKEN`; ausência/erro de secret retorna 503; token inválido retorna 401, antes de efeitos. | Provisionar secret em PROD, alinhar token do Asaas de maneira segura, teste de webhook real, semântica de eventos, persistência e retry. |
| Bloqueio de operações Asaas PROD | `operationsEnabled=false` no código local da A1, **intencional**. Não existe simples flag segura de cliente que libere PROD. | Implementar e testar caminho de ativação controlada, preferencialmente por loja, somente após gates técnicos e autorização remota. |
| Endpoint já existente em PROD | **Conforme levantamento do usuário em 20/10:** `asaasWebhook` publicado em `us-central1` e configurado no painel Asaas PROD. | Revisão exata publicada, secrets e credenciais utilizados, autenticação e comportamento real do endpoint. A1 não foi implantada por esse fato. |
| Secrets no PROD | **Conforme levantamento do usuário:** `ASAAS_API_KEY` v2 habilitada, mas nenhuma chave ativa confirmada; `ASAAS_WEBHOOK_TOKEN` ainda não encontrado. | Instalar material correto com autorização, sem exposição; provar bindings, versão consumida e origem. |
| Vínculos financeiros legados | Existem lojas de testes anteriores no projeto Firebase PROD com IDs Asaas Sandbox, segundo histórico do projeto. Há `subscriptionLegacyRegistry`, mas classificação completa e efeito de todas as rotas ainda não homologados. | Inventário **somente leitura**, classificação de origem e regularização não destrutiva por loja; checagem `cpfs_cadastrados`. |
| Webhook ledger/processor 02b | Foram relatados **57 testes locais + 18 Emulator PASS** para componentes isolados; integração ao endpoint PROD ainda não comprovada. | Validação de concorrência, ordenação, persistência, HTTP retry, reconciliador e deploy, sem tratar testes de componente como E2E real. |
| P4 inadimplência | P4-A/B/D/E/F1–F4 historicamente concluídas; regra de três dias de graça e bloqueio no quarto. | P4-F5/F6 não confirmadas; origem financeira nos jobs, recuperação de `inactive`, reconciliação e cron PROD. |
| Android Google Play | `targetSdk/compileSdk 36`, `minSdk 24`, NDK 27 constatados em configuração local no relatório comercial Android 01; `versionCode` local 49. | Conferir maior versionCode já usado, build comercial assinado, AAB compatível, 16 KB, App Check release, instalação/atualização e Play review. |
| F9 e outras funções comerciais | V2 e identidade durável demonstrados com SQLite + Firestore Emulator; D1–D4 aprovadas e implementadas/testadas **localmente** na execução Android 03, sem corte remoto. | Checkout Android comercial, outros writers, offline/fiado/caixa e homologação Samsung. Não confundir Asaas cobrança SaaS com venda de mercadoria no PDV. |

## Contrato operacional HML × PROD consolidado

| Configuração | HML | PROD |
| --- | --- | --- |
| Projeto Firebase | `store-connect-hml` | `store-connect-app` |
| `ASAAS_ENV` | `sandbox` | `production` |
| `ASAAS_CREDENTIAL_ENV` | `sandbox` | `production` |
| Projeto de processo | `GCLOUD_PROJECT` ou `GOOGLE_CLOUD_PROJECT`, coerente e validado | Idem |
| Secret de API outbound | `ASAAS_API_KEY` **do próprio projeto** | `ASAAS_API_KEY` **do próprio projeto** |
| Secret de entrada webhook | `ASAAS_WEBHOOK_TOKEN` **do próprio projeto** | `ASAAS_WEBHOOK_TOKEN` **do próprio projeto** |
| URL Asaas | `https://api-sandbox.asaas.com/v3` | `https://api.asaas.com/v3` |
| Operações financeiras no A1 local | Admissíveis somente no par HML/sandbox autorizado | **Bloqueadas** até ativação explícita/homologada |

Os nomes `ASAAS_SANDBOX_API_KEY` e `ASAAS_PRODUCTION_API_KEY` da primeira versão da P5 são **alternativas históricas não implementadas**. O contrato A1 conserva `ASAAS_API_KEY` por projeto Firebase isolado e cria `ASAAS_WEBHOOK_TOKEN`. As strings reais **não** devem constar do Markdown, log, AAB ou chat.

Os arquivos `.env`, `.env.store-connect-hml` e `.env.store-connect-app` não substituem secrets. A existência local dos dois arquivos específicos foi informada em 20/10, porém é necessário comprovar como a CLI seleciona a configuração durante cada deploy, inclusive `ASAAS_ENV` e `ASAAS_CREDENTIAL_ENV`, sem confiar no `.env` genérico. Nenhum teste de deploy é implícito.

## Legado Sandbox em Firebase PROD: política de preservação

1. **Não apagar, reinicializar nem migrar em massa** lojas, produtos, históricos, cadastros ou assinaturas vinculadas a Sandbox no `store-connect-app`. A loja da cliente de perfumaria já possui dados reais e deve ser preservada.
2. Distinguir origem **comprovada PROD**, **comprovada Sandbox**, **sem origem verificável**, **sem vínculo** e **teste histórico**. Um ID existente não prova ambiente; `subscriptionStatus=active` ou `trialEndDate` antigo não comprovam direito a cobrança PROD.
3. Validar `asaasBindingEnvironment`, `asaasBindingProjectId`, `externalReference`, `subscription.id`, customer e titularidade, quando disponíveis; `classifyAsaasBindingOrigin` já foi conferido no código local: recusa IDs existentes sem origem e origem parcial/divergente; admite cadastro sem vínculo como `new_unbound`. A cobertura de cada função consumidora e os testes de integração ainda precisam prova específica. Não reutilizar IDs Sandbox em Asaas PROD por inferência.
4. Implantar admissão financeira controlada por **loja autorizada** antes de testar cobrança real. O bloqueio `operationsEnabled` global A1 não é prova de allowlist por loja já implementada.
5. Regularizar vínculos somente em fluxo auditável, autorizado e não destrutivo. Antes de abrir cadastro comercial amplo, checar colisões de CPF/CNPJ em `cpfs_cadastrados` e ownership.

## Piloto comercial de sete dias: contrato de negócio

- Contagem de trial inicia no **primeiro dia efetivo após instalação/configuração**, não na data em que se cadastrou ou terminou de cadastrar os produtos. Registrar início e término por backend confiável; a regra exata de horário/fuso e contagem precisa contrato explícito e teste. Esta atualização não escolhe entre 168 horas e dias civis nem comprova o fluxo no produto.
- A cliente pode registrar vendas reais **sem emissão de uma assinatura paga ou cobrança antecipada**, desde que o fluxo de acesso trial esteja efetivamente implementado e homologado. **Não** assumir que isso já funciona com `createAsaasSubscription`/`expireTrials` atuais.
- Não usar automaticamente `nextDueDate` igual a hoje para um contrato com gratuidade futura: definir criação de assinatura após aceite e momento adequado, ou vencimento pactuado, garantindo ausência de cobrança no trial. Não inventar comportamento do Asaas.
- Somente o proprietário usará loja PROD separada para testes pagos pequenos, com custos/taxas explícitos e conciliação. Não criar clientes/pagamentos fictícios dentro da loja de perfumaria.
- Se o Asaas PROD não estiver pronto no final do trial, submeter ao proprietário uma **prorrogação formal e rastreável do acesso gratuito**, com prazo e fluxo implementado/testado. Não há aprovação automática de extensão nesta documentação; não gerar cobrança inesperada ou retroativa e respeitar o consentimento.
- Cliente opera app e planilha em paralelo por sete dias; planilha permanece referência inicial. Conciliar vendas, estoques, caixa, recebíveis e diferenças diariamente. Auditorias adicionais podem continuar durante piloto **desde que os riscos críticos já estejam resolvidos antes do uso real**.

## Gates prioritários — não transformar em auditoria infinita

1. **Antes de gerar cobrança real:** reconhecer o projeto PROD, key da conta certa, webhook de entrada autenticado, binding de assinatura da loja, idempotência criação/webhook, política trial/aceite, recuperação após falha/timeout e controle de jobs autônomos. Sem `operationsEnabled` liberado por atalho.
2. **Antes de ativar acesso financeiro amplo:** proteger `checkOverdueSubscriptions`, `reconcileAsaasBilling`, `syncAsaasSubscriptionPrices`, `expireTrials` e efeitos de perfis; definir recuperação de `inactive` e prova F5/F6. Distinguir bloqueio de acesso de cancelamento financeiro.
3. **Antes de vendas comerciais no app:** integrar checkout V2/idempotência, fiado/offline/caixa seguros, autorização/isolamento entre lojas, App Check e capacidade mínima de recuperar dados. Testes F9 locais não autorizam automaticamente PROD.
4. **Antes de publicação Google Play:** verificar assinatura, AAB versionCode ainda livre, atualização sem perda de dados, Play Integrity/App Check, compatibilidade 16 KB e conteúdo/ficha/declaracões pendentes realmente existentes. **Acesso Produção já liberado; política Asaas/Play já solucionada.**
5. **Depois de lançar:** acompanhamento real, conciliação diária, correções e auditorias complementares, sem criar cobranças duplicadas/inesperadas.

## Cronograma P5 atualizado e executável

| Etapa | Execução atual / próximos passos | Estado em 20/10 |
| --- | --- | --- |
| P5.0 — levantamento dirigido | Auditoria local de 19/10 e A1; conferir deltas sem repetir varredura geral. | **Parcialmente executada** |
| P5.1 — isolamento HML/PROD | Guard de projeto/ambiente/credencial na A1, 62 testes Node; falta prova remota e de origem de vínculo por consumidor. | **Implementada/testada localmente, incompleta para PROD** |
| P5.2 — secrets e configuração | Código usa slots por projeto e novo token; no PROD, token informado como ausente. | **Código parcial; provisioning PROD pendente** |
| P5.3 — webhook PROD | Autenticação local A1; ledger/scanner/processor locais relatados; integração publicada não comprovada. | **Em implementação; E2E pendente** |
| P5.4 — cobrança real controlada | Primeiro apenas loja própria autorizada, menor valor aceitável, condições/taxas e rastreio. | **Não executada** |
| P5.5 — inadimplência/reconciliação | P4 histórico reutilizável; gates de origem/jobs, F5/F6 e falhas pendentes. | **Parcial/histórico, não aprovado PROD** |
| P5.6 — E2E financeiro real | Customer → subscription → payment → webhook → Firestore → app; falhas, cancelamento e conciliação. | **Não executado** |
| P5.7 — build comercial Android | Preparação de versão, configuração, sign/AAB/Play pode ocorrer **em paralelo** às etapas financeiras; aprovação da candidata requer gates concluídos. | **Preparação em paralelo; candidata não homologada** |
| P5.8 — checklist de lançamento | Marcar individualmente com evidências. Não reiniciar gates Play e políticas Asaas já solucionados. | **Aberto** |
| P5.9 — publicação Google Play | Autorizar submissão da candidata, aguardar revisão, disponibilidade, instalar e só então iniciar trial efetivo. | **Não executada nesta preparação** |

**Execução do projeto em paralelo:** F9 Android e funcionalidades comerciais em uma frente; Asaas PROD em outra **sem edições simultâneas nos mesmos arquivos**; ficha Play/release preparada sem implantar. Qualquer deploy, secret, cadastro remoto, cobrança, migração, publicação ou alteração em dados da cliente exige autorização própria imediatamente antes.

### Evidências relatadas pelas revisões — limites conferidos na seção seguinte

- `StoreConnect_ASAAS_A1_RESULTADO.txt` (19/10/2026): 62 Node PASS, autenticação, variáveis, fail-closed PROD, somente código local.
- `StoreConnect_ASAAS_AUDITORIA_CONFIG_PROD.txt` (19/10/2026): riscos anteriores à A1 — origem de vínculos, cron de preços, timeout/criação, webhook não autenticado no estado pré-A1.
- `StoreConnect_ASAAS_PROD_P1_05_RESULTADO.txt`: seis checks puros PASS sem Firebase/Asaas.
- `PROD_EXECUCAO_COMERCIAL_ANDROID_01_RESULTADO.txt` e retomada `02`: checkout, Android, Rules, versionCode/config local; não certificam Asaas PROD.
- `P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md`: arquitetura P4 e evidências históricas de 15/09.
- `Texto pegado(20261020-181712).txt`: inventário de 50 dúvidas; itens apresentados como perguntas/achados relatados, não como testes aprovados.

---


## Evidências conferidas para esta atualização oficial

Foram comparados integralmente os deltas das duas revisões com os documentos oficiais e lida a [matriz de 50 questões](../revisao_p4_p5_20261020/P4_P5_MATRIZ_50_QUESTOES_E_EVIDENCIAS.md). O [modelo operacional HML/PROD](../firebase/PROD_VS_HML_OPERATING_MODEL.md) foi consultado: separação física, mesmo `com.storeeconnect.app`, flavors/entrypoints explícitos e **novo build PROD do código aprovado**. Track Play não escolhe backend; HML e PROD não são duas instalações independentes no Samsung.

O modelo de 11/10 ainda chama `ASAAS_SANDBOX_API_KEY`/`ASAAS_PRODUCTION_API_KEY` de nomes futuros. A implementação local mais recente em `functions/financeiro/asaasSecrets.js` usa `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` por projeto isolado. Esta P5 registra o delta sem alterar o documento de ambientes nem presumir provisionamento remoto. Nenhum valor de secret foi lido.

| Verificação local em 20/10 | Conclusão documental |
| --- | --- |
| `asaasConfig.js` / `asaasSecrets.js` / `asaasWebhookAuth.js` | Guards e autenticação existem; Asaas PROD permanece bloqueado pelo código local. Não confundir presença dos arquivos com revisão publicada. |
| `asaasBindingOrigin.js` / `reconcileAsaasBilling.js` | Classificador e skip de origem não comprovada estão implementados localmente. Isso supera a dúvida da matriz sobre existência; não fecha todos os consumidores nem homologação. |
| `asaasWebhook.js` | Contém origem, precondições de versão e erros transitórios. Não importa o ledger/scanner/processor novos. Integração durável e semântica de ACK/retry permanecem pendentes de prova. |
| `checkOverdueSubscriptions` em `functions/index.js` | Corpo preserva assinatura e bloqueia por data canônica, mas não demonstra guard de origem nem a precondição de versão do reconciliador. Não considerar todos os jobs protegidos pelo guard global outbound. |
| `expireTrials.js` | Expiração transacional/auditada já existe; não criar tarefa como se o módulo não existisse. Falta demonstrar início correto dos sete dias, renovação/aceite, extensão se aprovada e acesso sem cobrança. |
| [Android 03](../release/PROD_EXECUCAO_COMERCIAL_ANDROID_03_RESULTADO.txt) | D1–D4 implementadas localmente em Rules/Functions/writers; resultados históricos reportados: 272 TAP + 64 + 22 + 32 verificações Node e 143 Flutter/SQLite. Não reexecutados nesta atualização; conjunto mistura testes puros, Emulator Admin/Rules e integração local, sem homologação Android/PROD. |

As referências `StoreConnect_ASAAS_A1_RESULTADO.txt`, `StoreConnect_ASAAS_AUDITORIA_CONFIG_PROD.txt`, `StoreConnect_ASAAS_PROD_P1_05_RESULTADO.txt` e `Texto pegado(20261020-181712).txt` são citadas pelas revisões, mas não foram localizadas na pesquisa dos arquivos versionados/não ignorados desta árvore. Contagens A1/02b e observações do painel permanecem **relatos externos**, não PASS independente. As revisões dizem que o webhook PROD já estaria publicado e que faltaria token/chave confirmada; nada disso foi reconsultado ou provisionado nesta execução.

### Pendências concretas e fronteiras de responsabilidade

1. **Asaas:** concluir admissão financeira por loja; criação de assinatura durável após timeout/perda de resposta; conectar ledger ao endpoint, com ACK somente após persistência segura e reprocessamento; provar origem nos jobs e nos demais consumidores. A admissão F9 não substitui a financeira. Esta revisão documental não altera os módulos em trabalho na outra frente.
2. **P4:** registrar F5/F6, recuperação autorizada de `inactive` e caso sem webhook, agenda e revisão efetivamente publicadas; preservar o contrato financeiro e a decisão histórica de não forçar `UNDEFINED` após cada pagamento (ver P4).
3. **F9/Android:** D1–D4 não aguardam nova aprovação. Falta conectar o checkout comercial à identidade persistida/V2, implementar equivalentes seguros para recebimentos, fiado e offline e concluir compatibilidade F10. O relatório 03 demonstra risco residual de `markOrderAsPaid` em duas escritas durante o corte; S01 ainda duplica em `legacy`. Não ativar `authoritative` sem drenagem/evidência real e substitutos compatíveis.
4. **Firebase/Android/Play:** comprovar isolamento/autorização, App Check release, backup/recuperação, assinatura/AAB/configuração por ambiente, atualização e Samsung. Arquivos locais ou diagnóstico `dev.storeconnect.nativeprobe` não homologam o comercial. Verificar apenas pendências reais da ficha/declaracões; acesso à Produção e política Asaas já resolvidos.
5. **Trial e cobrança posterior:** implementar/provar início auditável no primeiro dia de uso efetivo, regra temporal explícita, acesso gratuito e condições aceitas para depois do piloto. Eventual extensão precisa decisão concreta e implementação; não emitir assinatura cobrável por inferência de datas antigas.

### Duas lojas e cronograma por marcos

| Marco e ordem | Entrega e condição para avançar |
| --- | --- |
| 1 — frentes locais coordenadas | F9 checkout/recebimentos/offline/fiado/F10 e Asaas criação/webhook/jobs/trial; preparação Play em paralelo, sem concorrência nos mesmos arquivos. Resolver riscos financeiros e perda de dados antes do uso real. |
| 2 — HML e Samsung | Validar a revisão identificada no ambiente isolado, transporte Firebase e fluxos completos no comercial. Registrar falhas/recuperação e preservação de pendências, sem confundir com Emulator. |
| 3 — preparação PROD autorizada | Conferir revisões/serviços/secrets/jobs, Rules, App Check, backup e admissão das lojas; implantar somente em execução explicitamente autorizada. Preservar dados existentes. |
| 4 — loja do proprietário | Loja independente para teste real de pequeno valor, limitado, rastreável, com taxas conhecidas e autorização específica; conciliar cobrança, pagamento, webhook, cancelamento/falhas e repetição. Sem transações de terceiros simuladas. |
| 5 — candidata e Google Play | Novo AAB PROD do código aprovado, assinatura/versão/testes; autorização específica para envio, revisão e publicação. Confirmar disponibilidade e download normal pela loja. Nenhuma data de aprovação Google é prometida. |
| 6 — loja da cliente / início do piloto | Conferir configuração, produtos/preços/estoque com a cliente, preservar sua loja PROD e iniciar os sete dias apenas quando pronta para primeiro uso efetivo. Não apagar/recriar/migrar em massa sem autorização específica. |
| 7 — sete dias efetivos e continuidade | Operação paralela com planilhas: conciliar diariamente quantidade/valor de vendas, itens, estoque inicial/final, Pix/dinheiro/outros recebimentos, caixa/diferenças, fiado/contas a receber, cancelamentos/devoluções/ajustes aplicáveis. Cobrança posterior somente nos termos aceitos. |

Não inserir fixtures ou vendas fictícias nas lojas reais. O proprietário e a cliente não podem acessar dados um do outro. O objetivo continua incluir todas as funcionalidades comerciais; melhorias não críticas e auditorias adicionais podem seguir durante o piloto. Datas serão fixadas a partir dos resultados dos marcos, sem reiniciar uma auditoria geral nem prometer PROD pronto.

---
Status histórico da criação: planejamento documental. A atualização oficial de 20/10 acima registra os avanços locais e prevalece para status. Os requisitos abaixo continuam aplicáveis; esta documentação não autoriza acesso remoto, secrets, cobranças, deploy ou publicação.

## 1. Objetivo

A P5 prepara o Store&Connect para operar comercialmente com clientes reais utilizando o ambiente de PRODUÇÃO do Asaas. Deve transformar a integração já existente/testada em uma operação segura para produção.

Objetivos principais:

- separar claramente Sandbox e Produção;
- proteger credenciais;
- validar cobranças reais;
- validar assinaturas;
- validar webhooks;
- validar cancelamentos;
- validar inadimplência e reconciliação;
- evitar duplicidade de efeitos;
- preparar build candidata de produção;
- criar checklist formal de lançamento.

## 2. Estratégia de distribuição

**GOOGLE PLAY — PRODUÇÃO**

Destinada a:

- clientes reais;
- versão estável;
- Asaas PRODUÇÃO;
- funcionalidades previamente homologadas.

**GOOGLE PLAY — TESTE FECHADO**

Destinada a:

- testadores;
- homologação contínua;
- novas funcionalidades;
- Asaas SANDBOX quando houver operações de pagamento;
- versões posteriores antes de promoção à produção.

Princípio:

> Teste fechado recebe primeiro.
> Produção recebe somente versões aprovadas.

## 3. Ambientes

A separação é obrigatória:

| Aspecto | TESTE / HOMOLOGAÇÃO | PRODUÇÃO |
| --- | --- | --- |
| Distribuição Android | Google Play Teste Fechado | Google Play Produção |
| Asaas | Sandbox | Produção |
| Dados e público | Dados de teste e testadores | Clientes reais |
| Cobranças | Nenhuma cobrança real | Cobranças reais |
| Webhooks | Do ambiente de teste | Webhooks reais |
| Acompanhamento | Homologação | Monitoramento reforçado |

Nunca misturar credenciais ou endpoints entre ambientes.

## 4. Princípio de segurança Asaas

Regra arquitetural: o aplicativo Flutter NÃO deve possuir a API Key privada do Asaas.

Fluxo esperado:

```text
APP
  ->
BACKEND / CLOUD FUNCTIONS
  ->
ASAAS
```

A chave Asaas permanece exclusivamente em backend seguro. NÃO incluir em:

- código Dart;
- APK;
- AAB;
- JavaScript Web;
- repositório Git;
- logs;
- payload enviado ao cliente.

## 5. Secrets

Nomes alternativos propostos na criação inicial, substituídos no contrato local A1 pelos slots homônimos por projeto descritos acima:

```text
ASAAS_SANDBOX_API_KEY
ASAAS_PRODUCTION_API_KEY
```

Preservados como histórico da proposta, sem exigir renomeação de secrets. O código local conferido usa `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_ENV` e `ASAAS_CREDENTIAL_ENV`; bindings e revisões remotas continuam sujeitos à validação autorizada.

Antes de implementar:

- auditar onde a chave atual é armazenada;
- auditar como Functions recebem secrets;
- auditar se existe chave hardcoded;
- auditar logs;
- auditar arquivos `.env`;
- auditar configuração do Firebase/Cloud.

Nunca copiar secret real para documentação.

## 6. Seleção de ambiente

O ambiente Asaas NÃO deve ser escolhido livremente pelo aplicativo cliente. Evitar contrato vulnerável como `environment = "production"` enviado pelo Flutter e aceito diretamente pelo backend.

A escolha de Sandbox/Produção deverá ser determinada por configuração segura do backend/deploy. O cliente não pode promover a própria operação de Sandbox para Produção.

## 7. Relação com P4

A P5 deve reutilizar e integrar as decisões de [P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md](P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md). P5 NÃO substitui P4.

P4 trata principalmente:

- inadimplência;
- reconciliação;
- estados de pagamento;
- recuperação de inconsistências financeiras.

P5 trata:

- preparação operacional para ambiente real;
- segurança;
- validação de produção;
- publicação comercial.

As duas fases devem convergir antes do lançamento. Preservar os contratos da P4: isolamento pela assinatura oficial da loja, validação de vínculo, data canônica de atraso, distinção entre bloqueio de acesso e cancelamento, e reconciliação sem alteração do Asaas. Pendências de recuperação de `inactive` devem ser auditadas e resolvidas pelo contrato aplicável antes do lançamento, sem presumir reativação automática.

## 8. P5.0 — Auditoria da integração atual

Levantamentos já foram relatados; conferir apenas deltas e lacunas do circuito financeiro atual, sem repetir auditoria geral:

- Functions relacionadas ao Asaas;
- criação de customer;
- criação de subscription;
- criação de payment;
- cancelamento;
- webhooks;
- persistência no Firestore;
- IDs Asaas armazenados;
- estados de assinatura;
- tratamento de erro;
- retries;
- idempotência;
- logs;
- secrets;
- ambiente atual Sandbox/Produção.

Reutilizar relatórios existentes e registrar evidências, lacunas e próximas alterações mínimas, sem secrets ou dados sensíveis. Os relatos externos e a inspeção dirigida estão qualificados na atualização acima; a P5.0 não é certificação integral do circuito PROD.

## 9. P5.1 — Separação Sandbox × Produção

Objetivo: garantir que Sandbox e Produção sejam ambientes explicitamente distintos.

Validar:

- base URL;
- secret;
- webhook;
- clientes;
- subscriptions;
- payments;
- identificadores;
- configuração de deploy.

Nenhum identificador Sandbox deve ser interpretado como Produção. Nenhuma cobrança de teste pode aparecer como cobrança real.

## 10. P5.2 — Secrets e configuração segura

Objetivo: garantir que credenciais de Produção existam somente no backend.

Validar:

- secret manager/configuração segura;
- nenhum secret no Git;
- nenhum secret no Flutter;
- nenhum secret no Hosting;
- nenhum secret em logs;
- acesso mínimo necessário;
- processo de rotação de chave.

Documentar, na etapa futura e após auditoria, o procedimento de troca emergencial da chave: responsável e autorização, contenção do incidente, substituição segura no backend, revogação da chave comprometida, validação controlada e registro rastreável. A sequência operacional deverá respeitar a arquitetura real e evitar novas cobranças indevidas. Nenhuma troca é realizada nesta etapa documental.

## 11. P5.3 — Webhooks de produção

Auditar e preparar:

- endpoint;
- autenticação/validação;
- identificação do evento;
- idempotência;
- eventos duplicados;
- eventos fora de ordem;
- retry do Asaas;
- falhas temporárias;
- logs seguros;
- atualização do Firestore.

Eventos relevantes devem ser levantados a partir da integração real já existente antes de decidir lista definitiva. Não inventar handlers sem auditar o código atual. Usar a P4 como referência e confirmar o comportamento efetivo na P5.0.

## 12. Idempotência

Regra obrigatória: o mesmo webhook recebido duas ou mais vezes NÃO pode:

- duplicar cobrança;
- duplicar assinatura;
- duplicar movimento financeiro;
- alterar estado incorretamente;
- gerar efeitos colaterais repetidos.

Planejar chave/id de idempotência baseada nos identificadores reais fornecidos pelo Asaas. Definir o contrato somente após auditoria, incluindo concorrência, reprocessamento e separação por ambiente.

## 13. P5.4 — Assinatura / cobrança real controlada

Antes de liberar clientes reais, executar teste controlado com ambiente de Produção, em etapa futura explicitamente autorizada.

Preferencialmente com:

- conta controlada;
- valor pequeno;
- cliente de teste autorizado.

Validar ciclo:

1. criação do customer;
2. criação da assinatura;
3. criação/geração da cobrança;
4. pagamento;
5. recebimento do webhook;
6. atualização no Store&Connect;
7. situação final coerente.

Não realizar cobrança real sem autorização explícita na etapa futura. Qualquer acesso ou operação em produção exige autorização explícita de Rodrigo imediatamente antes da execução.

## 14. P5.5 — Cancelamento, inadimplência e reconciliação

Integrar com P4. Cobrir:

- assinatura cancelada;
- pagamento vencido;
- pagamento recebido após atraso;
- cobrança cancelada;
- falha de cobrança;
- status divergente;
- webhook perdido;
- reconciliação posterior.

O Store&Connect não deve depender exclusivamente de um único webhook para manter verdade financeira permanente. Preservar a diferença entre cancelamento comercial e bloqueio por inadimplência definida na P4.

## 15. Fonte de verdade

Definir durante auditoria, respeitando P4 e implementação existente:

- quais estados são autoritativos no Asaas;
- quais estados são cache/espelho no Firestore;
- quando reconciliar;
- como tratar divergência.

Não definir arbitrariamente sem auditar P4 e implementação existente. A P4 já distingue cobranças/pagamentos no Asaas e estado operacional no Firestore; a P5 deverá confirmar essa divisão e suas condições de atualização em Produção, sem criar uma autoridade concorrente no aplicativo.

## 16. P5.6 — Teste E2E real

Executar fluxo completo controlado, somente com autorização explícita para a etapa real:

```text
APP
 -> BACKEND
 -> ASAAS PRODUÇÃO
 -> WEBHOOK
 -> FIRESTORE
 -> APP
```

Validar:

- assinatura;
- cobrança;
- pagamento;
- atualização;
- cancelamento;
- atraso;
- reconciliação;
- duplicidade;
- erro de rede;
- webhook repetido.

Produzir checklist de resultado com cenário, resultado esperado, resultado observado, evidência minimizada e aprovação ou pendência. Não executar esses testes nesta etapa documental.

## 17. Cliente já existente no Asaas

Auditar comportamento quando:

- CPF/CNPJ já possui customer;
- customerId já está salvo;
- customerId salvo é inválido;
- customer pertence a Sandbox;
- customer pertence a Produção;
- cadastro local e Asaas divergem.

Não criar clientes duplicados silenciosamente. Validar vínculo e ambiente antes de reutilizar identificadores, preservando o isolamento financeiro pela assinatura oficial previsto na P4.

## 18. Assinatura duplicada

Garantir que ações repetidas no aplicativo não criem múltiplas assinaturas pagas para o mesmo contrato quando isso não for intencional.

Avaliar:

- double tap;
- retry;
- timeout;
- resposta perdida;
- Function executada novamente.

A prevenção deve ser garantida no backend, inclusive quando o cliente desconhece o resultado da tentativa anterior.

## 19. P5.7 — Build candidata de Produção

A preparação técnica da build pode ocorrer em paralelo a P5.0–P5.6. A aprovação final e submissão dependem dos gates críticos aplicáveis e da autorização específica.

A build de Produção deverá:

- usar backend configurado para Asaas Produção;
- não carregar secret Asaas;
- possuir versionCode novo;
- possuir versionName apropriado;
- passar testes;
- passar assinatura Android;
- passar validação Play Console;
- possuir SHA registrado.

Registrar identificação, hash do artefato e fingerprint de assinatura aplicável. Não promover AAB HML: produzir novo build explicitamente PROD do código aprovado, conforme modelo operacional.

## 20. Teste Fechado permanente

Após abertura da Produção, manter o Teste Fechado permanentemente.

Exemplo conceitual de versões:

| Canal | Versões |
| --- | --- |
| Produção | 1.0.6 |
| Teste Fechado | 1.0.7, 1.0.8, 1.0.9 |

Novas funcionalidades entram primeiro no Teste Fechado. Depois da homologação, o código aprovado origina um novo build explicitamente configurado para Produção, respeitando a configuração de ambiente e a autorização de publicação. Os números acima não definem as próximas versões reais.

## 21. P5.8 — Checklist de lançamento

Checklist da candidata específica: cada item depende de evidência no ambiente aplicável. Há implementação local parcial conforme quadro acima; nenhum item assinalado por inferência. Acesso à faixa Produção e questão de políticas Asaas/Play já resolvidos pelo proprietário.

**BACKEND**

- [ ] Secrets Produção configurados.
- [ ] Sandbox separado.
- [ ] Functions corretas.
- [ ] Logs revisados.
- [ ] Idempotência validada.

**ASAAS**

- [ ] Customer validado.
- [ ] Subscription validada.
- [ ] Payment validado.
- [ ] Webhook validado.
- [ ] Cancelamento validado.
- [ ] Atraso validado.
- [ ] Reconciliação validada.

**ANDROID**

- [ ] Versão validada.
- [ ] VersionCode validado.
- [ ] Assinatura validada.
- [ ] MinSdk validado.
- [ ] AAB validado.
- [ ] Candidata, ficha e declarações aplicáveis validadas na Play Console (acesso à faixa Produção já liberado).
- [ ] SHA registrado.

**WEB**

- [ ] Versão validada.
- [ ] Hosting validado.
- [ ] Configuração validada.
- [ ] Comportamento financeiro validado.

**SEGURANÇA**

- [ ] Nenhum secret no cliente.
- [ ] Nenhum secret no Git.
- [ ] Nenhuma credencial em log.

**NEGÓCIO**

- [ ] Planos validados.
- [ ] Valores validados.
- [ ] Periodicidade validada.
- [ ] Regras de cancelamento validadas.
- [ ] Inadimplência validada.

Registrar resultado, evidência e responsável pela aprovação de cada item. Quando Web não for aplicável, justificar formalmente essa condição. Este checklist não autoriza deploy de Functions ou Hosting, nem publicação Play Store.

## 22. P5.9 — Publicação

Somente após gates críticos aplicáveis da candidata aprovados; documentar itens não aplicáveis, preservando funcionalidades comerciais previstas. Exige autorização específica para submissão/publicação.

Fluxo:

```text
CANDIDATO
 -> VALIDAÇÃO FINAL
 -> GOOGLE PLAY PRODUÇÃO
 -> MONITORAMENTO
 -> CLIENTES REAIS
```

Não publicar automaticamente após build. Exigir autorização explícita de Rodrigo imediatamente antes da publicação. Deploys e demais ações de produção também exigem autorização explícita imediatamente antes de sua execução.

## 23. Rollout

Considerar publicação gradual se a Play Console e estratégia do projeto permitirem.

Exemplo conceitual:

- grupo inicial;
- monitorar;
- ampliar;
- 100%.

Não decidir percentual agora. Avaliar no momento real do lançamento.

## 24. Monitoramento pós-lançamento

Após Produção, monitorar:

- erros de Functions;
- webhooks;
- falhas Asaas;
- pagamentos;
- assinaturas duplicadas;
- cancelamentos;
- divergências;
- crash Android;
- reclamações de clientes.

Definir janela reforçada de acompanhamento nos primeiros dias, responsáveis e critérios de escalonamento antes do lançamento.

## 25. Fallback / incidente

Se houver falha crítica:

- não gerar novas cobranças indevidas;
- bloquear novas operações financeiras se necessário;
- preservar dados;
- registrar incidente;
- reconciliar com Asaas;
- nunca corrigir manualmente estados financeiros sem rastreabilidade.

Não implementar mecanismo agora. Ações em produção e medidas destrutivas continuam sujeitas à autorização explícita imediatamente antes da execução.

## 26. Auditoria

Operações financeiras relevantes devem ser rastreáveis. Planejar registro de:

- storeId;
- customerId interno;
- Asaas customerId quando apropriado;
- subscriptionId;
- paymentId;
- evento recebido;
- status anterior;
- status novo;
- origem da mudança;
- timestamp backend.

Nunca registrar secrets. Definir os registros conforme os identificadores e vínculos reais auditados, aplicando minimização e acesso restrito.

## 27. Privacidade

Evitar logs desnecessários contendo:

- CPF/CNPJ completo;
- dados bancários;
- tokens;
- API keys;
- payloads financeiros integrais.

Aplicar princípio de minimização, inclusive em relatórios de teste, evidências de lançamento e registros de incidente.

## 28. Critérios de aceite da P5

P5 somente pode ser considerada concluída quando:

- Sandbox e Produção estão separados;
- secrets estão seguros;
- nenhum secret está no cliente;
- webhook Produção validado;
- idempotência validada;
- cobrança real controlada aprovada;
- cancelamento validado;
- inadimplência validada;
- reconciliação validada;
- duplicidade bloqueada;
- E2E Produção aprovado;
- candidato Android aprovado;
- candidato Web aprovado quando aplicável;
- checklist P5.8 aprovado;
- publicação explicitamente autorizada.

Documentação criada não significa P5 concluída nem comprova validação em Produção. Registrar evidências e resolver pendências da integração com P4 antes do lançamento.

## 29. Cronograma P5

Referência de escopos P5, complementada pelo cronograma por marcos e pelos status da atualização de 20/10. Não representa reinício obrigatório de todas as etapas; datas dependem das evidências e autorizações:

| Etapa | Escopo |
| --- | --- |
| P5.0 | Auditoria da integração Asaas atual |
| P5.1 | Separação Sandbox × Produção |
| P5.2 | Secrets e configuração segura |
| P5.3 | Webhooks de produção |
| P5.4 | Assinatura/cobrança real controlada |
| P5.5 | Cancelamento, inadimplência e reconciliação |
| P5.6 | Teste E2E real |
| P5.7 | Build candidata de Produção |
| P5.8 | Checklist de lançamento |
| P5.9 | Publicação em Produção |

## 30. Princípio final

O ambiente de Produção do Asaas representa dinheiro real.

Nenhuma operação financeira real deve depender apenas de validação de
interface ou de comportamento do aplicativo cliente.

A segurança, autorização, escolha de ambiente, idempotência e integridade
financeira devem ser garantidas pelo backend do Store&Connect.
