# P5 — Preparação de Produção Asaas

Status: planejamento documental. As etapas abaixo são futuras e não estão aprovadas ou executadas por meio deste documento. Esta criação não autoriza acesso ao Asaas, Firebase Produção, cobranças reais, configuração de secrets, deploy ou publicação.

## 1. Objetivo

A P5 prepara o Store&Connect para operar comercialmente com clientes reais utilizando o ambiente de PRODUÇÃO do Asaas. Deve transformar a integração já existente/testada em uma operação segura para produção.

Objetivos principais:

- separar claramente Sandbox e Produção;
- proteger credenciais;
- validar cobranças reais;
- validar assinaturas;
- validar webhooks;
- validar cancelamentos;
- validar inadimplência e reconciliação;
- evitar duplicidade de efeitos;
- preparar build candidata de produção;
- criar checklist formal de lançamento.

## 2. Estratégia de distribuição

**GOOGLE PLAY — PRODUÇÃO**

Destinada a:

- clientes reais;
- versão estável;
- Asaas PRODUÇÃO;
- funcionalidades previamente homologadas.

**GOOGLE PLAY — TESTE FECHADO**

Destinada a:

- testadores;
- homologação contínua;
- novas funcionalidades;
- Asaas SANDBOX quando houver operações de pagamento;
- versões posteriores antes de promoção à produção.

Princípio:

> Teste fechado recebe primeiro.
> Produção recebe somente versões aprovadas.

## 3. Ambientes

A separação é obrigatória:

| Aspecto | TESTE / HOMOLOGAÇÃO | PRODUÇÃO |
| --- | --- | --- |
| Distribuição Android | Google Play Teste Fechado | Google Play Produção |
| Asaas | Sandbox | Produção |
| Dados e público | Dados de teste e testadores | Clientes reais |
| Cobranças | Nenhuma cobrança real | Cobranças reais |
| Webhooks | Do ambiente de teste | Webhooks reais |
| Acompanhamento | Homologação | Monitoramento reforçado |

Nunca misturar credenciais ou endpoints entre ambientes.

## 4. Princípio de segurança Asaas

Regra arquitetural: o aplicativo Flutter NÃO deve possuir a API Key privada do Asaas.

Fluxo esperado:

```text
APP
  ->
BACKEND / CLOUD FUNCTIONS
  ->
ASAAS
```

A chave Asaas permanece exclusivamente em backend seguro. NÃO incluir em:

- código Dart;
- APK;
- AAB;
- JavaScript Web;
- repositório Git;
- logs;
- payload enviado ao cliente.

## 5. Secrets

Planejar configuração separada:

```text
ASAAS_SANDBOX_API_KEY
ASAAS_PRODUCTION_API_KEY
```

Ou nomenclatura compatível com a arquitetura real existente. Os nomes acima são propostas, não configuração já implementada. A auditoria deverá verificar o uso existente de `ASAAS_API_KEY` e `ASAAS_ENV` no backend antes de definir o contrato final.

Antes de implementar:

- auditar onde a chave atual é armazenada;
- auditar como Functions recebem secrets;
- auditar se existe chave hardcoded;
- auditar logs;
- auditar arquivos `.env`;
- auditar configuração do Firebase/Cloud.

Nunca copiar secret real para documentação.

## 6. Seleção de ambiente

O ambiente Asaas NÃO deve ser escolhido livremente pelo aplicativo cliente. Evitar contrato vulnerável como `environment = "production"` enviado pelo Flutter e aceito diretamente pelo backend.

A escolha de Sandbox/Produção deverá ser determinada por configuração segura do backend/deploy. O cliente não pode promover a própria operação de Sandbox para Produção.

## 7. Relação com P4

A P5 deve reutilizar e integrar as decisões de [P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md](P4_INADIMPLENCIA_E_RECONCILIACAO_ASAAS.md). P5 NÃO substitui P4.

P4 trata principalmente:

- inadimplência;
- reconciliação;
- estados de pagamento;
- recuperação de inconsistências financeiras.

P5 trata:

- preparação operacional para ambiente real;
- segurança;
- validação de produção;
- publicação comercial.

