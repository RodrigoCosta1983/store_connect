# BKP-R2B — autorização administrativa do restore

## Modelo canônico auditado e reutilizado

Auditoria: `functions/backups/createStoreSnapshot.js` (backup manual),
`functions/backups/previewBackupRetention.js` (consulta administrativa),
`functions/products/restoreProduct.js`,
`functions/usuarios/revogarAcessoFuncionario.js`,
`functions/usuarios/convidarFuncionario.js`, `functions/auth/bootstrapStore.js`,
`functions/categories/deleteCategory.js` e autorização de assinatura em
`functions/index.js`. Nenhum desses arquivos foi alterado.

A administração de backups exige usuário autenticado, perfil existente em
`users/{uid}`, role normalizada como `admin`, `users/{uid}.storeId` igual à
loja solicitada e documento `stores/{storeId}` existente. A relação canônica
é o campo storeId do perfil; não existe coleção de memberships nesse fluxo.
Gerente (`gerente`) e operador (`operador`, incluindo aliases de outras
operações) não recebem permissão administrativa de backup.

`accessStatus: revoked` é a revogação real usada pelo backend administrativo.
Perfis legados sem accessStatus são aceitos pelas operações existentes;
R2B preserva isso. Quando presente, somente string normalizada `active`
permite autorização; `revoked` nega, tipos ou valores desconhecidos negam.
Não são criados campos inactive/revoked/disabled no perfil.
Firebase Auth possui `disabled`, usado pela revogação de funcionários.
Nesta etapa, `{uid, disabled}` é contexto autenticado confiável e explícito
controlado pelos testes; disabled deve ser boolean e false para permitir.
R2B não consulta Auth SDK nem verifica tokens. A integração futura deverá
obter esse contexto de autenticação real e revalidar usuário/token revogado;
um objeto fornecido pelo cliente não constitui autenticação.

## MERGE_A1 e REPLACE

MERGE_A1 exige a administração canônica acima. REPLACE exige também a
distinção de propriedade já existente: `stores/{targetStoreId}.ownerId`
deve ser o UID autenticado. As operações de assinatura em index exigem
exatamente admin + vínculo à store + ownerId correspondente. Essa distinção
real é reutilizada para o modo destrutivo; nenhuma role/capability foi criada.
OwnerId isolado ou role conceitual `owner` não autoriza sem role `admin`.

REPLACE continua exigindo reconhecimento destrutivo/confirmation do R2A,
tanto no formato DRY_RUN quanto EXECUTE. A autorização não substitui essa
confirmação nem modifica a semântica dos modos no R1.

## API, identidade e fail-closed

Policy pura: `authorizeRestoreAdminRequest(request, context)` em
`storeRestoreAdminAuthorization.js`. Sempre reutiliza validator R2A;
request e seus campos schemaVersion, intent, mode, source, targetStoreId,
requestedByUid, expectedPlanHash e confirmation não recebem formato novo.
Não calcula planHash e não altera inputs.

Contexto confiável possui exatamente:

```js
{
  authenticatedRequester: {uid, disabled},
  userProfile: {uid, data}, // null para perfil inexistente
  targetStore: {id, exists, data} // null para loja não carregada/inexistente
}
```

É contexto interno de dados carregados, jamais payload administrativo.
Maps com accessors/prototypes personalizados e shapes de contexto inválidos
negam autorização. Dados adicionais ordinários do perfil/store não concedem
permissão. Identidades são strings válidas e comparadas sem trim/coerção;
somente role/accessStatus seguem trim + lowercase canônicos.

UID autenticado deve corresponder estritamente a requestedByUid e ao ID do
perfil carregado. Store carregada deve corresponder a targetStoreId.
Autorização na source não concede autorização na target. Não há fallback
para loja atual. Fields role/capability enviados no request são rejeitados
pelo shape fechado R2A antes de qualquer leitura no adapter.

Retorno: `{authorized, reasonCode, targetStoreId, requesterUid}`. Request
inválido retorna identidades null. UID de retorno é o autenticado validado,
nunca UID forjado do payload. Nenhum documento completo é retornado.

