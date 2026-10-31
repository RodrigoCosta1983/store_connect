# F10/C4-B/02 — listagem local paginada de variantes

18/10/2026. Implementação de leitura no módulo `productVariantsReadB2A.js`.
Somente chamada Node em processo local confiável, Firestore Emulator `demo-*`,
SDK efetivamente em loopback sem SSL, guardas C1 existentes. Sem endpoint,
callable, token, assinatura, writer ou integração Flutter.

## Entrada e autorização

`listProductVariantsB02(db, {auth, data: {scope, productId, pageSize?, cursor?}})`.

`scope` exige exatamente projectId/uid/storeId; productId é ID estável, não path.
`pageSize` inteiro de 1 a 50, padrão 50. Omitir cursor inicia na primeira página;
null explícito é inválido. Campos extras são rejeitados antes de I/O.
O comando/cursor é copiado e validado antes do primeiro await.

`auth` tem a MESMA premissa de C1/C3/B2-A: contexto confiável do chamador Node.
Não é aceito no corpo `data` nem obtido de UID/papel/loja informados pelo cliente.
Cada página reconsulta na transação perfil atual, papel permitido, revogação,
vínculo de loja e existência da loja. scope apenas confere essas identidades.
Permissões de leitura seguem os cinco papéis C1, inclusive para arquivadas.

O módulo não autentica um processo externo. Se alguém expuser a função
aceitando `request.auth` de JSON, a premissa será violada. Não há tal adaptador
nesta entrega. A verificação de perfil não prova emissão/posse de uma credencial.

## Coleção, consistência e custo

Pai: `stores/{storeId}/products/{productId}`.
Folhas: `products/{productId}/variants/{variantId}` na mesma loja.
Pai deve ser variantParent válido; simples/legado não são convertidos ou tratados
como pai vazio. Inclui todas as folhas ativas E arquivadas, sem filtro de campo.
Pai arquivado é legível, sem permissão de mutação implícita.

A ordenação é por document ID crescente, definida pelo Firestore, independente
de nome, COD, atributos e arquivamento. IDs originais não são recalculados.
Valida pai, cada folha, vínculo, combinação canônica, reserva de combinação,
reserva COD/ownership e estoque/lotes pelos mesmos helpers do leitor B2-A.
Uma folha inválida fora da página pedida também impede o resultado inteiro.
Dados, campos desconhecidos e tokens `{seconds:string,nanoseconds:integer}`
usam firestoreValue/expectedTime existentes. Não há agregação de estoque no pai.

Cada página lê o conjunto completo em uma transação, com `orderBy(documentId)`
e `limit(201)`. Mais de 200 folhas bloqueiam; não se anuncia conclusão truncada.
O teto de 200 é a guarda defensiva C1 existente, não limite comercial homologado.
Os documentos são verificados antes de recortar a página de resposta.
Assim, a paginação é da RESPOSTA; o custo de leitura NÃO é limitado a pageSize.
Não é uma estratégia de escala aprovada. Não mantém snapshots históricos.

Cada página calcula fingerprint SHA256 sobre JSON canônico de:
`[1, scope, productId, parent.updateTime, [[variantId, updateTime], ...]]`,
incluindo TODAS as variantes ordenadas. Estoque/arquivamento C3 muda o updateTime
da folha sem mudar o pai: por isso o baseline do pai isolado seria insuficiente.
Inserções e mudanças do pai/folhas invalidam a continuação. Reservas são relidas
e validadas em cada página; alterações sem efeito nos dados/ownership não mudam
o fingerprint. A garantia presume o banco e os writers locais confiáveis.

## Resposta de página e cursor

Sucesso: status=available, scope, identity={productId,variantId:null}, parent,
variants e pagination. parent tem data/updateTime/isSellable=false. Cada item
de variants tem identity={productId,variantId}, data e updateTime.

pagination contém:

- pageSize, offset (quantidade de itens anteriores), totalCount;
- fingerprint do conjunto verificado nessa transação;
- complete: esta página alcançou o final do conjunto verificado;
- empty: o conjunto inteiro tem zero folhas, não apenas esta página;
- nextCursor: null no final; objeto de continuação nos demais casos.

Cursor tem exatamente version=1, scope, productId, pageSize, offset, afterId e
fingerprint. Repita pageSize nas chamadas seguintes quando diferente do padrão.
Offset precisa ser positivo, menor que 200 e múltiplo do tamanho da página;
afterId deve corresponder ao item imediatamente anterior do conjunto atual.
Offset no final ou além do conjunto não é um cursor válido. Repetir cursor
inalterado sobre conjunto inalterado produz a mesma página.

Cursor é asserção de posição/consistência, SEM assinatura ou autoridade.
Pode ser reconstruído por um chamador com dados conhecidos; não atesta que
esse chamador recebeu páginas anteriores. complete de uma página final NÃO é
prova isolada de que um consumidor montou a lista completa.

Para conferir uma travessia completa, o consumidor confiável deve começar sem
cursor/offset=0, seguir os nextCursor devolvidos, exigir offsets contíguos,
scope/produto/pageSize/fingerprint/totalCount constantes, IDs únicos na ordem,
e só concluir com complete=true, nextCursor=null e soma de itens=totalCount.
Pode recomputar o fingerprint com o baseline do pai e todos os IDs/tokens
acumulados. Páginas omitidas, duplicadas ou misturadas não atendem esse protocolo.
O hash comprova consistência do conjunto no contexto confiável local, NUNCA
autentica servidor/usuário ou resposta JSON de outro processo.

Vazio comprovado LOCALMENTE: pai válido, autorização e consulta completas na
transação, variants=[], offset=0, totalCount=0, empty=true, complete=true,
nextCursor=null. Trata-se de estado naquele snapshot, não promessa futura.

## Resultados sem página

- access-denied/authorization-failed: contexto/perfil/papel/loja/escopo negado.
- identity-conflict/cursor-identity-conflict: cursor de outra identidade.
- identity-conflict/cursor-position-conflict: posição não corresponde ao conjunto.
- unknown/listing-changed: fingerprint divergiu; descartar travessia e reler
  desde a primeira página. Não continuar combinando snapshots diferentes.
- unknown/entity-absent: pai não encontrado no caminho da loja autorizada.
- unknown/read-unavailable: falha/timeout/transação esgotada ou loja ausente.
- inconsistent-state/invalid-stored-state: dado/reserva/índice inválido ou teto
  local ultrapassado. Sem reparo, lista parcial ou escrita.

Esses resultados não têm variants/pagination e jamais significam lista vazia.
Entrada/cursor malformado lança invalid-argument antes de I/O. A guarda de
ambiente lança failed-precondition antes de I/O. Não há receipt de consulta,
requestId novo, mudança de ledger, alteração de baseline ou protocolo de retry.

## Limites de integração

Transporte/autenticação/proveniência externos continuam BLOQUEADOS nos termos
dos relatórios B2-B2-A/A1 e C4-B/01. O Flutter não foi alterado nem conectado.
O decoder Flutter B2-A atual não aceita este novo envelope como leitura antiga;
futuro contrato/decoder de listagem deve validar a travessia sem fabricar confiança.
Salvar exige ainda ponte C2 autorizada, intenção durável, tratamento da sequência
parcial pai+variantes e recuperação autoritativa. C3 não edita cadastro.
Sem ativação comercial, garantia global de Rules ou admissão de dependências.
