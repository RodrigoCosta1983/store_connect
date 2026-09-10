/**
 * ============================================================================
 * STORE CONNECT - BOOTSTRAP SEGURO DE LOJA
 * ============================================================================
 *
 * Arquivo:
 *   functions/auth/bootstrapStore.js
 *
 * Objetivo:
 *   Criar a primeira loja de um usuário autenticado sem permitir que o Flutter
 *   escolha diretamente campos de autoridade como role, ownerId, storeId,
 *   subscriptionStatus ou trialEndDate.
 *
 * Responsabilidades:
 *   - validar autenticação;
 *   - normalizar nome, telefone e CPF/CNPJ recebidos;
 *   - impedir um mesmo UID de criar uma segunda loja;
 *   - reservar CPF/CNPJ atomicamente em cpfs_cadastrados;
 *   - criar stores/{storeId};
 *   - vincular users/{uid} à nova loja como admin;
 *   - iniciar o trial usando o relógio do servidor;
 *   - registrar auditLog server-side.
 *
 * Segurança:
 *   - o UID do proprietário vem exclusivamente de request.auth.uid;
 *   - role é sempre "admin" e é definida somente pelo backend;
 *   - subscriptionStatus é sempre "trial";
 *   - subscriptionType é sempre "free";
 *   - trialEndDate é calculado no servidor;
 *   - a reserva do CPF/CNPJ e a criação da loja acontecem na mesma transação;
 *   - o cliente não informa storeId nem ownerId.
 *
 * Compatibilidade:
 *   - o documento users/{uid} pode já existir (cadastro por e-mail) ou ainda
 *     não existir (primeiro login/cadastro via Google);
 *   - dados de perfil existentes são preservados com merge.
 *
 * Manutenção:
 *   - não mover a definição de role/status/trial para o Flutter;
 *   - não substituir a transação por writes independentes;
 *   - não permitir criação de segunda loja por este endpoint sem uma regra de
 *     produto específica para multi-loja;
 *   - alterações de assinatura após o bootstrap pertencem ao backend financeiro.
 * ============================================================================
 */

"use strict";

const admin = require("firebase-admin");
const {
  onCall,
  HttpsError,
} = require("firebase-functions/v2/https");

const TRIAL_DAYS = 7;
const TRIAL_DURATION_MS =
  TRIAL_DAYS * 24 * 60 * 60 * 1000;

