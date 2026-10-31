# F9 A5 — núcleo V2 local e aditivo

Data: 14/10/2026. Branch feat/f7-intelligent-catalog.
HEAD preservado: 30f4f8db2a4a59d21696fde3d673144aded31154.
Implementação local da etapa aprovada; sem publicação ou migração de clientes.
As restrições do pedido de implementação prevalecem sobre a proposta histórica.

## 1. Escopo efetivamente implementado

Dois handlers adicionais, exportados localmente no index:

- updateProductV2: patch cadastral/fiscal explícito/categorias/COD.
- adjustProductStockV1: ajuste separado de saldo/lotes, com motivo e auditoria.

V1 não foi substituído nem bloqueado. Nenhum writer de vendas, cliente Flutter,
Rules ou módulo de backup/restore foi alterado. Nenhum writer/export F10 criado.

getProductEditState, getProductMutationResult, integração do cliente, persistência
de tentativas e sinalização visual do restore ficam para etapas seguintes.
Nesta etapa os testes obtêm expectedUpdateTime do DocumentSnapshot Admin real.
Não adaptar o cliente preenchendo a versão com horário local ou updatedAt.

## 2. Contrato updateProductV2

Envelope obrigatório:

    {
      schemaVersion: 2,
      requestId: "identidade-estavel",
      productId: "produto",
      expectedUpdateTime: {seconds: "1791970000", nanoseconds: 123456000},
      changes: {
        set: {name: "Nome", price: 12.5},
        remove: ["barcode"],
        fiscal: {set: {ncm: "12345678", cest: null}, remove: ["cfop"]},
        categories: {ids: ["categoria"]}
      }
    }

Exemplo ilustrativo. Blocos opcionais; comando deve solicitar alguma alteração.
Campos desconhecidos, lotes/quantidade, storeId, transforms, campos derivados,
arquivamento e caminhos arbitrários são rejeitados antes de qualquer escrita.
requestId string não vazia, máximo 128 caracteres; productId estrito, sem slash,
whitespace externo ou pontos de navegação.

| Campo/intenção | Contrato implementado |
| --- | --- |
| Campo ou bloco omitido | Preserva, sem defaults ou reconstrução |
| changes.set | Somente name, price, minimumStock, imageUrl, cod, barcode, costPrice |
| changes.remove | Somente cod, barcode, costPrice; exclusão explícita |
| Null cadastral | Rejeita em todos os campos set; não significa remoção |
| name | Trim não vazio; name_lowercase derivado somente quando name é solicitado |
| price/costPrice | Número finito não negativo; zero explícito é válido |
| minimumStock | Inteiro seguro não negativo; não é movimentação de saldo |
| imageUrl | String; vazio limpa referência, sem excluir arquivo |
| cod | Trim/uppercase não vazio, até 40; remoção por remove, não vazio/null |
| barcode | Trim não vazio; remoção por remove |
| fiscal omitido ou {} | Preserva mapa/timestamp; {} não apaga irmãos |
| fiscal.set | Somente folhas fiscais editáveis conhecidas, string ou null |
| fiscal.set.campo=null | Persiste null explicitamente |
| fiscal.remove | Exclui somente a folha editável indicada |
| categories.ids | Até dez IDs distintos, ordem significativa; [] remove associações via projeção atual |
| set/remove repetidos/conflitantes | Rejeita |

Campos fiscais editáveis explícitos: ncm, origem, cfop, unidade, cest,
icmsSituacaoTributaria, pisSituacaoTributaria, cofinsSituacaoTributaria,
ibsCbsSituacaoTributaria, ibsCbsClassificacaoTributaria.

Edição comum em changes.set não aceita fiscal nem fiscal.campo. Campos fiscais
internos/desconhecidos, metadados e updatedAt não são controláveis pelo cliente.
Patch fiscal explícito usa FieldPath por folha e preserva irmãos/legados.
updatedAt é gerado exclusivamente pelo servidor quando há mudança fiscal real.
Sem novo gate de assinatura na edição.

Fiscal ausente pode receber folhas; mapa fiscal inválido (null, array, string,
Timestamp, DocumentReference) bloqueia apenas a solicitação fiscal, sem reparação
silenciosa. Cadastro comum preserva esses legados sem transformá-los em mapa.
Estoque/lotes legados malformados também são preservados por cadastro comum.
COD/reserva inconsistente permanece bloqueio conservador, inclusive COD omitido.

