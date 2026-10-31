"use strict";
const {createHash} = require("node:crypto");
const SOURCE = "store-connect-app", TARGET = "store-connect-hml", STORE = "F1ediJCWm8kmUKy3vTK1";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const financial = /asaas|subscription|trial|payment|invoice|overdue|blockedAt|pendingPlan|billing|purchaseDate|pix|token|secret|credential/i;
const personal = /cpf|cnpj|document|phone|telefone|email|address|endereco|customerName|clientName|buyer|seller|createdBy|updatedBy|ownerId/i;
const stock = /quantidade|quantity|stock|estoque|lots|batches/i;
const rootCopy = new Set(["name", "storeName", "description", "businessName", "currency", "timezone", "updatedAt"]);
function policy(path, field, value) {
  const root = path === `stores/${STORE}`;
  if (root && ["subscriptionStatus", "subscriptionType"].includes(field)) return ["PRESERVE_HML", "Preservar active/business; nao implica pagamento"];
  if (root && field === "ownerId") return ["GUARD_OWNER", "Comparar owner/role, nunca substituir"];
  if (root && field === "productId") return ["EXCLUDE", "Identificador legado Google Play"];
  if (financial.test(field)) return ["EXCLUDE", "Nao importar vinculos, credenciais ou estado financeiro PROD"];
  if (personal.test(field)) return ["ANONYMIZE_REVIEW", "Exige politica e consentimento; sem valor no manifesto"];
  if (/url|image|photo|foto/i.test(field)) return ["REMAP_STORAGE", "URL/asset exige validacao e destino HML explicito"];
  if (/firebasestorage|storage.googleapis|gs:\/\//i.test(JSON.stringify(value))) return ["REMAP_STORAGE", "Copiar asset para bucket HML aprovado; URL PROD nunca ativa"];
  if (JSON.stringify(value).includes(`projects/${SOURCE}/`)) return ["REMAP_REFERENCE", "Revalidar referencia no projeto HML"];
  if (/^(productId|categoryId|categoryIds|customerId|saleId|variantId|storeId)$/.test(field)) return ["REMAP_REFERENCE", "Preservar ID logico apenas apos validar existencia e ambiente"];
  if (/\/(sales|customers|cash_flow)\//.test(path)) return ["ARCHIVE_ONLY_REVIEW", "Historico anonimizado isolado; sem triggers/efeitos financeiros"];
  if (/\/products\//.test(path) && stock.test(field)) return ["PRESERVE_HML", "Preservar estoque restaurado, inclusive descendentes"];
  if (root && !rootCopy.has(field)) return ["REVIEW_UNKNOWN", "Campo raiz nao aprovado para copia automatica"];
  if (value.mapValue || value.arrayValue) return ["REVIEW_CONTAINER", "Nunca copiar container integral; aprovar folhas e elementos individualmente"];
  if (/\/(products|categories)\//.test(path) || rootCopy.has(field) && root) return ["COPY_IF_ABSENT", "Somente ausente, mesmo ID; validar variantes e referencias"];
  return ["REVIEW_UNKNOWN", "Colecao/campo fora da allowlist; fail-closed"];
}
function flatten(fields, prefix = "") {
  const rows = [];
  for (const [key, value] of Object.entries(fields || {})) {
    const field = prefix ? `${prefix}.${key}` : key;
    rows.push([field, value]);
    if (value.mapValue?.fields) rows.push(...flatten(value.mapValue.fields, field));
    if (value.arrayValue?.values) value.arrayValue.values.forEach((v, i) => {
      if (v.mapValue?.fields) rows.push(...flatten(v.mapValue.fields, `${field}[${i}]`));
    });
  }
  return rows;
}
function planStore({sourceProject = SOURCE, targetProject = TARGET, storeId = STORE, source, target, owner}) {
  if (sourceProject !== SOURCE || targetProject !== TARGET || storeId !== STORE) throw Error("project_or_store_guard");
  const root = `stores/${STORE}`, a = source.find(d => d.path === root), b = target.find(d => d.path === root);
  for (const documents of [source, target]) {
    if (new Set(documents.map(d => d.path)).size !== documents.length || documents.some(d =>
      !(d.path === root || d.path.startsWith(`${root}/`)) || typeof d.updateTime !== "string" || !d.updateTime)) throw Error("snapshot_path_or_version_guard");
  }
  if (!a || !b || !owner || owner.role !== "admin" || owner.accessStatus === "revoked" || owner.storeId !== STORE ||
      !a.fields.ownerId?.stringValue || a.fields.ownerId.stringValue !== b.fields.ownerId?.stringValue || owner.uid !== b.fields.ownerId.stringValue) throw Error("owner_role_guard");
  const targets = new Map(target.map(d => [d.path, d]));
  const entries = source.map(doc => {
    const current = targets.get(doc.path), targetFields = new Map(flatten(current?.fields));
    return {documentKey: hash(doc.path), collectionFamily: doc.path.split("/")[2] || "store_root",
      targetOnlyFields: [...targetFields.keys()].filter(field => !flatten(doc.fields).some(([sourceField]) => sourceField === field)),
      destinationPolicy: /\/(sales|customers|cash_flow|auditLogs|catalogs|catalogRequests)\//.test(doc.path) ? "ISOLATED_ARCHIVE_REVIEW_ONLY" : "REVIEW_WITHOUT_OVERWRITE",
      sourceUpdateTime: doc.updateTime, targetUpdateTime: current?.updateTime || null,
      sourceDigest: hash(doc.fields), targetDigest: current ? hash(current.fields) : null,
      fields: flatten(doc.fields).map(([field, value]) => {
        const [action, reason] = policy(doc.path, field, value), existing = targetFields.has(field);
        return {field, action: existing && action === "COPY_IF_ABSENT" ? "PRESERVE_HML" : action, reason,
          targetPresent: existing, equal: existing && hash(value) === hash(targetFields.get(field))};
      })};
  });
  return {schemaVersion: 1, mode: "DRY_RUN", sourceProject, targetProject, storeId,
    applyEnabled: false, snapshotIsAtomic: false, sourceDocuments: source.length, targetDocuments: target.length,
    targetOnlyDocuments: target.filter(d => !source.some(s => s.path === d.path)).map(d => hash(d.path)),
    entries, planDigest: hash(entries), blockers: ["Sem apply nesta ferramenta", "Backup criptografado com hash e restauracao verificada pendente",
      "Aprovar anonimização e remapeamento campo a campo", "Revalidar source/target updateTime em transacao no futuro executor",
      "Leituras nao atomicas: repetir inventario imediatamente antes do apply autorizado", "Historico somente em arquivo isolado sem efeitos"]};
}
module.exports = {SOURCE, TARGET, STORE, hash, policy, flatten, planStore};
