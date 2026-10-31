"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fixtures = require("../../../test/fixtures/sale_v2_command_cases.json");
const {normalize} = require("../../sales/saleV2Contract");
for (const fixture of fixtures.cases) {
  test("B07-C shared client/backend fixture: " + fixture.name, () => {
    const input = {...fixtures.base, ...fixture.patch};
    if (!fixture.valid) return assert.throws(() => normalize(input), TypeError);
    const expected = {...input, notes: input.notes ?? null, customerId: input.customerId ?? null,
      items: [...input.items].sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0)};
    assert.deepEqual(normalize(input), expected);
  });
}
