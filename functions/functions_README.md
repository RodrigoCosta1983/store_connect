# Cloud Function: onProductDelete

O que este conjunto faz
- Quando um documento `stores/{storeId}/products/{productId}` é deletado do Firestore, a função `onProductDelete`
  tenta remover do Cloud Storage o arquivo apontado por `imagePath` (preferencial) ou `imageUrl` no documento.
- Em caso de falha, a função grava um registro em `_cleanup_errors` no Firestore para auditoria/manual cleanup.

Pré-requisitos
- Firebase CLI (v>=11)
  - Instalação: `npm install -g firebase-tools`
- Estar logado no Firebase: `firebase login`
- Projeto Firebase já inicializado; se ainda não inicializou a pasta `functions`, execute `firebase init functions`
  - Escolha JavaScript (ou TypeScript se preferir adaptar).
- Node 18 (recomendado, configurado no engines do package.json)

Como instalar / preparar
1. Copie os arquivos `index.js` e `package.json` para a pasta `functions/` do seu projeto Firebase.
2. No terminal:
   cd functions
   npm install

Conceder permissões (importante)
- A Service Account usada pelas Cloud Functions precisa de permissão para deletar objetos no bucket.
- Tipicamente a service account padrão é: `<PROJECT_ID>@appspot.gserviceaccount.com`
- Para garantir, atribua a role `roles/storage.objectAdmin` (ou `roles/storage.admin`) à service account:
  ```bash
  gcloud projects add-iam-policy-binding <PROJECT_ID> \
    --member="serviceAccount:<PROJECT_ID>@appspot.gserviceaccount.com" \
    --role="roles/storage.objectAdmin"
  ```
  (Substitua `<PROJECT_ID>` pelo ID do seu projeto.)

Como testar localmente (emulador)
- Recomendo usar os emuladores (Firestore + Functions + Storage) para testar sem tocar produção:
  1. No diretório do projeto (onde está firebase.json), inicie:
     firebase emulators:start --only firestore,functions,storage
  2. No emulador, crie um documento produto com `imagePath` que aponte para um arquivo do Storage emulado (ou faça upload via emulador).
  3. Delete o documento e verifique logs das functions no terminal para confirmar que o arquivo foi removido.

Como fazer o deploy
- Para fazer deploy apenas desta função:
  ```bash
  cd functions
  npm install
  cd ..
  firebase deploy --only functions:onProductDelete
  ```
- Para fazer deploy de todas as functions:
  firebase deploy --only functions

Observações e boas práticas
- O código tenta lidar com three common formats:
  - `imagePath` relativo (ex: `stores/<storeId>/products/<productId>/photo_123.webp`)
  - `gs://<bucket>/path/to/object`
  - `downloadURL` do Firebase Storage (a função tenta extrair o caminho codificado)
- A função grava erros em `_cleanup_errors` no Firestore caso a deleção falhe — útil para monitoramento/manual cleanup.
- Em produção, considere:
  - Configurar alertas (Cloud Monitoring) se `_cleanup_errors` crescer.
  - Ter uma rotina agendada (Cloud Scheduler + Function) para garimpar arquivos órfãos periodicamente.
  - Fornecer um script admin para limpar órfãos em lote com critérios (idade, prefixo).

Se quiser, eu também:
- gero uma função adicional agendada (`cleanupOrphans`) para varredura periódica de arquivos órfãos (ex.: que não possuam documento referenciando `imagePath`) — útil como safety net;
- ou adapto a função para mover arquivos para uma pasta `quarantine/` ao invés de deletar diretamente (útil para rollback).