Categorias são relidas/validadas dentro da mesma transação, com projeção legada
e profundidade atual. Não é feita chamada separada setProductCategories.
Os validadores existentes são reutilizados sem refatorar/modificar o endpoint V1
de taxonomia. COD arquivado continua imutável; manutenção comercial/taxonômica
permitida não altera estado de arquivamento.

## 3. Versão, transação e idempotência

expectedUpdateTime contém segundos decimais canônicos e nanos exatos,
alinhados a microssegundos conforme Firestore. Validar intervalo Timestamp;
não truncar nanos para milissegundos. Comparar ao updateTime do snapshot lido
NA TRANSAÇÃO, não a um campo opcional no documento.

Ordem: validação estrutural/normalização → perfil/loja/autorização → receipt →
produto/versão → categorias/reservas/produtos do helper COD → todas as escritas.
Leituras precedem writes; callback não faz upload nem outro efeito externo.
Retry automático compara novamente a versão original; nunca atualiza baseline
para reaplicar a intenção antiga. Conflito retorna aborted com
reason=product-version-conflict, sem escrita.

Receipt por operação/loja/uid/requestId fica em auditLogs, em namespace próprio.
Hash canônico inclui versão, baseline e comando normalizado; ordem das chaves
de objetos é irrelevante, remove é ordenado, ordem de categorias/lotes é
semântica. Presença de blocos, null e remoção continuam explícitos.
V1 mantém seu namespace/hash sem alteração.

Autorização (roles operacionais atuais, revogação, loja derivada do perfil)
é revalidada inclusive no replay. Mesmo ID/hash retorna confirmação anterior
antes de reler versão/estado mutável; ID/hash diferente retorna already-exists,
reason=request-id-reused. Mesmo ID usado em V1 e V2 não colide entre operações.
Receipt, cadastro, taxonomia e reserva/liberação COD são atômicos.

Retorno: success, productId, requestId, replayed, changed. Patch sem efeito
confirma receipt com changed=false e não muda versão do produto.
Replay após venda/edição posterior não restaura estado antigo.
Não há expiração automática de receipts introduzida.

Cliente futuro deve congelar comando/ID e repetir os mesmos dados após timeout
ou resposta desconhecida. Sem integração/persistência cliente nesta etapa,
não existe nova garantia de deduplicação entre diálogos/reinícios.

## 4. Contrato de ajuste de estoque

Envelope: schemaVersion=1, requestId, productId, expectedUpdateTime, reason
não vazio e stockChange. Roles operacionais atuais, perfil não revogado e loja
derivada. Produto arquivado rejeita ajuste. Cadastro/fiscal/COD/categorias
não são aceitos neste payload.

| stockChange.kind | Campos/efeito |
| --- | --- |
| setManualQuantity | quantity inteiro seguro >=0; só lotes ausentes ou [] |
| editLots | operations não vazias; cada op é add, update ou remove |
| convertToLots | lots não vazios com quantidade positiva/validadeMs válida; só origem manual |
| convertToManual | quantity >=0 e acknowledgement=true; só origem com lotes |

editLots: update {index,set:{quantidade?,validadeMs?}}, remove {index},
add {quantidade,validadeMs}, cada um com op explícito. Índices são da ordem
original vinculada ao token; alvos resolvidos antes de remover, sem duplicatas.
Update preserva o mapa ORIGINAL do servidor, demais folhas e precisão do
Timestamp quando validade não é alterada. Não filtra lotes zerados nem reordena.
Quantidade zero em lote existente é explícita e preserva o lote; add exige
positivo. Remover todos exige conversão explícita. Soma é derivada no servidor
e precisa ser inteiro seguro. Não há migração/IDs novos de lotes.

Saldo/lotes atuais inválidos ou divergentes bloqueiam ajuste, sem defaults,
arredondamento ou validade fictícia. Auditoria registra motivo, ator, antes/
depois; saldo/lotes/receipt confirmam juntos. Ajuste não cria venda, caixa,
reserva de estoque ou alteração COD. Vendas continuam com seus contratos atuais.

## 5. Arquivos desta etapa

Criados:

