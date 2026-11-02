# Web 1.0.6+50 — BUG 01E

Base: `c8791309a969ca4fa2ec57ed58c9e4cdf6d5e54e` (histórico independente, sem F7).

Fechar a pesquisa desmontava/recriava o indicador da AppBar. Na Web, isso tentava reassinar o mesmo stream de assinatura única e lançava `Stream has already been listened to`. O indicador agora permanece montado com `Offstage`; o X continua fechando e limpando a busca. Nenhuma lógica comercial foi alterada.

Validação anterior: 5 testes dirigidos; Chrome desktop/mobile com ponteiro real, 112 verificações; aprovação manual do proprietário em 02/11/2026. O sintoma Android permanece separado.

Já publicado no Hosting em 02/11/2026:
- Release: `sites/store-connect-app/releases/1793598216044000`
- Versão: `sites/store-connect-app/versions/df8f4b65862984fc`
- Main JS: `e6b0df3c94a2b64f0f10e88ebea0a2757b061cad2150f321e64399c19b8a9a82`
- 54/54 arquivos HTTP/hash; abertura do login conferida sem operações financeiras.

SHA-256 do fonte corrigido: `bdd0a3cbf1ac084a93bfb3d3c27f919896ab92e5455193d1d4b9b20130a8fb41`.

O manifesto/README existentes descrevem a captura histórica c879, preservada. O delta desta branch é apenas `app/lib/screens/sales/new_sale_screen.dart` e esta nota; o hash acima identifica a exceção aprovada ao manifesto-base. Nenhum build, fixture ou credencial foi incluído. Este registro Git não executa deploy.
