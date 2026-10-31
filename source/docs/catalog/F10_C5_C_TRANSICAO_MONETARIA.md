# F10-C5-C — Consumidores e transição monetária segura

16/10/2026 · `feat/f7-intelligent-catalog` · HEAD `30f4f8db2a4a59d21696fde3d673144aded31154`.

**Diagnóstico e recomendação, sem alteração operacional.** C5-A/B e decisões
C01–C09 são a base; novos gates abaixo precisam de aprovação. Nenhuma evidência
local certifica o estado publicado em HML/PROD. F10-D não foi iniciado.

## 1. Conclusão e fronteira da investigação

Recomenda-se a estratégia proposta: simples legados mantêm `price`/`costPrice`
em unidade monetária; novos pais/variantes usam exclusivamente centavos em
perfil separado versionado C5-B, sem espelho decimal, conversão ou migração
automática. Pai não é item vendável. Não introduzir perfil monetário em simples
legados nesta primeira transição; a representação `simple` permitida no DTO C5
não constitui autorização de adoção operacional.

Isso ainda não é seguro para ativação. Há writers antigos que não discriminam
tipo, leitores que inventam zero ou falham sem `price`, vendas diretas e backlog
offline com preços históricos do cliente. Ausência de preço no pai não é barreira:
um writer antigo pode acrescentá-lo. Saldo zero também não é controle de acesso.

Buscas dirigidas a price/costPrice/centavos/totais nas áreas produtos, vendas,
catálogo, fiscal e consumidores Flutter relacionados; leitura dos pontos
encontrados e inventário F9/A5 como referência, confirmado nos caminhos críticos.
Sem varredura de artefatos/build, dados reais, serviços financeiros externos ou
auditoria global. `functions/reports` não existe; relatórios encontrados são
Flutter. Busca literal discount/desconto nas áreas de venda/carrinho/widgets/
catálogo não encontrou política implementada; isso não certifica ausência em
todo o sistema. F8 é planejamento, não implementação de lucro histórico.

## 2. Inventário dirigido

UM = unidade monetária legada Number/double; C = centavos inteiros seguros.
Referências são linhas/símbolos do estado local, não de versões publicadas.
“Fonte usada” descreve o código atual; não aprova essa fonte como autoridade.

