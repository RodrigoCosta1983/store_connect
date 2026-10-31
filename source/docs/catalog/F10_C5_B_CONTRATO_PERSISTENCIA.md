# F10-C5-B — Proposta de persistência comercial

Data: 16/10/2026. Branch `feat/f7-intelligent-catalog`.
HEAD de referência: `30f4f8db2a4a59d21696fde3d673144aded31154`.

**Estado: proposta validada somente por leitura local de documentos sintéticos.
Não autoriza escrita, migração, ativação comercial nem alteração de contratos anteriores.**

## 1. Base e escolha de isolamento

C5-A define configuração em memória, não campos Firestore. F9 usa `price` e
`costPrice` em unidade monetária; `minimumStock`, `barcode`, `imageUrl` e `fiscal`
também existem no documento da entidade. DTOs F10-B versionados e a projeção
`project` de C1 são estritos quanto às chaves de topo. Adicionar `commercial`
ou `priceCents` nesses documentos quebra essa leitura. C3 valida somente a
estrutura utilizada e faz updates pontuais; isso não torna C1 permissivo.

Propõe-se separar a configuração em documento próprio, sem acrescentar campos
ao documento do produto/variante e sem mudar `variantSchemaVersion=1`:

| Entidade | Caminho proposto |
|---|---|
| Simples ou pai | `stores/{storeId}/products/{productId}/commercialProfiles/current` |
| Variante | `stores/{storeId}/products/{productId}/variants/{variantId}/commercialProfiles/current` |

Esses caminhos são **novos e apenas propostos**. Não foram criados, consultados
ou liberados por Rules. `current` identifica uma configuração, não um histórico
de auditoria. Não é receipt, ledger, índice de barcode ou reserva de COD.
O custo de leituras adicionais e a revisão independente são gates futuros.

## 2. Envelope versão 1 proposto

Exemplo sintético do pai:

```json
{
  "schemaVersion": 1,
  "identity": {
    "projectId": "demo-c5-b",
    "storeId": "s",
    "productId": "p",
    "variantId": null,
    "kind": "variantParent"
  },
  "configuration": {
    "priceCents": 1999,
    "costCents": 1000,
    "imageUrl": "referencia-sintetica",
    "fiscal": {"ncm": "0101", "origem": null}
  }
}
```

Exemplo sintético da variante:

```json
{
  "schemaVersion": 1,
  "identity": {
    "projectId": "demo-c5-b",
    "storeId": "s",
    "productId": "p",
    "variantId": "v",
    "kind": "variant"
  },
  "configuration": {
    "priceCents": {"mode": "override", "value": 2199},
    "costCents": {"mode": "inherit"},
    "imageUrl": {"mode": "remove"},
    "fiscal": {"mode": "inherit"},
    "barcode": "000123",
    "minimumStock": 2
  }
}
```

Envelope exige exatamente `schemaVersion`, `identity`, `configuration`.
`identity` exige os cinco campos ilustrados; `kind` é `simple`, `variantParent`
ou `variant`. Somente `variant` tem variantId não null. IDs seguem a validação
estável F10-B. O caminho/contexto confiável de leitura deve concordar com a
identidade declarada. Identidade no JSON é asserção, nunca autorização.
O adaptador local recebe esse contexto explicitamente; não verifica um caminho
real, perfil, banco, projeto SDK efetivo ou proveniência de rede.

Sem `createdAt`/`updatedAt` novos neste envelope. A revisão proposta é o
`updateTime` nativo do documento comercial, externo a `data`. Caso uma futura
auditoria necessite metadados adicionais, exige contrato versionado separado.
Não se inventam ator, data, aprovação ou assinatura a partir de `reason`.

## 3. Configuração e estados de presença

| Campo | Simples/base do pai | Variante |
|---|---|---|
| `priceCents` | Inteiro seguro não negativo | Política inherit/override com inteiro |
| `costCents` | Inteiro seguro não negativo | Política inherit/override com inteiro e reason no override |
| `imageUrl` | String não vazia | inherit/override com string, ou remove |
| `fiscal` | Mapa dos campos comprovados | inherit/override com mapa completo e reason no override |
| `barcode` | String própria não vazia | String própria; não herda |
| `minimumStock` | Inteiro próprio para simples | Inteiro próprio; não herda |

Todos são opcionais e podem ser representados como null, conforme C5-A.
Ausência do campo é diferente de ausência do documento comercial inteiro.

