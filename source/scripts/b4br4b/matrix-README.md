# R4-B/02 — matriz de revisão e rastreabilidade

Consome a coleta final da Subetapa 01 sem executá-la novamente. O parser, os
gates e os inventários aprovados ficam intactos. Usa `within`/`resolve` do coletor
01 e hashes R3. Nenhuma dependência adicional, rede ou SDK Firebase é executado.

Da raiz:

```powershell
node --test scripts/b4br4b/matrix.test.cjs
node scripts/b4br4b/matrix.cjs build/b4br4b/inspection-1792358982334.json build/b4br4b02/nova-matriz.json
```

O diretório de saída deve existir. O arquivo de saída deve ser novo: escrita com
`wx` recusa sobrescrita (exit 2). Geração concluída retorna **1/BLOQUEADO**;
isso não é falha de teste nem aprovação de SDK. Testes aprovados retornam 0.
Para comparar, gere dois arquivos novos e compare SHA256. Mesmo input, fontes,
ferramentas e corpus produzem JSON idêntico; não há timestamp na matriz.

O resultado exportado desta entrega está em
`docs/catalog/F9_B07_D_C_C_C_B4_B_R4_B_02_MATRIZ.json`.

Cada fronteira tem ID/índice do input, URI, pacote de origem/destino, tipo,
categoria, tags de contexto, serviço, capacidade **potencial**, prioridade,
hash/trecho/AST da origem e disponibilidade do destino. Não há deduplicação das
197 arestas. Destino disponível não significa closure examinada ou aprovada.

Estados separados:

- `reviewStatus=PENDENTE`: integridade da origem conferida, revisão do destino
  e de seus efeitos ainda pendente. Nenhuma fronteira recebeu REVISADO.
- `NÃO DEMONSTRADO`: dados/fontes/integridade insuficientes; em `runtimeProof`
  significa que não há prova real de isolamento, inclusive nas fontes presentes.
- `evidenceReview=REVISADO` nos requisitos do owner: somente rastreabilidade
  dos trechos delimitados, sem aprovar o requisito, o arquivo ou o SDK.
- `requirementStatus`: PENDENTE para revisão estrutural/estática ainda necessária;
  NÃO DEMONSTRADO para os requisitos que exigem execução real.
- `admission=NOT_ADMITTED` e resultado BLOQUEADO em todos os casos.

Prioridades são triagem lexical: P0 para interop, registro/plataforma, rede/I/O
e assincronia; P1 para framework; P2 para anotações/utilitários. Os IDs P0 por
Auth/Firestore/Functions/Core estão em `priorityByService`. Não significam
vulnerabilidade ou chamada comprovada. Um import pode representar só um tipo.

`owner-review.json` é roteiro de requisitos rastreáveis, sem decisão arquitetural
nova ou revisão positiva de policy. O gerador aponta arquivo/seção/linha/trecho
documental, locator de código, prova necessária e bloqueio para cada requisito.
Identifica R2 como contrato PROPOSTO e relatórios/README conforme sua autoridade;
não converte esses textos em autorização normativa independente.

A busca K14/K15 registra os arquivos e hashes do corpus, referências e seções.
Abrange documentos locais `.txt/.md`, contratos dos gates, testes/helpers SDK e
evidências textuais pertinentes `build/b4b*`. Exclui node_modules, fixtures,
outputs desta subetapa e inventários/baselines volumosos. Não pesquisa conversas,
DOCX/PDF ou todo o disco. Referências e intervalos K11–K16 não definem K14/K15.
Definições aprovadas seguem NÃO LOCALIZADO; não há texto normativo inventado.

Os gates na matriz são resultados **recebidos** da coleta 01. A regressão desta
subetapa reexecuta os testes R3/R4-A/01 separadamente, sem sobrescrever evidências.
A falha histórica R2 de Functions continua reprovada e NÃO EXECUTADA aqui.
Não existe admissão nem autorização implícita para R4-B/03.
