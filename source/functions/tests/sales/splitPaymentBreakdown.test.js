"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const {normalizeSalePayments} = require("../../sales/splitPaymentBreakdown");
const contract = require("../../sales/saleV2Contract");
const {buildSalePayments} = require("../../fiscal/salePayments");
const parts = [{method: "Dinheiro", amountCents: 5000}, {method: "Cartão de crédito", amountCents: 5000}];
const command = () => ({schemaVersion: 2, requestId: "sale", saleId: "sale", scope: {projectId: "demo-test", uid: "u", storeId: "s"},
  origin: "online", saleKind: "instant", items: [{productId: "p", quantity: 1, expectedUnitPriceCents: 10000}],
  expectedTotalCents: 10000, paymentMethod: "Misto", payments: parts});

test("split payments close the total in exact cents and normalize stable order", () => {
  assert.deepEqual(normalizeSalePayments("Misto", [...parts].reverse(), 10000), parts);
  assert.deepEqual(normalizeSalePayments("Misto", [
    {method: "Dinheiro", amountCents: 10}, {method: "PIX", amountCents: 20},
    {method: "Cartão de crédito", amountCents: 30}, {method: "Cartão de débito", amountCents: 40}], 100).map(p => p.amountCents), [10, 20, 30, 40]);
});
test("wrong totals, duplicate methods, deferred, fractional and arbitrary fields are rejected", () => {
  for (const payments of [undefined, null, [], [parts[0]], [parts[0], {...parts[1], amountCents: 4999}],
    [parts[0], {...parts[1], amountCents: 5001}], [parts[0], {...parts[1], amountCents: 0}],
    [parts[0], {...parts[1], amountCents: 5000.1}], [parts[0], {...parts[1], method: "Fiado"}],
    [parts[0], {...parts[1], method: "Dinheiro"}], [parts[0], {...parts[1], confirmed: true}]]) {
    assert.throws(() => normalizeSalePayments("Misto", payments, 10000), TypeError);
  }
  assert.throws(() => normalizeSalePayments("Dinheiro", parts, 10000));
});
test("existing single-method V2 command preserves its normalized bytes", () => {
  const input = command(); input.paymentMethod = "Dinheiro"; delete input.payments;
  const normalized = contract.normalize(input);
  assert.equal(Object.hasOwn(normalized, "payments"), false);
  // Captured from the existing contract before adding split payments.
  assert.equal(contract.hash(normalized), "dca4934a86ce12dec393fa8ef04b3f153cd813f4a92bb4955ba7bfd0c46e5b61");
});
test("split amounts participate in server command hash and invalid splits cannot become commands", () => {
  const first = contract.normalize(command());
  const other = contract.normalize({...command(), payments: [{method:"Dinheiro",amountCents:4000}, {method:"Cartão de crédito",amountCents:6000}]});
  assert.notEqual(contract.hash(first), contract.hash(other));
  assert.throws(() => contract.normalize({...command(), payments: [parts[0]]}));
});
test("fiscal payload uses real emitter mappings for each payment without any provider call", () => {
  const file = path.resolve(__dirname, "../../fiscal/emitirNfce.js");
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(fs.readFileSync(file, "utf8") + "\nmodule.exports.paymentMapperForTest = buildPayment;\n", file);
  const result = buildSalePayments({paymentMethod:"Misto",payments:parts}, 100, compiled.exports.paymentMapperForTest);
  assert.deepEqual(result.map(p => [p.forma_pagamento,p.valor_pagamento]), [["01",50],["03",50]]);
  assert.equal(result[1].tipo_integracao,"2");
  assert.equal(result.reduce((sum,p) => sum + Math.round(p.valor_pagamento*100),0),10000);
  const single = buildSalePayments({paymentMethod:"PIX"},100,compiled.exports.paymentMapperForTest);
  assert.deepEqual(single,[compiled.exports.paymentMapperForTest("PIX",100)]);
});
test("invalid fiscal split is rejected before even building any payment entry", () => {
  let calls = 0;
  assert.throws(() => buildSalePayments({paymentMethod:"Misto",payments:[parts[0]]},100,()=>{calls++;}));
  assert.equal(calls,0);
});
