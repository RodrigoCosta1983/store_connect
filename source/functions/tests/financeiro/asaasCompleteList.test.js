"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readCompleteAsaasList} = require("../../financeiro/asaasCompleteList");
const {billingReader} = require("../../financeiro/asaasDurableWebhook");
const page = (rows, totalCount, offset = 0, hasMore = false, limit = 100) => ({data: {data: rows, totalCount, offset, hasMore, limit}});
const input = get => ({get, url: "https://synthetic.invalid/list", headers: {}, params: {status: "ACTIVE"}});
test("complete empty page is explicit; it is not inferred from a malformed response", async () => {
  assert.deepEqual(await readCompleteAsaasList(input(async () => page([],0))), []);
});
test("short page with continuation is followed to the end without assuming absence", async () => {
  const offsets = [];
  const rows = await readCompleteAsaasList(input(async (_, options) => {
    offsets.push(options.params.offset);
    assert.equal(options.params.status, "ACTIVE");
    return options.params.offset === 0 ? page([{id:"a"}],2,0,true) : page([{id:"b"}],2,1,false);
  }));
  assert.equal(rows.length,2); assert.deepEqual(offsets,[0,1]);
});
for (const [name, value] of [
  ["missing body", {}], ["missing total", {data: {data:[],hasMore:false,offset:0,limit:100}}],
  ["missing hasMore", {data: {data:[],totalCount:0,offset:0,limit:100}}],
  ["wrong offset", page([],0,10)], ["false end while total has more", page([{id:"a"}],2)],
  ["empty page has more", page([],1,0,true)], ["more than total", page([{id:"a"}],0)],
]) test(`incomplete list fails closed: ${name}`, async () => {
  await assert.rejects(readCompleteAsaasList(input(async () => value)), {code:"asaas_list_inconclusive"});
});
test("total changing between pages and duplicate identity both reject full result", async () => {
  for (const second of [page([{id:"b"}],3,1,true),page([{id:"a"}],2,1,false)]) {
    await assert.rejects(readCompleteAsaasList(input(async (_,o) => o.params.offset === 0 ? page([{id:"a"}],2,0,true) : second)), {code:"asaas_list_inconclusive"});
  }
});
test("page/item bound returns no partial array and authorizes no caller POST", async () => {
  let posts = 0;
  await assert.rejects((async () => {
    await readCompleteAsaasList({...input(async () => page([{id:"a"}],101,0,true)),maxPages:1});
    posts++;
  })(), {code:"asaas_list_inconclusive"});
  assert.equal(posts,0);
});
test("transport failure on final page rejects instead of returning prefix", async () => {
  await assert.rejects(readCompleteAsaasList(input(async (_,o) => {
    if (o.params.offset) throw Error("synthetic timeout");
    return page([{id:"a"}],2,0,true);
  })), /synthetic timeout/);
});
test("billing cannot claim no debt from missing metadata; later page debt is found", async () => {
  let malformed = true;
  const reader = billingReader({config:{baseUrl:"https://synthetic.invalid"},headers:{},get: async (url, options) => {
    if (url.includes("/subscriptions/")) return {data:{id:"sub",customer:"customer",externalReference:"store",status:"ACTIVE"}};
    if (malformed) return {data:{data:[],hasMore:false}};
    const status = options.params.status;
    if (status !== "OVERDUE") return page([],0);
    const offset = options.params.offset;
    const row = {id:offset ? "older" : "newer",subscription:"sub",customer:"customer",status,dueDate:offset ? "2026-10-10" : "2026-10-20"};
    return page([row],2,offset,offset === 0);
  }});
  await assert.rejects(reader("sub",{eventType:"PAYMENT_RECEIVED"},{asaasCustomerId:"customer"},"store"), {code:"asaas_list_inconclusive"});
  malformed = false;
  const result = await reader("sub",{eventType:"PAYMENT_RECEIVED"},{asaasCustomerId:"customer"},"store");
  assert.equal(result.hasOverdue,true); assert.equal(result.overdueDueDate,"2026-10-10");
});
