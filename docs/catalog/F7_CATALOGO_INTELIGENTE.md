# 🚀 F7 — CATÁLOGO INTELIGENTE E COMPARTILHAMENTO DE PRODUTOS

Documentação oficial da arquitetura, decisões, segurança, implementação e evolução do Catálogo Inteligente do Store&Connect.

> Este documento é a referência oficial da F7.
> Toda decisão arquitetural relevante e toda etapa concluída devem ser registradas aqui.

**Última atualização:** 12/09/2026 — F7.5-P avançou com P1–P4 concluídas e P5 concluída no Preview. Refresh silencioso, proteção contra requisições simultâneas, lifecycle funcional no iOS e refresh manual universal foram validados em Android, iPhone e desktop. A futura ação de selecionar produtos reutilizará o refresh silencioso na F7.6. Produção LIVE ainda permanece na versão anterior até publicação isolada do checkpoint.

=====================================================================

# 📌 STATUS DA F7

```text
✅ F7.1 — Arquitetura e modelo do catálogo
    ✅ F7.1-A — Modelo Product atual identificado
    ✅ F7.1-B — Pontos de acesso à collection products mapeados
    ✅ F7.1-C — Persistência do cadastro manual mapeada
    ✅ F7.1-D — Persistência da importação de produtos mapeada
    ✅ F7.1-E — Schema canônico do Catálogo Inteligente definido
    ✅ F7.1-F — Entrega pública do catálogo e estratégia de imagens definida

✅ F7.2 — Backend seguro para criação do catálogo
✅ F7.3 — Seleção de produtos dentro da loja
    ✅ modo de seleção de catálogo
    ✅ seleção individual desktop/web
    ✅ seleção individual mobile
    ✅ seleção em massa por categoria
    ✅ contador de produtos selecionados
    ✅ configuração de título e validade
    ✅ integração Flutter → createCatalog
    ✅ cabeçalho responsivo mobile
    ✅ produtos sem estoque bloqueados na UI
    ✅ produtos sem estoque bloqueados no backend
    ✅ regressão automática do catálogo 4/4
    ✅ validação runtime Android
    ✅ createCatalog publicado em produção
✅ F7.4 — Geração e gestão do link público temporário
    ✅ F7.4-B1 — contrato de publicSlug definido
    ✅ F7.4-B2 — URL canônica definida com publicSlug + publicToken
    ✅ F7.4-B3 — Flutter monta publicUrl
    ✅ F7.4-B4 — copiar e compartilhar link após a criação
    ✅ F7.4-B5 — dialog de catálogo criado extraído para componente próprio
    ✅ F7.4-B6 — criação/cópia/compartilhamento validados em runtime Android
    ✅ F7.4-B7 — persistência segura para recuperação futura do link
    ✅ F7.4-B8 — listCatalogs + tela base Catálogo Inteligente implementadas
    ✅ F7.4-B9 — item Catálogo Inteligente inserido abaixo de Gerenciar Clientes
    ✅ createCatalog + listCatalogs publicados em produção
    ✅ tela Catálogo Inteligente validada em runtime Android
    ✅ F7.4-B10 — copiar e compartilhar catálogo existente
    ✅ F7.4-B10 validada em runtime Android
✅ F7.5 — Página pública responsiva
    ✅ getPublicCatalog público e sanitizado
    ✅ rota /{publicSlug}/catalogo/{publicToken} sem AuthGate
    ✅ layout responsivo desktop/mobile
    ✅ Firebase Hosting Preview + live
    ✅ domínio definitivo app.storeconnect.com.br
    ✅ comportamento de estoque dinâmico validado por nova consulta
⏳ F7.5-P — Performance + atualização inteligente da página pública
    ✅ P1 — diagnóstico de performance mobile
    ✅ P2 — redução de repaints + diagnóstico de imagens/dispositivo
    ✅ P3 — isolamento completo da rota pública dos providers privados
    ✅ P4 — Slivers, lazy rendering, layout mobile e escala de 200 produtos
    ✅ P5 — atualização inteligente / refresh orientado à ação do cliente
    ⏳ P6 — validação final em dispositivos reais
⏳ F7.6 — Seleção de quantidades
⏳ F7.7 — Resumo e envio da seleção
⏳ F7.8 — Recebimento da solicitação no Store&Connect
⏳ F7.9 — Expiração, bloqueio, segurança, retenção e limpeza
⏳ F7.10 — Testes completos do MVP
⏳ F7.11 — Demo comercial
```


=====================================================================

# 🎯 OBJETIVO DA F7

Criar um sistema de catálogo inteligente que permita ao lojista selecionar produtos existentes no Store&Connect e gerar um catálogo temporário compartilhável através de link.

Fluxo principal:

```text
LOJA
  ↓
seleciona produtos existentes
  ↓
gera catálogo
  ↓
recebe link temporário
  ↓
compartilha com o cliente

CLIENTE
  ↓
abre no navegador
  ↓
SEM login
SEM instalação de aplicativo
  ↓
visualiza produtos
  ↓
seleciona quantidades
  ↓
confere resumo
  ↓
envia seleção para a loja
```

=====================================================================

# 📦 ESCOPO DO MVP

O primeiro MVP deverá permitir:

```text
✅ seleção de produtos pela loja
✅ foto do produto
✅ nome
✅ preço
✅ categoria quando aplicável
✅ indicação segura de disponibilidade
✅ pesquisa
✅ seleção de quantidade pelo cliente
✅ resumo da seleção
✅ envio da solicitação para a loja
✅ link público temporário
✅ página responsiva
✅ acesso sem login para o cliente
```

Não faz parte inicialmente:

```text
❌ checkout
❌ pagamento online
❌ e-commerce completo
❌ cadastro obrigatório do cliente
❌ exposição de custo
❌ exposição de margem
❌ exposição de lotes
❌ exposição de informações fiscais
❌ exposição de estoque operacional detalhado
```


=====================================================================

# 🏗️ ARQUITETURA BASE DO CATÁLOGO

## Fonte operacional de verdade

A collection oficial de produtos da loja continuará sendo:

```text
stores/{storeId}/products/{productId}
```

A F7 NÃO deverá criar um segundo cadastro independente de produtos.

Regra arquitetural:

```text
PRODUTO DA LOJA
→ fonte operacional de verdade

CATÁLOGO
→ camada controlada de publicação e compartilhamento
```

O catálogo utiliza produtos já existentes na loja, evitando:

```text
❌ duplicação de cadastro
❌ divergência de produto
❌ manutenção duplicada
❌ exposição direta da estrutura interna da loja
```

=====================================================================

# 🔒 FRONTEIRA ENTRE DADOS PRIVADOS E PÚBLICOS

O cliente que abrir um catálogo público NÃO deverá receber acesso direto aos documentos:

```text
stores/{storeId}/products/{productId}
```

Também não deverão ser afrouxadas as regras de segurança da collection products apenas para permitir o catálogo.

O backend será responsável por:

```text
1. validar a loja e o usuário que cria o catálogo
2. receber os productIds selecionados
3. consultar os produtos privados
4. rejeitar produtos arquivados
5. filtrar somente campos permitidos
6. gerar a representação pública do catálogo
```

Princípio:

```text
BANCO PRIVADO DA LOJA
        ↓
BACKEND SEGURO
        ↓
SANITIZAÇÃO DOS DADOS
        ↓
CATÁLOGO PÚBLICO
```

O navegador do cliente nunca deverá receber o documento operacional completo do produto.

=====================================================================

# 📦 CAMPOS PÚBLICOS — CONTRATO ATUAL DA F7.5

A implementação concluída da F7.5 expõe somente o conjunto sanitizado
necessário para a página pública.

Contrato atual de produto:

```text
productId
name
price
imageUrl
quantidade
categoryName
position
```

