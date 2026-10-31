# F10-C3 — Estoque, lotes e arquivamento local de variantes

Data: 16/10/2026. Complementa contratos F10 e decisões C01–C09.
Somente Emulator `demo-*`, loopback efetivo; sem handler, index ou integração.

## Operações e entrada

`adjustVariantStockC3(db, request)` e `archiveVariantC3(db, request)` em
`functions/products/productVariantsC3.js`. Envelope obrigatório:

```json
{
  "schemaVersion": 1,
  "requestId": "id-estavel-da-intencao",
  "scope": {"projectId":"demo-local","uid":"ator","storeId":"loja"},
  "productId": "pai",
  "variantId": "variante",
  "expectedProductUpdateTime": {"seconds":"123","nanoseconds":0},
  "expectedVariantUpdateTime": {"seconds":"123","nanoseconds":0},
  "reason": "Motivo explícito",
  "stockChange": {"kind":"setManualQuantity","quantity":5}
}
```

`stockChange` é obrigatório no ajuste e proibido no arquivamento. Todos os
demais campos acima são obrigatórios nas duas operações. Campos adicionais,
paths, transforms e patches cadastrais são rejeitados. IDs seguem C1; os dois
baselines preservam precisão Firestore conforme `expectedTime` F9.

O validador oficial `validateAdjustProductStock` F9 define integralmente:

- `setManualQuantity`: inteiro seguro não negativo; rejeita modo com lotes.
- `convertToLots`: lista não vazia, novos lotes com saldo positivo e
  `validadeMs` inteira no intervalo Timestamp F9; quantidade resulta da soma.
- `editLots`: add/update/remove explícitos por índice do baseline original;
  índice repetido/inexistente rejeita. Update pode zerar lote existente.
  Remover todos exige conversão explícita. Ordem e metadados sobreviventes
  preservados; datas não alteradas conservam nanosegundos exatos.
- `convertToManual`: quantidade segura não negativa e `acknowledgement=true`;
  exige lotes atuais e remove-os somente por essa intenção explícita.

Não existe delta implícito, venda, FIFO de consumo, seleção de lote por
vencimento, transferência, custo/alocação, devolução, saldo negativo ou
redistribuição automática. Esses contratos não são deduzidos de um ajuste.

## Integridade, identidade e autorização

Autorização/loja/revogação C1 relidas na transação, inclusive replay. Ajuste
aceita os mesmos cinco papéis F9/C1; arquivamento exige admin, conforme a
permissão F9 de arquivamento. Scope é asserção, nunca autoridade de loja.
O pai deve ser `variantParent` ativo e a variante pertencer ao caminho.
Combinação completa/canônica deve corresponder à reserva C1. COD presente
deve estar canônico e sua reserva íntegra ter o proprietário F9 correto.
Não há reparo, recriação de índices ou liberação de COD.

Só folhas de estoque ou `isArchived`/`updatedAt` são alteradas. C3 valida a
estrutura utilizada (tipo, versão, vínculo, atributos, estado, índices e
estoque), preservando campos desconhecidos fora dela por update pontual.
Não interpreta custo/preço/fiscal/metadados novos nem altera os DTOs C1/B.
Metadados desconhecidos dos mapas de lotes também são preservados por F9.
Histórico existente, inclusive subcoleções e receipts, permanece intacto.

Quantidade atual deve ser inteiro seguro não negativo; lotes, quando
presentes, devem ser lista com quantidade íntegra e Timestamp Firestore.
Lista não vazia deve somar exatamente quantidade, com soma segura. Estado
inválido bloqueia ajuste e arquivamento, sem normalização/reparo silencioso.
Preparação estática local reproduz `productMutationV2.stock` sem modificar
o writer F9; testes diferenciais executam as operações contra o callable F9.

## Transação, concorrência e receipts

Leituras de autorização, receipt, pai, variante e reservas precedem writes.
Baseline obsoleto retorna `aborted`; mesma variante concorrente tem uma
intenção vencedora. Variantes diferentes podem ajustar independentemente:
ajuste/arquivamento não regrava pai, irmã, COD ou índice de combinação.
O pai é lido na transação: alteração/arquivamento concorrente serializa com
o efeito. Pai arquivado bloqueia todos os novos efeitos C3, inclusive archive;
variante arquivada bloqueia ajuste, mas admite archive como no-op autorizado.

Receipt usa exatamente `auditLogs/f10-c1-SHA256([uid,requestId])` por loja,
`schemaVersion=1`, operação, comando canônico, resultado, createdAt e auditoria
before/after. C3 acrescenta operações distintas no mesmo espaço C1/C2.
Criação, ajuste e arquivamento competem pela mesma identidade em ambas as
direções. Não há namespace paralelo. Divergência retorna `already-exists`
com `request-identity-conflict`, sem efeito parcial.

Replay retorna resultado anterior antes de baselines/estado mutável, após
reautorizar; não repete estoque/arquivamento nem regrava receipt. Falhas não
persistem receipt de rejeição, seguindo C1/C2; não se altera o contrato de
rejeições terminais do ledger F9. No-op grava receipt sem avançar updateTime.
Efeito real atualiza `updatedAt` da variante; baseline continua snapshot.updateTime.

Resposta contém schemaVersion, productId, variantId, requestId,
`status: adjusted | archived`, changed e replayed. Motivo, tipo de ajuste,
ator/loja e baselines ficam no comando; estoque before/after no audit do
ajuste. Arquivamento registra before/after de isArchived, sem inventar novos
campos no documento ou romper a leitura estrita C1.

## Gates preservados

Pai nunca é alvo de ajuste C3 nem fonte de saldo vendável. Nenhum agregado
é persistido no campo legado quantidade. Não há operação de arquivamento
do pai/restauração/conversão de tipo nesta entrega. Arquivamento lógico do
pai em ambiente operacional depende das barreiras antigas ainda pendentes.

Não há edição cadastral F10 habilitada: entradas C1/C2 não sobrescrevem saldo
de item existente e continuam rejeitando estoque inicial não zero. C3 não
aceita mudanças cadastrais. Writers legados/Rules não foram alterados, logo
não se declara proteção global contra edição/venda antiga do pai ou retenção
histórica global de COD. Ativação comercial continua bloqueada.
Limites C1/C2 são provisórios; carga, grandes arrays, UX e contrato de lotes
para venda continuam pendentes. Restore de backup permanece bloqueado.
