# F9 A5 — plano separado de transição de writers

Data: 14/10/2026. **PLANEJAMENTO — NÃO EXECUTADO.**
Esta etapa implementa só núcleo local aditivo; nenhuma autorização de deploy,
escrita remota, bloqueio de V1, mudança Rules ou migração de vendas é inferida.

## 1. Gates anteriores ao corte

Concluir getProductEditState com projeção e versão do MESMO snapshot, serviço
de recuperação de resultado autenticado e cliente que envia dirty fields.
Não misturar snapshot de stream antigo com token recém-buscado.
Separar Salvar cadastro/Ajustar estoque; implementar pendência por ambiente/
uid/loja/operação, payload congelado, retry e revisão de conflitos.
Upload reutiliza referência da mesma tentativa, sem promessa de transação
entre Storage/Firestore. Validar Web e Android com Flutter 3.32.6.

Confirmar clientes distribuídos/externos e todos os writers Admin/diretos.
Busca no repositório não prova ausência de ferramentas externas.

## 2. Migrar os dois fluxos de venda direta

1. payment_options_sheet.dart: venda online transacional cliente.
2. confirm_fiado_dialog.dart: batch de venda a prazo/decremento de quantidade.

Mapear papel/autorização, assinatura, localSaleId, preço/custo histórico,
descontos, cliente, parcelas/vencimentos, isPaid, cash_flow, FIFO, arquivados,
NFC-e, timeout e fila offline. Fazer matriz antes/depois com fixtures.
Não copiar payload de um fluxo sobre outro ou alterar regra financeira.

Avaliar adapter/backend de venda com helpers reutilizáveis, mantendo venda
e baixa na mesma transação. syncOfflineSale atual aceita somente proprietário
e usa contrato próprio de venda offline; redirecionar todos os operadores/
fiado para ela sem adaptar contrato quebraria permissões/parcelamento.
Diferença financeira ou autorização nova exige proposta explícita.

ID estável de venda, receipt/hash ou contrato equivalente validado: replay
não baixa novamente nem duplica venda/parcelas/caixa. Erro fiscal posterior
não deve desfazer venda confirmada. Operação de ajuste não substitui venda.
Testar corridas real online/offline/ajuste/edição, FIFO, legado, stock baixo,
perda de resposta e custo histórico. Nenhuma dessas migrações ocorreu agora.

## 3. Preparar bloqueio V1 sem perder replays

Manter validador, normalização, namespace e hash de receipts V1 intactos.
Revalidar autenticação/perfil/loja/revogação antes do replay.
Receipt correspondente retorna confirmação antes de versão/estado mutável.
Reutilização conflitante continua rejeitada.

Gate futuro: sem receipt confirmado, rejeitar nova escrita V1 com
failed-precondition/client-upgrade-required, ANTES de produto/reservas.
Não preencher stock defaults, reinterpretar V1 como patch nem copiar receipt
V1 para V2. Cliente antigo recebe indisponibilidade de edição explicitamente.
Testar operação V1 já confirmada, em voo, sem receipt, receipt divergente,
produto alterado/arquivado depois, perfil revogado e troca de loja.

Não expirar auditLogs de idempotência no rollout. Política de retenção e
continuidade após restore deve ser aprovada separadamente.

## 4. Coordenar backend, Rules e clientes

Após gates locais e novas autorizações, registrar artefato/whitelist e baseline
remoto de HML somente leitura, verificando identidade, região, runtime,
dependências, Storage e guard/codebase bootstrap. Default Firebase local é
PROD: comandos futuros sempre com alvo explícito store-connect-hml.

Janela sem escritas é necessária: deploy de serviços/cliente não é atômico.
Preparar pacote compatível e clientes antes do corte. Ordem planejada:

1. Suspender writes operacionais durante a janela; conferir operações em voo.
2. Rules completas revisadas, negando writes diretos em products/productCodes;
   conferir matches sobrepostos e preservação de leitura/outras coleções.