A `quantidade` retornada representa a disponibilidade atual consultada
pelo backend no momento da requisição.

Produtos com `quantidade <= 0`, inexistentes ou arquivados são omitidos
da resposta pública.

Continuam fora do contrato público os demais dados operacionais,
fiscais, custo, margem, lotes e informações internas da loja.

=====================================================================

# 🚫 CAMPOS QUE NÃO DEVEM SER PUBLICADOS

```text
costPrice
lotes
fiscal
minimumStock
name_lowercase
categoryId
createdAt
isArchived
```

A F7.5 revisou a decisão inicial sobre `quantidade`: a página pública recebe somente a quantidade disponível necessária para exibição e futura seleção, sem receber os demais dados operacionais do produto.

O barcode permanece como decisão pendente da F7.1.


=====================================================================

# ✅ F7.1-A ATÉ F7.1-D — SCHEMA ATUAL CONFIRMADO

## ProductModel atual

Arquivo:

```text
lib/models/product_model.dart
```

A classe Product atualmente representa:

```text
id
name
price
imageUrl
quantidade
minimumStock
```

IMPORTANTE:

O ProductModel é uma representação reduzida.
Ele NÃO contém todos os campos existentes nos documentos de produtos do Firestore.

=====================================================================

## Persistência do cadastro manual

Collection:

```text
stores/{storeId}/products/{productId}
```

Campos base confirmados:

```text
name
name_lowercase
price
lotes
quantidade
minimumStock
imageUrl
categoryId
categoryName
```

Na criação também é registrado:

```text
createdAt
```

Produtos Business podem possuir o mapa fiscal:

```text
fiscal.ncm
fiscal.origem
fiscal.cfop
fiscal.unidade
fiscal.cest
fiscal.icmsSituacaoTributaria
fiscal.pisSituacaoTributaria
fiscal.cofinsSituacaoTributaria
fiscal.ibsCbsSituacaoTributaria
fiscal.ibsCbsClassificacaoTributaria
fiscal.updatedAt
```

=====================================================================

## Persistência da importação

Campos confirmados:

```text
name
name_lowercase
price
lotes
quantidade
minimumStock
imageUrl
categoryId
categoryName
createdAt
```

Campos opcionais da importação:

```text
barcode
costPrice
```

Em lojas Business, a importação também pode registrar:

```text
fiscal.ncm
fiscal.updatedAt
```

=====================================================================

## Controle de arquivamento

O campo:

```text
isArchived
```

segue atualmente a regra de compatibilidade:

```text
isArchived == true
→ produto arquivado

isArchived ausente ou diferente de true
→ produto considerado ativo
```

Para a F7:

```text
produto arquivado
→ não pode ser incluído em novo catálogo
→ não pode ser aceito em nova solicitação do cliente
```


=====================================================================

# ✅ F7.1-E — MODELO CANÔNICO DO CATÁLOGO

## Decisão arquitetural

O catálogo NÃO criará uma cópia independente do cadastro de produtos.

A fonte operacional de verdade continuará sendo:

```text
stores/{storeId}/products/{productId}
```

O catálogo armazenará somente a relação entre o catálogo e os produtos selecionados.

Nome, preço, imagem, categoria e disponibilidade serão obtidos dos produtos atuais pelo backend no momento em que o catálogo for consultado.

=====================================================================

## Catalog

Estrutura privada proposta:

```text
stores/{storeId}/catalogs/{catalogId}
```

Campos atuais:

```text
status
title
createdAt
createdByUid
expiresAt
publicTokenHash
productCount
publicTokenEncrypted
```

Responsabilidades:

```text
status
→ controla se o catálogo pode continuar sendo utilizado

title
→ identificação do catálogo para a loja e para apresentação pública

createdAt
→ data de criação

createdByUid
→ usuário responsável pela criação

expiresAt
→ limite de validade do link público

publicTokenHash
→ hash SHA-256 utilizado para localizar e validar o catálogo público

productCount
→ quantidade de itens do catálogo, utilizada também na gestão interna

publicTokenEncrypted
→ envelope criptografado utilizado exclusivamente pelo backend
  para recuperar o link de um catálogo já criado
```

O token público original NÃO é armazenado em texto puro no documento do catálogo.
A recuperação privada do link utiliza AES-256-GCM e permanece restrita ao backend.

=====================================================================

## CatalogItem

Estrutura:

```text
stores/{storeId}/catalogs/{catalogId}/items/{catalogItemId}
```

Campos mínimos:

```text
productId
position
addedAt
```

Responsabilidades:

```text
productId
→ referência interna ao produto verdadeiro da loja

position
→ ordenação do produto dentro do catálogo

addedAt
→ momento em que o produto foi incluído no catálogo
```

O catalogItemId deverá possuir identificador próprio e não depender do productId.

=====================================================================

# 🔐 IDENTIFICADOR PÚBLICO DO PRODUTO — DECISÃO REVISADA NA F7.5

O desenho inicial previa utilizar apenas um `itemId` público e esconder
`productId`.

Na implementação concluída da F7.5, o contrato sanitizado de
`getPublicCatalog` retorna `productId` junto dos campos públicos do
produto.

Isso NÃO transforma o documento operacional do produto em público:
o navegador continua sem acesso direto a
`stores/{storeId}/products/{productId}` e não recebe `storeId`,
`catalogId`, campos fiscais, custo, lotes ou demais dados internos.

A segurança do catálogo não depende de esconder o `productId`.
Ela depende de o backend validar:

```text
publicSlug
publicToken
status do catálogo
expiresAt
loja
assinatura
itens pertencentes ao catálogo
estado atual dos produtos
```

O contrato definitivo de envio da F7.6/F7.7 ainda deverá decidir qual
identificador será enviado pelo cliente. Independentemente disso, o
backend deverá revalidar que cada produto solicitado pertence ao
catálogo e continua elegível antes de aceitar a solicitação.

=====================================================================

# 🔄 DADOS DINÂMICOS — SEM SNAPSHOT DO PRODUTO

No MVP, CatalogItem NÃO armazenará cópias de:

```text
name
price
imageUrl
categoryName
quantidade
availability
```

Essas informações serão consultadas no produto verdadeiro e sanitizadas pelo backend.

Consequências na próxima consulta pública:

```text
PREÇO ALTERADO NA LOJA
→ próxima chamada a getPublicCatalog retorna o preço atual

NOME ALTERADO
→ próxima chamada retorna o nome atual

IMAGEM ALTERADA
→ próxima chamada retorna a imagem atual

CATEGORIA ALTERADA
→ próxima chamada retorna a categoria atual

ESTOQUE ALTERADO
→ próxima chamada recalcula quantidade e elegibilidade
```

IMPORTANTE: uma página que já permaneça aberta não recebe essas mudanças
automaticamente no estado atual da F7.5. É necessária uma nova chamada
a `getPublicCatalog`, hoje provocada por recarregamento da página.
A estratégia de atualização inteligente será tratada na F7.5-P.

O objetivo é manter:

```text
products
→ única fonte de verdade
```

=====================================================================

# 📦 REGRA DE DISPONIBILIDADE — IMPLEMENTAÇÃO ATUAL

Regra pública validada na F7.5:

```text
quantidade > 0
→ produto é retornado
→ quantidade atual é enviada no contrato sanitizado

quantidade <= 0
→ produto é omitido da resposta pública

produto inexistente
→ omitido

isArchived == true
→ omitido
```

A quantidade exibida é informativa e representa o estado encontrado
naquela requisição. Ela não substitui a revalidação obrigatória do
backend no envio final da seleção.

=====================================================================

# 🗄️ PRODUTO ARQUIVADO

Regra oficial:

```text
isArchived == true
→ não pode entrar em novo catálogo
→ não deve continuar sendo oferecido publicamente
→ não pode ser aceito em nova solicitação
```

O backend deverá revalidar o estado atual do produto.