| Caminho / evidência | Representação e fonte usada | Escrita e impacto |
|---|---|---|
| `lib/models/product_model.dart:30,48`, Product factories | UM de product.price; fromMap exige num; fromFirestore usa zero se ausente/null | DTO local; não conhece variante; preço zero de fallback não pode atravessar V3 |
| `lib/screens/sales/new_sale_screen.dart:903,944,972,1073` | Lê products; filtra isArchived, projeta Product sem filtro productKind | Alimenta carrinho; pai sem preço pode falhar; pai com price pode parecer simples |
| `lib/models/cart_item_model.dart:7,30`, `lib/providers/cart_provider.dart:16,24` | UM, soma price*quantity, chave apenas productId; conserva preço já no carrinho | Estado local, sem servidor; duas variantes do mesmo pai colidiriam |
| `lib/screens/cart/cart_screen.dart:227,268`, NewSale/PaymentOptions | Exibe total local UM e encaminha carrinho | Orquestra fechamento; não fornece preço autoritativo |
| `manage_products_screen.dart:_saveProduct` (`:681,826,931,3831`) | Parse double de formulário, product.price; listagem usa fallback zero | Chama criação/V1 e editor cadastral; UI não separa autoridade de variante |
| `product_import_validation_screen.dart:537`, `product_import_item.dart:30,40`, `product_import_service.dart:769,786` | UM de arquivo/formulário, costPrice opcional | Importação chama createProduct por item; não é writer de perfil C5 nem conversão |
| `functions/products/createProductContract.js:326,415`, `createProduct.js:646,692` | UM finita não negativa; custo opcional do comando validado | Cria produto simples, estoque e receipt; não aceitar kind/perfil novo por campo solto |
| `updateProductContract.js`, `updateProduct.js:productRef/current/persisted` | UM do payload completo, não centavos | V1 atualiza produto identificado; pode introduzir price em pai sem checar kind/perfil |
| `productMutationContract.js:69,99`, `productMutationV2.js:cadastral/mutation` | UM em patches de price/costPrice; baseline exato de produto | V2 escreve folhas; baseline não identifica autoridade monetária nem perfil separado |
| `productEditState.js:41,54`, `product_cadastral_edit.dart:506`, `product_mutation_command.dart` | Projeção UM com ausente/null/unavailable, draft e comando próprios | Serviço lê; draft envia V2 por API; não pode ser reutilizado para centavos da variante |
| `archiveProduct.js:75`, `restoreProduct.js:98` | Price UM no snapshot de auditoria, não cálculo de preço | Writes de arquivo/restore individual; não migram moeda, devem respeitar kind futuro |
| `productVariantsC1.js:command/project`, C2 | Criação sem preços; DTO B preserva campos comerciais opacos | C1/C2 locais criam entidades/índices/COD; comandos não aceitam perfil comercial |
| `productVariantsC3.js:mutate`, `productVariantStockC3.js` | Não interpretam preço/custo | Writes locais só de estoque/arquivo; não resolvem revisão comercial |
| `functions/contracts/productCommercialC5.js`, `productCommercialPersistenceC5.js` | C somente dentro de configuração versionada; legado observado em UM | Puros/read-only, sem consumidores operacionais; misto price/costPrice + perfil bloqueado |
| `lib/widgets/payment_options_sheet.dart:334–425` | UM do carrinho gravada em products[].price e totalAmount; relê estoque, não preço efetivo | Transação cliente baixa saldo/FIFO e cria sale; não é confirmação V2 |
| `lib/widgets/confirm_fiado_dialog.dart:100,228,275` | UM do carrinho; parcelas arredondadas e última ajustada | Batch cliente cria sale/parcelas e baixa produto; sem resolver preço de servidor |
| `lib/providers/sales_provider.dart:addOrder (:24)` | Total UM e itens recebidos pelo chamador | Writer direto latente de sale; inventário F9 não encontrou chamador operacional; não ignorar a superfície |
| `functions/sales/saleV2Contract.js:32,61`, `confirmSaleV2.js:112–143` | Comando C esperado; servidor converte product.price UM estritamente, compara; venda histórica em UM | Núcleo local online instantâneo; escreve estoque/sale/receipt, sem export index; não suporta variantId |
| `sale_mutation_command.dart:128`, `sale_mutation_ledger.dart`, stores sale_mutation_store* | Comando V2 congelado em C; resultado/identidade duráveis | Persistência local B07-C; não integrado ao checkout ativo, não reutilizar como V3 por renomeação |
| `app_database.dart:68`, `offline_sales_repository.dart:123,157`, `offline_sales_sync_service.dart:150` | SQLite totalAmount REAL e productsJson UM; localSaleId estável | Backlog/reserva local por productId e envio ao sync; não guarda identidade variante nem quote C5 |
| `functions/sales/syncOfflineSale.js:201,245,311,844,1079` | UM recebida do backlog, normalizeMoney arredonda; valida total contra esses itens, não contra preço atual | Admin baixa estoque e cria sale; mantém replay/idempotência legado; nunca usar para novas variantes |
| `functions/catalog/createCatalog.js:188,2345,2889–2943`, tela pública | Exibição UM com fallback antigo; submit relê product.price, arredonda a C e grava snapshot UM | Escreve catálogo/solicitação, não sale/estoque; só productId, sem variante; requer exclusão de pai/perfil novo |
| `SaleOrder.fromFirestore (:78)`, `sales_provider.dart:87,204,377`, `sales_by_period_screen.dart:69` | UM dos itens/totais históricos de sales, não preço atual | Modelo/ABC/relatório; provider também atualiza recebimentos/caixa, preservar regras financeiras |
| `business_insights_service.dart:106,183,258`, `dashboard_screen.dart:56,107` | Soma totalAmount UM persistido | Leitura de faturamento/indicadores; ignorariam novo totalCents isolado ou confundiriam sua unidade |
| `accounts_receivable_screen.dart:67`, `customer_debt_detail_screen.dart:49,69`, `customer_receivables_screen.dart:93,144` | UM de totalAmount/amount/paidAmount; saldo por parcelas ou venda legada | Leitura e encaminhamento de pagamentos existentes; não migrar nem recalcular dívida pelo perfil atual |
| `pdf_receipt_service.dart:172,419,1457` | UM histórica de SaleOrder/itens, formatação de duas casas | Geração/exportação PDF, sem writer de produto; recibo PDF não é receipt de idempotência |
| `functions/fiscal/emitirNfce.js:buildItems (:339),:754` | Preço/total UM da sale; relê fiscal atual por productId; preço exige positivo | Escreve estado fiscal da sale, não estoque; não resolve variante ou snapshot fiscal novo |
| `backups/createStoreSnapshot.js:278,357`, `storeSnapshotContract.js:5` | Snapshot dos dados existentes sem conversão monetária | Exporta coleções v1; não inclui perfis/variantes; restore materializado permanece bloqueado |
| `firestore.rules:118,186,375` | Não impõem unidade monetária ou exclusividade de autoridade | Permitem criação de sale e certas alterações diretas de produto; barreira indispensável antes da coexistência operacional |

