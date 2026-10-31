# Credencial Sandbox histórica — estado e limites

Inspeção do painel informada pelo proprietário em 31/10/2026:

| Entrada | Data informada | Estado |
| --- | --- | --- |
| StoreConnect_sandbox | 24/02/2026 | desabilitada |
| StoreConnect_sandbox V1 | 09/10/2026 | habilitada |
| StoreConnect-HML | 26/10/2026 | habilitada |

A primeira é a única cronologicamente compatível entre essas três entradas com a credencial já exposta em 07/03/2026. Ainda não há correspondência criptográfica ou administrativa definitiva. A indicação desabilitada não comprova exclusão permanente. Nenhuma chave pode ser alterada por inferência dessa cronologia.

O diagnóstico anterior confirmou que a chave exposta é Sandbox, difere das credenciais atuais PROD/HML e recebeu rejeição em 29/10. Resíduos em configurações antigas não foram removidos. Não testar a credencial exposta, não alterar Asaas PROD e não rotacionar outras chaves sem autorização específica.

Este ramo possui histórico novo e independente, sem a credencial ou ancestrais F7. Isso não remove o segredo das branches antigas do repositório remoto. Não misturar a higienização do histórico remoto com esta preparação.

## Gate para um futuro push

1. O proprietário deve escolher explicitamente esta alternativa independente, preservando o ramo F7 e a release local anterior.
2. Concluir a comprovação disponível sobre configurações de automação; a ausência de workflows neste ramo não é prova suficiente de ausência de integrações externas.
3. Confirmar ausência de divergência/colisão no nome remoto antes da operação autorizada. Não sobrescrever branch existente nem fazer force push.
4. Obter autorização específica para push somente deste ramo. Não fazer merge, tags extras ou deploy.

A pendência administrativa da chave permanece registrada. Nenhum segredo, fragmento ou hash de credencial foi incluído neste histórico.