As duas fases devem convergir antes do lançamento. Preservar os contratos da P4: isolamento pela assinatura oficial da loja, validação de vínculo, data canônica de atraso, distinção entre bloqueio de acesso e cancelamento, e reconciliação sem alteração do Asaas. Pendências de recuperação de `inactive` devem ser auditadas e resolvidas pelo contrato aplicável antes do lançamento, sem presumir reativação automática.

## 8. P5.0 — Auditoria da integração atual

Antes de qualquer alteração, auditar:

- Functions relacionadas ao Asaas;
- criação de customer;
- criação de subscription;
- criação de payment;
- cancelamento;
- webhooks;
- persistência no Firestore;
- IDs Asaas armazenados;
- estados de assinatura;
- tratamento de erro;
- retries;
- idempotência;
- logs;
- secrets;
- ambiente atual Sandbox/Produção.

Produzir relatório técnico antes de modificar código. O relatório deverá registrar evidências, lacunas e próximas alterações mínimas, sem secrets ou dados sensíveis. A criação deste documento não constitui execução da auditoria P5.0.

## 9. P5.1 — Separação Sandbox × Produção

Objetivo: garantir que Sandbox e Produção sejam ambientes explicitamente distintos.

Validar:

- base URL;
- secret;
- webhook;
- clientes;
- subscriptions;
- payments;
- identificadores;
- configuração de deploy.

Nenhum identificador Sandbox deve ser interpretado como Produção. Nenhuma cobrança de teste pode aparecer como cobrança real.

## 10. P5.2 — Secrets e configuração segura

Objetivo: garantir que credenciais de Produção existam somente no backend.

Validar:

- secret manager/configuração segura;
- nenhum secret no Git;
- nenhum secret no Flutter;
- nenhum secret no Hosting;
- nenhum secret em logs;
- acesso mínimo necessário;
- processo de rotação de chave.

Documentar, na etapa futura e após auditoria, o procedimento de troca emergencial da chave: responsável e autorização, contenção do incidente, substituição segura no backend, revogação da chave comprometida, validação controlada e registro rastreável. A sequência operacional deverá respeitar a arquitetura real e evitar novas cobranças indevidas. Nenhuma troca é realizada nesta etapa documental.

## 11. P5.3 — Webhooks de produção

Auditar e preparar:

- endpoint;
- autenticação/validação;
- identificação do evento;
- idempotência;
- eventos duplicados;
- eventos fora de ordem;
- retry do Asaas;
- falhas temporárias;
- logs seguros;
- atualização do Firestore.

Eventos relevantes devem ser levantados a partir da integração real já existente antes de decidir lista definitiva. Não inventar handlers sem auditar o código atual. Usar a P4 como referência e confirmar o comportamento efetivo na P5.0.

## 12. Idempotência

Regra obrigatória: o mesmo webhook recebido duas ou mais vezes NÃO pode:

- duplicar cobrança;
- duplicar assinatura;
- duplicar movimento financeiro;
- alterar estado incorretamente;
- gerar efeitos colaterais repetidos.

Planejar chave/id de idempotência baseada nos identificadores reais fornecidos pelo Asaas. Definir o contrato somente após auditoria, incluindo concorrência, reprocessamento e separação por ambiente.

## 13. P5.4 — Assinatura / cobrança real controlada

Antes de liberar clientes reais, executar teste controlado com ambiente de Produção, em etapa futura explicitamente autorizada.

Preferencialmente com:

- conta controlada;
- valor pequeno;
- cliente de teste autorizado.

Validar ciclo:

1. criação do customer;
2. criação da assinatura;
3. criação/geração da cobrança;
4. pagamento;
5. recebimento do webhook;
6. atualização no Store&Connect;
7. situação final coerente.

Não realizar cobrança real sem autorização explícita na etapa futura. Qualquer acesso ou operação em produção exige autorização explícita de Rodrigo imediatamente antes da execução.

## 14. P5.5 — Cancelamento, inadimplência e reconciliação

Integrar com P4. Cobrir:

- assinatura cancelada;
- pagamento vencido;
- pagamento recebido após atraso;
- cobrança cancelada;
- falha de cobrança;
- status divergente;
- webhook perdido;
- reconciliação posterior.

O Store&Connect não deve depender exclusivamente de um único webhook para manter verdade financeira permanente. Preservar a diferença entre cancelamento comercial e bloqueio por inadimplência definida na P4.

## 15. Fonte de verdade

Definir durante auditoria, respeitando P4 e implementação existente:

- quais estados são autoritativos no Asaas;
- quais estados são cache/espelho no Firestore;
- quando reconciliar;
- como tratar divergência.

Não definir arbitrariamente sem auditar P4 e implementação existente. A P4 já distingue cobranças/pagamentos no Asaas e estado operacional no Firestore; a P5 deverá confirmar essa divisão e suas condições de atualização em Produção, sem criar uma autoridade concorrente no aplicativo.

## 16. P5.6 — Teste E2E real

Executar fluxo completo controlado, somente com autorização explícita para a etapa real:

```text
APP
 -> BACKEND
 -> ASAAS PRODUÇÃO
 -> WEBHOOK
 -> FIRESTORE
 -> APP
```

Validar:

- assinatura;
- cobrança;
- pagamento;
- atualização;
- cancelamento;
- atraso;
- reconciliação;
- duplicidade;
- erro de rede;
- webhook repetido.

Produzir checklist de resultado com cenário, resultado esperado, resultado observado, evidência minimizada e aprovação ou pendência. Não executar esses testes nesta etapa documental.

## 17. Cliente já existente no Asaas

Auditar comportamento quando:

- CPF/CNPJ já possui customer;
- customerId já está salvo;
- customerId salvo é inválido;
- customer pertence a Sandbox;
- customer pertence a Produção;
- cadastro local e Asaas divergem.

Não criar clientes duplicados silenciosamente. Validar vínculo e ambiente antes de reutilizar identificadores, preservando o isolamento financeiro pela assinatura oficial previsto na P4.

## 18. Assinatura duplicada

Garantir que ações repetidas no aplicativo não criem múltiplas assinaturas pagas para o mesmo contrato quando isso não for intencional.

Avaliar:

- double tap;
- retry;
- timeout;
- resposta perdida;
- Function executada novamente.

A prevenção deve ser garantida no backend, inclusive quando o cliente desconhece o resultado da tentativa anterior.

## 19. P5.7 — Build candidata de Produção

Somente depois de P5.0–P5.6 aprovados.

A build de Produção deverá:

- usar backend configurado para Asaas Produção;
- não carregar secret Asaas;
- possuir versionCode novo;
- possuir versionName apropriado;
- passar testes;
- passar assinatura Android;
- passar validação Play Console;
- possuir SHA registrado.

Registrar a identificação e o SHA aplicável da candidata conforme o processo real de assinatura e validação do projeto. Não promover automaticamente um AAB de homologação se ele estiver configurado para comportamento de Sandbox.

## 20. Teste Fechado permanente

Após abertura da Produção, manter o Teste Fechado permanentemente.

Exemplo conceitual de versões:

| Canal | Versões |
| --- | --- |
| Produção | 1.0.6 |
| Teste Fechado | 1.0.7, 1.0.8, 1.0.9 |

Novas funcionalidades entram primeiro no Teste Fechado. Depois da homologação, uma versão aprovada é preparada/promovida para Produção, respeitando a configuração de ambiente e a autorização de publicação. Os números acima não definem as próximas versões reais.

## 21. P5.8 — Checklist de lançamento

Checklist futuro; todos os itens permanecem pendentes até validação com evidências.

**BACKEND**

- [ ] Secrets Produção configurados.
- [ ] Sandbox separado.
- [ ] Functions corretas.
- [ ] Logs revisados.
- [ ] Idempotência validada.

**ASAAS**

- [ ] Customer validado.
- [ ] Subscription validada.
- [ ] Payment validado.
- [ ] Webhook validado.
- [ ] Cancelamento validado.
- [ ] Atraso validado.
- [ ] Reconciliação validada.

**ANDROID**

- [ ] Versão validada.
- [ ] VersionCode validado.
- [ ] Assinatura validada.
- [ ] MinSdk validado.
- [ ] AAB validado.
- [ ] Play Console validada.
- [ ] SHA registrado.

**WEB**

- [ ] Versão validada.
- [ ] Hosting validado.
- [ ] Configuração validada.
- [ ] Comportamento financeiro validado.

**SEGURANÇA**

- [ ] Nenhum secret no cliente.
- [ ] Nenhum secret no Git.
- [ ] Nenhuma credencial em log.

**NEGÓCIO**

- [ ] Planos validados.
- [ ] Valores validados.
- [ ] Periodicidade validada.
- [ ] Regras de cancelamento validadas.
- [ ] Inadimplência validada.