`functions/index.js:2345` exporta V1 e os núcleos cadastrais V2 seguintes;
`:1892` exporta syncOfflineSale; `:2819–2828` catálogo. Nenhum confirmSaleV2
ou núcleo F10/C5 foi exportado por esta etapa. Escrita Admin ignora Rules.

## 3. Riscos de dupla autoridade

1. `price` em topo e `configuration.priceCents` podem divergir e ser consumidos
   por clientes diferentes, mesmo que inicialmente iguais. C5-B bloqueia ambos;
   não resolver com prioridade ao campo mais recente ou com dual write.
2. Payload do carrinho/backlog não equivale a preço atual confiável. O checkout
   direto relê saldo; isso não autentica preço. O sync legado valida consistência
   interna do histórico, não transforma seu preço em fonte para variantes novas.
3. Centavos no comando V2 não significam cadastro novo em centavos: V2 ainda
   lê product.price e persiste venda UM após roundtrip. C5 não altera esse contrato.
4. Perfil separado muda sem alterar updateTime do produto. Usar somente baseline
   de produto, timestamp civil ou updatedAt perde mudanças de preço/herança.
5. Expor pai em consulta antiga pode causar crash ou preço zero; somar variantes
   por productId colide. Filtrar só UI, remover price ou usar saldo zero é insuficiente.
6. Custo ausente não é zero. Fontes examinadas de sale V1/V2 não capturam custo
   C5 histórico; não preencher lucro passado com custo atual. F8 exige snapshot.
7. Catálogo usa arredondamento; V2 e C5 fazem conversão estrita com diferenças
   de escopo. Não substituir normalizadores históricos para uniformizar agora.

## 4. Estratégia recomendada e segmentação

Manter dois domínios de autoridade por identidade, sem converter um no outro:

| Domínio | Cadastro monetário | Caminhos permitidos futuramente |
|---|---|---|
| Simples legado, sem discriminadores, ou simples F10 sem perfil | price/costPrice UM existentes | Fluxos legados compatíveis, sujeitos aos gates F9; nenhum perfil monetário C5 novo |
| Novo variantParent ativo | Perfil C5-B de base em C; sem price/costPrice no topo | Cadastro controlado; jamais vendável por V1/V2 ou V3 |
| Nova variante ativa | Perfil C5-B próprio em C, herança/override | Somente futuro caminho V3 que conheça a tupla e revalide o pai |
| Discriminador parcial/desconhecido, perfil misto ou vínculo divergente | Sem interpretação segura | Bloquear novos efeitos, não reparar/converter nem descartar histórico |

