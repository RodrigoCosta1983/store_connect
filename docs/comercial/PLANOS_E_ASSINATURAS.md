# Store&Connect — Planos e Assinaturas

Atualizado em: 15/09/2026

## Objetivo

Este documento registra decisões e diretrizes comerciais sobre a
distribuição de funcionalidades entre os planos do Store&Connect.

Ele serve como referência para produto, desenvolvimento, página de preços
e futuras decisões de monetização.

As definições abaixo representam a direção comercial atual e podem evoluir
conforme o produto amadurecer.

Nenhuma regra descrita neste documento deve alterar automaticamente o
comportamento do sistema. Mudanças de permissões, limites ou assinatura no
código devem possuir etapa técnica específica, validação e checkpoint
próprios.

---

## Princípio central

> **Pro entrega a funcionalidade principal. Business entrega escala,
> automação, inteligência e personalização.**

O plano Pro deve ser um produto completo e útil por si só.

O Business não deve existir apenas para desbloquear uma funcionalidade
essencial artificialmente removida do Pro. Seu valor deve estar na
capacidade de ampliar o uso do Store&Connect, automatizar operações,
fornecer mais inteligência comercial e oferecer recursos avançados para
empresas com maior necessidade operacional.

---

## Catálogo Inteligente

O Catálogo Inteligente é considerado uma funcionalidade estratégica do
Store&Connect e um dos principais diferenciais comerciais do produto.

A funcionalidade essencial do catálogo deve estar disponível no plano Pro.

### Plano Pro — fluxo essencial

A direção atual é que o Pro permita:

- criar catálogo inteligente;
- selecionar produtos para o catálogo;
- gerar e compartilhar link público;
- permitir que o cliente visualize os produtos;
- permitir seleção de produtos e quantidades;
- apresentar resumo da seleção;
- permitir envio da solicitação para a loja;
- receber a solicitação dentro do Store&Connect;
- permitir gerenciamento básico das solicitações recebidas.

Esse fluxo deve entregar valor comercial real ao lojista sem exigir o
Business apenas para utilizar o núcleo da funcionalidade.

---

## Plano Business — evolução do canal comercial

O Business deve incluir tudo o que existe no Pro e acrescentar recursos
voltados principalmente a:

- escala;
- automação;
- inteligência;
- personalização;
- gestão comercial avançada.

Possíveis diferenciais do Business incluem, sem compromisso de
implementação imediata:

- maior quantidade de catálogos ativos simultaneamente;
- limites superiores ou diferenciados;
- analytics de acesso ao catálogo;
- métricas de produtos visualizados;
- métricas de solicitações e conversão;
- histórico comercial mais detalhado;
- identificação do cliente;
- integração com cadastro de clientes;
- automações após recebimento de solicitação;
- notificações avançadas;
- personalização visual;
- branding avançado;
- fluxos comerciais automatizados;
- recursos inteligentes baseados em dados do catálogo;
- relatórios avançados;
- ferramentas de acompanhamento de desempenho.

Esses itens são possibilidades de produto e não representam,
individualmente, funcionalidades já aprovadas para desenvolvimento.

---

## Matriz conceitual inicial

| Funcionalidade | Pro | Business |
| --- | --- | --- |
| Criar catálogo público | Sim | Sim |
| Compartilhar catálogo por link | Sim | Sim |
| Cliente selecionar produtos | Sim | Sim |
| Cliente selecionar quantidades | Sim | Sim |
| Resumo da seleção | Sim | Sim |
| Enviar solicitação para a loja | Sim | Sim |
| Receber solicitação no Store&Connect | Sim | Sim |
| Gerenciamento básico das solicitações | Sim | Sim |
| Limites ampliados de catálogo | A definir | Previsto |
| Analytics de catálogo | Básico ou a definir | Avançado |
| Identificação do cliente | A definir | Candidato |
| Integração avançada com clientes | Não definida | Candidato |
| Automações comerciais | Limitadas ou a definir | Avançadas |
| Notificações avançadas | A definir | Candidato |
| Branding/personalização avançada | Não definida | Candidato |
| Relatórios e inteligência comercial | Básicos ou a definir | Avançados |

A tabela representa posicionamento de produto, não uma especificação
técnica definitiva.

---

## Estratégia de diferenciação

### Pro

O Pro deve responder à pergunta:

> "Consigo usar o Store&Connect de verdade para operar e vender melhor?"

A resposta deve ser sim.

O cliente Pro deve conseguir utilizar os principais fluxos do produto sem
sentir que adquiriu apenas uma demonstração limitada.

### Business

O Business deve responder à pergunta:

> "Consigo usar o Store&Connect em maior escala, com menos trabalho manual
> e mais inteligência sobre minha operação?"

A diferenciação deve ocorrer principalmente pela profundidade dos recursos,
e não pela retirada artificial de recursos essenciais do Pro.

---

## Diretriz para novos recursos

Ao surgir uma nova funcionalidade importante, avaliar:

1. ela faz parte do fluxo essencial de utilização do Store&Connect?
2. ela é necessária para que a funcionalidade principal entregue valor?
3. ela representa escala, automação, inteligência ou personalização?
4. ela reduz trabalho operacional de empresas com uso mais intenso?
5. ela é um diferencial avançado ou uma necessidade básica?

Como orientação:

- recursos essenciais tendem ao Pro;
- recursos avançados de escala, automação, inteligência e personalização
  tendem ao Business.

A decisão final deve considerar custos operacionais, infraestrutura,
posicionamento comercial e estratégia de aquisição de clientes.

---

## Limites ainda não definidos

Nesta etapa NÃO estão definidos:

- preço futuro de cada plano;
- quantidade máxima de catálogos por plano;
- quantidade máxima de solicitações;
- limites de produtos por plano;
- limites de usuários;
- limites de armazenamento;
- limites de analytics;
- limites de automações;
- regras específicas de branding;
- funcionalidades definitivas de identificação do cliente.

Esses valores devem ser definidos posteriormente com análise comercial e
técnica própria.

Não criar limites arbitrários no código com base apenas neste documento.

---

## Relação com a F7 — Catálogo Inteligente

A implementação atual da F7 deve manter como direção que o fluxo essencial
do Catálogo Inteligente seja compatível com o plano Pro.

Isso inclui conceitualmente:

- criação;
- compartilhamento;
- seleção;
- envio da solicitação;
- recebimento básico da solicitação.

Recursos adicionais construídos posteriormente ao redor desse fluxo podem
ser avaliados como diferenciais Business.

A documentação técnica da F7 continua sendo a autoridade sobre arquitetura,
segurança e comportamento técnico do Catálogo Inteligente.

Este documento define somente posicionamento comercial.

---

## Decisão registrada em 15/09/2026

Foi adotada como direção inicial do Store&Connect:

> **Não esconder o principal valor do Catálogo Inteligente atrás do plano
> Business. O Pro deve possuir o fluxo comercial principal. O Business deve
> justificar o upgrade através de escala, automação, inteligência,
> personalização e recursos comerciais avançados.**

Essa decisão deverá ser revisitada quando forem definidos os limites
oficiais e a estrutura final de preços dos planos.