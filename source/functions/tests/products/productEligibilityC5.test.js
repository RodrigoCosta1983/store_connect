"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const c = require("../../contracts/productEligibilityC5");
const {normalize, hash} = require("../../sales/saleV2Contract");
const absent = () => ({exists: false});
const snap = data => ({exists: true, data, updateTime: {seconds: "1792100000", nanoseconds: 123456000}});
const scope = () => ({projectId: "demo-c5-d", storeId: "s"});
function request(kind = "legacySimple", protocol = "legacyV1", operation = "sale") {
  const variant = kind === "variant";
  const identity = {productId: "p", variantId: variant ? "v" : null};
  const data = kind === "legacySimple" ? {price: 19.99} : kind === "variant" ?
    {variantSchemaVersion: 1, productId: "p", attributes: [], isArchived: false} :
    {productKind: kind, variantSchemaVersion: 1, isArchived: false,
      ...(kind === "simple" ? {price: 19.99} : {attributeDefinitions: []})};
  return {protocol, operation, scope: scope(), identity, entity: snap(data), commercial: absent()};
}
const evaluate = c.evaluateProductEligibility;
function profile(req, configuration, kind) {
  return snap({schemaVersion: 1, identity: {...req.scope, ...req.identity,
    kind: kind || (req.identity.variantId === null ? req.entity.data.productKind || "simple" : "variant")}, configuration});
}
function future() {
  const req = request("variant", "futureV3");
  const p = request("variantParent", "futureV3", "read");
  p.commercial = profile(p, {priceCents: 1999});
  req.parent = {scope: p.scope, identity: p.identity, entity: p.entity, commercial: p.commercial};
  req.commercial = profile(req, {});
  return req;
}
test("simple domains permit only compatible legacy operations without granting authorization", () => {
  for (const kind of ["legacySimple", "simple"]) {
    for (const protocol of ["legacyV1", "legacyV2"]) {
      for (const op of ["read", "cadastral", "stock", "sale"]) {
        const r = evaluate(request(kind, protocol, op));
        assert.equal(r.status, "compatible", kind + protocol + op);
        assert.equal(r.check, "pure-domain-only");
        assert.equal(Object.hasOwn(r, "trusted"), false);
      }
    }
    for (const op of ["fiado", "catalog", "import"]) assert.equal(evaluate(request(kind, "legacyV1", op)).status, "compatible");
  }
});
test("parent is rejected for every legacy operation, including a parent with valid legacy price", () => {
  for (const protocol of ["legacyV1", "legacyV2"]) {
    for (const op of ["read", "cadastral", "stock", "sale", "import", "fiado", "offline", "catalog", "fiscal"]) {
      const req = request("variantParent", protocol, op); req.entity.data.price = 10;
      assert.equal(evaluate(req).status, "blocked");
    }
  }
  assert.equal(evaluate(request("variantParent", "futureV3", "sale")).reason, "parent-not-sellable");
});
test("old protocols reject variants without erasing variant identity", () => {
  for (const protocol of ["legacyV1", "legacyV2"]) {
    for (const op of ["read", "stock", "sale", "cadastral"]) {
      const req = request("variant", protocol, op), r = evaluate(req);
      assert.equal(r.reason, "variant-not-supported");
      assert.equal(r.identity.variantId, "v");
      assert.equal(req.identity.variantId, "v");
    }
  }
});
test("dropping or mismatching a variant identity/discriminator cannot demote it to legacy simple", () => {
  for (const patch of [{}, {variantSchemaVersion: undefined}, {variantSchemaVersion: null}, {productKind: "simple"}]) {
    const req = request("variant"); req.identity.variantId = null;
    Object.assign(req.entity.data, patch);
    if (Object.hasOwn(patch, "variantSchemaVersion") && patch.variantSchemaVersion === undefined) delete req.entity.data.variantSchemaVersion;
    assert.equal(evaluate(req).status, "blocked");
  }
  const req = future(); req.entity.data.productId = "other";
  assert.equal(evaluate(req).reason, "invalid-kind-or-identity");
  const extra = future(); extra.entity.data.variantId = "other";
  assert.equal(evaluate(extra).status, "blocked");
});
test("unknown/partial/null discriminators fail closed", () => {
  for (const data of [{productKind: "simple"}, {variantSchemaVersion: 1}, {productKind: null, variantSchemaVersion: 1},
    {productKind: "other", variantSchemaVersion: 1}, {productKind: "simple", variantSchemaVersion: 2}]) {
    const req = request(); req.entity = snap(data);
    assert.equal(evaluate(req).reason, "invalid-kind-or-identity");
  }
});
test("D1 all known entity markers block simple classification by presence, without altering input", () => {
  for (const kind of ["legacySimple", "simple"]) {
    for (const marker of ["attributeDefinitions", "attributes", "productId", "variantId"]) {
      for (const value of [null, [], {}, "", "p", 0, false, [{malformed: true}]]) {
        for (const protocol of ["legacyV1", "legacyV2", "inspection"]) {
          const req = request(kind, protocol, protocol === "inspection" ? "read" : "sale");
          req.entity.data[marker] = value;
          const before = JSON.stringify(req);
          const result = evaluate(req);
          assert.equal(result.status, "blocked", kind + marker + protocol);
          assert.equal(result.reason, "invalid-kind-or-identity");
          assert.equal(Object.hasOwn(req.entity.data, marker), true);
          assert.equal(JSON.stringify(req), before);
        }
      }
    }
  }
});
test("D1 partial discriminators and mixed parent/variant structures fail closed", () => {
  for (const data of [
    {attributeDefinitions: [], productKind: "variantParent"},
    {attributeDefinitions: null, variantSchemaVersion: 1},
    {attributes: [], productId: "p"},
    {attributes: null, variantSchemaVersion: 1},
    {attributeDefinitions: [], attributes: [], productId: "p"},
    {productKind: "variantParent", variantSchemaVersion: 1, attributeDefinitions: [], attributes: null},
  ]) {
    const req = request(); req.entity.data = {...req.entity.data, ...data};
    assert.equal(evaluate(req).reason, "invalid-kind-or-identity");
  }
  const req = future(); req.entity.data.attributeDefinitions = [];
  assert.equal(evaluate(req).reason, "invalid-kind-or-identity");
  const missing = future(); delete missing.identity.variantId;
  assert.throws(() => evaluate(missing), TypeError);
});
test("D1 malformed non-JSON marker values are rejected instead of silently omitted", () => {
  for (const marker of ["attributeDefinitions", "attributes", "productId", "variantId"]) {
    const req = request(); req.entity.data[marker] = undefined;
    assert.throws(() => evaluate(req), TypeError);
    assert.equal(Object.hasOwn(req.entity.data, marker), true);
  }
});
test("D1 legitimate simple history and unrelated legacy metadata are preserved", () => {
  for (const kind of ["legacySimple", "simple"]) {
    const req = request(kind, "legacyV2");
    Object.assign(req.entity.data, {costPrice: 1, cod: "COD", barcode: "001", imageUrl: "ref", minimumStock: 2,
      fiscal: {ncm: "01"}, categoryIds: ["c"], createdAt: {seconds: "1", nanoseconds: 123456789}, custom: {keep: true}});
    const before = JSON.stringify(req);
    assert.equal(evaluate(req).status, "compatible");
    assert.equal(JSON.stringify(req), before);
  }
  // B legacy observation is permissive; a collision is not an approved new effect.
  const item = {productId: "p", name: "Histórico", price: 0.29, quantity: 1,
    attributeDefinitions: null, attributes: [], custom: {keep: true}};
  const observed = c.observeHistoricalItem({protocol: "legacyV1", item});
  assert.deepEqual(observed.data, item);
  assert.equal(observed.check, "historical-observation-only");
  assert.throws(() => { observed.data.custom.keep = false; }, TypeError);
});
test("D1 absence of every structural marker cannot prove original type", () => {
  const req = request();
  assert.equal(evaluate(req).status, "compatible");
  assert.equal(evaluate(req).check, "pure-domain-only");
  // No historical origin is inferred when the current snapshot is indistinguishable.
  assert.equal(Object.hasOwn(evaluate(req), "originalKind"), false);
});
test("structural reading does not depend on price, profile or archive and cannot be used as sale", () => {
  for (const kind of ["legacySimple", "simple", "variantParent", "variant"]) {
    const req = request(kind, "inspection", "read"); req.entity.data.isArchived = true;
    req.entity.data.price = null; req.commercial = snap({schemaVersion: 999});
    assert.equal(evaluate(req).reason, "structural-read-only");
    req.operation = "sale";
    assert.equal(evaluate(req).status, "blocked");
  }
});
test("invalid legacy price blocks sale but not structural/cadastral or stock domain", () => {
  for (const price of [null, -1, -0, "19.99"]) {
    const req = request(); req.entity.data.price = price;
    assert.equal(evaluate(req).reason, "invalid-legacy-price");
    for (const op of ["read", "cadastral", "stock"]) {
      req.operation = op; assert.equal(evaluate(req).status, "compatible");
    }
  }
  const req = request(); delete req.entity.data.price;
  assert.equal(evaluate(req).reason, "invalid-legacy-price");
});
test("V2 preserves its strict monetary validation; V1 domain does not rewrite rounding policy", () => {
  const req = request("simple", "legacyV2"); req.entity.data.price = 0.29;
  assert.equal(evaluate(req).status, "compatible");
  req.entity.data.price = 1.005;
  assert.equal(evaluate(req).reason, "incompatible-v2-price");
  req.protocol = "legacyV1";
  assert.equal(evaluate(req).status, "compatible");
  assert.equal(req.entity.data.price, 1.005);
});
test("explicit legacy zero is preserved by its existing domain, future free sale remains pending", () => {
  for (const protocol of ["legacyV1", "legacyV2"]) {
    const req = request("simple", protocol); req.entity.data.price = 0;
    assert.equal(evaluate(req).status, "compatible");
  }
  const req = future(); req.commercial = profile(req, {priceCents: {mode: "override", value: 0}});
  assert.equal(evaluate(req).reason, "free-sale-policy-pending");
});
test("a present profile, equal/new money, null or unknown version cannot activate legacy paths", () => {
  for (const commercial of [profile(request(), {priceCents: 1999}), snap({schemaVersion: 99}), snap({schemaVersion: 1, configuration: null})]) {
    for (const op of ["read", "cadastral", "stock", "sale"]) {
      const req = request("simple", "legacyV1", op); req.commercial = commercial;
      assert.equal(evaluate(req).reason, "commercial-profile-not-supported");
    }
  }
  for (const key of ["priceCents", "costCents", "commercial", "commercialProfiles"]) {
    const req = request(); req.entity.data[key] = null;
    assert.equal(evaluate(req).reason, "unsupported-top-level-money");
  }
});
test("archive state blocks new sale/stock but not reading or cadastral domain", () => {
  for (const isArchived of [true, null, "false"]) {
    const req = request(); req.entity.data.isArchived = isArchived;
    assert.equal(evaluate(req).reason, "entity-not-active");
    req.operation = "stock"; assert.equal(evaluate(req).status, "blocked");
    req.operation = "read"; assert.equal(evaluate(req).status, "compatible");
  }
  const req = request("simple"); delete req.entity.data.isArchived;
  assert.equal(evaluate(req).status, "blocked");
});
test("unknown cost is never changed into zero; invalid present cost blocks new monetary eligibility", () => {
  const req = request();
  assert.equal(evaluate(req).status, "compatible");
  assert.equal(Object.hasOwn(req.entity.data, "costPrice"), false);
  req.entity.data.costPrice = null;
  assert.equal(evaluate(req).status, "compatible");
  assert.equal(req.entity.data.costPrice, null);
  for (const costPrice of [-1, "2.00"]) {
    req.entity.data.costPrice = costPrice;
    assert.equal(evaluate(req).reason, "invalid-legacy-cost");
  }
});
test("offline and fiscal require their historical contracts, even for valid simple current price", () => {
  for (const op of ["offline", "fiscal"]) assert.equal(evaluate(request("simple", "legacyV1", op)).status, "blocked");
  for (const op of ["cadastral", "import", "fiado", "offline", "catalog", "fiscal"]) {
    const req = future(); req.operation = op;
    assert.equal(evaluate(req).reason, "future-operation-contract-pending");
  }
});
test("future inherited and overridden candidates keep tuple and remain blocked for confirmation", () => {
  for (const [configuration, cents, source] of [[{}, 1999, "parent"], [{priceCents: {mode: "inherit"}}, 1999, "parent"],
    [{priceCents: {mode: "override", value: 2500}}, 2500, "variant"]]) {
    const req = future(); req.commercial = profile(req, configuration);
    const r = evaluate(req);
    assert.equal(r.reason, "v3-confirmation-contract-pending");
    assert.equal(r.status, "blocked");
    assert.deepEqual(r.priceCandidate, {unitPriceCents: cents, source});
    assert.equal(r.identity.key, '["p","v"]');
    assert.throws(() => { r.priceCandidate.unitPriceCents = 0; }, TypeError);
  }
});
test("missing/null/invalid profiles and mixed monetary sources never produce price candidates", () => {
  const cases = [
    r => { r.commercial = absent(); },
    r => { r.parent.commercial = absent(); },
    r => { r.commercial = profile(r, null); },
    r => { r.commercial = profile(r, {priceCents: null}); },
    r => { r.commercial = profile(r, {priceCents: {mode: "override", value: -1}}); },
    r => { r.entity.data.price = null; },
    r => { r.parent.entity.data.costPrice = null; },
    r => { r.commercial.data.identity.storeId = "other"; },
    r => { r.commercial.data.schemaVersion = 2; },
  ];
  for (const change of cases) {
    const req = future(); change(req); const r = evaluate(req);
    assert.equal(r.status, "blocked");
    assert.equal(Object.hasOwn(r, "priceCandidate"), false);
  }
});
test("override without a valid base value remains a documented policy gap", () => {
  const req = future(); req.parent.commercial.data.configuration = {};
  req.commercial = profile(req, {priceCents: {mode: "override", value: 2500}});
  assert.equal(evaluate(req).reason, "base-price-policy-pending");
});
test("cross-store/project/product parent, missing parent and archived parent/variant fail closed", () => {
  for (const change of [r => { delete r.parent; }, r => { r.parent.identity.productId = "q"; },
    r => { r.parent.scope.storeId = "other"; }, r => { r.parent.scope.projectId = "demo-other"; },
    r => { r.parent.entity = absent(); }, r => { r.parent.entity.data.isArchived = true; },
    r => { r.entity.data.isArchived = true; }]) {
    const req = future(); change(req); assert.equal(evaluate(req).status, "blocked");
  }
});
test("C3 stock domain is variant-specific and independent of commercial price", () => {
  const req = future(); req.protocol = "f10C3"; req.operation = "stock";
  req.commercial = absent(); req.parent.commercial = absent(); req.entity.data.price = null;
  assert.equal(evaluate(req).reason, "c3-stock-domain-only");
  for (const kind of ["legacySimple", "simple", "variantParent"]) assert.equal(evaluate(request(kind, "f10C3", "stock")).status, "blocked");
});
test("legacy item identity barrier rejects explicit variantId including null and never strips it", () => {
  assert.equal(c.legacyItemIdentityBarrier({productId: "p"}).variantId, null);
  for (const variantId of ["v", null, undefined, ""]) {
    const raw = {productId: "p", variantId};
    assert.throws(() => c.legacyItemIdentityBarrier(raw), TypeError);
    assert.equal(Object.hasOwn(raw, "variantId"), true);
  }
});
test("historical/backlog observation preserves exact bytes, unknown fields and invalid old price without new effects", () => {
  const item = {productId: "p", name: "Antigo", quantity: 2, price: 1.005,
    custom: {snapshot: [null, {seconds: "1", nanoseconds: 999999999}]}};
  const before = JSON.stringify(item);
  const r = c.observeHistoricalItem({protocol: "legacyV1", item});
  assert.equal(JSON.stringify(r.data), before);
  assert.equal(JSON.stringify(item), before);
  assert.equal(r.check, "historical-observation-only");
  item.custom.snapshot.push(3);
  assert.equal(r.data.custom.snapshot.length, 2);
  assert.throws(() => r.data.custom.snapshot.push(4), TypeError);
  assert.throws(() => c.observeHistoricalItem({protocol: "legacyV2", item: {...item, variantId: "v"}}), TypeError);
});
test("existing V2 frozen normalization/hash remains unchanged and still rejects variantId", () => {
  const raw = {schemaVersion: 2, requestId: "sale", saleId: "sale", scope: {...scope(), uid: "u"},
    origin: "online", saleKind: "instant", items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 1999}],
    expectedTotalCents: 1999, paymentMethod: "PIX"};
  const before = normalize(raw), digest = hash(before), bytes = JSON.stringify(raw);
  evaluate(request("simple", "legacyV2"));
  assert.deepEqual(normalize(raw), before);
  assert.equal(hash(normalize(raw)), digest);
  assert.equal(JSON.stringify(raw), bytes);
  assert.throws(() => normalize({...raw, items: [{...raw.items[0], variantId: "v"}]}), TypeError);
});
test("malformed protocol, operation, identities, missing context, client price and extra flags are rejected", () => {
  for (const [protocol, operation] of [["none", "sale"], ["legacyV2", "fiado"], ["inspection", "stock"], [null, "sale"], ["legacyV1", "delete"]]) {
    const req = request(); req.protocol = protocol; req.operation = operation;
    assert.equal(evaluate(req).status, "blocked");
  }
  for (const mutate of [r => { delete r.commercial; }, r => { r.identity.productId = "bad/id"; },
    r => { delete r.identity.variantId; }, r => { r.trusted = true; }, r => { r.expectedPrice = 0; },
    r => { r.entity.data.price = NaN; }, r => { r.parent = {}; }]) {
    const req = request(); mutate(req);
    const blocked = () => { const result = evaluate(req); assert.equal(result.status, "blocked"); };
    try { blocked(); } catch (error) { if (!(error instanceof TypeError)) throw error; }
  }
});
