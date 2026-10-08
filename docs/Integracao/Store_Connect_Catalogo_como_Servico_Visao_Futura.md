# Store Connect — Catálogo como Serviço e Integração com Sistemas Existentes

**Status:** Ideia de arquitetura futura — não implementar agora
**Data:** 21/09/2026
**Objetivo:** registrar uma possível linha de produto do Store Connect para empresas que desejam usar o catálogo inteligente sem substituir imediatamente o sistema que já utilizam.

---

## 1. Contexto

Alguns clientes potenciais já terão ERP, PDV, sistema de estoque ou software próprio implantado. Em muitos casos, a empresa pode não querer ou não poder substituir esse sistema por motivos contratuais, operacionais, financeiros, regulatórios ou de dependência de processos internos.

Nesses cenários, o Store Connect não precisa competir com o sistema existente. Ele pode atuar como uma **camada complementar de catálogo e vendas digitais**, conectada ao sistema oficial do cliente.

A proposta é permitir que o cliente mantenha seu sistema atual como fonte principal de dados e utilize apenas as funcionalidades diferenciais do Store Connect, especialmente:

- catálogo inteligente;
- apresentação organizada de produtos;
- busca;
- recomendações;
- promoções;
- cross-sell e upsell;
- carrinho e pedido;
- futura automação comercial baseada em IA.

---

## 2. Visão de produto

A ideia pode ser posicionada futuramente como uma modalidade própria:

### Store Connect Completo
O cliente utiliza o ecossistema Store Connect para gestão, produtos, vendas e catálogo.

### Store Connect Catalog
O cliente mantém seu ERP/PDV/sistema atual e utiliza o Store Connect apenas como a camada de catálogo inteligente e experiência digital de venda.

Mensagem comercial possível:

> “Você não precisa trocar seu sistema atual. O Store Connect pode se integrar a ele e funcionar como sua camada de catálogo e vendas digitais.”

---

## 3. Princípio arquitetural principal

O sistema atual do cliente deve continuar sendo, por padrão, o **source of truth** para os dados operacionais que já administra.

Exemplos:

- produto;
- SKU/código externo;
- preço;
- estoque;
- status ativo/inativo;
- eventualmente unidade, marca e outros dados comerciais.

O Store Connect pode complementar esses dados com informações próprias, por exemplo:

- imagens;
- organização visual;
- categorias do catálogo;
- tags e grupos;
- promoções próprias do catálogo;
- recomendações;
- regras de exibição;
- métricas de interação;
- configurações de cross-sell/upsell.

---

## 4. Arquitetura conceitual inicial

```text
┌───────────────────────────────┐
│ SISTEMA ATUAL DO CLIENTE      │
│ ERP / PDV / sistema próprio   │
│                               │
│ produtos                      │
│ estoque                       │
│ preços                        │
│ códigos / SKU                 │
└───────────────┬───────────────┘
                │
                │ API / integração
                ▼
┌───────────────────────────────┐
│ CAMADA DE INTEGRAÇÃO          │
│ STORE CONNECT                 │
│                               │
│ normalização                  │
│ mapeamento                    │
│ sincronização                 │
│ categorias                    │
│ imagens                       │
│ regras                        │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ CATÁLOGO STORE CONNECT        │
│                               │
│ busca                         │
│ recomendações                 │
│ promoções                     │
│ cross-sell / upsell           │
│ carrinho / pedido             │
└───────────────────────────────┘
```

---

## 5. Estratégia recomendada para a primeira versão

A primeira integração deve ser **unidirecional**:

```text
Sistema do cliente
        ↓
Store Connect
```

O Store Connect consulta ou recebe dados do sistema externo e os utiliza para manter o catálogo atualizado.

Exemplos:

- preço alterado no ERP → preço refletido no Store Connect;
- estoque alterado no ERP → disponibilidade refletida no catálogo;
- novo produto no ERP → produto disponibilizado para tratamento/publicação no catálogo;
- produto inativado no ERP → item desativado ou ocultado conforme regra definida.

### Por que começar assim

É a alternativa de menor risco porque:

- o Store Connect não precisa escrever no sistema do cliente;
- reduz impacto operacional;
- reduz risco de inconsistência;
- facilita aprovação de segurança pelo cliente;
- simplifica contratos e permissões;
- permite implantação gradual.

---

## 6. Evolução futura: integração bidirecional controlada

Depois de estabilizada a sincronização de leitura, pode ser oferecido um segundo estágio:

```text
Sistema do cliente
        ↓
Store Connect
        ↓
Pedido realizado
        ↓
Sistema do cliente
```

Nesse modelo, o pedido feito no catálogo poderia ser enviado ao ERP/PDV do cliente por meio de uma API oficial, webhook ou conector específico.

A escrita no sistema externo deve ser sempre explícita, limitada ao necessário e baseada em contrato de integração bem definido.

---

## 7. Formas de integração possíveis

Prioridade sugerida:

1. **API oficial** — melhor opção quando disponível.
2. **Webhooks** — úteis para atualizações quase em tempo real.
3. **Banco de dados em modo somente leitura** — quando o fornecedor permitir e houver contrato adequado.
4. **SFTP / arquivos estruturados** — CSV, XML, JSON ou outros formatos periódicos.
5. **Importação automatizada de CSV/Excel** — alternativa para sistemas sem API.
6. **Exportação periódica assistida** — último recurso para sistemas legados.

### Regra de segurança

Evitar escrita direta no banco de dados do cliente.

Se o acesso direto ao banco for necessário, a preferência arquitetural deve ser por credenciais **read-only**, com consulta somente aos campos necessários.

---

## 8. Camada de adaptadores

O núcleo do Store Connect não deve conhecer detalhes específicos de cada ERP.

A ideia é criar futuramente uma camada de integração baseada em adaptadores:

```text
integrations/
├── omie/
├── bling/
├── tiny/
├── totvs/
├── sap/
├── sistema_personalizado/
└── generic_api/
```

Cada adaptador teria a responsabilidade de converter o formato externo para um modelo interno padronizado.

Exemplo de entrada de um ERP:

```json
{
  "cod_prod": "4581",
  "descricao": "Coca Cola 2L",
  "preco_venda": 10.99,
  "saldo": 18
}
```

Representação interna conceitual:

```text
externalProductId = 4581
name              = Coca Cola 2L
price             = 10.99
quantity          = 18
```

O catálogo deve consumir o modelo interno do Store Connect, e não a estrutura específica do ERP.

---

## 9. Campos que podem ser previstos para o futuro

Sem implementar agora, vale reservar conceitualmente espaço para dados como:

- `externalProductId`
- `externalSku`
- `sourceSystem`
- `integrationId`
- `lastSyncedAt`
- `syncStatus`
- `syncError`
- `externalUpdatedAt`
- `externalPriceSource`
- `externalStockSource`

Esses campos não precisam ser adicionados enquanto não houver uma integração real aprovada. O objetivo aqui é apenas registrar a direção arquitetural.

---

## 10. Separação de responsabilidades

### Sistema externo
Deve ser responsável, quando aplicável, por:

- código oficial do produto;
- preço oficial;
- estoque oficial;
- cadastro operacional;
- regras fiscais;
- informações que o cliente determine como fonte mestre.

### Store Connect
Pode ser responsável por:

- experiência de catálogo;
- organização visual;
- imagens adicionais;
- categorias e grupos do catálogo;
- recomendações;
- cross-sell/upsell;
- promoções de apresentação;
- destaques;
- interface de compra;
- comportamento do cliente;
- métricas e inteligência comercial.

Essa separação deve ser configurável por integração.

---

## 11. Sincronização e conflitos

Antes de implementar qualquer conector, será necessário definir regras explícitas de propriedade dos dados.

Exemplo:

| Campo | Fonte principal sugerida |
|---|---|
| SKU | ERP |
| Nome comercial | ERP ou Store Connect, conforme contrato |
| Preço | ERP |
| Estoque | ERP |
| Imagem | Store Connect ou ERP |
| Categoria de catálogo | Store Connect |
| Grupo promocional | Store Connect |
| Recomendação | Store Connect |
| Status de disponibilidade | derivado do ERP + regras Store Connect |