=====================================================================

# 💰 ALTERAÇÃO DE PREÇO

O catálogo não congelará o preço do produto no MVP.

Regra:

```text
produto = R$ 49,90
      ↓
lojista altera para R$ 54,90
      ↓
próxima consulta do catálogo
      ↓
R$ 54,90
```

No envio final da seleção, o backend deverá consultar novamente o preço atual.

=====================================================================

# 🔑 IDENTIFICADOR PÚBLICO

O link utilizará token aleatório de alta entropia.

Formato canônico definido posteriormente na F7.4:

```text
https://app.storeconnect.com.br/{publicSlug}/catalogo/{publicToken}
```

O banco armazenará:

```text
publicTokenHash
```

Fluxo:

```text
publicToken recebido
        ↓
backend calcula hash
        ↓
localiza catálogo pelo publicTokenHash
        ↓
valida status e expiração
```

O token puro não deverá ser persistido no documento do catálogo.

=====================================================================

# ⏱️ EXPIRAÇÃO E REVOGAÇÃO

O catálogo possuirá expiresAt.

O backend deverá bloquear o acesso quando:

```text
data atual >= expiresAt
```

Também deverá existir possibilidade de revogação manual pela loja.

Estado efetivo:

```text
ATIVO
→ status permite uso
→ ainda não expirou

REVOGADO
→ bloqueio imediato pela loja

EXPIRADO
→ expiresAt já foi atingido
```

A expiração pode ser determinada pelo backend através de expiresAt sem depender de uma atualização agendada do documento.

=====================================================================

# 🛡️ REVALIDAÇÃO NO ENVIO DA SELEÇÃO

O envio feito pelo cliente nunca será aceito apenas com base no que estava visível na tela.

Antes de registrar a solicitação, o backend deverá validar novamente:

```text
✅ token do catálogo
✅ catálogo ativo
✅ catálogo não expirado
✅ item realmente pertencente ao catálogo
✅ productId relacionado ao item
✅ produto ainda existente
✅ produto não arquivado
✅ preço atual
✅ disponibilidade atual
✅ quantidade solicitada válida
```

O backend será a autoridade final.

=====================================================================

# 📌 DECISÃO FINAL DA F7.1-E

```text
products
→ fonte de verdade

Catalog
→ controla publicação, validade e acesso

CatalogItem
→ relaciona o catálogo ao produto

backend
→ consulta + valida + sanitiza

cliente público
→ recebe somente dados necessários
```

A F7.1-E está concluída.

Próxima etapa:

```text
F7.1-F — DEFINIR ENTREGA PÚBLICA DO CATÁLOGO E ESTRATÉGIA DE IMAGENS
```


=====================================================================

# ✅ F7.1-F — ENTREGA PÚBLICA E ESTRATÉGIA DE IMAGENS

## Entrada pública do catálogo

O fluxo público será separado do AuthGate.

Arquitetura definida:

```text
MaterialApp
    ↓
entrada da aplicação
    │
    ├── /{publicSlug}/catalogo/{publicToken}
    │       ↓
    │   fluxo público
    │   SEM AuthGate
    │   SEM login
    │
    └── demais acessos
            ↓
         AuthGate
            ↓
      aplicação autenticada
```

No MVP não será necessário substituir imediatamente o MaterialApp por GoRouter ou MaterialApp.router.

A entrada pública deverá ser reconhecida antes do AuthGate.

=====================================================================

## Firebase Hosting

O Firebase Hosting está configurado no `firebase.json` com:

```text
public = build/web
rewrite ** → /index.html
```

Isso permite abertura direta da rota canônica:

```text
/{publicSlug}/catalogo/{publicToken}
```

sem redirecionar o cliente para o fluxo de autenticação.

Fluxo validado:

```text
Flutter Web build
    ↓
Firebase Hosting Preview Channel
    ↓
validação funcional
    ↓
canal live
    ↓
https://app.storeconnect.com.br
```

O domínio institucional permanece separado em:

```text
https://www.storeconnect.com.br
```

=====================================================================

## Regras atuais das imagens

As imagens de produtos permanecem em:

```text
product_images/{storeId}/{fileName}
```

As Storage Rules atuais permitem leitura e escrita somente para membros ativos da própria loja.

Essa proteção NÃO será removida para atender ao catálogo público.

Regra:

```text
❌ NÃO usar allow read: if true
❌ NÃO tornar product_images público
```

=====================================================================

## imageUrl atual

O cadastro de produtos atualmente realiza:

```text
upload da imagem
    ↓
getDownloadURL()
    ↓
imageUrl persistido no produto
```

O caminho interno utilizado durante o upload atualmente NÃO é persistido.

O imageUrl original não deverá ser enviado diretamente ao cliente público do catálogo.

Motivo:

URLs retornadas por getDownloadURL podem possuir token próprio de download e não acompanham automaticamente a expiração ou revogação do catálogo.

=====================================================================

## Novo campo interno imagePath

Será introduzido o campo:

```text
imagePath
```

Exemplo:

```text
imagePath = product_images/{storeId}/{fileName}
```

O campo será interno e nunca deverá ser enviado ao navegador público.

Produtos novos ou que recebam nova imagem deverão manter:

```text
imageUrl
→ compatibilidade com o aplicativo atual

imagePath
→ referência interna utilizada pelo backend
```

=====================================================================

## Compatibilidade com produtos antigos

Produtos existentes podem possuir somente imageUrl.

Não será exigida migração em massa para iniciar o MVP.

O backend deverá possuir estratégia de compatibilidade para produtos legados, recuperando o caminho do objeto quando possível a partir do imageUrl existente.

Produtos que tiverem sua imagem atualizada passarão naturalmente a possuir imagePath.

=====================================================================

## Entrega pública da imagem

### Revisão de implementação na F7.5

O desenho inicial abaixo previa uma entrega de imagem por endpoint
controlado e `imagePath`.

Na F7.5 concluída, `getPublicCatalog` retorna o `imageUrl` sanitizado
necessário à interface pública. As regras privadas da collection de
produtos não foram abertas ao navegador.

A eventual migração para entrega de imagem por proxy controlado,
inclusive para acoplar a validade da imagem à expiração do catálogo,
permanece como possibilidade de endurecimento na F7.9.

Fluxo inicialmente definido:

```text
CLIENTE
   ↓
endpoint público controlado do catálogo
   ↓
valida publicToken
valida catálogo ativo
valida expiresAt
valida itemId
   ↓
resolve productId internamente
   ↓
obtém imagePath
   ↓
Firebase Storage via Admin SDK
   ↓
imagem enviada ao navegador
```

Estado atual da F7.5:

```text
❌ imagePath não é exposto
✅ productId faz parte do contrato sanitizado atual
✅ imageUrl é utilizado pela página pública
```

A página continua sem acesso direto ao documento operacional completo
do produto.

=====================================================================

## Revogação e expiração

Como as imagens serão entregues através do backend do catálogo:

```text
CATÁLOGO ATIVO
→ imagem disponível

CATÁLOGO EXPIRADO
→ backend bloqueia acesso

CATÁLOGO REVOGADO
→ backend bloqueia acesso
```

As Storage Rules privadas existentes permanecem intactas.

=====================================================================

# 📌 DECISÃO FINAL DA F7.1-F

```text
rota pública
→ tratada antes do AuthGate

Hosting
→ configurado para suportar a rota canônica /{publicSlug}/catalogo/{publicToken}

product_images
→ continua privado

imageUrl
→ mantido por compatibilidade

imagePath
→ novo campo interno

backend
→ autoridade para entregar imagens públicas
```

A F7.1-F está concluída.


=====================================================================

# 🟡 F7.2 — BACKEND SEGURO PARA CRIAÇÃO DO CATÁLOGO

## ✅ F7.2-A — Estrutura das Cloud Functions