1. functions/products/productMutationContract.js
2. functions/products/productMutationV2.js
3. functions/tests/products/productMutationContract.test.js
4. functions/tests/products/productMutationV2.emulator.test.js
5. functions/tests/products/runProductV2Tests.js
6. docs/catalog/F9_A5_V2_IMPLEMENTACAO_LOCAL.md
7. docs/catalog/F9_A5_TRANSICAO_WRITERS.md

Modificado somente functions/index.js, acrescentando os dois exports e
comentário. O export updateProduct V1 já existia localmente antes desta etapa;
o diff contra HEAD contém também alterações anteriores, que não devem ser
atribuídas a esta implementação.

## 6. Validação

| Verificação | Resultado nesta etapa |
| --- | --- |
| Contratos puros create/V1/V2/stock | 20/20 TAP aprovados; create também possui suas verificações internas |
| V2/stock Emulator, estado final | 32/32 aprovados, incluindo dois testes com syncOfflineSale real |
| updateProductIntegrity V1 Emulator | 5/5 aprovados |
| createProduct Emulator | 64 verificações aprovadas |
| COD/reservas V1 Emulator | 37 cenários aprovados, incluindo 15 pares concorrentes e corridas archive/update |
| Rules COD | 6/6 aprovados, sem alteração das Rules |
| Contenção restore | 6/6 aprovados; materialização permanece bloqueada |
| Node syntax | 6/6 arquivos JS verificados, incluindo index |
| git diff --check | Aprovado; whitespace dos sete arquivos novos também conferido |

O runner integrado passou antes do último endurecimento fiscal e dos dois
testes reais de venda. Depois dessas mudanças, a suíte V2 completa foi
reexecutada e passou 32/32; V1/Rules/restore não mudaram.
SDK/JDK/dependências existentes; JDK 21 ajustado somente no ambiente do processo.
Todos os writes ocorreram no Firestore Emulator, projeto demo-store-connect-restore.
Nenhum teste gravou Firebase remoto. Não houve Dart alterado; Flutter/analyze
não foram repetidos nem seus resultados históricos declarados como novos.
Regressão completa de restore (603/649, 46 falhas intencionais históricas)
não repetida/alterada; seus testes de contenção foram executados e aprovados.

Logs: build/f9-v2-contracts.log, f9-v2-emulator.log (primeira rodada, falhas
diagnosticadas), f9-v2-emulator-final.log (regressão integrada) e
f9-v2-emulator-targeted.log (estado final do núcleo).

A primeira rodada teve seis falhas: cinco decorrentes de nome de variável
incorreto na auditoria stock antes de commit, corrigido; uma fixture de archive
omitindo storeId obrigatório no contrato existente, corrigida. Nenhum teste
foi removido ou relaxado para ocultar comportamento incorreto.

## 7. Compatibilidade, bloqueadores e limites

V1 continua aceitando novas operações e replays. Rules e writers diretos
continuam iguais. Portanto NÃO há garantia A5 global sobre clientes atuais:
o editor ainda usa V1, com seus riscos de estoque/fiscal/taxonomia.
Esta etapa valida o novo núcleo, não libera homologação nem muda esse corte.

Pendentes: leitura autoritativa para cliente, recuperação de resultado,
dirty fields, persistência de tentativa, separação visual de cadastro/estoque,
paridade/migração das vendas diretas, bloqueio V1 e Rules finais.
Sem teste de carga; consulta completa de produtos no helper COD continua
custo/contenção. Token de documento causa conflitos conservadores até por
mudanças não relacionadas. Limites reais de tamanho/tempo transacional não
foram certificados para grandes arrays/lojas.

Atomicidade é Firestore; upload Storage continua externo e pode deixar órfão.
Nenhuma lógica Storage foi alterada. Sem reparação automática de legado ou
reservas ausentes; inconsistências exigem etapa própria.

Restore B continua bloqueando materialização no backend. Sinalização visual
fica separada conforme pedido; histórico das 46 falhas não foi modificado.
Não declarar recuperação operacional pronta nem backup completo de reservas.
Infraestrutura HML previamente inventariada continua pendência; sem nova
inspeção ou mudança remota nesta etapa.

Fontes primárias conferidas para as garantias transacionais e updateTime:

- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Precondition

Sem commit, push, deploy, instalação, reset/restore Git/stash/clean, escrita
remota, mudança IAM/PROD ou F10. Plano de transição separado, não executado.