3. Backend seletivo compatível: venda autoritativa, V2/ajuste/read/result e
   gate V1 para novos writes, com archive/restore/COD/taxonomia compatíveis.
   Não publicar bootstrap, financeiros, schedulers ou F10 incidentalmente.
4. Cliente HML compatível por último; nenhuma edição por versão antiga.
5. Smoke tests sintéticos HML somente com autorização de escrita específica:
   V1 replay/negação, V2, stock, vendas, roles, lojas, retry, COD e legado.
6. Abrir writes após resultados e monitorar conflitos/contenção/erros.

Se qualquer componente/cliente ainda exigir write direto, não abrir a janela
nem relaxar Rules para obter compatibilidade aparente. A disponibilidade de
clientes antigos para editar não é preservada no corte definitivo.

## 5. Rollback sem reabrir operações inseguras

Preparar antes do corte um pacote de contenção: suspende novas mutações, mantém
leitura e replays válidos, Rules endurecidas e reservas existentes.
Cada operação remota depende de autorização própria imediatamente antes.

Falha de cliente: suspender edição/vendas novas conforme impacto e distribuir
cliente compatível com o backend seguro. Não voltar ao cliente que escreve
diretamente e reabrir Rules para fazê-lo funcionar.

Falha de backend: manter gate V1/Rules, reimplantar versão compatível ou
correção mínima. Baseline HML antes inventariado não tinha essas Functions;
não presumir versão anterior segura disponível para rollback.

Se COD já foi gravado, não apagar reservas, voltar ao ruleset permissivo,
habilitar V1 inseguro nem usar restore de backup como rollback de dados.
Writes podem ficar suspensos até correção; disponibilidade não pode ser
obtida sacrificando integridade. Operações confirmadas mantêm receipts.
Eventual correção de dados exige inventário e autorização separada.

## 6. Restore e condição de liberação

Alternativa B mantém executor bloqueado antes do primeiro commit. Aviso visual
e adaptação rastreável das 46 falhas são etapa separada; não apagar histórico,
alterar backup seguro ou reabilitar materialização durante migração de writers.

Liberação depende de paridade financeira, cliente migrado, Rules finais,
gate V1 testado, ausência de writers fora do contrato, infraestrutura pronta
e rollback ensaiado localmente. Núcleo V2 aprovado no Emulator sozinho não
significa que clientes atuais estejam protegidos ou que HML esteja liberado.

## 7. Refinamento após inventário local — sem corte

Inventário completo das fontes examinadas, matriz, retries, updateTime,
operações em voo e testes pendentes:
[F9_A5_INVENTARIO_WRITERS.md](F9_A5_INVENTARIO_WRITERS.md).

Antes da janela do item 4, preparar barreira backend-only lida DENTRO das
transações de todos os writers envolvidos e comprovar drenagem das revisões
antigas que não a leem. Hoje archive/restore leem perfil/loja antes da
transação: flag fora dela não fornece barreira serializada. Endereço/estados/
operador/proteção Rules desse controle exigem contrato antes de implementação.
Não considerar bloqueio UI, deploy concluído ou timeout cliente como drenagem.

Revisar também criação direta de sales: negar produto não fecha addOrder
latente nem outros creates de sale sem produto. Preservar updates legítimos
de pagamentos/caixa; não aplicar deny indiscriminado ao domínio financeiro.

Retry online recria saleId ao reinvocar o método; fiado cria novo ID por envio.
syncOfflineSale deduplica existência por localSaleId, mas não compara hash do
comando, é owner-only e usa isPaid=true. Esses pontos impedem redirecionamento
automático das vendas diretas e precisam de contrato/testes próprios.

Ledger de produto não pode reutilizar PendingSales por suposição: consultas
atuais não particionam conta/ambiente/loja, e Web não inicializa essa fila.
Preservar backlog e identidades; não converter pendência V1 em requestId V2.
Este refinamento é diagnóstico/plano: V1, writers e Rules continuam intactos.