Codes internos estáveis: AUTHORIZED, INVALID_REQUEST, UNAUTHENTICATED,
INVALID_AUTHORIZATION_CONTEXT, REQUESTER_MISMATCH, REQUESTER_DISABLED,
PROFILE_NOT_FOUND, NOT_STORE_MEMBER, INSUFFICIENT_PERMISSION, ACCESS_REVOKED,
STORE_NOT_FOUND, STORE_OWNER_REQUIRED, AUTHORIZATION_READ_FAILED.
Ausência/inconsistência sempre nega. Codes servem para testes/diagnóstico
interno; não existe mensagem pública detalhada nem endpoint que permita
enumerar lojas.

## Adapter estritamente Emulator-only e read-only

`authorizeRestoreAdminInEmulator({request, authenticatedRequester, projectId})`
em `storeRestoreAdminAuthorizationEmulator.js` aceita exclusivamente projeto
`demo-store-connect-restore` e FIRESTORE_EMULATOR_HOST em `127.0.0.1:8080`,
`localhost:8080` ou `[::1]:8080`, seguindo a allow-list do R1 Emulator.
Ausência/host inesperado lança INVALID_EMULATOR_HOST; projeto inesperado
lança INVALID_EMULATOR_PROJECT antes de carregar SDK/iniciar reads.

Cliente próprio usa explicitamente projectId, host validado e ssl:false;
não aceita cliente injetado, default app, credenciais ou fallback para
produção. Valida identidade antes de ler. Copia request/contexto autenticado
antes de await. Lê somente `users/{authenticatedUid}` e
`stores/{targetStoreId}` e delega à policy. Erro de leitura nega com código
sanitizado; cliente é encerrado ao final.

Zero set/create/update/delete/batch/transaction writes; nenhum audit log,
operation document ou membership é criado. Testes seedam fixtures somente
no Emulator fora da autorização e comparam snapshot lógico de todo o banco,
inclusive subcoleções e pais ausentes, antes/depois. APIs de escrita são
bloqueadas durante os cenários de autorização.

## R2A, R2B e execução futura

R2A confirmation não é R2B authorization. Ambas serão necessárias; usuário
autorizado com confirmação inválida nega, confirmação válida de usuário
sem permissão nega. Autorização é avaliada independentemente para DRY_RUN e
EXECUTE. ALLOW é apenas decisão interna, não execução nem aprovação eterna.
A camada futura deverá revalidar autenticação, revogação, vínculo, role e
propriedade no momento de EXECUTE, além do dry-run confiável e planHash R1.
Persistem o risco de concorrência e a necessidade de proteção futura.

Policy sem Firebase, Firestore, Auth SDK, ambiente, clock, random, network,
writes ou efeitos colaterais; mesmas entradas produzem mesma decisão.
Única dependência local é o contrato puro R2A.

## Não implementado e validação

Sem restore, chamada R1G, dry-run real, EXECUTE real, callable, endpoint HTTP,
export em index, scheduler, trigger, UI/botão, audit log persistido, operação,
lock, lease, produção ou deploy. R1A–R1G e R2A não foram alterados.

Runner isolado: `node functions/tests/restore/runRestoreAdminAuthorizationTests.js`
sob Firestore Emulator do projeto demo. Não requer alteração de package.json
nem dos runners anteriores. Regressão inclui R2B, R2A e R1A–R1G, apenas Node
e Emulator, além de syntax checks e git diff --check.

Validação local: Firestore Emulator com JDK 21 temporário, sem alterar Java
do Windows. R2B 113/113 (68 unitários e 45 Emulator/guards); R2A 120/120;
R1G 41/41; R1F 49/49; R1E 55/55; R1D 8/8; R1C 56/56; R1B 66/66;
R1A 130/130. Total 638/638, zero falhas ou skips; baseline anterior 525/525
preservado. Os cinco JS novos passaram node --check e git diff --check
passou. Somente os seis arquivos R2B foram criados; arquivos existentes,
incluindo package.json, index, R2A e módulos/testes R1, permaneceram intactos.
