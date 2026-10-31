# F10-C4-B2-A — leitura autoritativa local

Data: 16/10/2026. Adaptador Node somente para Firestore Emulator `demo-*`,
com host loopback e configuração efetiva do SDK conferidos antes de qualquer I/O.
Não é endpoint, transporte Flutter nem autorização para ativação comercial.

## Entradas e autoridade

`readVariantStateB2A(db, {auth, data: {scope, productId, variantId?}})` lê
o pai e, quando solicitado, a variante na mesma transação. IDs são estáveis;
`variantId` omitido solicita somente o pai; null explícito é inválido.

`queryVariantReceiptB2A(db, {auth, data: {operation, command}})` recebe a
operação original e o comando completo congelado. Aceita createProductC1/C2,
createVariantC1/C2, adjustVariantStockC3 e archiveVariantC3. Reutiliza os
normalizadores puros dos próprios serviços, sem adaptar baselines/atributos
ao estado atual. C1 continua recusando COD; C2 mantém COD original no comando,
inclusive distinção entre omitido, vazio e espaços. null continua inválido.

`auth` representa o contexto confiável do chamador local, como nos serviços C1/C3,
e não um campo autorizado de um payload público. Não existe autenticação HTTP,
verificação de token remoto ou endpoint neste módulo. Uma integração futura
deverá produzir esse contexto a partir de autenticação verificada.

Toda chamada reconsulta users/{auth.uid}, papel permitido, accessStatus,
vínculo storeId e existência da loja na transação. Scope projectId/uid/storeId
é somente asserção contra db.projectId e o perfil. Consulta de archive exige
admin atual, inclusive para receipt já confirmado. Revogação concorrente
obedece à ordem serial da transação; nenhuma resposta concede autorização futura.

## Estado

`available` devolve scope, identity {productId, variantId}, parent e variant
opcional. Cada snapshot contém `data` completo e `updateTime` exato
{seconds: string, nanoseconds: integer}, validado pelo contrato F9.
parent acrescenta `isSellable: false`, independentemente de eventual saldo legado.
Não há saldo agregado, preço efetivo nem política comercial inferida.

Valida discriminação/versionamento, atributos completos e canônicos, vínculo
da variante, estados booleanos de arquivamento, índice da combinação e reservas
COD por proprietário, inclusive reserva legada de produto sem ownerType.
Estoque/lotes da variante usa exatamente a validação estática F9/C3, inclusive
para leitura de arquivados, sem aplicar qualquer ajuste. Pai arquivado pode ser
lido; não autoriza movimentação. Campos desconhecidos, estoque legado do pai,
metadados e omissão/null/valor permanecem no snapshot, sem defaults ou reparo.
Campos comerciais desconhecidos são informativos, sem validação de venda.

Serialização SDK reutiliza firestoreValue C1: Timestamp exato, referências
com caminho/projeto/databaseId, bytes em base64 e GeoPoint. Não passa por
Date, ISO ou milissegundos. Preserva a precisão realmente armazenada; o Emulator
trunca timestamps gravados a microssegundos. Valores SDK não suportados bloqueiam
a leitura, em vez de conversão silenciosa.

## Receipt e prova

Namespace existente preservado:
`stores/{storeId}/auditLogs/f10-c1-SHA256(JSON.stringify([uid,requestId]))`.
C2 mapeia createProductC2/createVariantC2 para createProductC1/createVariantC1
persistidos. Não existe namespace alternativo, migração ou write de consulta.

Receipt schemaVersion=1 contém operation, command, result, createdAt; C3 inclui
audit. O comando persistido de criação de produto contém defaults do servidor;
o leitor valida esses defaults e reconstrói apenas essa entrada histórica para
passá-la pelo normalizador original, exigindo igualdade integral com o persistido.
Não acrescenta campos ao receipt. Variantes mantêm a ordem original dos atributos
no comando; somente o documento criado tem combinação canônica.

Confirmação exige operação persistida correta, comando canônico completo igual
ao normalizado original e resultado compatível com identidade/status/schema.
Criação não contém requestId no result: o vínculo vem da chave e do command.
C3 exige requestId, changed e replayed=false persistidos, razão coerente e audit
consistente; ajuste reproduz a preparação F9 sobre audit.before e compara after
e changed; archive valida transição/no-op booleanos. Não altera o flag persistido
nem finge replay de writer. Campos desconhecidos do envelope e metadados dos
lotes são devolvidos, sem regravar. Formatos de resultado divergentes bloqueiam.

Receipt confirmado não depende de o snapshot atual ainda existir/estar ativo
ou ter o baseline antigo. Confirma o commit daquela intenção, não o estado atual.
Resposta inclui operation original, persistedOperation e receipt {path, updateTime,
data}. O updateTime do receipt NÃO é o baseline do pai nem da variante.

A identidade comprovável é a equivalência definida pelo normalizador histórico,
não igualdade byte a byte de todo payload recebido antes dele. Por exemplo,
C3 já remove espaços externos de reason e criação de produto materializa
quantidade=0/lotes=[] no comando. Os receipts não permitem recuperar essas
distinções originais perdidas. COD e baselines mantêm as distinções efetivamente
persistidas. Se B2-B exigir prova de bytes não registrados, esse caso fica bloqueado;
não se acrescenta fingerprint retroativo nem se atribui evidência inexistente.

## Resultados e bloqueios

- `confirmed`: receipt existente, íntegro e compatível com toda a intenção.
- `identity-conflict`: receipt íntegro na chave ocupada por operação/comando
  diferente; não revela o comando ou receipt incompatível.
- `access-denied`: autenticação/contexto, perfil, vínculo, escopo ou permissão
  insuficiente, inclusive após revogação e em replays.
- `inconsistent-state`: dados, índice, reserva ou receipt malformados.
- `unknown`: receipt/entidade ausente, loja ausente, timeout, falha de leitura
  ou esgotamento transacional. Ausência de resposta também é unknown no futuro adapter.
- `available`: snapshot válido; não prova commit de uma intenção.

Entrada malformada gera invalid-argument; guarda de ambiente gera
failed-precondition antes de qualquer I/O. Nenhum status muda ledger, reenvia
comando, libera bloqueio, cria requestId ou representa rejeição terminal.

C1/C2/C3 não persistem receipts de rejeição. Falha de writer e ausência de
receipt são indistinguíveis de comando ainda não enviado/em andamento ou leitura
inconclusiva; não existe evidência para rejected. Conflito/corrupção/acesso negado
mantêm a intenção em quarentena, nunca autorizam uma identidade substituta.
Receipts não registram baselines pós-commit: é obrigatória nova leitura para
uma futura intenção. Nunca alterar comando ou baseline da intenção original.

## Pendências B2-B e limites

As interfaces Flutter VariantAuthoritativeReader/VariantReceiptReader continuam
abstratas. VariantLocalResolution B1 é simulação, não carrega prova autoritativa;
null não pode virar rejeição. B2-B deverá definir decoder/prova, revalidar sessão
e escopo e persistir resultado via CAS sem aceitar outcomes synthetic-b1 como
evidência. Transporte/endpoint/integração UI e liberação do ledger não implementados.

A prova presume Firestore autoritativo com writers confiáveis. Não há assinatura
criptográfica nos receipts históricos; corrupção semanticamente consistente ou
Admin malicioso não é detectável somente pelo formato. Não se declara segurança
comercial global: F9 ainda libera COD antigo em determinadas trocas/remoções;
writers antigos/Rules não têm barreiras globais de variantes demonstradas.
Sem migração, auditoria global, teste de carga, operação comercial ou restore.
