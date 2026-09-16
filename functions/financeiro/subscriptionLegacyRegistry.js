"use strict";

/**
 * Classifica a reserva de CPF/CNPJ usada pelo fluxo de assinatura.
 *
 * IMPORTANTE:
 * "require_financial_proof" NAO autoriza migracao.
 * Esse resultado apenas informa ao chamador que o registro e legado,
 * nao possui storeId e pertence a outro UID.
 *
 * O backend financeiro deve comprovar o vinculo da loja antes de
 * alterar esse registro.
 */
function classifySubscriptionCpfRegistry({
  exists,
  data,
  userId,
  storeId,
}) {
  const normalize = (value) =>
    String(value || "").trim();

  const currentUserId = normalize(userId);
  const currentStoreId = normalize(storeId);

  if (!currentUserId || !currentStoreId) {
    throw new Error(
      "userId e storeId atuais sao obrigatorios.",
    );
  }

  if (!exists) {
    return {
      action: "create",
      registeredUid: "",
      registeredStoreId: "",
    };
  }

  const registryData = data || {};

  const registeredUid =
    normalize(registryData.uid);

  const registeredStoreId =
    normalize(registryData.storeId);

  if (!registeredUid) {
    return {
      action: "reject",
      reason: "missing_uid",
      registeredUid,
      registeredStoreId,
    };
  }

  if (registeredStoreId) {
    if (
      registeredUid !== currentUserId ||
      registeredStoreId !== currentStoreId
    ) {
      return {
        action: "reject",
        reason: "ownership_conflict",
        registeredUid,
        registeredStoreId,
      };
    }

    return {
      action: "current",
      registeredUid,
      registeredStoreId,
    };
  }

  if (registeredUid === currentUserId) {
    return {
      action: "backfill_store_id",
      registeredUid,
      registeredStoreId: "",
    };
  }

  return {
    action: "require_financial_proof",
    registeredUid,
    registeredStoreId: "",
  };
}

/**
 * createAsaasSubscription comercializa Pro para novos casos.
 *
 * Para loja paga existente, entretanto, Business deve ser preservado
 * durante regularizacao/reconciliacao.
 */
function resolveExistingPaidSubscriptionType(
  subscriptionType,
) {
  const normalized =
    String(subscriptionType || "")
      .trim()
      .toLowerCase();

  if (normalized === "business") {
    return "business";
  }

  return "pro";
}

/**
 * Valida a prova financeira necessaria para migrar uma reserva
 * LEGADA de CPF/CNPJ pertencente a outro UID e sem storeId.
 *
 * IMPORTANTE:
 *
 * Esta funcao NAO consulta o Asaas e NAO altera nenhum dado.
 * Ela apenas valida objetos que o chamador obteve de fontes
 * oficiais.
 *
 * Para aprovacao automatica, o vinculo precisa existir ANTES
 * da migracao:
 *
 * store.document
 *   == customer.cpfCnpj
 *
 * store.asaasCustomerId
 *   == customer.id
 *   == subscription.customer
 *
 * store.asaasSubscriptionId
 *   == subscription.id
 *
 * customer.externalReference
 *   == subscription.externalReference
 *   == storeId
 *
 * A assinatura tambem precisa estar ACTIVE no Asaas, pois este
 * fluxo existe para regularizar uma assinatura paga ja existente,
 * e nao para reivindicar um vinculo financeiro historico encerrado.
 */
function evaluateLegacyFinancialProof({
  storeId,
  cleanDocument,
  storeData,
  customer,
  subscription,
}) {
  const normalizeText = (value) =>
    String(value || "").trim();

  const normalizeDocument = (value) =>
    normalizeText(value).replace(/\D/g, "");

  const expectedStoreId =
    normalizeText(storeId);

  const expectedDocument =
    normalizeDocument(cleanDocument);

  if (!expectedStoreId || !expectedDocument) {
    return {
      ok: false,
      reason: "invalid_context",
    };
  }

  const currentStoreData =
    storeData || {};

  const storeDocument =
    normalizeDocument(
      currentStoreData.document,
    );

  if (
    !storeDocument ||
    storeDocument !== expectedDocument
  ) {
    return {
      ok: false,
      reason: "store_document_mismatch",
    };
  }

  const expectedCustomerId =
    normalizeText(
      currentStoreData.asaasCustomerId,
    );

  const expectedSubscriptionId =
    normalizeText(
      currentStoreData.asaasSubscriptionId,
    );

  if (
    !expectedCustomerId ||
    !expectedSubscriptionId
  ) {
    return {
      ok: false,
      reason: "missing_official_financial_ids",
    };
  }

  if (
    normalizeText(customer?.id) !==
    expectedCustomerId
  ) {
    return {
      ok: false,
      reason: "customer_id_mismatch",
    };
  }

  if (
    normalizeDocument(customer?.cpfCnpj) !==
    expectedDocument
  ) {
    return {
      ok: false,
      reason: "customer_document_mismatch",
    };
  }

  if (
    normalizeText(
      customer?.externalReference,
    ) !== expectedStoreId
  ) {
    return {
      ok: false,
      reason:
        "customer_external_reference_mismatch",
    };
  }

  if (
    normalizeText(subscription?.id) !==
    expectedSubscriptionId
  ) {
    return {
      ok: false,
      reason: "subscription_id_mismatch",
    };
  }

  if (
    normalizeText(
      subscription?.externalReference,
    ) !== expectedStoreId
  ) {
    return {
      ok: false,
      reason:
        "subscription_external_reference_mismatch",
    };
  }

  if (
    normalizeText(subscription?.customer) !==
    expectedCustomerId
  ) {
    return {
      ok: false,
      reason: "subscription_customer_mismatch",
    };
  }

  if (
    normalizeText(subscription?.status)
      .toUpperCase() !== "ACTIVE"
  ) {
    return {
      ok: false,
      reason: "subscription_not_active",
    };
  }

  return {
    ok: true,
    customerId: expectedCustomerId,
    subscriptionId:
      expectedSubscriptionId,
  };
}

module.exports = {
  classifySubscriptionCpfRegistry,
  resolveExistingPaidSubscriptionType,
  evaluateLegacyFinancialProof,
};