Registrar resultado, evidência e responsável pela aprovação de cada item. Quando Web não for aplicável, justificar formalmente essa condição. Este checklist não autoriza deploy de Functions ou Hosting, nem publicação Play Store.

## 22. P5.9 — Publicação

Somente após checklist integral aprovado.

Fluxo:

```text
CANDIDATO
 -> VALIDAÇÃO FINAL
 -> GOOGLE PLAY PRODUÇÃO
 -> MONITORAMENTO
 -> CLIENTES REAIS
```

Não publicar automaticamente após build. Exigir autorização explícita de Rodrigo imediatamente antes da publicação. Deploys e demais ações de produção também exigem autorização explícita imediatamente antes de sua execução.

## 23. Rollout

Considerar publicação gradual se a Play Console e estratégia do projeto permitirem.

Exemplo conceitual:

- grupo inicial;
- monitorar;
- ampliar;
- 100%.

Não decidir percentual agora. Avaliar no momento real do lançamento.

## 24. Monitoramento pós-lançamento

Após Produção, monitorar:

- erros de Functions;
- webhooks;
- falhas Asaas;
- pagamentos;
- assinaturas duplicadas;
- cancelamentos;
- divergências;
- crash Android;
- reclamações de clientes.

Definir janela reforçada de acompanhamento nos primeiros dias, responsáveis e critérios de escalonamento antes do lançamento.

## 25. Fallback / incidente

Se houver falha crítica:

- não gerar novas cobranças indevidas;
- bloquear novas operações financeiras se necessário;
- preservar dados;
- registrar incidente;
- reconciliar com Asaas;
- nunca corrigir manualmente estados financeiros sem rastreabilidade.

Não implementar mecanismo agora. Ações em produção e medidas destrutivas continuam sujeitas à autorização explícita imediatamente antes da execução.

## 26. Auditoria

Operações financeiras relevantes devem ser rastreáveis. Planejar registro de:

- storeId;
- customerId interno;
- Asaas customerId quando apropriado;
- subscriptionId;
- paymentId;
- evento recebido;
- status anterior;
- status novo;
- origem da mudança;
- timestamp backend.

Nunca registrar secrets. Definir os registros conforme os identificadores e vínculos reais auditados, aplicando minimização e acesso restrito.

## 27. Privacidade

Evitar logs desnecessários contendo:

- CPF/CNPJ completo;
- dados bancários;
- tokens;
- API keys;
- payloads financeiros integrais.

Aplicar princípio de minimização, inclusive em relatórios de teste, evidências de lançamento e registros de incidente.

## 28. Critérios de aceite da P5

P5 somente pode ser considerada concluída quando:

- Sandbox e Produção estão separados;
- secrets estão seguros;
- nenhum secret está no cliente;
- webhook Produção validado;
- idempotência validada;
- cobrança real controlada aprovada;
- cancelamento validado;
- inadimplência validada;
- reconciliação validada;
- duplicidade bloqueada;
- E2E Produção aprovado;
- candidato Android aprovado;
- candidato Web aprovado quando aplicável;
- checklist P5.8 aprovado;
- publicação explicitamente autorizada.

Documentação criada não significa P5 concluída nem comprova validação em Produção. Registrar evidências e resolver pendências da integração com P4 antes do lançamento.

## 29. Cronograma P5

Sequência oficial de etapas; datas e execução serão definidas posteriormente:

| Etapa | Escopo |
| --- | --- |
| P5.0 | Auditoria da integração Asaas atual |
| P5.1 | Separação Sandbox × Produção |
| P5.2 | Secrets e configuração segura |
| P5.3 | Webhooks de produção |
| P5.4 | Assinatura/cobrança real controlada |
| P5.5 | Cancelamento, inadimplência e reconciliação |
| P5.6 | Teste E2E real |
| P5.7 | Build candidata de Produção |
| P5.8 | Checklist de lançamento |
| P5.9 | Publicação em Produção |

## 30. Princípio final

O ambiente de Produção do Asaas representa dinheiro real.

Nenhuma operação financeira real deve depender apenas de validação de
interface ou de comportamento do aplicativo cliente.

A segurança, autorização, escolha de ambiente, idempotência e integridade
financeira devem ser garantidas pelo backend do Store&Connect.