Não mudar C5-A/B para restringir seu DTO genericamente: trata-se de recomendação
de rollout mais restrita, que requer aprovação antes de integração. Não habilitar
um produto por simples flag `trusted`/versão de app. A identificação confiável
deve vir do documento e caminho servidor e ser imposta nas fronteiras de efeito.
Conversão de simples em pai (C09), adoção de perfil em simples e redistribuição
de estoque ficam fora da primeira liberação. C1/C2 atuais podem criar pai/variante
sem perfil: isso os deixa sem preço comercial, não automaticamente vendáveis.

## 5. Obtenção futura do preço V3 e concorrência

Proposta para o contrato futuro, não implementação ou alteração de receipt:

1. Autenticar ator e obter loja no servidor. Validar tupla productId/variantId,
   tipo, versão, vínculo, combinação/índices necessários e estado ativo de pai e
   variante. Cliente não escolhe autoridade por barcode, COD, UID ou valor.
2. Ler numa transação coerente pai, variante e ambos os perfis comerciais,
   inclusive existência dos perfis e ausência de price/costPrice incompatíveis.
   Revalidar schema/identity contra caminhos reais. Mesmo com override, ler e
   validar estado do pai e os perfis envolvidos; não aceitar orphan ou perfil null.
3. Resolver C5 somente quando ambos os documentos de configuração necessários
   forem válidos. Perfil da variante inexistente não é `{}` e não autoriza herança
   por default. Perfil existente com preço omitido ou inherit resolve pelo pai;
   null é não resolvido. Override é inteiro próprio validado; nunca copiar price
   do cliente. A ausência do preço-base pode ser resolvida por override válido,
   desde que o perfil-base exista/válido; obrigatoriedade de base é decisão pendente.
4. Comparar o preço e as revisões esperadas de apresentação com o estado relido;
   qualquer mudança relevante exige revisão explícita do comprador/operador,
   sem fechar silenciosamente por preço maior/menor. Definir contrato exato de
   quote/expectativas em F10-D antes de gravar. QueryId de leitura não vira saleId.
5. Calcular subtotais e soma em C com multiplicação/soma seguras, quantidades
   validadas e política de desconto explicitamente aprovada. Guardas no valor
   unitário não bastam para evitar overflow do subtotal/total.
6. Na futura confirmação, revalidar revisões no próprio commit junto de estoque
   e receipt, lendo antes de escrever. Snapshot histórico deve registrar preço
   efetivo, origem base/override, identidade exata e revisões lidas; campos e hash
   de V3 precisam de contrato novo aprovado. Não preencher receipts antigos.

O snapshot coerente é o estado serializado da confirmação, não garantia de que
o preço nunca mudará após commit. Retry da transação não pode aceitar preço
novo sem as expectativas/revisão previstas no contrato. Replay de resultado
confirmado deve preservar o histórico, sem recalcular pelo preço atual.
Revisões nativas são tokens exatos seconds/nanos; observação C5 pode conservar
nanos genéricos, mas CAS real deve respeitar precisão F9/Firestore e origem real.
Timeout/desconexão deixa confirmação incerta; não criar nova intenção nem liberar
ledger B1/B07-C usando DTO/fixture. Transporte C4 continua adiado.

### Estados que devem bloquear novo fechamento