O backend atual utiliza CommonJS com require() e módulos separados por domínio.

O Admin SDK é inicializado uma única vez no index.js.

A implementação do catálogo seguirá o mesmo padrão:

```text
functions/catalog/
└── createCatalog.js
```

O módulo será exportado pelo index.js sem concentrar a lógica nele.

=====================================================================

## ✅ F7.2-B — Autorização para criação de catálogo

Criar catálogo é considerado uma operação comercial, não uma ação crítica administrativa.

Papéis normalizados atualmente:

```text
admin
gerente
operador
```

Compatibilidade com papéis legados:

```text
caixa
→ operador

vendedor
→ operador
```

Podem criar catálogo:

```text
✅ admin
✅ gerente
✅ operador
```

O backend NÃO confiará em role, uid ou storeId informados pelo Flutter.

Fluxo de autorização:

```text
request.auth.uid
        ↓
users/{uid}
        ↓
valida documento
valida accessStatus
obtém storeId
normaliza role
        ↓
autoriza operação
```

Usuários com accessStatus == revoked são bloqueados.

=====================================================================

## ✅ F7.2-C — Contrato de entrada do createCatalog

O Flutter enviará somente:

```text
title
productIds[]
expiresInDays
```

O Flutter NÃO enviará como autoridade:

```text
storeId
uid
role
createdByUid
createdAt
expiresAt
status
publicToken
publicTokenHash
name
price
quantidade
imageUrl
categoryName
```

O backend obterá o storeId através de users/{uid}.storeId.

=====================================================================

## Expiração

O Flutter enviará uma duração relativa:

```text
expiresInDays
```

O backend calculará expiresAt utilizando o relógio do servidor.

Limites iniciais do MVP:

```text
mínimo = 1 dia
máximo = 30 dias
padrão sugerido na interface = 7 dias
```

=====================================================================

## Validação de productIds

O backend deverá:

```text
✅ exigir array não vazio
✅ aceitar somente strings válidas
✅ remover duplicados
✅ validar existência dos produtos
✅ garantir pertencimento à loja
✅ rejeitar produtos arquivados
✅ limitar o tamanho do catálogo
```

Limite inicial:

```text
máximo 200 produtos por catálogo
```

=====================================================================

## Validação do título

```text
trim obrigatório
mínimo = 1 caractere
máximo = 100 caracteres
```

=====================================================================

## Assinatura da loja

O catálogo seguirá a mesma política comercial já utilizada pelo backend de vendas.

Status permitidos:

```text
active
trial
overdue
```

Qualquer outro subscriptionStatus bloqueia a criação do catálogo.

=====================================================================

## Dados definidos exclusivamente pelo backend

```text
uid
storeId
role
status = active
createdAt
createdByUid
expiresAt
publicToken
publicTokenHash
publicTokenEncrypted
```

O publicToken deverá ser gerado criptograficamente.

O publicToken puro é retornado ao criador, porém não é persistido em texto puro.
O documento do catálogo persiste o publicTokenHash e o envelope
publicTokenEncrypted para recuperação privada do link pelo backend.

=====================================================================

# ⏳ PRÓXIMA SUBETAPA

```text
F7.2-D — IMPLEMENTAR createCatalog
```


=====================================================================

# 🟡 F7.2-D — PERSISTÊNCIA SEGURA DO CATÁLOGO

## Índice privado do token público

O link público utiliza:

```text
https://app.storeconnect.com.br/{publicSlug}/catalogo/{publicToken}
```

O cliente público conhece apenas o publicSlug amigável e o publicToken.
Ele NÃO conhecerá storeId ou catalogId.

Para permitir localização eficiente do catálogo, será criado um índice interno:

```text
catalogPublicTokens/{publicTokenHash}
```

Campos mínimos:

```text
storeId
catalogId
createdAt
```

Esse documento é exclusivamente interno e deverá ser utilizado pelo backend.

O token original nunca será persistido em texto puro.

Somente seu hash SHA-256 será utilizado como identificador do índice
`catalogPublicTokens`. A cópia criptografada necessária para recuperar
links existentes fica somente no documento privado do catálogo.

=====================================================================

## Fluxo de resolução pública

```text
publicToken
    ↓
SHA-256
    ↓
publicTokenHash
    ↓
catalogPublicTokens/{publicTokenHash}
    ↓
storeId + catalogId
    ↓
stores/{storeId}/catalogs/{catalogId}
    ↓
valida status
valida expiresAt
    ↓
entrega dados sanitizados
```

Não será necessário realizar busca global entre catálogos.

=====================================================================

## Persistência atômica

A criação do catálogo deverá ser executada em uma única operação atômica.

```text
WRITE BATCH
│
├── stores/{storeId}/catalogs/{catalogId}
│
├── stores/{storeId}/catalogs/{catalogId}/items/{catalogItemId}
├── ...
│
└── catalogPublicTokens/{publicTokenHash}
```

Regra:

```text
se qualquer escrita falhar
→ nenhuma parte do catálogo é criada
```

Com o limite inicial de 200 produtos por catálogo, a operação permanece dentro do tamanho planejado para o MVP.

=====================================================================

## Dados persistidos

Catalog:

```text
status = active
title
createdAt
createdByUid
expiresAt
publicTokenHash
productCount
publicTokenEncrypted
  ciphertext
  iv
  authTag
  version
```

O `publicTokenEncrypted` utiliza AES-256-GCM.
A chave é fornecida exclusivamente ao backend através do Secret Manager:

```text
CATALOG_TOKEN_ENCRYPTION_KEY
```

O secret representa exatamente 32 bytes e não é enviado ao Flutter.

CatalogItem:

```text
productId
position
addedAt
```

Índice público privado:

```text
storeId
catalogId
createdAt
```

O publicToken puro é retornado ao criador após a operação, mas nunca é gravado em texto puro no Firestore.


=====================================================================

# ✅ F7.2-D — createCatalog IMPLEMENTADO E VALIDADO

A criação segura do catálogo foi implementada em:

```text
functions/catalog/createCatalog.js
```

Export oficial:

```text
exports.createCatalog = createCatalog
```

=====================================================================

## Fluxo final implementado

```text
Flutter autenticado
      ↓
createCatalog
      ↓
valida request.auth.uid
      ↓
users/{uid}
      ↓
valida accessStatus
normaliza role
obtém storeId
      ↓
stores/{storeId}
      ↓
valida subscriptionStatus
      ↓
valida contrato de entrada
      ↓
valida products
      ↓
gera publicToken criptográfico
      ↓
gera SHA-256 publicTokenHash
      ↓
criptografa publicToken com AES-256-GCM
      ↓
gera publicTokenEncrypted
      ↓
WriteBatch atômico
      ↓
Catalog + CatalogItems + índice do token
```

=====================================================================

## Segurança confirmada

```text
✅ storeId obtido pelo backend
✅ uid obtido de request.auth
✅ role obtida do Firestore
✅ usuário revogado bloqueado
✅ role desconhecida falha fechada
✅ assinatura inválida bloqueada
✅ productId com barra bloqueado
✅ produtos inexistentes bloqueados
✅ produtos arquivados bloqueados
✅ productIds duplicados removidos
✅ publicToken gerado com crypto.randomBytes(32)
✅ publicTokenHash gerado com SHA-256
✅ publicToken puro nunca persistido em texto puro
✅ publicTokenEncrypted protegido com AES-256-GCM
✅ chave de criptografia fornecida por Secret Manager
✅ batch atômico
```

=====================================================================

## Estruturas persistidas

Catálogo:

```text
stores/{storeId}/catalogs/{catalogId}
```

Itens:

```text
stores/{storeId}/catalogs/{catalogId}/items/{catalogItemId}
```

Índice privado:

```text
catalogPublicTokens/{publicTokenHash}
```

=====================================================================

## Testes runtime

Runner:

