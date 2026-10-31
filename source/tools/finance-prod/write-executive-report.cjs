"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),folder=path.join(root,'build/prod-final-20261026'),read=n=>JSON.parse(fs.readFileSync(path.join(folder,n)));
const m=read('prod-metadata.json'),p=read('prod-deploy-preconditions.json'),c=read('candidate-checksums.json'),v=read('validation-results.json');
const command=fs.readFileSync(path.join(folder,'deploy-MINIMO_LEITURA-NAO_EXECUTADO.txt'),'utf8').trim(),full=fs.readFileSync(path.join(folder,'deploy-SETE_BLOQUEADO_TOKEN_E_GATES-NAO_EXECUTADO.txt'),'utf8').trim();
const rollback={project:m.project,executed:false,oldRevisions:Object.fromEntries(Object.entries(m.functions).filter(([,f])=>f.revision).map(([name,f])=>[name,{revision:f.revision,metadataSha256:f.metadataSha256,updateTime:f.updateTime}])),newFunctions:['getAsaasSubscriptionStateV1','reconcileAsaasSubscriptionV1','reviewAsaasSubscriptionAttemptV1'],sourceBackupAvailable:false,warning:'Metadata/revisions are not a deployable source backup. Never automatically restore sandbox environment in PROD or delete new functions.'};
fs.writeFileSync(path.join(folder,'rollback-plan.json'),JSON.stringify(rollback,null,2)+'\n');
const report=`[NO_GO_PROD_COMERCIAL - CORRECOES LOCAIS E CANDIDATA PROD ENTREGUES]
STORE&CONNECT - FINALIZACAO EXECUTIVA PROD - 26/10/2026
PROD PRIMEIRO. HML CONGELADO. Nenhuma chamada/remota ou alteração HML nesta rodada.

VEREDITOS SEPARADOS
APP_PROD_SEM_COBRANCA: GO para código local dirigido; NO-GO para declarar aparelho/instalação pronta.
  Leitor novo ainda ausente remotamente, nova versão Android pendente; não houve instalação.
DEPLOY_FINANCEIRO_PROD: NO-GO do conjunto completo de sete; candidata congelada, comando NÃO EXECUTADO.
  Proposta mínima: três consultas, em fase distinta, sujeita à aprovação e ao gate pré-escrita da CLI.
REABILITAR_ASAAS_PROD: NO-GO. NÃO autorizado e proteções atuais publicadas não comprovadas.
PRIMEIRA_COBRANCA_REAL: NO-GO. NÃO autorizada; nenhuma contratação/customer/cobrança realizada.
PUBLICACAO_GOOGLE_PLAY: NO-GO. Não submetido; Console/versão/programa de pagamentos pendentes.

1. IMPLEMENTACAO CONCRETA DESTA RODADA
functions/financeiro/faturas.js: o gate global PROD ocorria ANTES de autorizar/classificar o vínculo.
Agora, após validar configuração e proprietário/admin/loja, ausência total de vínculo retorna
no_subscription sem secret, HTTP ou escrita. Vínculo parcial permanece failed-precondition.
Portal sem vínculo continua precondição de domínio. Vínculo completo em PROD continua bloqueado
ANTES de admissão/secret/Asaas, com reason=provider_operations_disabled. Nenhum guard foi removido.
functions/financeiro/asaasSecrets.js: secret indisponível retorna somente reason=credential_unavailable;
não propaga valor, causa ou payload do provedor.
lib/services/subscription_billing_access.dart: mensagens distintas para bloqueio externo intencional
e credencial indisponível; contract exige consentToContract explícito fora do payload, default=false,
antes até da leitura/slot. Consultar nunca vira contratação.
lib/screens/subscription_screen.dart: só passa consentimento após confirmação do diálogo existente;
explica contratação desabilitada quando operationsEnabled=false. Botão continua bloqueado em erro.
Testes alterados: functions/tests/financeiro/billingReadConsolidation.test.js,
functions/tests/financeiro/asaasSecrets.test.js e test/subscription_billing_access_test.dart.
Ferramentas novas restritas em tools/finance-prod/: read-prod-metadata.cjs,
read-deploy-preconditions.cjs, prepare-prod-candidate.cjs, validate-prod-package.cjs,
run-directed-validation.cjs e este gerador. Sem refatoração F7/F9/F10 ou alteração de Rules/Android.

2. CADEIA REAL E DIAGNOSTICO
lib/main_prod.dart -> bootstrap(AppEnvironment.production) -> Firebase store-connect-app;
Android flavor prod, google-services oficial e com.storeeconnect.app preservados.
AuthGate lê usuário/loja e roteia; não cria cobrança nem altera subscriptionStatus.
subscription_screen -> SubscriptionBillingAccess.query -> getAsaasSubscriptionStateV1 (Firestore-only).
invoices_screen -> Firestore stores e listAsaasInvoices; portal -> getAsaasPortalUrl;
troca de plano -> changeAsaasPlan (fora do conjunto de sete e ainda precisa revisão coordenada).
Contratação: diálogo -> consentimento explícito -> persistência local de requestId -> createAsaasSubscription.
Não existe fallback de leitura para criação. Não foi usado Assinar Agora como diagnóstico.
UI já distingue not-found/unimplemented de unavailable, permissão, precondição e erro interno.
not-found isolado conserva ambiguidade serviço ausente/recurso inexistente; não inventa diagnóstico.
Leitura atual de metadata comprovou AUSÊNCIA do novo getAsaasSubscriptionStateV1 em us-central1.
Isso é um bloqueio concreto do cliente novo; não prova a causa de todos os internal/HTTP500 anteriores.
Os upstream 401 anteriores de listAsaasInvoices são evidência histórica, sem correlação nova de logs.
Chave desabilitada pode explicar 401; não prova causa única de internal ou de create HTTP500.

3. PROD PUBLICADO VERSUS LOCAL - FONTE ATUAL, SOMENTE METADADOS
Coleta: ${m.time} UTC; GETs Cloud Functions v2 por nome/us-central1, sem invocar handlers.
Publicador ${m.publisher.masked}, fingerprint ${m.publisher.fingerprint}.
${Object.entries(m.functions).map(([n,f])=>`${n}: HTTP${f.http}; ${f.state||'AUSENTE'}; revisão=${f.revision||'NENHUMA'}; atualizado=${f.updateTime||'N/A'}.`).join('\n')}
Todos os nomes existentes consultados: GEN_2/nodejs22/us-central1, sem label explícita de codebase;
CLI os considera default se não há label. Runtime atual verificado por fingerprint fbfc64a2e0ccf114
e identidade mascarada 29***@d***; candidata fixa essa mesma conta Gen2 Compute do projeto PROD.
ALERTA COMPROVADO: todos os existentes consultados carregam ASAAS_ENV=sandbox nos metadados;
ASAAS_CREDENTIAL_ENV não está presente na projeção. Isso não comprova qual URL o código antigo usou,
mas não satisfaz o contrato novo production/production. A candidata usa SOMENTE production/production.
Não se importou wrapper, .env, secret, identidade financeira ou dados do HML.
ASAAS_API_KEY: latest=3 ENABLED, namespace store-connect-app; bindings publicados usam versão 3.
IAM atual: HTTP200, vínculo direto/incondicional secretAccessor do runtime exato confirmado.
ASAAS_WEBHOOK_TOKEN: resource GET HTTP${p.webhookResource.http}, latest GET HTTP404; token PROD não disponível
como recurso consultável. Nenhum valor lido, secret criado/rotacionado ou grant executado.
Webhook publicado consultado possui SOMENTE binding ASAAS_API_KEY; token independente não vinculado.
Rules PROD: GET release/ruleset HTTP200/200, SHA256 ${m.rules.sha256}.
Nenhuma equivalência/segurança financeira de Rules foi inferida por mera busca de nomes ou por hash;
proteção de coleções internas/campos deverá ser provada antes de habilitar writers financeiros.
Não houve publicação nesta rodada. Metadados não certificam conteúdo/guards do código antigo.

4. CANDIDATA PROD CONGELADA / SUBCONJUNTOS
Caminho: ${c.candidate}
114 arquivos; conteúdo SHA256 ${c.contentSha256}
manifest.json SHA256 ${c.manifestSha256}
Config: build/prod-final-20261026/candidate-v1/firebase.prod-finance.candidate.json
Projeto store-connect-app explícito; codebase default; região us-central1; Node22.
Wrapper independente gerado da fonte LOCAL atual; recusa HML/Sandbox/mistura de projetos antes de importar.
Exporta exatamente: getAsaasSubscriptionStateV1, listAsaasInvoices, getAsaasPortalUrl,
createAsaasSubscription, asaasWebhook, reconcileAsaasSubscriptionV1, reviewAsaasSubscriptionAttemptV1.
Nenhum cron/oitavo endpoint é exportado. Imports transitivos não equivalem a export/deploy de F9/F10.
Guard predeploy só lê bytes/manifest/ambiente local; não faz chamadas ou escritas remotas.
Dependências instaladas isoladamente via npm ci --omit=dev --ignore-scripts --no-audit --no-fund.
Tentativa --offline falhou ENOTCACHED semver-7.7.4; repetida SOMENTE instalação permitindo registry:
exit 0, sem scripts npm, sem atualização de lockfile. Logs de ambas as tentativas preservados.
Pacote permite configurar/publicar código fail-closed SEM ativar a chave. operationsEnabled=false em PROD
continua definido por código; só habilitar StoreConnect-PROD NÃO remove esse bloqueio.

Subconjunto A, correção de leitura: 1 criação (state) + 2 updates (invoices/portal), por metadados nominais.
Configuração/empacotamento exatos acima; não requer token webhook nem novo grant previsto no estado lido.
Subconjunto B, sete financeiros: 3 criações + 4 updates nominais. NO-GO por token ausente e gates não implantados.
Não executar A e B por arrasto ou usar --only functions genérico. Nenhum é plano cloud integral.
O filtro da CLI pode incluir prefixos e outras regiões; futura execução precisa negar colisão/deleção,
IAM inesperado, API nova e criação de identidade não autorizada antes de escrita, sem confiar em --non-interactive.
CLI15.32 executa generateServiceIdentity Pub/Sub/Eventarc para Gen2; esse efeito não foi autorizado aqui.
Upload/build/imagens e IAM de invocação só dos serviços selecionados também precisam estar delimitados.
Não há autorização para modificar IAM de secrets/projeto, novas APIs/secrets ou outros recursos.

5. CRONS / MUDANCA DE PLANO / ROLLBACK
Foram consultados apenas checkOverdueSubscriptions, reconcileAsaasBilling, syncAsaasSubscriptionPrices
e expireTrials. Não foram executados, alterados ou incluídos no wrapper.
Local: sync de preços recusa fora Sandbox; reconciliador recusa operationsEnabled=false;
checkOverdue usa origem/admissão por loja; expireTrials não chama Asaas e preserva planos pagos/históricos.
Remoto: revisões/datas registradas acima, ambiente sandbox; equivalência aos guards locais NÃO comprovada.
Antes de reabilitar chave, preservar/atualizar de modo seletivo esses três crons financeiros e
changeAsaasPlan conforme fonte comprovada/contrato, ou demonstrar que não podem executar efeitos indesejados.
expireTrials requer confirmação da política trial, não ativação financeira. Não ampliar deploy às cegas.
Cron remoto antigo é impedimento para reabilitação, NÃO para preparar/publicar leitor fail-closed aprovado.
rollback-plan.json guarda revisões anteriores, hashes e nomes novos. prod-metadata.json é backup sanitizado
de metadados, NÃO backup restaurável de código. Fonte remota anterior não foi baixada; restauração integral
ainda exige pacote anterior verificável. Não usar HEAD como rollback nem restaurar sandbox em PROD por hábito.
Após futuro deploy parcial: parar, consultar nomes/revisões e manter chave desligada. Não repetir deploy,
não usar --force, não apagar novas Functions. Rollback de código/tráfego exige autorização própria
e fonte/revisão recuperável conferida; nenhuma operação de rollback foi executada ou prometida como pronta.

6. P2.6.4 / P2.6.5 / WEBHOOK / P4 / TRIAL
LOCAL: projeto/origem/loja/owner/admissão backend; slot durável com requestId+consentimento;
resultado ambíguo não gira identidade nem permite takeover por TTL; revisão/reconciliação com prova.
Webhook local usa token independente, ledger/replay e processamento persistido. Em PROD continua
fail-closed: asaasDurableWebhook, reconcileFinancialState e reviewSubscriptionAttempt têm guards Sandbox;
nenhum foi removido. Não fingir que basta mudar variável ou ligar chave para homologá-los.
GLOBAL: operationsEnabled=false, getAsaasApiKey bloqueia PROD, sem liberação escondida por env.
Para liberar depois será necessária revisão específica de código/gates com admissão controlada,
sem enfraquecer consentimento, origem, slot, ledger ou autorização. NÃO feito nesta rodada.
Remoto: revisão correspondente a essas garantias NÃO implantada/comprovada; webhook token falta;
P4 D1-D3/D4 e recuperação inactive com prova permanecem evidências locais/documentais, não homologação atual.
Trial: bootstrap local define TRIAL_DAYS=7 no servidor, sem customer/assinatura automática;
AuthGate bloqueia visualmente trial vencido, não apaga dados nem persiste status; expiração é backend.
Loja histórica active/business não comprova assinatura paga e não será convertida/migrada para teste.
Nenhuma loja nova, Marisete, trial ou autorização financeira por loja foi criada/modificada agora.

7. UNICA BATERIA DIRIGIDA - RESULTADOS HONESTOS
Runner: tools/finance-prod/run-directed-validation.cjs; evidências em build/prod-final-20261026/.
Node offline: billingReadConsolidation 18 PASS (4 novos), subscriptionStateReadOnly 12 PASS.
asaasSecrets: primeira execução 10 PASS/4 FAIL; causa: expectativa antiga details=undefined,
incompatível com novo DTO sanitizado {reason:credential_unavailable}. Ajustada comparação EXATA,
mantidas verificações de ausência de valor/cause privado. Repetidos SOMENTE quatro nomes: 4 PASS/0 FAIL.
Cobertura final: 44 casos Node distintos aprovados; rodada inicial/exit1 preservados, não reescritos.
Paths: sem vínculo sem HTTP/secret, dono/operador/outra loja, parcial, gate PROD, secret ausente,
401/403/404/500 sintéticos, trial sem contrato, tentativa inconclusiva e ausência de side effects de leitura.
Flutter billing: 16 PASS, flavor prod, --no-pub. Consentimento ausente produz zero leituras/persistências/envios;
mesmo payload consent=true não substitui parâmetro explícito; timeout conserva intenção em nova instância;
consulta falha não habilita botão, e mensagens não exibem payload privado. Nenhum pagamento remoto testado.
Package: PASS real SDK/discovery sete exports, seis callables App Check, runtime/região/ambiente/hash,
dependências locais e recusa de HML/Sandbox; zero handlers invocados; IO externo proibido no processo.
node --check: 3 PASS; flutter analyze dirigido: exit0, zero errors/warnings, 8 infos registrados;
git diff --check exit0. Não mascarar infos como análise sem observações.
Não repetidos suítes gerais F7/F9/F10, Emulator, Flutter global ou os 11 testes HML.
P2.6.4/P2.6.5/P4 anteriores reutilizados como evidência local, sem transformar em homologação PROD.

8. ANDROID / BUILDS
Novo APK/AAB de release: NÃO GERADO. O projeto fixa versionName1.0.6/versionCode49 e houve mudança Dart.
Não foi escolhido/chutado número nem reutilizado automaticamente49. Solicitado novo versionCode aprovado
e conferido em tracks/rascunhos Play; sem resposta/evidência nesta conclusão, NO-GO para nova candidata Android.
Assinatura oficial local preexistente não foi alterada e nenhum keystore gerado/exposto.
Builds anteriores NAO_PUBLICAR são históricos e NÃO contêm estas correções:
build/release-prod-gate/NAO_PUBLICAR-app-prod-release.apk - 79450778 bytes;
SHA256 A7B2FD45E5F452FE1F4F40743E5E80B62176CA2ACC2828DC4C2B4069A885B441.
build/release-prod-gate/NAO_PUBLICAR-app-prod-release.aab - 62452648 bytes;
SHA256 80DA0C9B4D405E199EF0A9186F36183D6E70D95120A846FC27CDF5EC1AD9E349.
Hashes desses dois arquivos reconferidos agora. Versão/certificado/alinhamento são evidências
do relatório gate de25/10, NÃO novos testes de binário: com.storeeconnect.app;1.0.6+49; minSdk24,
targetSdk36; assinatura SHA256 B7:AB:1F:3C:B4:7A:88:AA:72:86:20:01:10:17:FB:0F:81:C7:28:CB:BB:F6:8A:86:A9:30:BA:9D:B1:EC:25:C7;
zipalign16KB e ELF64 anteriores PASS, sem teste real em aparelho16KB. Upload key/Play não conferidos.
F9/F10 mantidos com guards; não removidos nem anunciados homologados. Sem instalação Motorola/Samsung.

9. QUADRO OBRIGATORIO - CHAVE DESABILITADA VERSUS REABILITACAO
(a) PODEM OPERAR SEM CHAVE ATIVA:
    login/leituras Firestore autorizadas, leitor state, apresentação/roteamento trial;
    listAsaasInvoices no_subscription para loja sem vínculo após publicar patch; portal sem vínculo
    só informa precondição. Não há chamadas Asaas nem prova de pagamento nesses caminhos.
(b) DEPENDEM DE CHAVE ATIVA E GATES ADEQUADOS:
    faturas/assinatura oficial/portal com vínculo, criação customer/assinatura, alteração de plano,
    reconciliação/revisão com provedor e processamento de webhook que consulta estado upstream.
    Recepção HTTP/autenticação webhook exige token próprio e endpoint configurado; HTTP200 isolado
    não prova ledger aplicado ou pagamento. No código atual, PROD também está bloqueado por guards.
(c) REQUISITOS PARA PEDIR REABILITACAO:
    chave exata StoreConnect-PROD na conta/ambiente Asaas PRODUCAO, sem nova chave;
    revisões PROD corretas production/production publicadas e verificadas com cliente versionado;
    criação protegida por owner+consentimento+requestId/slot, origem/admissão por loja nova;
    token próprio disponível com autorização separada, webhook autenticado/ledger/replay,
    Rules internas e App Check, P4/reconciliação com prova, crons e changeAsaasPlan sem efeitos antigos;
    pacote/rollback recuperável, nenhuma rotina automática capaz de criar customer/assinatura/cobrança.
    HOJE esses requisitos NÃO estão satisfeitos; nenhuma revisão protegida publicada foi inventada.
    Quando satisfeitos, apresentar nomes/revisões reais e riscos antes do aval. Operação manual futura:
    responsável reabilita SOMENTE a chave existente StoreConnect-PROD no painel Asaas de produção.
    Não foi executada, não está autorizada e não se recomenda como solução provisória do internal.
(d) PRIMEIRO SMOKE APOS AVAL + REABILITACAO MANUAL:
    cliente PROD autenticado/App Check e loja nova controlada/autorizada, estado Firestore primeiro;
    chamada expressamente autorizada list/read da assinatura/faturas, com vínculo oficial se houver,
    sem qualquer POST/PUT financeiro, customer ou contrato. Loja sem vínculo deve retornar
    no_subscription e NÃO comprova comunicação com provedor. Sem vínculo controlado, definir consulta
    upstream GET adicional antes de chamá-la; não criar vínculo para fabricar um smoke.
    Comprovar status HTTP/correlação sanitizados e zero efeitos, não imprimir IDs/URLs.
    Se401 persistir: parar, isolar credencial secret/ambiente/ativação; nunca criar outra assinatura.
(e) GATE INDEPENDENTE - UMA CONTRATACAO REAL:
    depois do read-only aprovado, novo aval com plano/valor/owner/novo Store ID de
    Marisete - Teste PROD, trial7 dias sem Asaas e sem status forçado, requestId estável, UMA intenção.
    Comprovar recibo, IDs somente em armazenamento autorizado, webhook autenticado/ledger/estado,
    replay sem duplicidade; timeout preserva slot e interrompe. Não usar lojas históricas/perfumaria/Farma.
    Sem novo aval não criar loja, admissão, customer, assinatura ou cobrança. NADA disso foi feito.

10. GOOGLE PLAY - POLITICA APLICAVEL, NAO HOMOLOGADA
Inferência de classificação: a assinatura do SOFTWARE Store&Connect libera funcionalidade digital
de produtividade/gestão; não é pagamento pelos produtos físicos vendidos pelas lojas usuárias.
A política inclui esse tipo de software e restringe direcionamento externo salvo programas/exceções.
Logo, ter Asaas funcional em APK não demonstra conformidade da distribuição Play.
Brasil consta do piloto de escolha de faturamento para apps não relacionados a jogos; exige
empresa, inscrição, escolha junto ao Play Billing, APIs específicas e reporte de transações.
O piloto menciona WebView incorporado; isso não aprova automaticamente launchUrl para navegador externo.
Inscrição/integração do Store&Connect NÃO comprovadas. Não foi alterado fluxo silenciosamente,
submetido AAB ou prometida aprovação. Antes de Play, decidir modelo compatível e comprovar Console/SDKs.
Fontes oficiais consultadas26/10, sem tratar regra como aprovação individual:
https://support.google.com/googleplay/android-developer/answer/9858738?hl=pt-br
https://support.google.com/googleplay/android-developer/answer/12570971?hl=pt-br
Checklist restante: versão/tracks/upload key, pagamentos, Data safety, privacidade, exclusão de conta,
App access, declarações/requisitos da conta e revisão Google. APK no Motorola é gate diferente de Play.

11. PROXIMA APROVACAO CONCRETA - NAO EXECUTADA
Proposta preferencial: somente três consultas fail-closed, após fechar controle de efeitos CLI e rollback:
${command}
Não é autorização atual. Antes de execução futura: confirmar mesmos hashes/identidade/projeto,
nenhuma colisão/prefixo/deleção, nenhuma mudança de account/runtime/região, API ou IAM extra,
e delimitar generateServiceIdentity e infraestrutura gerenciada. Não usar firebase.json padrão/--force.
Comando nominal do pacote SETE, apenas para revisão; BLOQUEADO por token e demais gates:
${full}
Nenhum comando mutante para criar token/Rules/IAM foi executado ou incluído como desbloqueio automático.
Ordem humana curta:
A) Aprovar subconjunto financeiro exato e efeitos restritos; publicar só quando precondições provadas.
B) Confirmar revisões e leitura Firestore/Auth/App Check sem contratação; corrigir erro sem ligar chave.
C) Autorizar separadamente token/config webhook e comprovar autenticação antes da ativação API;
   processamento completo com eventos/ledger somente quando cenário autorizado puder executá-lo.
D) Autorizar nova loja/trial isolado, sem tocar históricas e sem vínculo financeiro automático.
E) Após guards/crons efetivamente implantados, pedir reabilitação manual e aval para smoke READ-ONLY.
F) Após sucesso read-only, pedir aval independente para UMA contratação real e provar antirrepetição.
Código fail-closed não depende da chave ativa para ser publicado. Consultas externas dependem dela.

12. PRESERVACAO / AUSENCIA DE EFEITOS
FUNCTIONS_DEPLOY=NAO_EXECUTADO; RULES_DEPLOY=NAO_EXECUTADO; IAM_WRITES=ZERO; SECRETS_WRITES=ZERO
ASAAS_CALLS=ZERO; HANDLER_INVOCATIONS=ZERO; REMOTE_DATA_WRITES=ZERO; PLAY=NAO_SUBMETIDO
Chave StoreConnect-PROD não ativada; nenhum dispositivo instalado, loja alterada ou migração.
HML candidato-v2/v3/bootstrap/Rules/secrets intocados. Trabalho staged/unstaged/untracked preservado.
Branch feat/f7-intelligent-catalog; HEAD30f4f8db2a4a59d21696fde3d673144aded31154; sem commit/push/reset/stash/clean/rebase.
Relatório único em docs/release; cópia idêntica na Área de Trabalho real com SHA256 conferido pelo terminal.
`;
const target=path.join(root,'docs/release/STORECONNECT_PROD_FINALIZACAO_EXECUTIVA_26-10-2026.txt');fs.writeFileSync(target,report,'utf8');
console.log('CORRECOES_LOCAIS=PASS; NODE=44 casos distintos aprovados (4 repetidos); FLUTTER=16 PASS; CANDIDATA_PROD=CONGELADA; DEPLOY=NAO_EXECUTADO; APK_AAB_NOVOS=BLOQUEADO_VERSIONCODE; ASAAS=ZERO; HML_CONGELADO; PLAY=NAO_SUBMETIDO');
