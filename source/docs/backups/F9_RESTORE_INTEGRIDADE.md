# F9 — contenção local de integridade do restore

Data: 14/10/2026. Implementação local para revisão; sem deploy.

O snapshot v1 permanece inalterado: products, customers, categories, sales e
cashFlow (cash_flow no Firestore), além de sete settings. Produtos ativos e
arquivados preservam seus campos, inclusive COD. productCodes, usuários,
auditLogs, assinatura/Asaas e arquivos físicos Storage não integram o snapshot.
As leituras sequenciais do produtor também não constituem snapshot transacional
de todas as coleções.

O único executor de restore encontrado é storeRestoreEmulator.js, restrito a
demo-store-connect-restore e host local. R2A/R2B validam contrato/autorização,
mas não executam restore; não há export de restore de backup em index.js.
restoreProduct é uma operação distinta: restaura o estado de um único produto.

## Contenção aplicada

O planner adiciona PRODUCT_CODES_REQUIRE_RESTORE_POLICY se origem ou baseline
do destino contiver COD não vazio, incluindo arquivados. O executor rejeita
qualquer plano com escritas com RESTORE_EXECUTION_BLOCKED_INTEGRITY antes do
primeiro batch. Parsing, transformação, planejamento e verificação continuam
disponíveis. Plano sem escritas não materializa dados.

O bloqueio é deliberadamente mais amplo que snapshots com COD: a leitura do
baseline e os commits não compartilham transação ou barreira contra writers.
Um produto pode adquirir COD depois da validação. Uma restauração sem COD
poderia então sobrescrever/apagar esse produto e deixar reserva órfã. Múltiplos
batches podem deixar aplicação parcial se um commit intermediário falhar.

Não há reconstrução, sobrescrita de reservas, migração implícita ou rollback
implementado. Reservas legadas e ownerType variant permanecem intocadas.
Os testes legados que esperam materialização passam a falhar pela contenção;
não foram reescritos para declarar o executor pronto.

## Proposta para reabilitação — requer decisão antes de implementação

1. Definir política/versionamento do snapshot para productCodes e, futuramente,
   os documentos de variantes. Não é possível reconstruir owners de variante
   apenas com products. Snapshot v1 não representa essas identidades.
2. Validar o estado final completo por loja, combinando origem e preservados do
   destino no MERGE, incluindo arquivados, COD normalizado, IDs hash, owners e
   duplicidades. Reservas legadas devem ser interpretadas sem regravação
   automática. Reserva válida conflitante deve bloquear, nunca ser substituída.
3. Aprovar proteção contra writers concorrentes entre baseline e aplicação,
   cobrindo todos os caminhos de escrita envolvidos. Uma aprovação ou hash
   antigo não é uma barreira de concorrência.
4. Para conjuntos pequenos, avaliar transação única de produtos, reservas e
   demais mudanças, com limites explícitos de tamanho. Para conjuntos maiores,
   definir protocolo de staging/publicação, isolamento e recovery antes de
   reabilitar batches; não prometer rollback global inexistente.
5. Testar falhas antes/durante/depois do commit, perda de resposta, repetição,
   isolamento, concorrência, legados, arquivados e variantes. Revalidar suites
   R1/R2 contra o contrato aprovado antes de qualquer operação real.

## Produtos no F9

COD arquivado é imutável no update, inclusive atribuição a arquivado sem COD.
COD omitido ou normalizado igual pode manter edição comercial. Create/update
consultam produtos da loja na transação para impedir apropriação de COD de
legado sem reserva. Archive/restore validam reserva e duplicidade antes da
mudança de estado, inclusive chamadas idempotentes. Reserva ausente exige
revisão explícita; não é reparada silenciosamente. Reservas legadas válidas
permanecem byte a byte inalteradas. Owner de variante não é apropriado.

A consulta completa de produtos aumenta leituras, locks e contenção por loja;
avaliar volume e carga HML antes da liberação. Não há writer F10 novo.
O bloqueio não reconcilia inconsistências históricas: inventário HML e eventual
correção autorizada separadamente continuam necessários.

## Alternativas para a homologação F9 — revisão de 14/10/2026

Nenhuma alternativa foi selecionada ou reabilitada nesta revisão.

| Alternativa | Dependências e impacto | Riscos | Estimativa de esforço |
| --- | --- | --- | --- |
| A — implementar restore seguro antes de homologar F9 | Aprovar política de reservas/snapshot, semântica de MERGE/REPLACE, concorrência e recovery. Validar fluxo administrativo R2 e todos os writers afetados. Para conjuntos pequenos, avaliar transação única com limites; conjuntos maiores exigem protocolo próprio. Adia F9 e amplia o escopo de recuperação. | Reconstrução incompleta de owners, aplicação parcial, races, limites transacionais e regressão dos fluxos R1/R2. Variantes futuras não podem ser inventadas/reconstruídas sem dados. | 5–10 dias úteis para solução limitada e testada; 10–20+ se incluir grandes volumes, staging e recovery. Estimativa de engenharia, não prazo assumido. |
| B — manter restore temporariamente indisponível | Manter bloqueio backend antes do primeiro commit. Informar na área Backup e Recuperação que restauração está indisponível e distinguir criação de backup de recuperação. Preservar testes da contenção e registrar os 46 testes incompatíveis com materialização, sem skip/remoção. | Recuperação operacional indisponível; backup v1 não cobre reservas/variantes. Homologação só pode declarar o escopo F9 sem restore, após decisão explícita. | 0,5–1,5 dia útil para aviso/testes/documentação, além dos demais gates F9. |

A interface atual possui criação de backup e preview de retenção, mas não
possui ação de restore de backup. O título “Backup e Recuperação” pode sugerir
capacidade maior que a disponível; a alternativa B deve acrescentar aviso
explícito, sem criar botão que chame um executor indisponível. Essa alteração
de interface não foi implementada automaticamente ao apresentar alternativas.

A criação de backups não foi alterada pela contenção local, mas disponibilidade
em HML depende de Function e Storage próprios. Não presumir esses serviços
publicados/provisionados apenas pela existência do botão Flutter.

Recomendação: B para manter F9 separado da arquitetura de recovery, mediante
aceitação explícita do escopo e conclusão de A5/infraestrutura HML. A alternativa
A deve ser uma etapa própria com contrato revisado. Não retornar a batches
inseguros para recuperar o verde dos 46 testes.