```text
functions/tests/catalog/runCatalogTests.js
```

Comando oficial:

```text
npm run test:catalog
```

Resultado validado no Firestore Emulator:

```text
✅ createCatalog.emulator.test.js
   → happy path

✅ createCatalogAuthorization.emulator.test.js
   → autenticação e fail closed

✅ createCatalogValidation.emulator.test.js
   → contrato, produtos, atomicidade e deduplicação

✅ REGRESSÃO F7 COMPLETA — 4/4 PASSARAM
```

✅ Primeiro createCatalog real validado em produção pelo aplicativo Android, incluindo criação do catálogo, items e índice catalogPublicTokens.

=====================================================================

# ✅ F7.2 — BACKEND SEGURO PARA CRIAÇÃO DO CATÁLOGO CONCLUÍDO

# ✅ F7.3 — SELEÇÃO DE PRODUTOS DENTRO DA LOJA

Implementado até este ponto:

```text
✅ modo de seleção de catálogo
✅ seleção individual desktop/web
✅ seleção individual mobile
✅ seleção em massa por categoria
✅ contador de produtos selecionados
✅ configuração de título e validade
✅ integração Flutter → createCatalog
✅ cabeçalho mobile responsivo
✅ proteção de estoque na UI
✅ proteção de estoque no backend
✅ regressão automática 4/4
✅ validação runtime Android
✅ createCatalog publicado em produção
```

=====================================================================

# 📦 REGRA DE DISPONIBILIDADE DO CATÁLOGO

Regra canônica para entrada de produtos:

```text
quantidade > 0
→ produto elegível para o catálogo

quantidade <= 0
→ produto não elegível

quantidade ausente ou inválida
→ produto não elegível
```

`minimumStock` não define disponibilidade para catálogo.

## Proteção em duas camadas

```text
FLUTTER
✅ produto zerado permanece visível
✅ exibe "Indisponível para catálogo"
✅ seleção individual bloqueada
✅ seleção por categoria ignora estoque zero

BACKEND createCatalog
✅ consulta novamente o produto no Firestore
✅ exige quantidade válida > 0
✅ estoque zero gera failed-precondition
✅ tentativa de burlar a UI continua bloqueada
```

## Proteções

```text
F7.5 — Página pública
✅ consultar disponibilidade atual a cada nova requisição
✅ estoque zerado → produto omitido na próxima consulta
✅ reposição de estoque → produto reaparece na próxima consulta
✅ productCount acompanha os produtos efetivamente retornados

F7.7 — Envio final
⏳ backend revalidar disponibilidade antes de aceitar a seleção
```

=====================================================================

# 🟡 F7.4 — GERAÇÃO E GESTÃO DO LINK PÚBLICO TEMPORÁRIO

## URL canônica definida

```text
https://app.storeconnect.com.br/{publicSlug}/catalogo/{publicToken}
```

O catalogId não é exposto na URL pública.

O publicToken continua sendo a credencial pública real do catálogo.
O publicSlug identifica a loja de forma amigável, mas não substitui
a validação segura do token.

=====================================================================

## ✅ F7.4-B1 / B2 — publicSlug e URL canônica

Identidade pública da loja:

```text
stores/{storeId}.publicSlug

storePublicSlugs/{publicSlug}
  storeId
  publicSlug
  createdAt
```

Novas lojas recebem publicSlug atomicamente através do bootstrapStore.

Lojas existentes sem publicSlug são migradas automaticamente
na primeira criação de catálogo através do createCatalog.

Retorno atual do createCatalog:

```text
success
catalogId
publicSlug
publicToken
expiresAt
productCount
```

Validações concluídas:

```text
✅ bootstrapStore validado no Firestore Emulator
✅ publicSlug salvo em stores/{storeId}
✅ reserva storePublicSlugs/{publicSlug} validada
✅ loja existente sem publicSlug migrada automaticamente
✅ createCatalog continua criando catálogo normalmente
✅ regressão automática do catálogo 4/4
✅ bootstrapStore publicado em produção
```

=====================================================================

## ✅ F7.4-B3 / B4 / B5 / B6 — geração e compartilhamento inicial no Flutter

Após createCatalog retornar com sucesso, o Flutter monta:

```text
publicUrl =
https://app.storeconnect.com.br/{publicSlug}/catalogo/{publicToken}
```

O diálogo de sucesso foi separado em:

```text
lib/screens/management/widgets/catalog_created_dialog.dart
```

A interface já permite no fluxo imediatamente após a criação:

```text
✅ visualizar a URL
✅ copiar link
✅ compartilhar link
✅ fechar o diálogo
```

A integração utiliza Clipboard e share_plus.

Validação realizada:

```text
✅ criação real no Android
✅ URL montada
✅ copiar link
✅ compartilhar link
```

A página pública foi implementada e validada posteriormente na F7.5.
Os links agora abrem diretamente no Flutter Web pelo domínio
`app.storeconnect.com.br`, sem exigir login.

=====================================================================

## ✅ F7.4-B7 — persistência segura para recuperar links existentes

### Problema resolvido

O publicToken puro não pode ser salvo em texto puro.

Porém, guardar somente publicTokenHash impediria que a loja
recuperasse posteriormente o mesmo link para copiar ou compartilhar.

A solução adotada mantém duas representações privadas com funções diferentes:

```text
publicToken
  ↓
  ├── SHA-256
  │     ↓
  │   publicTokenHash
  │     ↓
  │   localização/validação pública
  │
  └── AES-256-GCM
        ↓
      publicTokenEncrypted
        ↓
      recuperação privada do link pelo backend
```

O documento privado do catálogo armazena:

```text
publicTokenHash

publicTokenEncrypted
  ciphertext
  iv
  authTag
  version
```

O token puro:

```text
❌ não é persistido em texto puro
❌ não é salvo em catalogPublicTokens
❌ não é enviado pelo backend de listagem como campo separado
```

### Secret Manager

A chave de criptografia utilizada pelo backend é:

```text
CATALOG_TOKEN_ENCRYPTION_KEY
```

Contrato da chave:

```text
Base64
→ representa exatamente 32 bytes
→ utilizada por AES-256-GCM
```

A chave nunca é enviada ao Flutter e seu valor não deve ser
registrado em documentação, logs ou respostas da aplicação.

Constantes atuais:

```text
ENCRYPTION_ALGORITHM = aes-256-gcm
ENCRYPTION_VERSION = 1
```

### Helpers implementados

Em:

```text
functions/catalog/createCatalog.js
```

foram implementados:

```text
getCatalogTokenEncryptionKey()
encryptCatalogPublicToken()
decryptCatalogPublicToken()
```

A descriptografia valida:

```text
✅ version
✅ IV com 12 bytes
✅ authTag com 16 bytes
✅ ciphertext não vazio
✅ autenticação GCM através de setAuthTag()
```

### Validação runtime da criptografia

Foi executado teste temporário de round-trip:

```text
publicToken
  ↓ encrypt
publicTokenEncrypted
  ↓ decrypt
publicToken recuperado
  ↓
comparação exata com o token original
```

Resultado:

```text
✅ encrypt → decrypt validado no Functions Emulator
✅ teste temporário removido após validação
✅ helper decrypt mantido para recuperação real
```

=====================================================================

## ✅ F7.4-B8 — listCatalogs e tela base do Catálogo Inteligente

### Callable segura listCatalogs

Foi implementada no mesmo módulo:

```text
functions/catalog/createCatalog.js
```

Exportada pelo:

```text
functions/index.js
```

Fluxo de autorização:

```text
Flutter autenticado
      ↓
listCatalogs
      ↓
request.auth.uid
      ↓
users/{uid}
      ↓
valida accessStatus
normaliza role
obtém storeId
      ↓
stores/{storeId}/catalogs
      ↓
orderBy createdAt desc
limit 50
```

Regra de segurança:

```text
❌ Flutter não envia storeId como autoridade
✅ storeId é resolvido pelo backend através do uid autenticado
```

Para cada catálogo com token recuperável:

```text
publicTokenEncrypted
      ↓
decryptCatalogPublicToken()
      ↓
publicToken em memória no backend
      ↓
https://app.storeconnect.com.br/{publicSlug}/catalogo/{publicToken}
      ↓
publicUrl
```

Campos seguros retornados à interface:

```text
catalogId
title
status
createdAt
expiresAt
productCount
publicSlug
publicUrl
linkAvailable
```

Não são retornados:

```text
❌ publicTokenEncrypted
❌ publicTokenHash
❌ chave de criptografia
```

### Compatibilidade com catálogos legados

Caso um catálogo antigo não possua publicTokenEncrypted
ou o link não possa ser recuperado:

```text
publicUrl = null
linkAvailable = false
```

A falha de um link individual não deve derrubar a listagem inteira.

### Validação runtime de listCatalogs

O Functions Emulator reconheceu:

```text
createCatalog
listCatalogs
```

A chamada autenticada retornou dois catálogos de teste,
ambos com:

```text
linkAvailable = true
publicUrl presente
```

Foi executada uma validação adicional de integridade sem imprimir
o token ou a URL completa:

```text
publicUrl
  ↓
token recuperado somente em memória
  ↓
SHA-256
  ↓
comparado com publicTokenHash salvo
```

Resultado:

```text
✅ URL canônica válida
✅ token recuperado presente
✅ SHA-256 recuperado = publicTokenHash persistido
✅ integridade confirmada para os dois catálogos testados
```

### Tela Flutter

Criada em:

```text
lib/screens/management/catalogs_screen.dart
```

A tela consome apenas:

```text
listCatalogs
```

e não envia storeId.

Estados implementados:

```text
✅ loading
✅ erro com tentar novamente
✅ lista vazia
✅ lista de cards
✅ pull-to-refresh
✅ linkAvailable tratado
```

Informações exibidas no card:

```text
título
status
quantidade de produtos
data de criação
data de expiração
```

Padrão visual adotado como referência:

```text
Card
elevation = 3
borderRadius = 18
padding = 20
badge arredondado de status
```

O arquivo passou em:

```text
dart format
flutter analyze
→ No issues found
```

=====================================================================

## ✅ F7.4-B9 — acesso pelo menu

O item:

```text
Catálogo Inteligente
```

foi inserido em:

```text
lib/screens/sales/new_sale_screen.dart
```

Posição:

```text
Gerenciar Clientes
Catálogo Inteligente
----------------
Configurações
```

Navegação:

```text
Catálogo Inteligente
  ↓
CatalogsScreen
```

A validação estrutural confirmou:

```text
✅ import de CatalogsScreen
✅ item Catálogo Inteligente logo abaixo de Gerenciar Clientes
✅ drawer fechado antes da navegação
✅ navegação para CatalogsScreen
```

Os avisos já existentes encontrados pelo flutter analyze em
new_sale_screen.dart não foram alterados nesta etapa para evitar
refatoração fora do escopo.

=====================================================================

## ✅ Deploy do backend da recuperação

Publicação realizada em produção:

```text
firebase deploy --only functions:createCatalog,functions:listCatalogs
```

Resultado:

```text
✅ Deploy complete
```

As duas functions utilizam o secret:

```text
CATALOG_TOKEN_ENCRYPTION_KEY
```

=====================================================================

## 📌 Decisão de produto — catálogo independente de cliente

O catálogo não fica obrigatoriamente vinculado a um cliente específico.

Ele pode representar:

```text
campanha
promoção
seleção temática
catálogo geral
compartilhamento para um ou vários clientes
```

Por isso a gestão de catálogos será uma área própria da loja,
em vez de ficar dentro do cadastro de clientes.

Exemplo visual planejado para cada card:

```text
Promoção de Setembro                 ATIVO
18 produtos
Criado: 10/09/2026
Expira: 17/09/2026

[Copiar link] [Compartilhar] [⋮]
```

=====================================================================

## ✅ F7.4-B10 — copiar e compartilhar catálogo existente

A tela **Catálogo Inteligente** passou a exibir ações diretamente nos cards quando o backend informa que o link pode ser recuperado com segurança.

Regra de interface:

```text
linkAvailable = true
+ publicUrl válida
  ↓
[Copiar link] [Compartilhar]

linkAvailable = false
  ↓
sem botões
+ aviso de link indisponível
```

Implementação Flutter:

```text
Clipboard.setData(...)
SharePlus.instance.share(...)
```

O `publicUrl` é recebido da callable `listCatalogs`; o Flutter não recebe `publicTokenHash`, `publicTokenEncrypted` nem a chave de criptografia.

Validação runtime Android concluída em 10/09/2026:

```text
✅ catálogo novo aparece no topo da lista
✅ título, status, productCount, createdAt e expiresAt corretos
✅ catálogo novo com link recuperável não exibe aviso de indisponibilidade
✅ botão Copiar link exibido somente quando linkAvailable = true
✅ botão Compartilhar exibido somente quando linkAvailable = true
✅ Copiar link funcionando no Android
✅ Compartilhar funcionando no Android
✅ catálogos legados continuam sem botões e com aviso de link indisponível
```

Com isso, a **F7.4 — Geração e gestão do link público temporário está concluída**.

A página pública responsiva foi concluída na **F7.5** em 11/09/2026.

=====================================================================

# ✅ F7.5 — PÁGINA PÚBLICA RESPONSIVA CONCLUÍDA

A F7.5 foi concluída e validada de ponta a ponta em produção em
11/09/2026.

## Backend público — getPublicCatalog

Foi implementada a callable pública:

```text
getPublicCatalog
```

Arquivos principais:

```text
functions/catalog/createCatalog.js
functions/index.js
```

Responsabilidades validadas:

```text
✅ acesso sem autenticação
✅ recebe publicSlug + publicToken
✅ calcula SHA-256 do token
✅ resolve catalogPublicTokens/{publicTokenHash}
✅ valida storeId/catalogId apenas internamente
✅ valida loja e assinatura
✅ valida status do catálogo
✅ valida expiresAt
✅ consulta os CatalogItems ordenados
✅ resolve os documentos atuais dos produtos
✅ omite produto inexistente
✅ omite produto arquivado
✅ omite produto com quantidade <= 0
✅ retorna somente contrato sanitizado
```

Não são retornados ao navegador:

```text
❌ publicToken
❌ publicTokenHash
❌ publicTokenEncrypted
❌ storeId
❌ catalogId
❌ chave de criptografia
❌ documento operacional completo do produto
```

## Contrato público atual

```text
store
  name
  logoUrl
  phone

catalog
  title
  expiresAt
  productCount

products[]
  productId
  name
  price
  imageUrl
  quantidade
  categoryName
  position
```

`productCount` representa a quantidade de produtos efetivamente
disponíveis retornados pela consulta pública.

## Flutter Web — rota pública

Tela criada em:

```text
lib/screens/public/public_catalog_screen.dart
```

A entrada Web reconhece:

```text
/{publicSlug}/catalogo/{publicToken}
```

antes do fluxo autenticado.

Arquitetura validada:

```text
URL pública
    ↓
main.dart identifica a rota
    ↓
PublicCatalogScreen
    ↓
SEM AuthGate
SEM login
    ↓
getPublicCatalog
```

Os demais acessos continuam seguindo o fluxo autenticado normal.

## Estados da página pública

Implementado:

```text
✅ loading
✅ sucesso
✅ erro
✅ tentar novamente
```

A interface pública exibe:

```text
✅ logo da loja com fallback
✅ nome da loja
✅ telefone
✅ título do catálogo
✅ validade
✅ quantidade de produtos disponíveis
✅ imagem do produto com fallback
✅ categoria
✅ nome
✅ preço
✅ quantidade disponível
✅ layout responsivo desktop/mobile
```

