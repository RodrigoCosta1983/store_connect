# BKP-R2A — contrato de segurança do restore administrativo

## Objetivo e fronteira

R2A define somente solicitações versionadas e validação estrutural pura.
Nenhum resultado `ok: true` autoriza ou executa restore. O núcleo R1A–R1G
permanece interno, protegido e inalterado. Não há integração entre este
validator e o executor Emulator-only R1. R2A não consulta existência da loja.

Referências auditadas: `storeSnapshotParser.js`, `storeRestorePlanner.js`,
`storeRestoreTransform.js`, `storeRestoreFlow.js`, `storeRestoreResult.js`,
`createStoreSnapshot.js` e o apêndice R1 de `F5_BACKUP_E_RECUPERACAO.md`.
R1B suporta transformação same-store; R1G e R1F proíbem origem igual ao
destino operacional. R2A preserva a restrição operacional, sem redefinir R1B.

## Ameaças e fases obrigatórias futuras

Riscos: destino implícito/incorreto, solicitante forjado, troca de backup,
escalada de modo, confirmação reaproveitada, plano adulterado ou obsoleto,
concorrência, aprovação permanente e falha após aplicação parcial.

Fluxo obrigatório da futura camada administrativa:

SOLICITAÇÃO → VALIDAÇÃO DE AUTORIZAÇÃO → DRY-RUN → PLANO R1B → RESUMO PARA
O ADMINISTRADOR → CONFIRMAÇÃO EXPLÍCITA → VALIDAÇÃO DE QUE O PLANO NÃO MUDOU
→ EXECUÇÃO FUTURA → VERIFICAÇÃO R1E → RESULTADO FINAL R1F.

Não haverá caminho de execução direta. A futura camada deverá rejeitar
blockers R1, entradas incompletas e divergências antes de qualquer escrita.

## Solicitação v1 e política fechada

CommonJS: `validateRestoreAdminRequest`, `validateDryRunRequest` e
`validateExecuteRequest`. Retorno síncrono `{ok: true, request}` com cópia
destacada; erro `StoreRestoreAdminValidationError`, code/message fixos
`INVALID_RESTORE_ADMIN_REQUEST`, sem payload ou diagnóstico interno.

Campos comuns obrigatórios e exclusivos:

| Campo | Contrato |
| --- | --- |
| schemaVersion | número inteiro literal 1 |
| intent | DRY_RUN ou EXECUTE |
| mode | MERGE_A1 ou REPLACE |
| source | exatamente `{storeId, checksumSha256}` |
| targetStoreId | identidade explícita do destino |
| requestedByUid | identidade explícita do solicitante |

`source.storeId` corresponde à identidade real `snapshot.metadata.storeId`
do R1; `source.checksumSha256` é o checksum dos bytes gzip de
`technicalMetadata` R1A. Isso identifica o artefato, sem inventar snapshotId,
backupId, path Storage ou outra interpretação de origem. A futura camada
deverá resolver o artefato por fonte confiável, passar ambos como metadata
esperada ao R1A e conferir origem/destino com o plano R1B. R2A não recebe
bytes, snapshot, credenciais ou documentos da loja.

IDs são strings não vazias, sem barra ou NUL, diferentes de `.` e `..`,
sem espaços nas extremidades. Não há trim, lowercase, coerção, boolean
inferido ou fallback. Hashes têm exatamente 64 caracteres hex minúsculos,
compatíveis com R1. R2A não calcula checksum nem planHash.

Shapes exatos rejeitam propriedades desconhecidas, inclusive metadata,
symbols, propriedades ocultas, accessors e prototypes personalizados.
Não há namespace aberto de metadata nesta versão; extensão exige contrato
posterior explícito. Solicitações são mapas de dados, não objetos executáveis.

## DRY_RUN, execução e confirmação

DRY_RUN não aceita expectedPlanHash nem confirmation. Para REPLACE exige
`destructiveActionAcknowledged: true` na raiz, reconhecendo a natureza do
modo escolhido; isso não confirma execução. MERGE_A1 não aceita esse campo.

EXECUTE exige `expectedPlanHash` e `confirmation` com exatamente:

```json
{
  "intent": "EXECUTE",
  "targetStoreId": "store-B",
  "mode": "MERGE_A1",
  "planHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "confirmed": true
}
```

Destino, modo e hash devem corresponder estritamente à solicitação.
REPLACE exige adicionalmente `confirmation.destructiveActionAcknowledged`
igual a true; o campo na raiz não é aceito para EXECUTE. Não há confirmação
genérica reutilizável nem dependência do texto de botão. Os validators
específicos rejeitam a intenção oposta. EXECUTE é somente uma estrutura
formalmente aceitável: nenhuma função aqui executa ou atesta revisão real.

REPLACE mantém o contrato R1: exclusão planejada de extras nas cinco
coleções, sem substituir o root. MERGE_A1 mantém criação, sobrescrita e
preservação de extras; não recebe semântica destrutiva adicional. MERGE_A2,
CREATE e qualquer outro modo são rejeitados.

## Autorização e aprovação futura

Somente usuário autenticado e autorizado a administrar targetStore poderá
solicitar dry-run ou execução. O padrão canônico atual de backup manual em
`createStoreSnapshot.js` confere perfil existente, role admin e storeId do
perfil igual à loja. A camada futura deve reutilizar a autorização canônica,
vincular requestedByUid ao UID autenticado e revalidar antes da execução.
R2A não valida Firebase Auth nem confia no UID estrutural como autorização.
REPLACE poderá exigir garantia adicional de autorização em etapa posterior,
se o modelo canônico permitir; nenhum papel novo é definido aqui.

EXECUTE futuro exige registro confiável de dry-run previamente revisado,
associado ao solicitante, origem/checksum, destino, modo e planHash. A camada
futura deve conferir esse registro e a confirmação; campos enviados pelo
cliente isoladamente não provam que houve dry-run ou revisão. Não se gera
token, assinatura ou segredo em R2A. Mesmo adulteração consistente de todos
os campos não equivale a aprovação confiável.

O hash continua pertencendo a R1B/R1F e cobre identidades, modo, política,
estado desejado e baseline. Antes de executar, recalcular pelo R1B a partir
do artefato validado e do estado atual autorizado do destino. Se planHash
divergir do aprovado, NÃO EXECUTAR: novo dry-run, novo resumo e nova
confirmação. R2A valida apenas formato e vínculo dos campos, sem recalcular.

## Expiração e concorrência

Aprovação/dry-run não podem permanecer válidos indefinidamente. Duração,
persistência e consumo da aprovação serão definidos em bloco posterior;
R2A não inventa TTL nem campos temporais sem política aprovada. Validação
temporal futura receberá referência temporal explícita do caller confiável,
sem Date.now no validator puro. Falta de política/registro válido deverá
bloquear a futura execução.

Dados do destino podem mudar entre dry-run e execução. Revalidar planHash
com estado atual é obrigatório; mudança exige novo ciclo. Isso não elimina
a janela entre revalidação e aplicação: a futura camada precisa definir
proteção de concorrência antes de habilitar produção. R2A não implementa
lock distribuído, transação global ou garantia de atomicidade.

## Auditoria e recovery futuros

Execução futura deverá registrar sem secrets: operationId, requester,
targetStoreId, mode, origem/checksum do backup/snapshot, planHash, início/fim,
resultado R1F, status e contagens. operationId pertence ao registro futuro,
não é campo redundante desta solicitação. R2A não grava audit log.

EXECUTION_FAILED não significa rollback. Falha após chunks aplicados deve
permanecer EXECUTION_FAILED, sem declarar sucesso ou atomicidade; verifier
e diagnóstico posteriores poderão ser necessários. R2A não implementa rollback.

## Escopo não implementado e validação

Sem restore, Firebase, Firestore, Auth real, network, writes, timers, ambiente,
relógio, aleatoriedade, callable, endpoint, UI, export em index, scheduler,
trigger, comando administrativo operacional, deploy ou produção. Somente
contrato, documentação e testes locais. Runner independente:
`node functions/tests/restore/runRestoreAdminContractTests.js`.