Nunca deve existir uma sincronização em que dois sistemas possam sobrescrever o mesmo campo sem uma regra clara de precedência.

---

## 12. Frequência de atualização

A estratégia pode variar conforme o cliente:

- tempo real via webhook;
- quase em tempo real;
- a cada poucos minutos;
- por lote em horários definidos;
- atualização manual assistida.

Preço e estoque normalmente exigem maior frequência do que imagens, descrições e categorização.

---

## 13. Identidade e rastreabilidade

Um produto precisa manter uma identidade estável entre os dois sistemas.

O Store Connect deve ter seu próprio ID interno e, separadamente, armazenar a referência externa.

Conceito:

```text
storeConnectProductId
        <->
externalProductId / externalSku
        <->
sistema do cliente
```

Não é recomendável usar o ID externo como único ID interno do Store Connect, pois:

- sistemas diferentes podem usar formatos incompatíveis;
- códigos externos podem mudar;
- o mesmo Store Connect pode integrar múltiplas fontes;
- a camada interna precisa continuar independente do fornecedor.

---

## 14. Segurança e isolamento

Uma futura plataforma de integrações deverá considerar:

- credenciais separadas por loja/cliente;
- princípio do menor privilégio;
- leitura somente quando escrita não for necessária;
- criptografia de segredos;
- rotação de credenciais;
- logs de sincronização;
- auditoria;
- limite de taxa;
- timeouts;
- retry controlado;
- idempotência;
- proteção contra duplicação;
- isolamento entre lojas;
- tratamento seguro de falhas.

Nenhuma credencial de integração deve ficar exposta no aplicativo cliente.

---

## 15. Tratamento de falhas

A integração precisa falhar de forma controlada.

Exemplos de estados futuros:

```text
SYNC_OK
SYNC_PENDING
SYNC_PARTIAL
SYNC_ERROR
AUTH_ERROR
RATE_LIMITED
EXTERNAL_UNAVAILABLE
MAPPING_ERROR
```

Uma falha no ERP não deve necessariamente derrubar o catálogo já publicado. O sistema pode manter o último estado válido conhecido, sinalizando que a sincronização está atrasada.

Para preço e estoque, a política precisa ser mais conservadora e definida por cliente.

---

## 16. Observabilidade

Para operação profissional, futuramente será necessário registrar:

- última sincronização;
- duração;
- quantidade de produtos recebidos;
- produtos criados/atualizados/ignorados;
- erros;
- divergências;
- status do conector;
- data da última comunicação com o sistema externo.

Pode existir um painel de integração para o administrador da loja.

---

## 17. Onboarding de um novo ERP

Fluxo conceitual:

1. identificar fornecedor e versão do sistema;
2. verificar documentação/API;
3. definir autenticação;
4. definir campos necessários;
5. mapear produtos;
6. definir source of truth por campo;
7. realizar sincronização em ambiente de teste;
8. validar diferenças;
9. homologar com o cliente;
10. ativar sincronização;
11. monitorar;
12. somente depois avaliar escrita de pedidos no sistema externo.

---

## 18. Generic Connector

Uma solução estratégica pode ser criar uma **API genérica de integração do Store Connect**.

Em vez de o Store Connect precisar conhecer todo sistema do mercado, o cliente ou fornecedor poderia enviar produtos no nosso contrato padrão.

Exemplo conceitual:

```text
ERP / Sistema do cliente
        ↓
Adapter do cliente ou parceiro
        ↓
Store Connect Integration API
        ↓
Modelo interno
        ↓
Catálogo
```

Isso pode reduzir bastante o custo de suportar sistemas personalizados.

---

## 19. Relação com a importação atual

O trabalho já realizado na importação de produtos é útil como base conceitual porque aborda:

- entrada de dados externos;
- normalização;
- resolução de categorias;
- validação;
- tratamento de inconsistências;
- criação controlada de produtos;
- associação explícita de categorias.