| Estado | Comportamento futuro seguro |
|---|---|
| Sem perfil da entidade/pai necessário, perfil null, schema inválido/desconhecido | Indisponível para nova venda; sem fallback legado/default |
| Preço efetivo omitido/null/inválido, fração/overflow, texto ou unidade ambígua | Bloquear; solicitar correção cadastral autorizada |
| Zero explicitamente cadastrado e válido | Não confundir com ausência; política de venda gratuita e compatibilidade fiscal precisam aprovação antes de habilitar |
| Pai/variante arquivados ou ausência de entidade/vínculo/combinação válida | Bloquear novo efeito; manter histórico e resultados já confirmados |
| Mudança de preço/perfil/arquivo concorrente | Conflito/revisão conforme contrato; sem usar cache ou payload como autoridade |
| Custo desconhecido | Não fabricar CPV zero; tratamento de venda/relatório e campo de custo histórico exigem contrato |

`emitirNfce` exige preço positivo hoje: zero permitido no DTO não aprova emissão
fiscal de item gratuito. Não inventar tributação para contornar essa diferença.

## 6. Barreiras exatas a contratar antes da ativação

| Ponto | Barreira futura necessária; nenhuma implementada nesta etapa |
|---|---|
| `updateProduct.js`, após ler current e antes de prepareCodeChange/update | Recusar novo efeito V1 sobre pai, perfil monetário novo ou discriminador inválido; manter reconhecimento do receipt histórico antes de validar estado mutável |
| `productMutationV2.js:mutation`, após snapshot/CAS e antes de prepare; cadastral e stock | Validar domínio simples legado e ausência de perfil incompatível transacionalmente; V2 não pode acrescentar price em pai. Não mudar hash/receipt/normalizador para isso sem contrato de erro aprovado |
| `createProduct.js`/createProductContract, importação, `productEditState.js:project` | Criação F9 só simples sem perfil; projeção antiga deve recusar domínio novo, não omitir kind e emprestar cadastro como simples |
| `archiveProduct.js`, `restoreProduct.js`, `setProductCategories.js` | Separar operações antigas sobre simples de lifecycle pai/variante; não criar backdoor de conversão. Contratar quais operações de pai podem reutilizar taxonomia sem alterar preço |
| `confirmSaleV2.js`, loop de produtos antes de priceCents/stock | Recusar pai/perfil novo mesmo com price válido; normalizador já rejeita variantId, mas isso não barra venda do pai por productId |
| `syncOfflineSale.js`, lookup de receipt/sale existente e leituras de products antes da baixa | Preservar replay conhecido e backlog de simples; impedir novo efeito incompatível sobre pai/variante. Não reprecificar backlog nem rejeitar resultado antigo porque o cadastro mudou |
| Checkout direto instantâneo/fiado e `SalesProvider.addOrder` | Não basta adicionar if Flutter: proteger estoque e sale no servidor/Rules. Corte amplo depende de F9 B07/fiado/offline e plano de clientes antigos |
| `createCatalog.js`, seleção/listagem pública e submit | Excluir pais/itens novos de operações antigas no servidor; não só na seleção visual. Continuar sem criar venda/reserva por solicitação pública |
| `firestore.rules:186`, products allow update :206 | Proteger productKind/variantSchemaVersion e novas fontes monetárias; validar estado anterior e posterior para impedir demover pai, injetar price ou fabricar schema. Read atual permite pai a clientes antigos |
| `firestore.rules:118`, sales create :128 e update :137 | Impedir fabricar venda nova/injetar itens monetários pelo cliente e reescrever história V3; preservar pagamento/parcelas/caixa autorizados com contrato financeiro, sem fechar recebíveis cegamente |
| `firestore.rules:375`, wildcard recursivo | Sob products o wildcard já exclui subcollection='products', portanto não se presume permissão para perfis/variantes aninhados. Manter exclusão; não criar perfil top-level genérico autorizado nem allow alternativo que reabra writes |
| Perfis/variants novos, futuros matches | Backend-only para escrita; leitura explicitamente autorizada e compatível. Deny em um match não cancela allow de outro: testar sobreposições e queries |

