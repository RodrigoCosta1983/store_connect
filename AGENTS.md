# Store&Connect — Regras para agentes

Este repositório usa desenvolvimento incremental e defensivo.

Antes de trabalhar, leia:

1. este `AGENTS.md`;
2. `docs/codex/CURRENT_WORK.md`;
3. a documentação específica da funcionalidade em `docs/`;
4. o código atual antes de propor alteração.

## Regra principal

Não faça refatorações amplas nem alterações fora do escopo da etapa atual.

O fluxo padrão é:

auditar -> alterar minimamente -> validar -> testar -> revisar diff ->
checkpoint Git -> continuar.

Se o contrato atual já definir claramente a próxima ação, prossiga sem
interromper Rodrigo.

Pare e peça decisão somente quando houver ambiguidade real, mudança
arquitetural, risco, produção ou alteração fora do combinado.

## Git

Branch atual de desenvolvimento F7:

`feat/f7-intelligent-catalog`

Sempre antes de alterar:

- conferir `git branch --show-current`;
- conferir `git status --short`;
- conferir o HEAD;
- abortar se existirem alterações inesperadas.

Nunca descarte trabalho existente do usuário.

Use:

`git --no-pager diff`

em vez de comandos que abram pager.

Depois de uma alteração:

- executar validações adequadas;
- executar `git diff --check`;
- conferir `git status`;
- fazer commit somente se tudo estiver correto.

Commit e push para a branch atual são permitidos quando:

- a etapa está dentro do contrato já aprovado;
- todos os testes relevantes passam;
- o diff contém apenas o escopo esperado.

Não faça amend de commits anteriores sem solicitação explícita.

## Deploy e produção

NUNCA execute automaticamente:

- `firebase deploy`;
- deploy de Cloud Functions;
- deploy de Hosting;
- publicação Play Store;
- alterações manuais em produção;
- exclusão ou migração de dados reais;
- operações destrutivas em Firestore;
- alterações de cobrança/Asaas em produção.

Essas ações exigem autorização explícita de Rodrigo imediatamente antes
da execução.

Não transforme uma autorização antiga em autorização permanente.

## Firebase / Firestore

Prefira Firestore Emulator para testes.

Nunca use produção como ambiente de teste.

Não exponha:

- tokens públicos completos;
- secrets;
- chaves;
- credenciais;
- dados sensíveis.

Quando um teste necessitar
`CATALOG_TOKEN_ENCRYPTION_KEY`, use uma chave aleatória temporária de
32 bytes no processo, nunca a imprima e restaure o ambiente ao final.

## Catálogo inteligente F7

Documento principal:

`docs/catalog/F7_CATALOGO_INTELIGENTE.md`

O navegador público nunca é autoridade sobre:

- `storeId`;
- `catalogId`;
- preço;
- estoque;
- subtotal;
- total;
- estado do produto.

O servidor deve revalidar o estado atual.

`productId` pode ser enviado pelo cliente público, mas deve ser validado
no servidor.

Uma seleção pública NÃO significa automaticamente:

- venda;
- reserva de estoque;
- decremento de estoque.

Não reutilize a coleção/fluxo `sales` para solicitações públicas sem um
contrato explícito que determine isso.

## Testes do catálogo

Suíte oficial:

executar a partir de `functions`:

`npm run test:catalog`

O runner descobre automaticamente arquivos:

`functions/tests/catalog/*.test.js`

Para o Firestore Emulator atual, usar JDK 21.

JDK confirmado nesta máquina:

`C:\Program Files\Eclipse Adoptium\jdk-21.0.6.7-hotspot`

Se o terminal estiver usando Java antigo, ajuste apenas o ambiente da
sessão quando possível.

Não altere permanentemente o Java do Windows sem necessidade.

## Windows PowerShell

O ambiente usado pelo projeto pode ser Windows PowerShell 5.1.

Evite sintaxe exclusiva do PowerShell 7, incluindo:

- operador `??`;
- operador ternário `? :`.

Evite iniciar uma nova linha com chamada de membro:

Errado:

`$value`
`.Replace(...)`

Correto:

`$value = $value.Replace(...)`

Para cálculos de datas, prefira:

`$span = $today.Date.Subtract($dueDate.Date)`

em vez de quebrar acesso a `.TotalDays` de forma incompatível.

Para JavaScript complexo em testes, não use `node -e` quando houver
risco de aspas serem reinterpretadas pelo PowerShell 5.1.

Prefira criar um `.js` temporário UTF-8 sem BOM e executá-lo com Node.

## Alterações de arquivos

Para patches pequenos:

- faça a menor alteração possível;
- preserve estilo e formatação existentes;
- não rode formatadores no arquivo inteiro se isso produzir mudanças
  não relacionadas.

Não use `dart format` em arquivo inteiro para um patch mínimo quando
isso alterar código fora do escopo.

Quando escrever arquivo por PowerShell, prefira UTF-8 sem BOM.

## Flutter

Após alteração Dart relevante, execute os checks adequados ao escopo.

Não modifique múltiplas telas/provedores apenas para "limpar" código
durante uma etapa funcional específica.

## Falhas

Se um teste falhar:

1. diagnostique a causa;
2. determine se é código, teste ou ambiente;
3. preserve as alterações válidas;
4. corrija somente o necessário;
5. execute novamente os testes relevantes.

Não esconda testes falhando.

Não modifique testes apenas para fazê-los passar quando o comportamento
real estiver incorreto.

## Autonomia

Pode executar autonomamente, dentro do escopo já aprovado:

- leitura e auditoria de código;
- edição local;
- criação/ajuste de testes;
- execução de Node, Flutter, Dart e Emulators;
- diagnóstico de falhas;
- correções diretamente decorrentes da etapa;
- `git diff`;
- commits;
- push da branch de desenvolvimento.

Pare para Rodrigo antes de:

- deploy;
- produção;
- exclusão/migração;
- alteração de secrets reais;
- nova decisão arquitetural não definida;
- mudança de regra de negócio;
- alteração fora da etapa atual;
- ação destrutiva;
- conflito entre documentação e implementação.

## Comunicação

Responda em português.

Se concluir uma etapa, informe de forma objetiva:

- o que foi alterado;
- quais testes passaram;
- qual commit foi criado;
- se houve push;
- qual é a próxima etapa.

Não peça confirmação para cada comando comum.

Não gere grandes scripts para Rodrigo copiar se você puder executar os
comandos diretamente no ambiente Codex.