Entretanto, importação de arquivo e integração contínua são problemas diferentes.

A futura integração exigirá também:

- identidade externa persistente;
- sincronização incremental;
- reconciliação;
- retries;
- idempotência entre sistemas;
- observabilidade;
- credenciais;
- controle de origem dos campos.

Portanto, a importação atual deve ser vista como aprendizado e componente relacionado, não como o conector definitivo.

---

## 20. Modelo comercial possível

A capacidade de integração pode abrir três ofertas:

### A. Store Connect Completo
Para empresas que querem usar todo o ecossistema.

### B. Store Connect Catalog
Para empresas que mantêm o sistema atual e usam somente o catálogo inteligente.

### C. Store Connect Enterprise Integration
Para empresas com ERP próprio, integrações especiais, múltiplas filiais ou requisitos específicos.

A integração pode futuramente ser cobrada como:

- setup inicial;
- mensalidade adicional;
- pacote por conector;
- volume de produtos;
- volume de sincronizações;
- projeto Enterprise customizado.

A definição comercial fica para etapa futura.

---

## 21. MVP futuro recomendado

Quando decidirmos transformar esta ideia em projeto, a primeira prova de conceito deve ser pequena:

1. escolher um único sistema externo;
2. integrar apenas leitura;
3. sincronizar produto, SKU, preço e estoque;
4. manter catálogo e categorias no Store Connect;
5. registrar `externalProductId`;
6. implementar sincronização manual;
7. depois adicionar sincronização automática;
8. somente após estabilidade considerar envio de pedidos de volta.

Evitar começar com vários ERPs simultaneamente.

---

## 22. O que NÃO fazer agora

Este documento não autoriza implementação.

Neste momento, não devemos:

- alterar o modelo atual de produtos apenas por hipótese futura;
- criar campos sem uso;
- adicionar dependências de ERP;
- modificar Rules por causa dessa ideia;
- misturar integração externa com o T6 atual;
- construir conectores antes de existir um cliente/caso concreto;
- assumir que todos os sistemas terão API;
- escrever diretamente em banco de terceiros.

A prioridade continua sendo fechar corretamente o núcleo atual do Store Connect.

---

## 23. Perguntas para quando retomarmos esta frente

Antes da implementação real, responder:

1. Qual será o primeiro ERP/sistema-alvo?
2. O cliente possui API oficial?
3. Quais dados precisam ser sincronizados?
4. Quem será source of truth para cada campo?
5. O catálogo deve continuar disponível se a integração estiver offline?
6. Qual tolerância para estoque desatualizado?
7. O preço deve ser consultado em tempo real ou sincronizado?
8. O pedido deve permanecer só no Store Connect ou voltar ao ERP?
9. Como produtos externos serão vinculados aos produtos internos?
10. Como tratar produtos removidos no ERP?
11. Como tratar conflito de atualização?
12. O cliente poderá editar no Store Connect campos controlados pelo ERP?
13. Qual frequência de sincronização?
14. Como credenciais serão armazenadas?
15. Quais logs e auditorias serão exigidos?
16. Como testar sem tocar em produção?
17. Haverá homologação por cliente?
18. Como versionar contratos de integração?

---

## 24. Diretriz registrada

A visão futura é:

> **O Store Connect deve ser capaz de funcionar tanto como sistema completo quanto como camada independente de catálogo inteligente integrada ao sistema que o cliente já possui.**

O princípio deve ser **integrar antes de substituir** quando a realidade do cliente exigir.

Isso reduz a barreira de adoção, amplia o mercado potencial e preserva a independência tecnológica do núcleo do Store Connect.

---

## 25. Status

**Backlog estratégico / arquitetura futura.**

Nenhuma implementação deve começar automaticamente a partir deste documento.

Quando houver interesse comercial real ou quando o roadmap chegar a essa frente, este documento deverá ser revisado e convertido em:

- requisitos funcionais;
- requisitos não funcionais;
- contrato de integração;
- modelo de dados;
- arquitetura de segurança;
- plano de testes;
- prova de conceito;
- cronograma por fases.
