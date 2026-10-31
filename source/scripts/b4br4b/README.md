# R4-B — coleta dirigida de fontes, sem admissão

Primeira subetapa: complementar o inventário de metadados R4-A com caminhos
reproduzíveis de import/export/part das quatro APIs Firebase e dos quatro plugins
Web resolvidos. Reutiliza o parser AST e compatibilidade R3 e a avaliação R4-A.
Não altera política, revisão, inventário aprovado ou estrutura inerte.

Da raiz, sem instalação, pub get, emuladores ou rede:

```powershell
node --test scripts/b4br4b/inspect.test.cjs
node scripts/b4br4b/inspect.cjs
```

O segundo comando retorna **1/BLOCKED**; erro de infraestrutura retorna 2.
Grava evidência com nome único em build/b4br4b. O grafo percorre todos os ramos
condicionais em 13 pacotes Firebase/interfaces/internals, sem executar as fontes.
Cada aresta registra origem, URI e linha; cada fonte alcançada recebe hash.
Pacotes externos ao recorte e bibliotecas dart: são fronteiras NÃO REVISADAS,
nunca folhas aprovadas. Ciclos terminam e diagnósticos/arquivos ausentes bloqueiam.
O recorte não é a closure completa do artefato distribuído ou dos módulos JS.
Locators são trechos textuais para revisão, não chamadas ou prova de dataflow.

## Requisitos de admissão pendentes

- Revisão independente dos papéis/hashes do owner e perfil, antes de atualizar
  policy/review. A coleta não concede autorização e não admite nenhum pacote.
- Nome/exclusividade do app e lifecycle SDK precisam de decisão/revisão; recusar
  app default/preexistente/desconhecido, parâmetros UI e configuração parcial.
- Criar os três serviços no mesmo app demo, configurar antes de usar, impedir
  reconfiguração pelo código controlado e entregar somente portas restritas.
- Revisar closure externa, registro Web gerado, interop e JS efetivamente servidos;
  comparar versões/hashes/imports e artefato distribuído. O plugin resolvido é
  cloud_functions_web; não existe pacote firebase_functions_web nessa resolução.
- Resolver K16 mediante autorização separada: core_web declara JS 12.15.0,
  cache conhecido fornece 12.19.0. Warning/override não provam compatibilidade.
- Definir allowlist exata de URLs/paths diagnósticos, redirects, credenciais e
  App Check antes da prova Functions; nenhuma callable comercial é autorizada.

## Provas delimitadas

Executáveis agora: parsing/grafo/hashes, recusas da coleta, gates R3/R4-A.
Essas provas não inicializam SDK nem comprovam isolamento real.

Após alinhamento/revisão: Auth demo em memória e associação ao app/tenant;
Firestore Source.server com metadata e Rules locais, sem cache/pending writes
aceitos como autoridade; Functions por URL diagnóstica absoluta com observação
de tráfego loopback. Incluir negativos de app trocado, configuração parcial e
instâncias externas. Sem venda, ledger, cobrança, checkout ou backend comercial.
Não executadas nesta subetapa. Sessão/geração/ABA permanecem gates próprios;
nenhum controle B4-C foi antecipado. A falha histórica Functions segue reprovada.

K11–K13 são consultáveis no relatório R2; K16 e o contrato de revisão constam
em R3/R4-A. Não foi encontrado texto individual identificado como K14/K15 nos
documentos F9 locais examinados: não inferir novas regras ou preencher a lacuna
com aprovação fabricada. A admissão continua bloqueada também por essa lacuna.
