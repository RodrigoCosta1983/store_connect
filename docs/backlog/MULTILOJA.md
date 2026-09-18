# Store&Connect — Arquitetura Multiloja

## Status

Backlog técnico / análise futura.

Ainda não existe decisão de implementação.

---

## Contexto

Hoje o Store&Connect possui uma restrição que impede o cadastro de mais de uma loja utilizando o mesmo CPF/CNPJ.

Esse modelo atende ao cenário atual de um cliente associado a uma única loja, porém limita situações legítimas como:

- um mesmo proprietário administrando duas ou mais lojas;
- matriz e filiais;
- um empresário operando marcas diferentes;
- grupos empresariais com múltiplos estabelecimentos;
- expansão de um cliente atual para novas unidades.

A restrição precisa ser reavaliada antes de o Store&Connect evoluir para um modelo multiloja.

---

## Problema arquitetural

O CPF/CNPJ não deve necessariamente representar a identidade única de uma loja.

Precisamos investigar se hoje o documento está sendo utilizado como:

- identificador da loja;
- chave de unicidade;
- chave de busca;
- vínculo entre usuário e loja;
- referência de assinatura;
- referência no Asaas;
- dado de cobrança;
- validação durante cadastro;
- regra de autorização ou segurança.

Não devemos simplesmente remover a restrição de CPF/CNPJ duplicado sem antes auditar essas dependências.

---

## Modelo conceitual a estudar

Separar os conceitos de:

### Conta / proprietário / organização

Representa quem administra uma ou mais lojas.

Pode possuir:

- CPF/CNPJ;
- dados cadastrais;
- dados de cobrança;
- assinatura/plano;
- usuários administradores.

### Loja

Representa uma unidade operacional independente.

Cada loja continua possuindo seu próprio:

- `storeId`;
- estoque;
- produtos;
- vendas;
- clientes;
- catálogo;
- solicitações;
- funcionários;
- configurações;
- dados operacionais.

Relação esperada:

```text
Conta / Organização
        |
        +---- Loja A
        |
        +---- Loja B
        |
        +---- Loja C

```

---

### Funcionários e permissões

O modelo de acesso também deverá ser estudado separadamente da identidade do proprietário.

Precisaremos definir futuramente se um mesmo usuário poderá:

- acessar uma única loja;
- acessar múltiplas lojas;
- possuir funções diferentes em lojas diferentes.

Exemplo:

```text
Usuário
├── Loja Centro → admin
└── Loja Barra  → gerente
```

Nenhuma decisão de implementação foi tomada ainda.

### Cobrança / Asaas

A relação entre responsável financeiro, assinatura, cliente Asaas e lojas ainda será estudada.

Ainda não está definido se:

- a assinatura pertencerá à conta/proprietário;
- cada loja possuirá sua própria assinatura;
- uma assinatura poderá contemplar múltiplas lojas;
- haverá cobrança adicional por unidade.

Essas decisões deverão considerar também o relacionamento atual com asaasCustomerId e asaasSubscriptionId.

Nenhuma dessas possibilidades representa uma decisão arquitetural neste momento.

## MULTILOJA-A0 — Auditoria futura

A primeira etapa desta evolução será exclusivamente de descoberta da implementação atual.

O MULTILOJA-A0 deverá auditar as dependências da unicidade de CPF/CNPJ, incluindo:

- cadastro e criação de loja;
- locais onde CPF/CNPJ é gravado;
- locais onde CPF/CNPJ é consultado;
- validações de unicidade;
- relação usuário ↔ loja;
- funcionários e permissões;
- assinatura;
- integração com Asaas;
- regras de segurança e autorização.

Durante o MULTILOJA-A0 não deverá ser removida nem alterada a regra atual de unicidade de CPF/CNPJ.

Somente após essa auditoria serão propostas alternativas de arquitetura.

A arquitetura multiloja ainda NÃO foi decidida.
