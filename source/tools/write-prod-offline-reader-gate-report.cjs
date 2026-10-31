"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'build/prod-offline-reader-gate-20261026'),r=JSON.parse(fs.readFileSync(path.join(folder,'gate-evidence.json')));
if(r.error)throw Error('Gate incomplete: report requires explicit error handling');
const command=fs.readFileSync(path.join(root,'build/prod-offline-recovery-20261026/reader-deploy-NOT-EXECUTED.txt'),'utf8').trim();
const text=`[NO-GO PARA IMPLANTAR AGORA COM GARANTIA DE SOMENTE O LEITOR]
STORE&CONNECT - GATE FINAL PROD getOfflineSaleResultV1 - 26/10/2026
Código e escopo nominal: PASS. Bloqueio: efeitos automáticos da Firebase CLI ainda não delimitados.
NÃO foi executado deploy/dry-run, generateServiceIdentity ou handler. Writer não foi habilitado.

1. DECISAO EXECUTIVA
A candidata é íntegra e o leitor está preparado localmente para PROD sem depender de Asaas,
secrets, assinatura, admissão de novos efeitos ou habilitação do writer. Não surgiu falha funcional nova.
A seleção nominal propõe uma criação e zero updates/deletes. secretAccessPlan está VAZIO.
O comando da CLI15.32.0, porém, executaria dois POST generateServiceIdentity em preparação Gen2.
Leitura IAM dos agentes Pub/Sub e Eventarc retornou403; não se comprovaram existência/estado nem
ausência de eventual criação/provisionamento. Portanto não há prova suficiente de que todos os
efeitos remotos se restringiriam ao leitor e sua infraestrutura autorizada.
ÚNICO BLOQUEIO DE LIBERAÇÃO IDENTIFICADO: decidir/controlar esses efeitos externos da CLI antes
de aprovar uma implantação. Não é bloqueio por falta de secret Asaas, grant financeiro ou testes HML.

2. GATE DE INTEGRIDADE - PASS
Candidata: build/prod-offline-recovery-20261026/candidate-v1
Todos os17 arquivos: tamanho e SHA256 idênticos ao manifesto congelado.
Digest de JSON(manifest.files): ${r.hashes.content}
SHA256 manifest.json: ${r.hashes.manifest}
Os hashes correspondem aos já registrados; candidata, dependências e fontes não foram reconstruídas.
Config exclusiva: firebase.prod-offline.json; somente functions; uma source functions/default/nodejs22.
Wrapper recusa GCLOUD_PROJECT ausente/outro projeto e GOOGLE_CLOUD_PROJECT divergente antes de importar.
Fonte exclusiva offline, sem index geral. Região global us-central1; Gen2; Node.js22; codebase default.
Env congelado: F9_COMMERCIAL_OFFLINE_PROJECT=disabled. Nenhuma variável foi escrita remotamente.
Único hook predeploy: node scripts/guard.cjs, leitura local de hashes/manifest/ambiente, sem RPCs.

3. IDENTIDADE/PROJETO/PERMISSOES - PASS, COM DEFAULT DOCUMENTADO
Projeto confirmado por GET Google Cloud: store-connect-app, número294766590074.
Publicador: ${r.publisher.masked}, fingerprint ${r.publisher.fingerprint}.
Firebase CLI da pasta candidata coincide com gcloud ativo. Sem troca de conta, impersonação,
FIREBASE_TOKEN, arquivo de credencial alternativo ou override de acesso detectados.
CLI instalada:15.32.0. Nenhum fallback de projeto será usado: --project store-connect-app explícito.
A candidata NÃO fixa serviceAccount. O contrato REST Gen2 define default do serviceAccountEmail
omitido como a conta Compute do número do projeto; não se inferiu a identidade por fingerprint.
Essa conta exata foi resolvida em memória, consultada no IAM: HTTP200, existe, disabled=false.
Runtime esperado: ${r.runtime.masked}, fingerprint ${r.runtime.fingerprint}.
Publicador possui iam.serviceAccounts.actAs nessa identidade: HTTP200/PASS.
As13 permissões de deploy/read consultadas no projeto: HTTP200, nenhuma faltante.
Roles atuais/incondicionais desse runtime: ${r.runtime.unconditionalRoles.join(', ')}.
Role definition roles/editor: HTTP200, inclui datastore.entities.get/list e datastore.databases.get.
Isso comprova permissões declaradas de leitura, não execução real em Cloud Run ou ausência de toda
restrição organizacional. Roles já existiam; nenhum papel, binding ou conta foi criado/substituído.
Editor é amplo: a limitação somente-leitura aqui é imposta pelo handler/transaction readOnly,
não por alegação de que a service account tem IAM exclusivamente de leitura.
Como o default não está fixado no pacote, revisar a identidade efetiva publicada faz parte do pós-gate.
Fonte oficial do default: https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions#ServiceConfig
CLI functions/env.js:292 injeta GCLOUD_PROJECT do projeto explicitamente selecionado.

4. EXPORTS E SELECAO - PASS NO ESCOPO VERIFICADO
Exports descobertos com SDK real na rodada anterior, sob o MESMO manifest SHA certificado agora:
- getOfflineSaleResultV1: callable Gen2/us-central1, App Check obrigatório, zero secrets.
- syncOfflineSaleV1: callable Gen2/us-central1, App Check obrigatório, zero secrets; writer disabled.
Não há export financeiro, Asaas, schedule, extensão, F9/F10 adicional ou HML no wrapper.
Módulos compartilhados conservam guards/strings históricas demo/HML; isso não configura nem aciona HML:
o wrapper rejeita projeto diferente de PROD e o leitor entra na política específica PROD.
Foram feitas leituras LIMITADAS de nomes/labels/runtime nas APIs v1/v2 locations/-, uma página por API,
somente para detectar colisões dos dois nomes e seus prefixos, sem produzir inventário geral.
Zero regiões unreachable. Nenhum nome exato/prefixo desses dois em qualquer região/codebase.
functionsDeployHelper.endpointMatchesFilter aceita ID exato OU ID-...: esse risco foi conferido agora;
nÃO se presumiu que --only é uma comparação de nome estritamente exata.
Planejador local createDeploymentPlan da CLI instalada, com o namespace atual e filtro explícito:
criar=[getOfflineSaleResultV1]; atualizar=[]; excluir=[]; secretAccessPlan={};
serviceAccountToCreate=null; serviceAccountToDelete=null. syncOfflineSaleV1 NÃO selecionada.
Isso é cálculo local informado pelos metadados atuais, NÃO preview cloud integral nem dry-run.
Alteração concorrente antes de uma execução futura exige repetir somente o guard de namespace/hashes.

5. AUTH/AUTORIZACAO/APP CHECK - PASS LOCAL; INTEGRACAO PROD NAO HOMOLOGADA
Os dois callables usam shared.options.enforceAppCheck=true; a descoberta anterior capturou opções
reais do SDK. Nenhum bypass de Auth/App Check foi acrescentado.
Leitor exige auth.uid; rejeita tenant; normaliza comando e requestId=saleId; usuário deve existir,
ter papel permitido (admin/gerente/operador/caixa/vendedor), vínculo atual com a loja e acesso não revogado.
scope.uid deve corresponder ao UID autenticado; scope.storeId ao perfil atual; scope.projectId ao PROD.
Loja deve existir. Replay exige ator original, protocolo, loja, requestHash, IDs e resultado terminal
consistente; total esperado também é conferido em confirmação. Divergência não vira comprovante.
A consulta não depende de assinatura paga, flag de writer, atestado de recuperação ou controle de novas escritas.
Token legítimo App Check no Motorola e sessão do ator original NÃO foram testados agora; são pós-gate.
Não se presume que teste de Emulator ou leitura IAM equivale a comportamento publicado/homologado.

6. LEITOR SEM EFEITOS COMERCIAIS - PASS LOCAL POR FLUXO FIXO E READONLY
Export getOfflineSaleResultV1 é ligado internamente a execute(request,true). O payload não pode
substituir queryOnly: chaves extras são recusadas pelo contrato.
runTransaction recebe {readOnly:true}. Ele lê users/loja, recibo auditLogs e eventual sale por ID.
Recibo existente: replay validado. Venda sem recibo: identity-conflict, sem recibo retroativo.
Nenhum dos dois: not-recorded, definitive=false, canAutoResend=false; NÃO autoriza reenvio.
Há retorno ANTES de autorização de novos efeitos, admissão, produtos, cálculo de estoque e writes.
Nenhum tx.create/update, sync, emissão fiscal, chamada Asaas ou criação de atestado é alcançável
nesse caminho. Inicialização/discovery não executa handlers.
O módulo também contém writer, mas ele não é deployado pelo filtro; o flag continua disabled.
Proteção do atestado backend de writer nas Rules não é dependência do leitor nesta fase.

7. CLI - EFEITOS ESPERADOS VERSUS BLOQUEIO
Local de evidência: instalação Node22/WinGet, node_modules/firebase-tools/lib, hashes em gate-evidence.json.
A) prepare.js:617/650/652 -> gcp/serviceusage.js:25/28:
   POST v1beta1/projects/294766590074/services/pubsub.googleapis.com:generateServiceIdentity
   POST v1beta1/projects/294766590074/services/eventarc.googleapis.com:generateServiceIdentity
   Incondicionais no ramo Gen2, sem teste de existência prévia nessa rotina. NÃO EXECUTADOS.
   APIs Pub/Sub/Eventarc: HTTP200 ENABLED. Agente existente é questão diferente de API habilitada.
   GET IAM das duas identidades exatas derivadas do número PROD: HTTP403/PERMISSION_DENIED.
   Existência/disabled INCONCLUSIVOS; fingerprints Pub/Sub0c303a7eb4656dea, Eventarcdc82ea2eb21d6c4a.
   Não interpretar403 como ausência, não conceder IAM para contornar, não usar POST como diagnóstico.
   Mesmo agente existente não transforma o POST em GET; efeito eventual precisa de decisão explícita.
B) checkIam.ensureServiceAgentRoles: para este callable sem eventTrigger, serviceForEndpoint=noop,
   sem requiredProjectBindings; não se espera novo grant de projeto por esse ramo. Genkit/declarative
   security não são usados. Sem secret bindings, não existe grant secretAccessor no plano do leitor.
C) createV2Function/fabricator: criação do leitor gera serviço/revisão Cloud Run e normalmente
   setInvokerCreate(public): binding roles/run.invoker para allUsers SOMENTE no serviço novo.
   Isso é IAM de invocação de infraestrutura, com Auth/App Check exigidos dentro do callable,
   não dispensa de autorização do negócio. Deve constar da futura autorização; zero mudanças
   IAM em projeto/secrets/serviços preexistentes são contempladas.
D) Gerar URL/upload de fonte, Cloud Build, imagens Artifact Registry e logs são infraestrutura
   inerente ao deploy, fora da mera gravação de um nome Function. Não foram iniciados agora.
E) APIs requeridas consultadas: cloudfunctions/cloudbuild/artifactregistry/run/eventarc/pubsub/storage,
   todas HTTP200 ENABLED. Nenhuma habilitação necessária segundo a fotografia atual; nenhuma feita.
F) gcf-artifacts/us-central1 GET HTTP200: cleanup policy PRESENTE nesta coleta, opt-out=false.
   CLI considera política existente/other policy suficiente; não prevê configuração nova de cleanup.
   Não reaplicar a conclusão de ausência de política de relatórios anteriores. Nenhuma mudança feita
   pelo agente. Se política sumir antes de execução, --non-interactive sem --force pode falhar após
   publicação, sem permissão para criar política ou repetir deploy automaticamente.
G) --non-interactive recusa deleção, mas só no release, após preparações/uploads possíveis.
   Portanto não é barreira suficiente para garantir zero efeitos antes de rejeitar delta inesperado.

8. BLOQUEIO E DECISAO HUMANA DELIMITADA
O código do leitor e seus pré-requisitos consultados passaram; o comando genérico da CLI não tem
flag que suprima os dois generateServiceIdentity do ramo Gen2. Não é honesto declarar zero
novos recursos não autorizados enquanto os agentes retornam403 e esses POST não foram delimitados.
Para sair deste NO-GO, o responsável deve decidir entre:
- obter prova somente-leitura dos agentes por operador já autorizado e revisar/autorizar o exato
  comportamento dos dois POST; ou
- aprovar separadamente o provisionamento EXATO das duas identidades gerenciadas PROD e os efeitos
  Google associados, antes de retomar o gate do deploy nominal. Não é autorização genérica de IAM.
Não trocar contas, habilitar API, pedir Owner/Editor, reativar Asaas ou publicar writer para resolver isso.
Qualquer nova concessão de IAM de projeto/secrets, outro endpoint, outra região, exclusão ou Function
preexistente alterada continua proibida. Candidata v1 não foi editada para contornar a CLI.

9. COMANDO PROPOSTO - NAO EXECUTADO
Executar da raiz SOMENTE em aprovação futura após resolver o bloqueio:
${command}
Config exata, projeto explícito, codebase default, uma Function; sem --force/Rules/indexes/Hosting/Storage.
Deploy execuções=0; exit code de deploy=N/A. Coletor de gate exit0 com resultado NO-GO, não GO.

10. VERIFICACAO POSTERIOR, SOMENTE APOS DEPLOY AUTORIZADO
1) Ler metadados getOfflineSaleResultV1: ACTIVE/GEN_2/nodejs22/us-central1/default; revisão nova,
   runtime exato fingerprint fbfc64a2e0ccf114, zero secret bindings e flag writer disabled.
   Confirmar que syncOfflineSaleV1 continua ausente e que nenhuma Function existente foi alterada.
2) Registrar hashes do pacote implantado/revisão e confirmar App Check da definição implantada.
   Só metadata ACTIVE não certifica Auth/App Check efetivo ou ausência de comportamento indesejado.
3) Com aprovação separada de invocação read-only, usar sessão legítima do ator original, App Check
   válido e comando preservado em memória. Chamar SOMENTE getOfflineSaleResultV1; não o worker
   de sincronização nem o botão do app antigo. Não criar token falso/customizado para fazer passar.
4) Conferir requestId/ator/hash/status. not-recorded continua inconclusivo e NÃO finaliza fila;
   confirmed/rejected só são aceitos após comprovante autoritativo consistente. Não reenviar unknown.
5) Preservar vendas/estoque/recibos, verificar logs sanitizados e ausência de novas gravações.
   Qualquer falha parcial: registrar revisão/estado e parar; sem --force, redeploy, rollback/deleção automáticos.
O Android1.0.6+49 instalado ainda tem fluxo antigo: pode tentar o writer após not-recorded e emissão
fiscal depois de um comprovante confirmado. Publicar só leitor NÃO atualiza esse cliente, NÃO reduz
sozinho o contador das duas pendências e NÃO autoriza acionar esses gatilhos como smoke read-only.
As quatro ausências dos documentos reais na rodada anterior permanecem evidência pontual;
nenhum recibo foi criado/recuperado nesta rodada nem venda marcada como concluída.

11. EVIDENCIAS E PRESERVACAO
build/prod-offline-reader-gate-20261026/gate-evidence.json: hashes atuais, namespace restrito,
plano limitado, IAM sanitizado, APIs/agentes/repositório e hashes dos fontes CLI examinados.
Testes anteriores reutilizados por integridade:3 política Node,6 transações Emulator,15 Flutter
distintos após repetição SOMENTE de2 expectativas corrigidas. Rodada inicial exit1 preservada.
Nenhuma suíte/Emulator/Flutter/análise geral foi repetida neste gate.
Dados/SQLite/aparelho/vendas/estoque/Asaas/secrets/assinaturas/Rules/HML inalterados e não usados como teste.
Cloud IAM testIamPermissions/getIamPolicy foram RPCs de consulta, sem mutação; emails completos,
tokens, policies brutas e dados de lojas não foram exportados.
DEPLOY=NAO_EXECUTADO; DRY_RUN=NAO_EXECUTADO; GENERATE_SERVICE_IDENTITY=ZERO
REMOTE_WRITES=ZERO; HANDLERS_INVOKED=ZERO; WRITER_ENABLED=NAO; APK=NAO_GERADO_NEM_INSTALADO
Branch feat/f7-intelligent-catalog; HEAD30f4f8db2a4a59d21696fde3d673144aded31154 preservados.
Sem commit/push/reset/stash/clean/rebase. Somente coletor/evidência/relatório locais adicionados.
Coleta UTC ${r.startedAt} a ${r.finishedAt}.
Relatório docs/release e cópia no Desktop real via GetFolderPath, igualdade SHA256 validada no terminal.
`;
const file=path.join(root,'docs/release/STORECONNECT_PROD_GET_OFFLINE_SALE_RESULT_GATE_FINAL_26-10-2026.txt');fs.writeFileSync(file,text,'utf8');
console.log('NO_GO: codigo/integridade/namespace PASS; 1 criacao, 0 updates/deletes, secretAccessPlan vazio. Pendencia: dois POST generateServiceIdentity; agentes HTTP403. DEPLOY=NAO_EXECUTADO.');console.log('REPORT_PATH='+file);