Rules não filtram resultados de consultas: restringir leitura de pais pode
quebrar a query ampla de products do cliente antigo. É necessário aprovar
particionamento/queries e rollout compatível antes de expor entidades na mesma
coleção a clientes mistos. Não se resolve aceitando preço zero nem apenas uma
versão declarada de aplicativo. Nenhuma topologia alternativa foi implementada.
Admin ignora Rules: guardas nos callables/sync/catálogo continuam obrigatórias.

## 7. Histórico, relatórios, fiscal, fiado e offline

Vendas antigas conservam products[].price, totalAmount, parcels e receipts
originais em UM. Nunca multiplicar in-place por 100, acrescentar variante
retroativa, reprecificar, re-hash ou reconstruir custo/fiscal pelo perfil atual.
Preço de cadastro atual e snapshot imutável de preço de uma venda não são duas
autoridades concorrentes: pertencem a momentos/domínios diferentes.

V3 terá que escolher schema de venda explicitamente versionado e leitores
tipados. Gravar somente totalCents quebra leitores totalAmount existentes;
gravar ambos cria risco de divergência. Recomenda-se primeiro contratar novos
leitores/projeção determinística de apresentação a partir da única autoridade
histórica versionada. Não aprovar dual write/espelho UM por esta etapa. Rounding,
limites de apresentação double e totais mistos precisam de testes/decisão.

ABC deve distinguir tupla vendida de agrupamento analítico por pai. Faturamento
usa total histórico; lucro F8 usa custo histórico ou estado desconhecido, nunca
costPrice/costCents atual. Fiscal hoje relê cadastro por productId; variante e
exceções fiscais exigem contrato de snapshot fiscal próprio antes de emissão.
PDF deve apresentar preço histórico de V3 por projeção compatível, sem transformar
um PDF em evidência de receipt/commit.

Parcelas, datas, paidAmount, caixa e cálculo de dívida ficam intactos. Não ligar
fiado V3 sem contrato separado para valores/parcelamento e corte do batch atual.
Descontos não serão modelados como override arbitrário enviado pelo cliente;
precedência, limites, aprovação e rateio precisam de decisão comercial específica.

Backlog SQLite legado mantém localSaleId, unidade UM, conteúdo e política de
replay. Reservas locais por productId não podem ser promovidas a reservas da
variante. Novas vendas offline de variantes permanecem bloqueadas até protocolo
próprio: preço aceito no instante offline versus preço atual é decisão explícita,
não detalhe de conversão. Não migrar sale-v2 para v3 nem recriar intenção unknown.

Snapshot backup v1 não inclui as novas subcoleções: preservar arquivos antigos
não demonstra recuperação de perfil/variante. Plano de exportação versionado é
gate para operação comercial; restore permanece bloqueado sem exceção.

## 8. Fases, dependências e critérios de liberação

| Fase proposta | Entrega limitada | Critério de saída |
|---|---|---|
| P0 — esta C5-C | Inventário e estratégia, sem código | Evidências e decisões abertas registradas; nenhum rollout |
| P1 — próximo contrato | Contrato de barreiras F9/F10, queries/clientes antigos, replay e erros; contrato puro de elegibilidade por domínio | Aprovar simples legado vs pai/variante, campos protegidos, coexistência e testes; sem writer |
| P2 — próximo bloco implementável após P1 | Validadores puros de domínio monetário e testes sintéticos de elegibilidade/matriz V1/V2, sem conexão operacional | Falha fechada para mixed/unknown/parent; legado e hash/receipt congelados preservados; aprovação de integração separada |
| P3 — proteção antes da exposição | Guardas Admin + Rules + consumidores compatíveis, em subetapas autorizadas | Emulator prova não bypass por cliente antigo/direto/callable; recebíveis/replay/backlog preservados; rollout e corte F9 aprovados |
| P4 — persistência C5 futura | Comando comercial separado, CAS/idempotência/auditoria, sem venda | Schema/lifecycle/exportação, autoridade única e concorrência comprovados; sem conversão automática |
| P5 — F10-D futuro | Contrato e só depois checkout V3 instantâneo por tupla e preço revalidado | Preço/estoque/receipt atômicos, históricos e leitores compatíveis; nenhum fiado/offline implícito |
| P6 — integrações posteriores | Relatórios/PDF/fiscal/fiado/offline por gates próprios | Testes financeiros/fiscais e recuperação adequados ao escopo, sem reutilizar confiança sintética C4 |

