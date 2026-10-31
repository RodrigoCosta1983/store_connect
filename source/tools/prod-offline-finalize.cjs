"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'build/prod-offline-diagnostic-20261026'),file=path.join(folder,'evidence.json'),r=JSON.parse(fs.readFileSync(file)),project='store-connect-app';
const t=spawnSync('gcloud.cmd',['auth','print-access-token','--project='+project,'--quiet'],{shell:true,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(t.status,0);let token=t.stdout.trim();
(async()=>{
 r.gen1CompatibilityLookup={};for(const name of ['getOfflineSaleResultV1','syncOfflineSaleV1']){const x=await fetch(`https://cloudfunctions.googleapis.com/v1/projects/${project}/locations/us-central1/functions/${name}`,{headers:{Authorization:'Bearer '+token,'x-goog-user-project':project},signal:AbortSignal.timeout(20000)});r.gen1CompatibilityLookup[name]={http:x.status};if(x.status!==404)r.gen1CompatibilityLookup[name].requiresReview=true;}
 const sources=['lib/screens/sales/new_sale_screen.dart','lib/services/offline_sales_sync_service.dart','lib/services/offline_sale_queue_sync.dart','lib/services/offline_sale_command.dart','lib/data/local/app_database.dart','lib/data/local/offline_sales_repository.dart','functions/sales/syncOfflineSaleV1.js','functions/sales/commercialOperationContext.js'];
 r.sourceHashes=Object.fromEntries(sources.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
 fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n');
 const text=`[CAUSA DE INCOMPATIBILIDADE IDENTIFICADA; RESULTADO INDIVIDUAL DAS DUAS VENDAS AINDA INCONCLUSIVO]
STORE&CONNECT - DIAGNOSTICO CIRURGICO DE VENDAS PENDENTES - 26/10/2026
Firebase PROD store-connect-app. SOMENTE LEITURA. Sem sincronização, reenvio, deploy ou alteração de fila.

1. CONCLUSAO E LIMITES
O fluxo Flutter atual correspondente à mensagem observada consulta getOfflineSaleResultV1 antes de
qualquer envio. Esse endpoint e syncOfflineSaleV1 não estão publicados nos metadados Gen2 consultados
em us-central1 (HTTP404). Conferência nominal adicional Gen1:
${Object.entries(r.gen1CompatibilityLookup).map(([n,v])=>n+': HTTP'+v.http).join('\n')}
Apenas syncOfflineSale legado está ACTIVE, revisão syncofflinesale-00002-nev, Node22/Gen2,
atualizado em2026-10-14T15:48:29.198232426Z. O fluxo novo NÃO o chama como fallback.
Logo, o backend disponível não atende ao contrato do cliente novo: é impedimento comprovado à recuperação.
Não há logs individuais correlacionando o erro de cada clique; a causa de cada execução no aparelho
não foi capturada. Não substituir essa limitação por afirmação de HTTP404 observado no Android.
Mensagem do catch apaga o diagnóstico técnico e conserva unknown para diferentes causas.
Não há prova nesta rodada de venda confirmada, rejeição definitiva ou ausência de gravação de cada ID.

2. FLUXO REAL NO FLUTTER
NewSaleScreen cria OfflineSalesSyncService e monitora a fila SQLite; indicador Online + contagem
nÃO significa disponibilidade dos endpoints ou venda confirmada. Comentários antigos ainda citam
syncOfflineSale, mas a implementação importada em offline_sales_sync_service.dart é apenas um export
de offline_sale_queue_sync.dart: usa getOfflineSaleResultV1/syncOfflineSaleV1, região padrão us-central1.
O botão Sincronizar / recuperar comprovantes chama _syncPendingOfflineSales -> syncPendingSales.
Para cada item: lê command_json original, compara scope projeto/UID/loja, obtém claim SQLite,
chama getOfflineSaleResultV1 com o comando preservado e valida requestId.
Somente se status=not-recorded chama syncOfflineSaleV1, com EXATAMENTE o mesmo comando/ID.
confirmed exige saleId e totalCents correspondentes; então atualiza cache e finaliza fila.
rejected só é terminal com resultado do servidor e motivo. Erro/contrato divergente cai no catch,
que grava unknown + Resultado desconhecido; consultar comprovante original. Sem código/endpoint
persistido nesse motivo, a mensagem não distingue callable ausente, permissão, gate ou erro de rede.
Comprovante validado seguido de falha no refresh vira confirmedRefreshPending, distinto de unknown.
Recuperação atual NÃO é estritamente read-only: pode enviar após not-recorded, atualizar estado local
e solicitar emitirNfce após confirmação. Por isso NÃO foi acionada nesta investigação.
Gatilhos locais existentes incluem início da tela, retorno da internet, botão e retry de claim;
nenhum foi disparado pelo agente, e o app não foi aberto/iniciado por ADB.

3. EVIDENCIA INDIVIDUAL
${r.operations.map(o=>`ID: ${o.id}
Data derivada do relógio cliente no ID: ${o.clientClockDerivedUtc} UTC (26/10, horário de Brasília -03).
Path de venda a conferir: stores/<STORE_ID>/sales/${o.id}
Path de recibo V1 a conferir: stores/<STORE_ID>/auditLogs/${o.receiptDocumentId}
Recibo definitivo: NÃO COMPROVADO. Gravação de venda: NÃO COMPROVADA.
Rejeição definitiva: NÃO COMPROVADA. Classificação: INCONCLUSIVO por evidência ainda insuficiente.
Não afirmar falha/sucesso nem apagar/refazer essa venda.`).join('\n\n')}
As datas derivadas são horários do aparelho, não timestamps server-side certificados.
Os IDs fornecidos foram usados exclusivamente como filtros exatos; não foram listadas lojas.

4. BUSCAS FIRESTORE - BLOQUEIO OBJETIVO
Feitas queries somente-leitura runQuery, projeção restrita, limit10, filtro IN exatamente os dois IDs:
sales.localSaleId e auditLogs.result.requestId. Ambas retornaram HTTP400/FAILED_PRECONDITION.
Repetidas SOMENTE essas queries para capturar o erro estruturado em resposta array:
COLLECTION_GROUP_ASC requerido para sales/localSaleId e auditLogs/result.requestId.
Nenhum índice foi criado ou sugerido como requisito para fazer quatro GETs diretos.
Não houve resultado válido de query; zero documentos retornados num erro NÃO significa zero documentos.
Nenhuma leitura de estoque/produtos/clientes nem listagem de lojas foi feita.
Store ID solicitado em pergunta nesta sessão; não disponível até o fechamento deste relatório.
Sem ele, não é possível formar os paths diretos sem enumerar lojas, o que foi evitado.

5. LOGS E ANDROID
Cloud Logging entries:list (RPC de leitura) filtrado SOMENTE getOfflineSaleResultV1,
syncOfflineSaleV1 e syncOfflineSale, recursos cloud_run_revision/cloud_function.
Janela inicial: ${r.logs.start} a ${r.logs.end}; HTTP${r.logs.http}, zero entradas, sem próxima página.
Janela ampliada para tentativas posteriores: ${r.recoveryLogs.start} a ${r.recoveryLogs.end};
HTTP${r.recoveryLogs.http}, ${r.recoveryLogs.entryCount} entradas, nextPage=${r.recoveryLogs.nextPagePresent}.
Ausência de logs não prova que o app não tentou: callable ausente pode falhar antes de haver runtime,
e requisição não contém necessariamente os IDs em logs padrão. Não há falha por venda correlacionada.
ADB get-state: ${r.android.connectionState}. Versão/binário e SQLite do Android instalado NÃO acessados.
Não usar a fonte local nem os APKs anteriores como prova do binário efetivamente instalado.
O texto fornecido corresponde ao catch do fluxo local V1; confirmar versão/erro técnico no aparelho
é etapa somente-leitura posterior se houver acesso, sem acionar sincronização ou abrir a tela com autossync.

6. IDEMPOTENCIA E COMPATIBILIDADE BACKEND
offlineSaleCommand preserva requestId=saleId=localId, projeto/UID/loja, itens, preços e data original.
Repositório grava fila+comando em transação SQLite; mesmo ID com intenção divergente é recusado;
na reutilização mantém createdAtMs original. Claim durável de2min e token condicional serializam workers;
retomar claim NÃO troca ID, não cancela venda e não prova ausência de efeito remoto.
Backend V1 calcula requestHash do comando normalizado; recibo auditLogs usa
offline-sale-v1- + SHA256(JSON.stringify(saleId)). Replay exige actorUid, protocolo e requestHash iguais.
Venda, estoque e recibo são criados na MESMA transação para confirmação; rejeição comprovada também
tem recibo. Venda existente sem recibo V1 retorna identity-conflict; não fabrica comprovante retroativo.
not-recorded devolve definitive=false: não autoriza concluir que nunca houve gravação nem duplicar ID.
IMPEDIMENTO ADICIONAL LOCAL: execute(queryOnly=true) começa por shared.destination antes da leitura.
commercialOperationContext.destination permite demo/loopback ou HML explícito, NÃO PROD.
Portanto publicar getOfflineSaleResultV1 exatamente como está NÃO bastaria; também retornaria
commercial-operation-disabled em PROD. Não remover esse gate do writer para recuperar comprovante.
syncOfflineSale legado tem outro contrato (localSaleId/produtos e resposta serverSaleId/alreadyProcessed),
sem o mesmo comprovante V1. Não substituí-lo por nome ou converter payload para tentar concluir.
Seu código remoto não foi baixado, invocado ou declarado equivalente ao local.

7. MENOR CORRECAO SEGURA PROPOSTA - NAO IMPLEMENTADA/DEPLOYADA NESTA RODADA
Separar recuperação de envio no cliente: caminho exclusivo read-only, sem fallback para syncOfflineSaleV1,
sem emissão fiscal e sem alterar a fila antes de prova terminal. Preservar os dois comandos e IDs.
Classificar not-found/unavailable/permission-denied/failed-precondition e endpoint em diagnóstico
sanitizado; não chamar todos de resultado desconhecido sem motivo, nem converter erro em rejeição.
Preparar leitor getOfflineSaleResultV1 PROD estritamente de leitura, com Auth/App Check,
projeto/UID/loja/ator/hash exatos, separado do gate de NOVOS efeitos. Manter syncOfflineSaleV1 fechado.
Isso exige revisão/teste dirigido e autorização específica de deploy posterior, NÃO concedida aqui.
Não publicar o writer HML-only nem fazer bypass de admissão F9/estoque para resolver UI.
Se já houver venda sem recibo V1, tratar como evidência histórica/conflito e reconciliação própria,
sem criar recibo artificial, não marcar a fila como synced apenas pela presença do documento.

8. CONDICAO SEGURA PARA CADA RECUPERACAO
Próximo dado necessário: STORE_ID da loja, obtido do escopo original sem listar lojas.
Com ele, fazer APENAS quatro GETs dos paths da seção3, sem chamar syncPendingSales ou qualquer writer.
Se recibo terminal existir: validar protocolo, actorUid, requestHash do command_json original,
requestId/saleId e total esperado; confirmar consistência com venda. Só então propor finalização
local do mesmo ID, em etapa autorizada, sem outra baixa de estoque.
Se recibo rejected existir: apresentar rejeição comprovada e motivo; não reenviar automaticamente.
Se venda existir sem recibo: conflito/histórico, preservar pendência e investigar origem; não reemitir.
Se ambos ausentes: ausência pontual não é prova de rejeição nem autorização de sincronização.
Qualquer processamento novo exigiria aprovação separada e backend PROD devidamente admitido.
Até esses GETs/comparações, AS DUAS permanecem INCONCLUSIVAS. Não repetir venda, trocar IDs,
limpar armazenamento, reinstalar app ou apagar fila para eliminar o contador.

9. PRESERVACAO E EVIDENCIAS
build/prod-offline-diagnostic-20261026/evidence.json contém metadados sanitizados, erros de queries,
intervalos de logs, fingerprints de fontes e IDs determinísticos dos recibos.
Scripts auxiliares tools/prod-offline-*.cjs usam GETs de metadata e POSTs EXCLUSIVAMENTE de leitura
(Firestore runQuery/Logging entries:list); não contêm caminho de commit/write/deploy/handler.
Nenhum código funcional Flutter/backend foi modificado nesta rodada; nenhum teste/suíte geral executado.
Branch feat/f7-intelligent-catalog; HEAD30f4f8db2a4a59d21696fde3d673144aded31154 preservados.
Nenhum reset/stash/clean/rebase/commit/push. Trabalho preexistente e relatório PROD financeiro preservados.
FIREBASE_PROD_WRITES=ZERO; HANDLERS_INVOKED=ZERO; SYNC=NAO_EXECUTADO; RECEIPTS_CREATED=ZERO
STOCK_WRITES=ZERO; QUEUE_MUTATIONS=ZERO; DEPLOY=NAO_EXECUTADO; ASAAS/HML=NAO_ACESSADOS_NESTA_RODADA
Relatório copiado para Desktop real via GetFolderPath('Desktop'), igualdade SHA256 conferida no terminal.
`;
 fs.writeFileSync(path.join(root,'docs/release/STORECONNECT_PROD_DIAGNOSTICO_VENDAS_PENDENTES_26-10-2026.txt'),text,'utf8');console.log('CAUSA: leitor/writer V1 ausentes; gate local V1 bloqueia PROD. DUAS VENDAS: INCONCLUSIVAS; queries exigem índice; faltam STORE_ID e quatro GETs diretos. ZERO escritas/sync/deploy.');
})().catch(()=>{console.error('Finalization incomplete; no sensitive error exported');process.exitCode=1;}).finally(()=>{token='';});