| Representação do campo | Interpretação |
|---|---|
| Ausente na base | Dado desconhecido/omitido; sem default |
| Ausente na variante, campo herdável | Herança padrão dentro do schema novo |
| `null` na base | Null explícito, sem zero/default/DELETE |
| `null` na variante, campo herdável | Estado não resolvido; sem fallback ao pai |
| `{ "mode": "inherit" }` | Herança explicitamente registrada |
| `{ "mode": "override", "value": ... }` | Valor próprio validado |
| `{ "mode": "remove" }` em imagem | Imagem removida explicitamente; sem fallback |

Barcode/mínimo ausentes ou null permanecem próprios, sem herança. O mínimo
na base atende simples; nunca é distribuído às variantes. Imagem vazia nova é
inválida, mas `imageUrl=""` legado continua observado sem reinterpretar remoção.
Remove é um estado persistível de imagem, não um FieldValue.delete nem exclusão
de arquivo Storage. Não existe patch de edição ou comando de remoção nesta etapa.
Override com `value:null` é inválido; null deve aparecer no campo em si.
Nenhum desses estados aprova venda ou resolve preço operacional ausente.

Preço e custo em centavos aceitam `[0, Number.MAX_SAFE_INTEGER]`, rejeitando -0,
frações, coerção de string e números não finitos. Inteiros Firestore fora da
faixa segura JavaScript são rejeitados. Não há moeda, desconto ou cálculo novo.
`minimumStock` usa quantidade inteira segura, sem saldo, lote ou movimento.

Fiscal limita-se a `ncm`, `origem`, `cfop`, `unidade`, `cest`,
`icmsSituacaoTributaria`, `pisSituacaoTributaria`, `cofinsSituacaoTributaria`,
`ibsCbsSituacaoTributaria`, `ibsCbsClassificacaoTributaria`: string ou null.
Não valida conteúdo tributário. Override substitui o mapa inteiro; não faz
merge por folha. `{}` não recupera os campos do pai. `reason` não vazia é
declaração de exceção de custo/fiscal, sem representar aprovação ou audit log.
Ativação dessas exceções permanece bloqueada até contrato de controle real.

## 4. Legado e introdução de centavos sem dupla interpretação

Ausência do documento comercial retorna `legacyObservation`: observa os campos
originais, suas unidades e estados, sem conversão, defaults ou herança nova.
Isso vale para simples F9 e entidades C1/C2 sem configuração comercial nova.
`price=19.99` continua unidade monetária; nunca é lido como 19,99 centavos.
Campos desconhecidos e fiscal legado não reconhecido são preservados no snapshot.
Dados legados inválidos permanecem observações, sem declaração de validade comercial.

Presença de versão nova válida usa somente `configuration`; nunca completa
campo omitido/null com campo de topo antigo. Outros campos legados comerciais
ficam disponíveis como observação, não são fundidos na configuração nova.
Perfil desconhecido/inválido não dispara fallback legado nem um default vazio.

**Se a entidade ainda contém `price` ou `costPrice`, a interpretação do documento
comercial novo é bloqueada, mesmo se os valores forem iguais ou null.** Não há
precedência silenciosa, dual write ou conversão automática. Esse bloqueio é uma
política defensiva do leitor experimental, não uma migração ou exigência de apagar
o legado. O documento original continua integralmente preservado.

Consequência: não se aprova adotar esse schema em produtos monetários F9 agora.
Uma futura etapa deve definir como preservar histórico e impedir leitores/writers
antigos de consumirem ou reintroduzirem uma segunda autoridade monetária. Não
se escolheu exclusão de campos, espelho decimal ou mudança de cliente por inferência.
Mesmo entidades C1 sem preço precisam de consumidores novos antes de ativação.

C5-A oferece conversão opt-in estrita `legacyMoneyToCents`, sem consumidor
operacional. `19.99 -> 1999`, `0.29 -> 29`; `1.005`, overflow e imprecisão visível
como `0.1+0.2` são rejeitados. C5-B não chama esse conversor automaticamente.
Conversão/rounding/backfill histórico exige aprovação específica.

## 5. Adaptador local e preservação

`projectCommercialRead(context, entitySnapshot, commercialSnapshot)` aceita
somente DTOs JSON-like já projetados, sem objetos Firebase ou I/O:

```json
{
  "exists": true,
  "data": {"campo": "dados sintéticos"},
  "updateTime": {"seconds": "1792100000", "nanoseconds": 123456789}
}
```

