# P5.1.1-B4A — Firebase HML × PROD local

## Baseline

Branch: feat/f7-intelligent-catalog.
HEAD: 80ccc7a84665ac0db37ab2ff1c0f46172b58a2f7.
Stage vazio. Inventário e hashes de todos os arquivos modificados/untracked
registrados antes da implementação; baseline preexistente preservado.

SHA256 customer_receivables_screen.dart:
D3A039D431B32EFAE918D1AF6891B9DD0F27CA07D5405A59B143AB9E9173BFCD

SHA256 pdf_receipt_service.dart:
1CB239FF709EC5C5BC7F5C9A78812767AF86CAD5430F70387D9AC9C8EAB23A36

## Configuração

| Ambiente | Projeto | Flavor | URL pública |
| --- | --- | --- | --- |
| production | store-connect-app | prod | https://app.storeconnect.com.br |
| hml | store-connect-hml | hml | https://store-connect-hml.web.app |

Ambos mantêm applicationId com.storeeconnect.app, sem suffix.
Signing, versões e SDKs Android não mudaram. Uma instalação substitui a outra
no mesmo dispositivo.

Source sets exclusivos: android/app/src/prod/google-services.json e
android/app/src/hml/google-services.json. O JSON raiz foi movido para PROD
somente após confirmar a identidade ativa; não existe fallback raiz.
Configuração HML Android e configurações Web foram obtidas via Firebase CLI
apps:sdkconfig com --project explícito e conteúdo retido.
As opções Dart antigas foram desativadas.

| Ambiente | App Android | App Web |
| --- | --- | --- |
| PROD | 1:294766590074:android:f993b08bb3f300b2afe3c3 | 1:294766590074:web:fbe25231b8ef11d8afe3c3 |
| HML | 1:324469869942:android:4482c313ccd8c0e9ae7e57 | 1:324469869942:web:0d50059ae896f7e3ae7e57 |

AppEnvironment centraliza identidades e URLs. main_prod.dart e main_hml.dart
chamam o mesmo app_bootstrap.dart. main.dart falha em qualquer modo e apenas
reexporta MyApp para compatibilidade de imports. Não existe ambiente padrão.

Antes de inicializar Firebase Android, comparar appFlavor (API oficial Flutter)
e BuildConfig.FLAVOR (canal nativo) com o entrypoint. O canal lê somente
flavor/projectId/appId de FirebaseOptions.fromResource, sem expor opções.
Divergência ou canal indisponível rejeita a inicialização.
Após initializeApp, verificar projectId e App ID do app default, inclusive
quando já inicializado. Falhas impedem demais serviços/runApp e geram erro
sanitizado.

O guard não converte AAB HML em PROD. Como package e assinatura são iguais,
Play Console não distingue backend Firebase. Publicação futura deve selecionar
e verificar explicitamente o artefato PROD; não promover cegamente AAB HML.
Kotlin/Gradle e dispositivo ainda exigem validação futura autorizada.
Nenhum build foi executado nesta etapa.

Links de catálogo usam AppConfiguration.environment.publicBaseUrl.
Permanece https://www.storeconnect.com.br na tela de vendas: link institucional,
sem backend/catalogo HML equivalente. Links wa.me independem do ambiente.
Functions não foram alteradas.

## Pendências

- HML_STORAGE_CONFIG_REFRESH_REQUIRED = SIM. SDK configs retornam storageBucket,
  mas isso não comprova provisionamento. Valor oficial preservado; revalidar
  após criar Storage HML. Nenhum bucket criado nesta etapa.
- HML_IOS_NOT_CONFIGURED = SIM. Ambos os entrypoints rejeitam iOS.
  Runner/GoogleService-Info.plist não foi alterado.
- OAUTH_CONSOLE_CHECK_REQUIRED = SIM. Nenhum SHA, provider ou OAuth alterado.
- EMULATOR_REGRESSION = PENDING antes de deploy.
- App Check e demais serviços após bootstrap preservam comportamento existente;
  esta etapa não os prepara remotamente no HML.

## Comandos futuros — NÃO executados

    flutter build appbundle --flavor hml -t lib/main_hml.dart
    flutter build appbundle --flavor prod -t lib/main_prod.dart
    flutter build web -t lib/main_hml.dart
    flutter build web -t lib/main_prod.dart

## Testes locais

    flutter test --no-pub --flavor hml test/firebase_environment_test.dart
    dart analyze lib/firebase lib/main.dart lib/main_prod.dart lib/main_hml.dart lib/firebase_options.dart test/firebase_environment_test.dart
    git diff --check

Usar SDK referenciado por .dart_tool/package_config.json nesta máquina:
C:/Users/rodri/develop/flutter_3.32.6/bin. Flutter do PATH aponta para outro SDK
e falhou ao compilar o framework com esse package_config.
Não houve atualização de SDK/dependências.
FLUTTER_APP_FLAVOR é reservado; o runner recebe --flavor hml.

Testes simulam canal nativo e Firebase, sem conexões remotas ou Emulator.
Cobrem resolução, identidades, URLs, ausência de fallback, flavor divergente,
erro nativo sanitizado e projectId após initializeApp.

Referências oficiais:
- https://docs.flutter.dev/deployment/flavors
- https://firebase.google.com/docs/projects/multiprojects
## Resultado da validação

- 14/14 testes locais aprovados com SDK alinhado ao package_config.
- Analyze dos arquivos novos/entrypoints: sem ocorrências.
- Analyze ampliado com SDK alinhado: exit 0, 25 infos em linhas preservadas do código anterior; nenhum warning ou erro. O SDK do PATH reportou também um warning preexistente unawaited_return_in_try_block.
- git diff --check aprovado.
- 61 arquivos preexistentes conferidos por SHA256 e preservados.
- Dois hashes Dart conhecidos preservados; stage vazio; branch e HEAD iguais.
- Auditoria de escopo e padrões de credencial aprovada.
- Sem build, Emulator, mutação Firebase remota, commit, push ou deploy.