F9/A5 B07-D e posteriores não estão declarados concluídos. F10-C5 fornece
configuração/projeção; não fecha o corte F9. C1/C2/C3 mantêm comandos e receipts;
qualquer necessidade de alterá-los deve ser proposta/versionada antes de editar.
F10-D depende de barreiras, contrato monetário e semântica da venda histórica,
não apenas de implementar um resolver C5. P3/P4 podem ser detalhados em partes,
mas a ativação aguarda todos os gates relevantes; fase aprovada não autoriza deploy.
Transporte C4 permanece pela alternativa D, sem condição escondida para retomá-lo.

### Matriz de testes a contratar

- Simples legado e simple v1 sem perfil continuam no domínio antigo; ausência,
  null, discriminador parcial, schema desconhecido e mixed nunca viram zero.
- V1/V2 produto, instantânea direta, fiado, sync e catálogo tentando pai/perfil
  novo: bloqueio antes do primeiro efeito; payload sem variantId também bloqueado.
- Rules com state anterior/posterior, demover kind, remover discriminadores,
  injetar price/costPrice/centavos e match recursivo; queries antigas e clientes
  sem versão atual; usuários revogados/loja divergente; Admin testado separadamente.
- Herança/override/null, perfil inexistente diferente de configuração vazia,
  zero explícito versus gratuito não aprovado, custo desconhecido, imagem/fiscal
  sem efeito monetário implícito; 0.29, 1.005, frações, limites e overflow de soma.
- Concorrência em pai/perfil-base/variante/perfil próprio, mudança de modo com
  mesmo valor, arquivo e revisão exata; nenhuma venda com snapshot incoerente.
- Cliente adultera preço/total/desconto; servidor rejeita e nunca usa payload
  para autorizar preço. Mesmo total com itens trocados deve ser identificado.
- Históricos/receipts V1/V2 byte/hash estáveis, retry/restart/unknown e replay
  após edição/arquivo sem novo efeito; backlog legado sincroniza com regra
  original, sem preço novo ou saleId substituto.
- Relatório/PDF misto versionado sem confundir centavos/UM; custo histórico
  ausente não zero; parcelas/recebimento/caixa preservados; fiscal com variante
  e preço zero depende de contrato específico, sem emissão real em testes.
- Exportação versionada inclui as entidades/perfis sem alterar parser v1;
  restore continua bloqueado. Testes Emulator apenas demo-* quando autorizados.

## 9. Decisões necessárias e próximo bloco seguro

Aprovar segmentação inicial sem perfil em simples; plano para queries/clientes
antigos e corte F9; contrato de bloqueio/replay por writer; base obrigatória versus
override suficiente, venda gratuita, custo obrigatório ou desconhecido; schema
histórico V3/projeções e desconto; política de preço offline e exceções fiscais;
barcode/múltiplas imagens continuam pendências C5 sem impacto de aprovação aqui.

Próximo bloco recomendado: **contratar e testar puramente a elegibilidade dos
domínios monetários e a matriz de barreiras V1/V2**, com fixtures e resultados
explícitos, sem writer ou Rules. Integração dessas barreiras deve ser autorizada
em etapa posterior; não começar por preço V3 operacional ou migração de legado.

Não executados testes de comportamento nesta etapa documental. A matriz acima
é futura, não resultado aprovado. Nenhum arquivo operacional foi alterado.
Parada após C5-C; sem commit/push/deploy/migração ou retomada de transporte.