Os cards foram centralizados e ajustados para apresentação compacta
em telas maiores, preservando adaptação para celular.

## Expiração visual

A validade é apresentada ao cliente em formato local:

```text
Disponível até DD/MM/AAAA
```

A autoridade sobre a expiração continua no backend.

## Firebase Hosting e domínio definitivo

O `firebase.json` passou a possuir Hosting para o Flutter Web:

```text
public = build/web
rewrite ** → /index.html
```

A implementação foi validada primeiro em Preview Channel e depois
publicada no canal `live`.

Aplicação / catálogo público:

```text
https://app.storeconnect.com.br
```

Site institucional preservado:

```text
https://www.storeconnect.com.br
```

URL canônica definitiva:

```text
https://app.storeconnect.com.br/{publicSlug}/catalogo/{publicToken}
```

`listCatalogs` foi publicado isoladamente após a validação do Hosting
live para devolver o domínio definitivo ao copiar ou compartilhar
catálogos existentes.

## Validações concluídas

```text
✅ getPublicCatalog validado no Firestore Emulator
✅ regressão completa do catálogo — 5/5 testes passaram
✅ rota pública validada localmente no Flutter Web
✅ acesso público sem login validado
✅ Preview Channel validado
✅ Hosting live validado
✅ app.storeconnect.com.br respondeu em produção
✅ desktop validado
✅ mobile validado
✅ link copiado pelo próprio Store&Connect validado
✅ link enviado e aberto com sucesso em outro celular
```

## Estoque dinâmico — comportamento validado

O catálogo não congela a quantidade do produto na criação.

Em produção foi validado:

```text
quantidade alterada para um valor maior
        ↓
recarrega / nova consulta
        ↓
nova quantidade aparece

quantidade alterada para 0
        ↓
recarrega / nova consulta
        ↓
produto é omitido
        ↓
productCount diminui

quantidade volta a ser > 0
        ↓
recarrega / nova consulta
        ↓
produto reaparece
        ↓
productCount aumenta novamente
```

Portanto:

```text
✅ products continua sendo a fonte operacional de verdade
✅ getPublicCatalog lê o estado atual em cada requisição
✅ catálogo reflete estoque atual na próxima consulta
```

## Estado atual — página aberta, refresh e autoridade dos dados

A F7.5 base publicada em produção continua sendo orientada a requisições:
uma página já aberta mantém o snapshot recebido na última chamada a
`getPublicCatalog` até ocorrer uma nova consulta.

Fluxo base em produção:

```text
cliente abre o catálogo
        ↓
getPublicCatalog
        ↓
dados ficam em memória na página

estoque/preço muda na loja
        ↓
página já aberta pode continuar com o snapshot anterior

recarregar página
        ↓
nova chamada getPublicCatalog
        ↓
dados atualizados
```

Portanto, a F7.5 NÃO é descrita como atualização em tempo real.

## ⏳ F7.5-P — PERFORMANCE + ATUALIZAÇÃO INTELIGENTE

A F7.5-P foi criada para melhorar a experiência da página pública antes da
F7.6, sem abrir acesso direto ao Firestore e sem transformar o catálogo em
uma tela de sincronização contínua.

### ✅ P1 — diagnóstico de performance

O diagnóstico confirmou que a página pública original utilizava
`SingleChildScrollView` + `Wrap`, construindo todos os cards de uma vez.
Também foi confirmado que não existia atualização contínua de estado durante
o scroll.

### ✅ P2 — redução de repaints e diagnóstico de imagens/dispositivo

Foi adicionado `RepaintBoundary` aos cards públicos para reduzir repaints
durante a rolagem.

Checkpoint:

```text
5b72654 perf(f7): reduzir repaints dos cards do catalogo publico
```

As imagens reais utilizadas no diagnóstico eram pequenas e não se mostraram
o gargalo principal. O teste em iPhone também identificou que o modo de
baixo consumo de energia pode degradar fortemente a fluidez da rolagem;
ao desativá-lo, a melhora foi significativa. Isso foi tratado como
comportamento do dispositivo, não como falha estrutural do catálogo.

### ✅ P3 — isolamento da rota pública

A rota pública foi progressivamente separada dos providers/listeners da área
privada.

Checkpoints:

```text
b02a95b perf(f7): isolar rota publica dos providers privados
e472cf7 perf(f7): remover theme provider da rota publica
```

Estado final da rota pública:

```text
rota pública
  ↓
MaterialApp próprio
  ↓
AppTheme.lightTheme
  ↓
PublicCatalogScreen

SEM MultiProvider privado
SEM ThemeProvider
SEM AuthGate
```

A aplicação autenticada continua com seus providers normalmente.

### ✅ P4 — Slivers, lazy rendering e layout mobile

A estrutura da página pública foi migrada para `CustomScrollView` com Slivers.

Checkpoints:

```text
c2fa135 perf(f7): preparar catalogo publico para slivers
96ecdd8 perf(f7): implementar lazy rendering no catalogo publico
4e0a862 feat(f7): otimizar layout mobile do catalogo publico
```

Principais decisões implementadas:

```text
✅ CustomScrollView
✅ SliverList lazy por linhas
✅ RepaintBoundary preservado por card
✅ desktop/tablet preservados
✅ mobile < 600 px com card horizontal compacto
✅ imagem mobile 110 x 110 com BoxFit.contain
✅ cabeçalho mobile horizontal
✅ logo mobile 110 x 110
✅ área estrutural preparada para futuras ações da F7.6
```

#### Validação de escala — P4B3

O limite oficial do catálogo permanece em 200 produtos.

Foi criado um build temporário de Preview que replicou produtos somente em
memória até atingir 200 cards. Firestore, Functions e dados reais não foram
alterados.

Resultado validado:

```text
✅ contador com 200 produtos
✅ rolagem mobile até o final
✅ retorno rápido ao topo
✅ rolagem desktop
✅ imagens durante a rolagem
✅ layout mobile
✅ layout desktop
```

Após o teste, o código-fonte foi restaurado e o Preview retornou aos produtos
reais. Nenhum commit permanente foi necessário para o teste sintético.

Com isso, a P4 foi encerrada no checkpoint:

```text
4e0a862 feat(f7): otimizar layout mobile do catalogo publico
```

### ✅ P5 — atualização inteligente do catálogo

O diagnóstico inicial confirmou que `_loadCatalog()` era a única rota de
consulta pública e sempre exibia o loading completo. Não existiam
`WidgetsBindingObserver`, `Timer`, `RefreshIndicator` ou acesso direto ao
Firestore.

#### ✅ P5-B1 — infraestrutura de refresh silencioso

Foi preparada localmente a evolução de `_loadCatalog()` para suportar:

```text
_loadCatalog(showLoading: true)
→ carregamento inicial / tentativa explícita

_loadCatalog(showLoading: false)
→ atualização silenciosa
```

Também foi adicionada proteção contra requisições simultâneas.

Regra de falha definida:

```text
falha transitória durante refresh silencioso
→ mantém o catálogo já carregado

backend informa catálogo inválido / expirado / indisponível
→ não manter conteúdo antigo como se ainda estivesse válido
```

#### ✅ P5-B2 — lifecycle preservado onde funciona

Foi adicionado `WidgetsBindingObserver` para tentar atualizar silenciosamente
quando a página/app retorna ao estado ativo.

Validação prática:

```text
iPhone / iOS
→ saiu da página/app
→ voltou
→ nova quantidade apareceu sem refresh manual ✅

inclusive com a tela apagando/entrando em descanso e voltando
→ catálogo retornou atualizado ✅
```

#### ❌ P5-B3 — tentativa específica para Web descartada

