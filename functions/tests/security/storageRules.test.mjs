import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

import {
  doc,
  setDoc,
} from "firebase/firestore";

import {
  ref,
  uploadString,
} from "firebase/storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ID = "store-connect-app";
const BUCKET_URL =
  "gs://store-connect-app.firebasestorage.app";

const STORAGE_RULES_PATH =
  path.resolve(
    __dirname,
    "../../../storage.rules",
  );

const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8080;

const STORAGE_HOST = "127.0.0.1";
const STORAGE_PORT = 9199;

const STORE_A = "store-a";
const STORE_B = "store-b";

const ACTIVE_UID = "user-active";
const REVOKED_UID = "user-revoked";

function upload(storage, objectPath) {
  return uploadString(
    ref(storage, objectPath),
    "storage-rules-test",
  );
}

async function expectAllow(
  label,
  operation,
) {
  await assertSucceeds(operation);

  console.log(
    `✅ ALLOW — ${label}`,
  );
}

async function expectDeny(
  label,
  operation,
) {
  await assertFails(operation);

  console.log(
    `✅ DENY  — ${label}`,
  );
}

let testEnv = null;

try {
  // ========================================================================
  // 1. AMBIENTE DE TESTE
  // ========================================================================

  testEnv =
    await initializeTestEnvironment({
      projectId: PROJECT_ID,

      firestore: {
        host: FIRESTORE_HOST,
        port: FIRESTORE_PORT,
      },

      storage: {
        host: STORAGE_HOST,
        port: STORAGE_PORT,

        rules: fs.readFileSync(
          STORAGE_RULES_PATH,
          "utf8",
        ),
      },
    });

  // ========================================================================
  // 2. ESTADO LIMPO
  // ========================================================================

  await testEnv.clearFirestore();
  await testEnv.clearStorage();

  // ========================================================================
  // 3. USERS/{uid}
  //
  // Gravamos os usuários sem passar por Security Rules.
  // ========================================================================

  await testEnv.withSecurityRulesDisabled(
    async (context) => {
      const db = context.firestore();

      await setDoc(
        doc(
          db,
          "users",
          ACTIVE_UID,
        ),
        {
          storeId: STORE_A,
          role: "operador",
          accessStatus: "active",
        },
      );

      await setDoc(
        doc(
          db,
          "users",
          REVOKED_UID,
        ),
        {
          storeId: STORE_A,
          role: "operador",
          accessStatus: "revoked",
        },
      );
    },
  );

  // ========================================================================
  // 4. CONTEXTOS DE AUTH
  // ========================================================================

  const activeStorage =
    testEnv
      .authenticatedContext(
        ACTIVE_UID,
      )
      .storage(BUCKET_URL);

  const revokedStorage =
    testEnv
      .authenticatedContext(
        REVOKED_UID,
      )
      .storage(BUCKET_URL);

  const anonymousStorage =
    testEnv
      .unauthenticatedContext()
      .storage(BUCKET_URL);

  const runId =
    Date.now().toString();

  // ========================================================================
  // 5. CAMINHOS LEGÍTIMOS DA PRÓPRIA LOJA
  // ========================================================================

  await expectAllow(
    "logo da própria loja",
    upload(
      activeStorage,
      `store_logos/${STORE_A}/logo-${runId}.jpg`,
    ),
  );

  await expectAllow(
    "QR Code PIX da própria loja",
    upload(
      activeStorage,
      `pix_qrcodes/${STORE_A}/pix-${runId}.png`,
    ),
  );

  await expectAllow(
    "categoria da própria loja",
    upload(
      activeStorage,
      `category_images/${STORE_A}/categoria-${runId}.jpg`,
    ),
  );

  await expectAllow(
    "produto da própria loja",
    upload(
      activeStorage,
      `product_images/${STORE_A}/produto-${runId}.jpg`,
    ),
  );

  // ========================================================================
  // 6. ACESSO CRUZADO ENTRE LOJAS
  // ========================================================================

  await expectDeny(
    "usuário da Loja A tentando gravar na Loja B",
    upload(
      activeStorage,
      `product_images/${STORE_B}/produto-${runId}.jpg`,
    ),
  );

  // ========================================================================
  // 7. FUNCIONÁRIO REVOGADO
  // ========================================================================

  await expectDeny(
    "funcionário revogado na própria loja",
    upload(
      revokedStorage,
      `product_images/${STORE_A}/revogado-${runId}.jpg`,
    ),
  );

  // ========================================================================
  // 8. NÃO AUTENTICADO
  // ========================================================================

  await expectDeny(
    "usuário não autenticado",
    upload(
      anonymousStorage,
      `store_logos/${STORE_A}/anonimo-${runId}.jpg`,
    ),
  );

  // ========================================================================
  // 9. BACKUP — BLOQUEIO ABSOLUTO PARA CLIENTE
  // ========================================================================

  await expectDeny(
    "cliente tentando acessar store_backups",
    upload(
      activeStorage,
      `store_backups/${STORE_A}/${runId}/snapshot.json.gz`,
    ),
  );

  console.log("");
  console.log(
    "✅ STORAGE RULES — 8/8 PASSARAM",
  );
} catch (error) {
  console.error("");
  console.error(
    "❌ STORAGE RULES — FALHA",
  );
  console.error(error);

  process.exitCode = 1;
} finally {
  if (testEnv) {
    await testEnv.cleanup();
  }
}