function normalizeString(value) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function buildPublicSlugBase(value) {
  const normalized = normalizeString(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");

  return normalized || "loja";
}

function onlyDigits(value) {
  return String(value ?? "")
    .replace(/\D/g, "");
}

function normalizePhone(value) {
  return onlyDigits(value);
}

function isValidDocumentLength(document) {
  return document.length === 11 ||
    document.length === 14;
}

function safeUsernameFromAuth(authToken) {
  const name = normalizeString(authToken?.name);
  if (name) {
    return name;
  }

  const email = normalizeString(authToken?.email);
  if (email.includes("@")) {
    return email.split("@")[0];
  }

  return "usuario";
}

const bootstrapStore = onCall(
  {
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Usuário não autenticado.",
      );
    }

    const uid = request.auth.uid;

    const name = normalizeString(
      request.data?.name,
    );

    const phone = normalizePhone(
      request.data?.phone,
    );

    const document = onlyDigits(
      request.data?.document,
    );

    if (!name) {
      throw new HttpsError(
        "invalid-argument",
        "Informe o nome da loja.",
      );
    }

    if (name.length > 120) {
      throw new HttpsError(
        "invalid-argument",
        "O nome da loja é muito longo.",
      );
    }

    if (!phone) {
      throw new HttpsError(
        "invalid-argument",
        "Informe o telefone da loja.",
      );
    }

    if (!isValidDocumentLength(document)) {
      throw new HttpsError(
        "invalid-argument",
        "CPF/CNPJ deve possuir 11 ou 14 dígitos.",
      );
    }

    const db = admin.firestore();

    const userRef =
      db.collection("users").doc(uid);

    const cpfRef =
      db.collection("cpfs_cadastrados").doc(document);

    // O ID nasce no backend. O Flutter nunca escolhe o storeId.
    const storeRef =
      db.collection("stores").doc();

    const publicSlugBase =
      buildPublicSlugBase(name);

    const publicSlugBaseRef =
      db.collection("storePublicSlugs").doc(publicSlugBase);

    const publicSlugFallback =
      `${publicSlugBase}-${storeRef.id}`;

    const publicSlugFallbackRef =
      db.collection("storePublicSlugs").doc(publicSlugFallback);

    const auditRef =
      storeRef.collection("auditLogs").doc();

    // Date.now() é executado no ambiente da Cloud Function, portanto não usa
    // o relógio do celular do usuário.
    const nowMillis = Date.now();

    const trialEndDate =
      admin.firestore.Timestamp.fromMillis(
        nowMillis + TRIAL_DURATION_MS,
      );

    let createdStoreId = null;
    let createdPublicSlug = null;

    await db.runTransaction(
      async (transaction) => {
        // Todas as leituras vêm antes das escritas.
        const userSnapshot =
          await transaction.get(userRef);

        const cpfSnapshot =
          await transaction.get(cpfRef);

        const publicSlugBaseSnapshot =
          await transaction.get(publicSlugBaseRef);

        const publicSlugFallbackSnapshot =
          await transaction.get(publicSlugFallbackRef);

        const userData =
          userSnapshot.exists
            ? userSnapshot.data() || {}
            : {};

        const existingStoreId =
          normalizeString(userData.storeId);

        const accessStatus =
          normalizeString(
            userData.accessStatus,
          ).toLowerCase();

        if (accessStatus === "revoked") {
          throw new HttpsError(
            "permission-denied",
            "Este usuário não pode criar uma loja.",
          );
        }

        if (existingStoreId) {
          throw new HttpsError(
            "already-exists",
            "Este usuário já possui uma loja vinculada.",
          );
        }

        if (cpfSnapshot.exists) {
          throw new HttpsError(
            "already-exists",
            "Este CPF/CNPJ já possui uma loja cadastrada no sistema.",
          );
        }

        let publicSlug;
        let publicSlugRef;

        if (!publicSlugBaseSnapshot.exists) {
          publicSlug = publicSlugBase;
          publicSlugRef = publicSlugBaseRef;
        } else if (!publicSlugFallbackSnapshot.exists) {
          publicSlug = publicSlugFallback;
          publicSlugRef = publicSlugFallbackRef;
        } else {
          throw new HttpsError(
            "already-exists",
            "N\u00e3o foi poss\u00edvel reservar uma URL p\u00fablica para esta loja.",
          );
        }

        const serverTimestamp =
          admin.firestore.FieldValue.serverTimestamp();

        transaction.set(
          storeRef,
          {
            name,
            publicSlug,
            phone,
            document,

            ownerId: uid,

            createdAt: serverTimestamp,

            subscriptionStatus: "trial",
            subscriptionType: "free",

            trialStartedAt: serverTimestamp,
            trialEndDate,

            subscriptionStatusUpdatedAt:
              serverTimestamp,
            subscriptionStatusUpdatedBy:
              "system:bootstrapStore",
          },
        );

        transaction.set(
          publicSlugRef,
          {
            storeId: storeRef.id,
            publicSlug,
            createdAt: serverTimestamp,
            createdBy: "system:bootstrapStore:publicSlug",
          },
        );

        const userPatch = {
          storeId: storeRef.id,
          phone,
          role: "admin",
          accessStatus: "active",
        };

        // Cadastro via Google pode chegar aqui sem users/{uid}.
        if (!userSnapshot.exists) {
          userPatch.email =
            normalizeString(
              request.auth.token?.email,
            );

          userPatch.username =
            safeUsernameFromAuth(
              request.auth.token,
            );

          userPatch.createdAt =
            serverTimestamp;
        }

        transaction.set(
          userRef,
          userPatch,
          { merge: true },
        );

        transaction.set(
          cpfRef,
          {
            document,
            storeId: storeRef.id,
            uid,

            // Mantemos os dois nomes por compatibilidade com registros legados.
            createdAt: serverTimestamp,
            cadastradoEm: serverTimestamp,

            motivo:
              "Bootstrap inicial da loja",
          },
        );

        transaction.set(
          auditRef,
          {
            action: "store_created",
            entityType: "store",
            entityId: storeRef.id,
            storeId: storeRef.id,

            performedBy: {
              uid,
              role: "admin",
            },

            reason:
              "initial_store_bootstrap",

            before: null,

            after: {
              ownerId: uid,
              subscriptionStatus: "trial",
              subscriptionType: "free",
              trialEndDate,
            },

            createdAt: serverTimestamp,
          },
        );

        createdStoreId = storeRef.id;
        createdPublicSlug = publicSlug;
      },
    );

    console.log(
      "[bootstrapStore] Loja criada com sucesso.",
      {
        uid,
        storeId: createdStoreId,
        publicSlug: createdPublicSlug,
      },
    );

    return {
      success: true,
      storeId: createdStoreId,
      publicSlug: createdPublicSlug,
      subscriptionStatus: "trial",
      subscriptionType: "free",
      trialDays: TRIAL_DAYS,
    };
  },
);

module.exports = {
  bootstrapStore,
};