Foi testada uma ampliação do lifecycle utilizando `kIsWeb` e o estado
`inactive` para tentar cobrir Chrome Android e navegador desktop.

Resultado:

```text
iOS
→ continuou funcionando

Android / navegador Web
→ não atualizaram de forma confiável ao alternar telas
→ só refletiram a nova quantidade após refresh da página
```

A B3 foi removida do código-fonte. A P5 voltou para a base B1+B2.

Decisão: NÃO introduzir agora Page Visibility API, polling periódico, Timer
ou dependência Web específica apenas para forçar comportamento idêntico entre
navegadores.
#### ✅ P5-D2 — refresh manual universal

Foi adicionado ao bloco de disponibilidade da página pública um controle
explícito de atualização que reutiliza:

```text
_loadCatalog(showLoading: false)
```

Comportamento validado:

```text
desktop / tablet
→ botão "Atualizar"

mobile
→ botão compacto com ícone de refresh

durante a requisição
→ pequeno indicador de progresso no próprio controle
→ sem loading de tela inteira
```

Validação prática concluída no Preview:

```text
✅ Android — botão Atualizar refletiu o estoque novo sem recarregar a página
✅ desktop — botão Atualizar refletiu o estoque novo sem F5
✅ iPhone — botão Atualizar refletiu o estoque novo
✅ iPhone — atualização automática ao retornar continuou funcionando
✅ nenhum loading de tela inteira durante o refresh silencioso
✅ layout do controle aprovado em mobile e desktop
```

#### 📌 Estratégia oficial da P5

A atualização será orientada à ação real do cliente:

```text
ABERTURA DO CATÁLOGO
        ↓
getPublicCatalog
        ↓
snapshot atual

RETORNO AO APP/ABA
        ↓
quando o lifecycle da plataforma suportar
        ↓
refresh silencioso automático
        ↓
validado no iOS

ANDROID / DESKTOP WEB
        ↓
refresh normal da página continua válido

CLIENTE TOCA EM "SELECIONAR PRODUTOS"
        ↓
_loadCatalog(showLoading: false)
        ↓
preço + estoque + elegibilidade atualizados
        ↓
inicia seleção com snapshot recente

OPÇÃO DE INTERFACE
        ↓
botão discreto "Atualizar"
        ↓
mesmo refresh silencioso

ENVIO FINAL
        ↓
backend consulta novamente produto/estoque/preço
        ↓
autoridade final
```

Regras consolidadas:

```text
✅ continuar utilizando getPublicCatalog
✅ manter Firestore privado
✅ manter refresh normal da página em qualquer plataforma
✅ preservar refresh automático no iOS onde já funciona
✅ atualizar antes de iniciar a seleção de produtos
✅ permitir refresh manual discreto na própria interface
✅ impedir requisições simultâneas
✅ revalidar novamente no backend no envio final

❌ sem polling contínuo
❌ sem Timer periódico
❌ sem acesso direto do navegador ao Firestore
❌ sem depender exclusivamente de lifecycle para Android/Web
```

Com a validação do refresh manual universal e a preservação do lifecycle
funcional no iOS, a P5 está concluída no Preview.

A futura ação "Selecionar produtos" reutilizará a mesma infraestrutura de
refresh silencioso durante a F7.6, antes de iniciar a seleção de quantidades.

Essa integração pertence à F7.6 e não reabre a P5.

A produção LIVE permanece temporariamente na versão base da F7.5 até a
publicação isolada deste checkpoint após commit e push.

### ⏳ P6 — validação final em dispositivos reais

Depois da integração do refresh orientado à ação do cliente, validar novamente:

```text
✅/⏳ iPhone / Safari
⏳ Android / Chrome
⏳ desktop / navegador
⏳ refresh manual da interface
⏳ entrada em "Selecionar produtos"
⏳ ausência de loading completo durante refresh silencioso
```

A estratégia continua mantendo o Firestore privado:

```text
página pública
      ↓
getPublicCatalog
      ↓
backend seguro
      ↓
Firestore
```

## Regra obrigatória para F7.6 / F7.7

A quantidade mostrada no catálogo é informação da interface e pode
ficar desatualizada entre duas consultas.

Por isso, no envio final:

```text
cliente envia seleção
        ↓
backend recebe a solicitação
        ↓
backend consulta o estoque atual novamente
        ↓
quantidade solicitada ainda disponível?
        │
        ├── SIM → fluxo pode prosseguir
        │
        └── NÃO → retornar disponibilidade atual / impedir inconsistência
```

Regra arquitetural:

```text
interface = informação de disponibilidade

backend no envio = autoridade final sobre disponibilidade
```

Essa revalidação é obrigatória e não será substituída por refresh automático,
refresh manual ou pela atualização feita antes de iniciar a seleção.

=====================================================================

# 📌 DECISÃO DE ESCALA PARA F7.9

A criação de muitos links de catálogo não mantém os catálogos
carregados permanentemente em memória.

Cada catálogo será localizado diretamente através do hash
do publicToken, sem varredura global dos catálogos.

Estrutura aproximada por catálogo:

```text
1 documento Catalog
N documentos CatalogItems
1 documento catalogPublicTokens
```

O limite atual do MVP permanece em até 200 produtos por catálogo.

Ciclo de vida previsto:

```text
ACTIVE
  ↓ expiresAt
EXPIRADO / ACESSO BLOQUEADO
  ↓ período de retenção
LIMPEZA AUTOMÁTICA
```

A limpeza futura deverá remover explicitamente:

```text
catalogPublicTokens/{publicTokenHash}
stores/{storeId}/catalogs/{catalogId}/items/*
stores/{storeId}/catalogs/{catalogId}
```

Importante: excluir o documento pai do catálogo no Firestore
não remove automaticamente a subcollection items.

O período de retenção será definido durante a implementação
da F7.9, sem antecipar agora se serão 30, 90 ou outro número de dias.

=====================================================================

# 📌 F7.9 — ACHADO DE RUNTIME PARA O BACKLOG

Em 12/09/2026 foi validado um caso importante de expiração:

```text
link público de catálogo expirado
→ backend bloqueou corretamente o acesso ✅
→ mensagem pública de catálogo expirado/indisponível ✅

mesmo catálogo na tela interna "Catálogo Inteligente"
→ card ainda exibiu badge ATIVO ❌
```

Conclusão:

```text
segurança/backend de expiração
→ correta

estado visual da tela administrativa
→ precisa considerar expiresAt, não apenas o status persistido
```

Regra prevista para a F7.9:

```text
status salvo active + expiresAt ainda futuro
→ ATIVO

status salvo active + expiresAt atingido
→ EXPIRADO

status revogado/inativo
→ INATIVO / REVOGADO conforme contrato final
```

Também deverá ser decidido de forma única o significado temporal de
`expiresAt` (instante exato vs. fim do dia) e aplicar a mesma semântica no
backend e na interface.

Ações de copiar/compartilhar link de catálogo efetivamente expirado também
deverão ser revisadas na F7.9 para evitar apresentar uma ação que leve a um
link já bloqueado.

=====================================================================

# 💡 BACKLOG FUTURO — VITRINE COMPLEMENTAR / CROSS-SELL

Ideia registrada para evolução posterior ao núcleo do MVP:

```text
CATÁLOGO PÚBLICO
  ├── produtos selecionados / solicitados para o cliente
  └── "Aproveite também" / promoções / sugestões da loja
```

Objetivo:

```text
upsell / cross-sell
→ permitir que a loja acrescente sugestões sem misturar a intenção original
  da seleção principal
```

Possível evolução do modelo:

```text
CatalogItem.purpose
  requested
  promotion
```

A ideia deve manter as mesmas regras já definidas para preço e estoque:
consulta atual pelo backend, sem snapshot operacional e com revalidação final.
Não faz parte do núcleo da F7.6 neste momento e permanece em backlog para não
desviar o MVP.
