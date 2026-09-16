"use strict";

const assert = require("assert");

const {
  classifySubscriptionCpfRegistry,
  resolveExistingPaidSubscriptionType,
  evaluateLegacyFinancialProof,
} = require(
  "../../financeiro/subscriptionLegacyRegistry",
);

function classify({
  exists = true,
  uid,
  registryStoreId,
  userId = "owner-atual",
  storeId = "store-atual",
}) {
  return classifySubscriptionCpfRegistry({
    exists,
    data: {
      uid,
      storeId: registryStoreId,
    },
    userId,
    storeId,
  });
}

function run() {
  // ============================================================
  // CPF/CNPJ - REGISTRO NOVO
  // ============================================================

  assert.deepStrictEqual(
    classifySubscriptionCpfRegistry({
      exists: false,
      data: null,
      userId: "owner-atual",
      storeId: "store-atual",
    }),
    {
      action: "create",
      registeredUid: "",
      registeredStoreId: "",
    },
  );

  // ============================================================
  // CPF/CNPJ - FORMATO ATUAL CORRETO
  // ============================================================

  assert.strictEqual(
    classify({
      uid: "owner-atual",
      registryStoreId: "store-atual",
    }).action,
    "current",
  );

  // ============================================================
  // LEGADO MESMO UID:
  // mesmo UID + storeId legado ausente
  // ============================================================

  const sameOwnerLegacy = classify({
    uid: "owner-atual",
    registryStoreId: undefined,
  });

  assert.strictEqual(
    sameOwnerLegacy.action,
    "backfill_store_id",
  );

  assert.strictEqual(
    sameOwnerLegacy.registeredUid,
    "owner-atual",
  );

  // ============================================================
  // LEGADO UID DIFERENTE:
  // UID antigo + storeId legado ausente
  //
  // NAO AUTORIZA MIGRACAO.
  // Exige prova financeira posterior.
  // ============================================================

  const oldOwnerLegacy = classify({
    uid: "owner-antigo",
    registryStoreId: undefined,
  });

  assert.strictEqual(
    oldOwnerLegacy.action,
    "require_financial_proof",
  );

  assert.strictEqual(
    oldOwnerLegacy.registeredUid,
    "owner-antigo",
  );

  // ============================================================
  // CONFLITOS DEVEM CONTINUAR BLOQUEADOS
  // ============================================================

  assert.strictEqual(
    classify({
      uid: "outro-owner",
      registryStoreId: "store-atual",
    }).action,
    "reject",
  );

  assert.strictEqual(
    classify({
      uid: "owner-atual",
      registryStoreId: "outra-store",
    }).action,
    "reject",
  );

  assert.strictEqual(
    classify({
      uid: "outro-owner",
      registryStoreId: "outra-store",
    }).action,
    "reject",
  );

  // Registro existente sem UID nunca pode ser reivindicado.
  const missingUid = classify({
    uid: "",
    registryStoreId: undefined,
  });

  assert.strictEqual(
    missingUid.action,
    "reject",
  );

  assert.strictEqual(
    missingUid.reason,
    "missing_uid",
  );

  // Normalizacao de espacos.
  assert.strictEqual(
    classifySubscriptionCpfRegistry({
      exists: true,
      data: {
        uid: " owner-atual ",
        storeId: " store-atual ",
      },
      userId: "owner-atual",
      storeId: "store-atual",
    }).action,
    "current",
  );

  // Contexto atual incompleto deve falhar fechado.
  assert.throws(
    () =>
      classifySubscriptionCpfRegistry({
        exists: true,
        data: {
          uid: "owner-atual",
        },
        userId: "",
        storeId: "store-atual",
      }),
    /obrigatorios/,
  );

  // ============================================================
  // PRESERVACAO DO PLANO PAGO EXISTENTE
  // ============================================================

  assert.strictEqual(
    resolveExistingPaidSubscriptionType("business"),
    "business",
  );

  assert.strictEqual(
    resolveExistingPaidSubscriptionType(" BUSINESS "),
    "business",
  );

  assert.strictEqual(
    resolveExistingPaidSubscriptionType("pro"),
    "pro",
  );

  assert.strictEqual(
    resolveExistingPaidSubscriptionType("trial"),
    "pro",
  );

  assert.strictEqual(
    resolveExistingPaidSubscriptionType("free"),
    "pro",
  );

  assert.strictEqual(
    resolveExistingPaidSubscriptionType(""),
    "pro",
  );

  assert.strictEqual(
    resolveExistingPaidSubscriptionType(null),
    "pro",
  );

  // ============================================================
  // LEGADO UID DIFERENTE - PROVA FINANCEIRA ESTRITA
  // ============================================================

  const financialStoreId =
    "store-h-carl";

  const financialDocument =
    "13033337759";

  const financialStoreData = {
    document: financialDocument,
    asaasCustomerId:
      "cus_LEGADO UID DIFERENTE",
    asaasSubscriptionId:
      "sub_LEGADO UID DIFERENTE",
  };

  const financialCustomer = {
    id: "cus_LEGADO UID DIFERENTE",
    cpfCnpj: "130.333.377-59",
    externalReference:
      financialStoreId,
  };

  const financialSubscription = {
    id: "sub_LEGADO UID DIFERENTE",
    customer: "cus_LEGADO UID DIFERENTE",
    externalReference:
      financialStoreId,
    status: "ACTIVE",
  };

  assert.deepStrictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer:
        financialCustomer,
      subscription:
        financialSubscription,
    }),
    {
      ok: true,
      customerId: "cus_LEGADO UID DIFERENTE",
      subscriptionId: "sub_LEGADO UID DIFERENTE",
    },
  );

  // Customer sem externalReference NAO serve como prova.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer: {
        ...financialCustomer,
        externalReference: "",
      },
      subscription:
        financialSubscription,
    }).reason,
    "customer_external_reference_mismatch",
  );

  // Customer apontando para outra loja.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer: {
        ...financialCustomer,
        externalReference:
          "outra-store",
      },
      subscription:
        financialSubscription,
    }).reason,
    "customer_external_reference_mismatch",
  );

  // CPF/CNPJ do customer precisa coincidir.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer: {
        ...financialCustomer,
        cpfCnpj:
          "00000000000",
      },
      subscription:
        financialSubscription,
    }).reason,
    "customer_document_mismatch",
  );

  // Assinatura precisa ser exatamente a salva na loja.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer:
        financialCustomer,
      subscription: {
        ...financialSubscription,
        id: "sub_outra",
      },
    }).reason,
    "subscription_id_mismatch",
  );

  // Assinatura precisa apontar para a mesma loja.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer:
        financialCustomer,
      subscription: {
        ...financialSubscription,
        externalReference:
          "outra-store",
      },
    }).reason,
    "subscription_external_reference_mismatch",
  );

  // Assinatura precisa pertencer ao customer oficial.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer:
        financialCustomer,
      subscription: {
        ...financialSubscription,
        customer:
          "cus_outro",
      },
    }).reason,
    "subscription_customer_mismatch",
  );

  // Neste fluxo automatico, assinatura encerrada nao prova
  // um vinculo financeiro atualmente regularizavel.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData:
        financialStoreData,
      customer:
        financialCustomer,
      subscription: {
        ...financialSubscription,
        status: "INACTIVE",
      },
    }).reason,
    "subscription_not_active",
  );

  // O documento canonico da loja tambem precisa coincidir.
  assert.strictEqual(
    evaluateLegacyFinancialProof({
      storeId: financialStoreId,
      cleanDocument:
        financialDocument,
      storeData: {
        ...financialStoreData,
        document:
          "00000000000",
      },
      customer:
        financialCustomer,
      subscription:
        financialSubscription,
    }).reason,
    "store_document_mismatch",
  );
  console.log("");
  console.log(
    "✅ subscriptionLegacyRegistry: todos os testes passaram",
  );
  console.log(
    "✅ LEGADO MESMO UID: backfill_store_id",
  );
  console.log(
    "✅ LEGADO UID DIFERENTE: require_financial_proof",
  );
  console.log(
    "✅ conflitos reais continuam rejeitados",
  );
  console.log(
    "✅ plano Business existente e preservado",
  );
}

try {
  run();
} catch (error) {
  console.error("");
  console.error(
    "❌ subscriptionLegacyRegistry.test.js FALHOU",
  );
  console.error(error);
  process.exit(1);
}