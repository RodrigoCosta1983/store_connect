# F10 — Registro complementar das decisões aprovadas

Data: 16/10/2026. Fonte: solicitação F10-C2 de Rodrigo nesta sessão.
Complementa F10_ARQUITETURA_CONTRATOS.md e os resultados A/B/C1; não altera
esses registros históricos nem transforma suas propostas em decisões.

Rodrigo confirma C01–C09 aprovadas em 16/10/2026. O complemento da solicitação
F10-C2 forneceu o texto abaixo. Direção funcional não autoriza inventar
contratos adicionais ainda indefinidos.

## C01 — Preços

Preço-base definido no produto principal. Cada variante pode ter preço próprio
opcional; caso não tenha, herda o preço-base. Políticas detalhadas de desconto
ainda dependem de contrato específico.

## C02 — COD

- COD opcional no produto principal e nas variantes.
- Quando preenchido, único por loja entre todos os tipos de proprietários.
- Preservar normalização e regras F9, namespace productCodes e ownership.
- COD de item arquivado permanece reservado.
- Não reutilizar automaticamente códigos históricos.

Na criação F9, campo ausente é permitido; campo presente exige string.
Null não é aceito pelo contrato de criação. normalizeCod aplica trim e
uppercase, limite de 40 caracteres na representação normalizada. O helper
isolado aceita null/undefined como ausência, mas não substitui a validação
do comando. createProductContract F9 aceita string vazia e espaços: ambos
normalizam para vazio e omitem cod na entidade, sem reserva. C2 mantém essa
persistência e conserva no comando/receipt a string fornecida, inclusive
vazia/espaços, distinguindo-a da ausência. Null e undefined explícito são
rejeitados. Valores informados são persistidos na representação canônica F9.

## C05 — Combinações

- Somente combinações explicitamente escolhidas.
- Sem geração cartesiana automática.
- Combinações duplicadas proibidas.
- Combinações parciais continuam bloqueadas até definição explícita.
- Não deduzir nova autorização para combinações parciais.

## C07 — Limites

Os limites C1 são provisórios e defensivos. Não representam restrições
comerciais permanentes e não podem ser promovidos a esse status sem teste
de carga. Permanecem os limites locais atuais, sem ampliação nesta etapa.

## C03 — Imagens

Variantes herdam por padrão a imagem do produto principal, mas podem possuir
imagens próprias. Detalhes de múltiplas imagens e remoção explícita deverão
ser especificados sem alterar silenciosamente omitido/null/valor.

## C04 — Código de barras

Barcode opcional e independente do COD. O scanner não deve escolher
automaticamente um produto quando houver correspondências ambíguas.
Política de unicidade e resolução detalhada depende de implementação específica.

## C06 — Arquivamento

Permitir arquivamento individual de variantes, preservando seu estoque,
histórico e reserva de COD. Arquivar não significa excluir registros nem
liberar códigos automaticamente.

## C08 — Custo, fiscal e estoque mínimo

Dados de custo e fiscais comuns são herdados do produto principal. Exceções
específicas por variante devem ser explícitas, controladas e auditáveis.
O estoque mínimo pertence individualmente à variante.

## C09 — Conversão de tipo

Conversão entre produto simples e produto principal com variantes somente por
operação explícita, confirmada e validada como segura. Nunca redistribuir
estoque automaticamente. Respeitar históricos e pendências offline.

## Limitação dirigida encontrada no F9

productCodeReservation.prepareCodeChange libera a reserva antiga quando
oldCod difere de newCod. productCodeAtomic.emulator.test.js contém o cenário
"legacy reservation stays unchanged on edit, archive and restore; change
releases it", incluindo reutilização do COD anterior. Portanto, retenção
histórica global não é comprovada pelos writers atuais.

Writers V1/V2 e Rules estão fora do escopo C2 e devem permanecer intactos.
C2 deve ficar isolado no Emulator e não declarar segurança comercial global.
Não implementar troca/liberação de COD em F10-C2. Uma futura operação segura
exige contrato explícito de retenção histórica, compatibilidade de todos os
writers e barreiras aprovadas antes de ativação operacional.

## Aplicação local C2 e compatibilidade C1

createProductC2/createVariantC2 são entradas locais aditivas do serviço
productVariantsC1.js; C1 mantém sua rejeição original de COD. Comandos sem
COD conservam exatamente a canonicalização C1, incluindo os campos default
já existentes. Operações persistidas continuam createProductC1/createVariantC1,
schemaVersion=1 e auditLogs/f10-c1-SHA256([uid,requestId]). Não há namespace
alternativo para escapar de conflito ou duplicar uma intenção antiga.
As entradas C2 permitem replay C1 sem regravar receipt ou revalidar estado
mutável; autorização/revogação continua obrigatória antes do replay.

Reserva nova contém cod, ownerType, productId e variantId conforme F9.
Reserva ocupada, inclusive legada ou órfã, nunca é adotada/regravada na criação.
A verificação local transacional inclui produtos legados sem índice e
variantes de todos os produtos da loja, incluindo arquivados. Variante com
COD sem reserva íntegra bloqueia novas reservas até revisão explícita.
Não há reparo nem auditoria global. Essa varredura defensiva local tem custo
proporcional aos produtos/variantes/reservas: teste de carga e estratégia
operacional aprovada continuam gates, sem promessa de escala comercial.