Documento inexistente exige exatamente `{ "exists": false }`. Snapshot
incompleto, Timestamp SDK, Date, undefined, acesso via getter, ciclo ou array
esparso são rejeitados, sem coerção. Objetos/mapas/listas suportados são copiados
e congelados; entrada não é modificada. Não se conecta este adaptador diretamente
a DocumentSnapshot real: a fronteira SDK permanece fora desta etapa.

Resultados locais: `legacyObservation`, `commercialV1`, `blocked`, `unavailable`.
Esses estados não são status B2-A, DTOs de commit, receipt ou resolução B1.
Entidade ausente não legitima documento comercial órfão. Tipo/vínculo/versionamento
da entidade são conferidos apenas no necessário para identificar sua classe;
atributos, combinação, reservas, saldo, arquivamento e autorização não são validados.

Snapshots completos da entidade e do documento comercial ficam separados da
configuração. Campos desconhecidos de ambos sobrevivem nessa evidência. Campos
desconhecidos dentro do schema comercial bloqueiam interpretação, sem descartá-los
ou repará-los. Documento `data:null` é malformado, não ausência ou remoção.
Não há serializer, merge de escrita ou método que devolva transform Firestore.

Barcode permanece exato, opcional e independente de COD. O helper C5-A conserva
ambiguidades e só garante unicidade no conjunto fornecido. C5-B não faz query,
índice, reserva ou seleção automática. Não garante unicidade global.

## 6. Compatibilidade C1/C2/C3, snapshots e concorrência

- F10-B, C1/C2 e seus normalizadores/receipts/versionamento permanecem intactos.
  A nova subcoleção não entra nos dados de topo nem no hash de intenção anterior.
  C1/C2 continuam sem aceitar configuração comercial em comandos de criação.
- C3 continua alterando somente folhas de estoque/arquivo e seu updatedAt;
  não lê nem altera documento comercial. Isso preserva seu contrato e não
  fornece controle de concorrência comercial por acidente.
- B2-A/B1 e snapshots históricos continuam exatos: não acrescentar configuração
  retroativa a receipt nem reinterpretar snapshot antigo usando preço atual.
  A projeção C5 não é prova de commit nem nova versão de readState/queryReceipt.
- Identidade continua a tupla productId/variantId, independente de COD/barcode,
  imagem, preço, rótulo ou combinação. Contexto store/project deve ser obtido
  pelo futuro caminho autorizado, nunca por preferência do cliente.
- `updateTime` da entidade e do comercial são revisões distintas. Uma edição
  futura deverá validar transacionalmente existência, perfil, tipo/arquivo,
  identidade e revisão de ambos; ausência exige precondição de inexistência.
  Leituras herdadas precisam de snapshots coerentes de pai e variante e de
  suas configurações, sem cache que troque pais/lojas. Nada disso está integrado.
- O adaptador preserva seconds string canônica e nanos completos (0..999999999),
  sem Date/ISO/milisegundos. Esse DTO de observação não substitui `expectedTime`
  F9, que exige precisão Firestore múltipla de 1000 nanos para baselines de
  comandos atuais. Valor sintético com outros nanos não recebe autoridade CAS.
  `createdAt`/`updatedAt` internos são dados preservados, não substitutos do
  updateTime nativo. Receipt.updateTime nunca vira baseline do produto.

## 7. Gates antes de qualquer escrita

1. Aprovar localização/schema e lifecycle do novo documento, inclusive entidades
   órfãs, backup/exportação e proteção contra writers antigos. Restore continua
   bloqueado; o parser de backup não foi ampliado nem declarado compatível.
2. Contratar transição monetária que preserve legado e evite duas autoridades,
   incluindo consumidores antigos, unidades, arredondamento e conversões.
3. Definir comandos, precondições CAS dos documentos separados, idempotência,
   auditoria server-side, permissões e tratamento de null/remove/inherit.
4. Aprovar exceções fiscais/custo controladas: ator, antes/depois, motivo e
   política de mapa inteiro ou por folha. Sem regras tributárias inferidas.
5. Descontos; múltiplas imagens/ordem/Storage; normalização, índice, escopo de
   unicidade de barcode e ambiguidades de scanner permanecem decisões abertas.
6. Definir mínimos ausentes/null, alertas e validação de imagem/URL; avaliar
   custo de consultas e estratégia de compatibilidade operacional.

Nenhum gate está liberado por este documento ou pelos testes sintéticos.
Sem writer, Rules, endpoint, índice, Firestore remoto, Storage ou migração.
Transporte C4 adiado pela alternativa D. Parada após C5-B.
