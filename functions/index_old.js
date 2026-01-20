/**
 * Cloud Function: onProductDelete
 * - Trigger: firestore.document('stores/{storeId}/products/{productId}').onDelete
 * - O que faz: quando um produto é deletado, busca imagePath (ou imageUrl) no documento antes de deletar
 *   e tenta remover o arquivo correspondente do Cloud Storage.
 *
 * Observações:
 * - imagePath esperado: storage path relativo, ex: "stores/<storeId>/products/<productId>/photo_12345.webp"
 * - Se imagePath vier como URL pública (downloadURL), a função tenta extrair o caminho armazenado após "/o/".
 * - A função registra logs detalhados para facilitar debug.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const REGION = 'us-central1'; // ajuste se preferir outra região

exports.onProductDelete = functions
  .region(REGION)
  .firestore
  .document('stores/{storeId}/products/{productId}')
  .onDelete(async (snap, context) => {
    const deletedData = snap.data();
    const storeId = context.params.storeId;
    const productId = context.params.productId;

    if (!deletedData) {
      console.log(`[onProductDelete] Documento vazio para stores/${storeId}/products/${productId}. Nada a fazer.`);
      return null;
    }

    // Prioriza imagePath (caminho no Storage). Se não existir, tenta imageUrl.
    let imageRefValue = deletedData.imagePath ?? deletedData.imageUrl ?? null;
    if (!imageRefValue) {
      console.log(`[onProductDelete] Nenhuma imagem associada ao produto ${productId}. Nada a deletar.`);
      return null;
    }

    const bucket = admin.storage().bucket(); // bucket padrão do projeto
    let filePath = null;

    try {
      // Caso seja um gs://... path -> extrai o caminho interno
      if (String(imageRefValue).startsWith('gs://')) {
        // gs://<bucket-name>/path/to/object
        filePath = String(imageRefValue).replace(/^gs:\/\/[^\/]+\/?/, '');
        console.log(`[onProductDelete] imageRefValue é gs:// -> filePath: ${filePath}`);
      }
      // Caso seja uma URL de download do Storage (padrão firebase storage), extrair segmento após /o/
      else if (String(imageRefValue).startsWith('http')) {
        try {
          const url = new URL(String(imageRefValue));
          const m = url.pathname.match(/\/o\/([^?]+)/); // captura o caminho codificado entre /o/ e ?
          if (m && m[1]) {
            filePath = decodeURIComponent(m[1]);
            console.log(`[onProductDelete] Extraído filePath da URL: ${filePath}`);
          } else {
            // algumas URLs podem ser do tipo /v0/b/<bucket>/o/<path>
            const altMatch = url.pathname.match(/\/v0\/b\/[^\/]+\/o\/(.+)/);
            if (altMatch && altMatch[1]) {
              filePath = decodeURIComponent(altMatch[1].split('?')[0]);
              console.log(`[onProductDelete] Extraído (alt) filePath da URL: ${filePath}`);
            }
          }
        } catch (err) {
          console.warn(`[onProductDelete] Falha ao analisar URL: ${err}`);
        }
      } else {
        // Assume que já é o path relativo (ex: stores/.../file.webp)
        filePath = String(imageRefValue);
        console.log(`[onProductDelete] imageRefValue tratado como path relativo: ${filePath}`);
      }

      if (!filePath) {
        console.log(`[onProductDelete] Não foi possível determinar filePath para: ${imageRefValue}`);
        return null;
      }

      const file = bucket.file(filePath);

      const [exists] = await file.exists();
      if (!exists) {
        console.log(`[onProductDelete] Arquivo não existe no bucket: ${filePath}`);
        return null;
      }

      await file.delete();
      console.log(`[onProductDelete] Arquivo deletado com sucesso: ${filePath}`);
      return null;
    } catch (error) {
      console.error(`[onProductDelete] Erro ao tentar deletar arquivo para produto ${productId} (store: ${storeId}):`, error);

      // Opcional: você pode salvar um log persistente em Firestore para retrial/manual cleanup
      try {
        const errorDoc = {
          storeId,
          productId,
          imageRefValue: String(imageRefValue),
          error: String(error),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };
        await admin.firestore().collection('_cleanup_errors').add(errorDoc);
        console.log('[onProductDelete] Log de erro gravado em _cleanup_errors.');
      } catch (err2) {
        console.error('[onProductDelete] Falha ao gravar log de erro em _cleanup_errors:', err2);
      }

      return null;
    }
  });