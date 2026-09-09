/**
 * Dependency-free smoke test: an in-memory linked client↔server pair.
 * Covers tools/list, connections_list, mock data, pagination, the error model, the
 * audit log, absence of secrets, conformance of mock responses to the declared
 * outputSchemas, and that the real-API mapping produces the same shape as the mocks.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import { RateLimiter } from "../src/core/rateLimiter.js";
import { WbClient, WB_GROUPS_WITHOUT_SANDBOX } from "../src/adapters/wb/client.js";
import { OrderSchema, PriceSchema, ProductSchema, StockSchema } from "../src/adapters/common/schema.js";

let failures = 0;
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL:", msg);
    failures++;
  }
}

const store = new MemoryStore();
const server = buildServer(store);
const client = new Client({ name: "smoke", version: "0.0.1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

// 1. tools/list
const tools = await client.listTools();
const names = tools.tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));
for (const expected of ["connections_list", "connection_get", "connection_test", "marketplace_capabilities", "wb_products_list", "wb_stocks_get", "wb_prices_get", "wb_orders_list"]) {
  assert(names.includes(expected), `tool ${expected} present`);
}

// 1b. all three adapters are registered
for (const expected of ["ozon_products_list", "ozon_stocks_get", "ozon_prices_get", "ozon_orders_list",
                        "ym_campaigns_list", "ym_products_list", "ym_stocks_get", "ym_prices_get", "ym_orders_list"]) {
  assert(names.includes(expected), `tool ${expected} present`);
}
for (const prefix of ["ozon", "wb", "ym"]) for (const suffix of ["read_search", "read_describe", "read_capabilities", "read_execute", "read_file"]) {
  assert(names.includes(`${prefix}_${suffix}`), `tool ${prefix}_${suffix} present`);
}
assert(names.length === 32, `compact catalog has 32 tools (17 existing + 15 extended), got ${names.length}`);

const searchResult: any = await client.callTool({ name: "ozon_read_search", arguments: { query: "seller", limit: 3 } });
const searchPayload = JSON.parse(searchResult.content[0].text);
assert(searchPayload.success && searchPayload.data.items.length > 0 && searchPayload.data.items.length <= 3, "ozon_read_search returns compact approved metadata");
const describedId = searchPayload.data.items[0].method_id;
const describeResult: any = await client.callTool({ name: "ozon_read_describe", arguments: { method_id: describedId } });
assert(JSON.parse(describeResult.content[0].text).data.input_schema, "ozon_read_describe returns input schema");
const unknownResult: any = await client.callTool({ name: "ozon_read_execute", arguments: { connection_id: "00000000-0000-4000-8000-000000000011", method_id: "ProductAPI_ImportProductsV3", params: {} } });
const unknownPayload = JSON.parse(unknownResult.content[0].text);
assert(unknownPayload.error?.code === "LOCAL_DENY", "write/unknown method is locally denied");

// 1c. every data tool declares an outputSchema, so the SDK validates responses itself.
// ym_campaigns_list is excluded: it returns account identifiers, not a normalized entity.
const dataTools = tools.tools.filter((t) => /^(wb|ozon|ym)_/.test(t.name) && t.name !== "ym_campaigns_list");
for (const t of dataTools) {
  assert(t.outputSchema, `${t.name} declares outputSchema`);
}
console.log(`outputSchema declared for all ${dataTools.length} data tools`);

// 2. connections_list — a mock connection exists and no secrets leak
const connsRes: any = await client.callTool({ name: "connections_list", arguments: {} });
const conns = JSON.parse(connsRes.content[0].text);
assert(conns.success === true, "connections_list success");
const demo = conns.data.items.find((c: any) => c.mock);
assert(demo, "demo mock connection exists");
assert(!JSON.stringify(conns).toLowerCase().includes("token"), "no secrets in connections_list");
console.log("demo connection:", demo.name, demo.connection_id);

// 3. wb_products_list via mock (callTool already validated structuredContent against outputSchema)
const prodRes: any = await client.callTool({ name: "wb_products_list", arguments: { connection_id: demo.connection_id } });
const prods = JSON.parse(prodRes.content[0].text);
assert(prods.success && prods.meta.source === "mock", "products from mock source");
assert(prods.data.items.length === 3, "3 mock products");
console.log("products:", prods.data.items.map((p: any) => p.ref.seller_sku).join(", "));

// 4. order pagination: limit=10 → 3 pages over 25 orders
let cursor: string | undefined;
let total = 0;
let pages = 0;
do {
  const res: any = await client.callTool({ name: "wb_orders_list", arguments: { connection_id: demo.connection_id, limit: 10, cursor } });
  const page = JSON.parse(res.content[0].text);
  assert(page.success, "orders page success");
  total += page.data.items.length;
  cursor = page.data.next_cursor ?? undefined;
  pages++;
} while (cursor && pages < 10);
assert(total === 25 && pages === 3, `pagination: got ${total} orders in ${pages} pages`);
console.log(`orders pagination ok: ${total} orders / ${pages} pages`);

// 5. stocks: FBO and FBS are never merged
const stocksAll: any = await client.callTool({ name: "wb_stocks_get", arguments: { connection_id: demo.connection_id } });
const allStocks = JSON.parse(stocksAll.content[0].text).data.items;
const fbsOnly: any = await client.callTool({ name: "wb_stocks_get", arguments: { connection_id: demo.connection_id, fulfillment_model: "FBS" } });
const fbs = JSON.parse(fbsOnly.content[0].text).data.items;
assert(allStocks.length > fbs.length, "fulfillment_model filter narrows results");
assert(fbs.every((s: any) => s.fulfillment_model === "FBS"), "FBS filter returns only FBS rows");
assert(allStocks.some((s: any) => s.fulfillment_model === "FBO"), "FBO rows present in all");
console.log(`stocks ok: ${allStocks.length} rows total, ${fbs.length} FBS`);

// 6. error path: connection that does not exist
const errRes: any = await client.callTool({ name: "wb_stocks_get", arguments: { connection_id: "11111111-1111-4111-8111-111111111111" } });
const err = JSON.parse(errRes.content[0].text);
assert(err.success === false && err.error.code === "CONNECTION_NOT_FOUND", "unified error model works");
assert(errRes.isError === true, "error result flagged isError");
assert(errRes.structuredContent === undefined, "error carries no structuredContent (would violate outputSchema)");
console.log("error model ok:", err.error.code);

// 7. audit entries were written
assert(store.auditLog.length >= 8, `audit log has ${store.auditLog.length} entries`);
assert(store.auditLog.some((l) => l.status === "error" && l.error_code === "CONNECTION_NOT_FOUND"), "error audited");
console.log("audit entries:", store.auditLog.length);

/* ------------------------------------------------------------------ *
 * 8. mock ↔ real contract: the real WB API mapping is validated against the
 *    same zod schemas as the mocks. The branches used to diverge (mocks had
 *    fields the real API never returns) — this test catches that.
 * ------------------------------------------------------------------ */

// Payloads shaped after the official WB OpenAPI specifications (verified 2026-08-28).
const wbCardsSample = {
  cards: [{ nmID: 118638974, vendorCode: "ZR-001", title: "Щётка", brand: "ZERBERG", subjectName: "Щётки", sizes: [{ skus: ["4600000000017"] }] }],
  cursor: { updatedAt: "2026-08-01T10:00:00Z", nmID: 118638974, total: 1 },
};
const wbStocksSample = {
  data: { items: [{ nmId: 118638974, chrtId: 91663228, warehouseId: -999999, warehouseName: "Склад WB", regionName: "Склад WB", quantity: 43, inWayToClient: 14, inWayFromClient: 11 }] },
};
const wbPricesSample = {
  data: { listGoods: [{ nmID: 118638974, vendorCode: "ZR-001", currencyIsoCode4217: "RUB", discount: 25, sizes: [{ price: 890, discountedPrice: 667.5 }] }] },
};
const wbOrdersSample = [
  { srid: "abc123", date: "2026-08-20T10:00:00", nmId: 118638974, supplierArticle: "ZR-001", priceWithDisc: 667.5, warehouseName: "Коледино", isCancel: false },
];

// The same mapping expressions as in src/adapters/wb/tools.ts.
const mappedProduct = wbCardsSample.cards.map((c: any) => ({
  ref: { marketplace: "wildberries", marketplace_product_id: String(c.nmID), seller_sku: c.vendorCode ?? null, barcode: c.sizes?.[0]?.skus?.[0] ?? null, title: c.title ?? null },
  brand: c.brand ?? null,
  category: c.subjectName ?? null,
}));
const mappedStock = wbStocksSample.data.items.map((r: any) => ({
  marketplace: "wildberries",
  marketplace_product_id: String(r.nmId),
  size_id: r.chrtId != null ? String(r.chrtId) : null,
  seller_sku: null,
  warehouse: r.warehouseName ?? null,
  warehouse_id: r.warehouseId != null ? String(r.warehouseId) : null,
  region: r.regionName ?? null,
  fulfillment_model: "FBO",
  available: r.quantity ?? 0,
  reserved: 0,
  in_transit_to_customer: r.inWayToClient ?? 0,
  in_transit_from_customer: r.inWayFromClient ?? 0,
}));
const mappedPrice = wbPricesSample.data.listGoods.map((g: any) => {
  const size = g.sizes?.[0] ?? {};
  const currency = g.currencyIsoCode4217 ?? "RUB";
  return {
    marketplace: "wildberries",
    marketplace_product_id: String(g.nmID ?? ""),
    seller_sku: g.vendorCode ?? null,
    price: { amount: String(size.price ?? g.price ?? 0), currency },
    discount_percent: g.discount ?? 0,
    price_after_discount: { amount: String(size.discountedPrice ?? 0), currency },
  };
});
const mappedOrder = wbOrdersSample.map((o: any) => ({
  marketplace: "wildberries",
  order_id: o.srid ?? o.gNumber ?? null,
  created_at: o.date ?? null,
  marketplace_product_id: o.nmId != null ? String(o.nmId) : null,
  seller_sku: o.supplierArticle ?? null,
  quantity: 1,
  amount: { amount: String(o.priceWithDisc ?? o.totalPrice ?? 0), currency: "RUB" },
  warehouse: o.warehouseName ?? null,
  status: o.isCancel ? "cancelled" : "created",
  is_cancelled: Boolean(o.isCancel),
}));

for (const [label, schema, rows] of [
  ["products", ProductSchema, mappedProduct],
  ["stocks", StockSchema, mappedStock],
  ["prices", PriceSchema, mappedPrice],
  ["orders", OrderSchema, mappedOrder],
] as const) {
  const parsed = (schema as any).array().safeParse(rows);
  assert(parsed.success, `real-API mapping for ${label} matches shared schema: ${parsed.success ? "" : JSON.stringify(parsed.error?.issues)}`);
}
// And the mocks too — both branches against a single schema.
assert(ProductSchema.array().safeParse(prods.data.items).success, "mock products match shared schema");
assert(StockSchema.array().safeParse(allStocks).success, "mock stocks match shared schema");
console.log("mock↔real contract ok: both branches satisfy the same schemas");

/* ------------------------------------------------------------------ *
 * 8b. Cross-marketplace normalization — the core promise of this server.
 *     The same question asked of three platforms must return an identically
 *     shaped structure that differs only in values.
 * ------------------------------------------------------------------ */
const OZON_DEMO = "00000000-0000-4000-8000-000000000011";
const YM_DEMO = "00000000-0000-4000-8000-000000000021";

const allConns = JSON.parse((await client.callTool({ name: "connections_list", arguments: {} }) as any).content[0].text).data.items;
for (const mp of ["wildberries", "ozon", "yandex_market"]) {
  assert(allConns.some((c: any) => c.marketplace === mp && c.mock), `demo connection seeded for ${mp}`);
}
console.log("demo connections:", allConns.map((c: any) => c.marketplace).join(", "));

const perMarketplace = [
  { mp: "wildberries", conn: demo.connection_id, products: "wb_products_list", stocks: "wb_stocks_get", prices: "wb_prices_get", orders: "wb_orders_list" },
  { mp: "ozon", conn: OZON_DEMO, products: "ozon_products_list", stocks: "ozon_stocks_get", prices: "ozon_prices_get", orders: "ozon_orders_list" },
  { mp: "yandex_market", conn: YM_DEMO, products: "ym_products_list", stocks: "ym_stocks_get", prices: "ym_prices_get", orders: "ym_orders_list" },
];

for (const m of perMarketplace) {
  for (const [kind, tool, schema] of [
    ["products", m.products, ProductSchema],
    ["stocks", m.stocks, StockSchema],
    ["prices", m.prices, PriceSchema],
    ["orders", m.orders, OrderSchema],
  ] as const) {
    const res: any = await client.callTool({ name: tool, arguments: { connection_id: m.conn } });
    const body = JSON.parse(res.content[0].text);
    assert(body.success === true, `${tool} succeeds`);
    assert(body.marketplace === m.mp, `${tool} reports marketplace=${m.mp}`);
    assert(Array.isArray(body.data.items) && body.data.items.length > 0, `${tool} returns items`);
    const parsed = (schema as any).array().safeParse(body.data.items);
    assert(parsed.success, `${tool} items match shared schema: ${parsed.success ? "" : JSON.stringify(parsed.error?.issues?.slice(0, 2))}`);
    // Every row knows which platform it came from.
    assert(body.data.items.every((i: any) => (i.marketplace ?? i.ref?.marketplace) === m.mp), `${tool} rows carry marketplace tag`);
  }
}
console.log("cross-marketplace normalization ok: 3 marketplaces x 4 entity kinds share one shape");

// The key customer scenario: stocks from all three platforms merge into one list.
const unified: any[] = [];
for (const m of perMarketplace) {
  const res: any = await client.callTool({ name: m.stocks, arguments: { connection_id: m.conn } });
  unified.push(...JSON.parse(res.content[0].text).data.items);
}
assert(StockSchema.array().safeParse(unified).success, "merged stocks from 3 marketplaces validate as one list");
const lowStock = unified.filter((s) => s.available < 10);
assert(lowStock.length >= 2, `low-stock query works across marketplaces (found ${lowStock.length})`);
console.log(`unified stock list: ${unified.length} rows from 3 marketplaces; low stock: ` +
  lowStock.map((s) => `${s.marketplace}/${s.seller_sku}=${s.available}`).join(", "));

// Yandex Market: two stock methods — per account (FBS) and per shop (FBO/FBY).
// Without campaign_id, Market warehouse stock is invisible — that is the API's own
// behaviour, and the tool must behave identically in mock and in production.
const ymFbs: any = await client.callTool({ name: "ym_stocks_get", arguments: { connection_id: YM_DEMO } });
const ymFbsRows = JSON.parse(ymFbs.content[0].text).data.items;
const ymFbo: any = await client.callTool({ name: "ym_stocks_get", arguments: { connection_id: YM_DEMO, campaign_id: "21express" } });
const ymFboRows = JSON.parse(ymFbo.content[0].text).data.items;
assert(ymFbsRows.length > 0 && ymFbsRows.every((s: any) => s.fulfillment_model === "FBS"), "ym stocks without campaign_id -> FBS (seller warehouses)");
assert(ymFboRows.length > 0 && ymFboRows.every((s: any) => s.fulfillment_model === "FBO"), "ym stocks with campaign_id -> FBO (Market warehouses/FBY)");
assert(StockSchema.array().safeParse([...ymFbsRows, ...ymFboRows]).success, "both YM stock paths share one schema");
console.log(`ym dual-path stocks ok: ${ymFbsRows.length} FBS (account) + ${ymFboRows.length} FBO (shop)`);

// Yandex Market: the two-level account structure is visible to the agent.
const camps: any = await client.callTool({ name: "ym_campaigns_list", arguments: { connection_id: YM_DEMO } });
const campItems = JSON.parse(camps.content[0].text).data.items;
assert(campItems.length > 0 && campItems[0].business_id && campItems[0].campaign_id, "ym_campaigns_list exposes businessId + campaignId");
console.log("ym campaigns ok:", campItems.map((c: any) => `${c.campaign_id}@${c.business_id}`).join(", "));

/* ------------------------------------------------------------------ *
 * 8c. Real-API mapping contract for Ozon and Yandex Market, using sample
 *     payloads shaped after their documentation (verified 2026-08-28).
 * ------------------------------------------------------------------ */
const ozonStocksSample = { items: [{ product_id: 704531, offer_id: "ZR-001", stocks: [{ type: "fbo", present: 96, reserved: 8 }, { type: "fbs", present: 42, reserved: 2 }] }], last_id: "" };
const mappedOzonStocks: any[] = [];
for (const r of ozonStocksSample.items) {
  for (const st of r.stocks) {
    mappedOzonStocks.push({
      marketplace: "ozon", marketplace_product_id: String(r.product_id), size_id: null, seller_sku: r.offer_id ?? null,
      warehouse: null, warehouse_id: null, region: null,
      fulfillment_model: String(st.type).toLowerCase() === "fbs" ? "FBS" : "FBO",
      available: st.present ?? 0, reserved: st.reserved ?? 0, in_transit_to_customer: 0, in_transit_from_customer: 0,
    });
  }
}
assert(StockSchema.array().safeParse(mappedOzonStocks).success, "Ozon stocks mapping matches shared schema");
assert(mappedOzonStocks.length === 2 && mappedOzonStocks[0].fulfillment_model === "FBO" && mappedOzonStocks[1].fulfillment_model === "FBS",
  "Ozon stock types split into separate FBO/FBS rows");

const ymStocksSample = { result: { warehouses: [{ warehouseId: 10000012, offers: [{ offerId: "ZR-001", stocks: [{ type: "AVAILABLE", count: 74 }, { type: "FREEZE", count: 6 }, { type: "DEFECT", count: 5 }] }] }], paging: {} } };
const mappedYmStocks: any[] = [];
for (const w of ymStocksSample.result.warehouses) {
  for (const o of w.offers) {
    const byType: Record<string, number> = {};
    for (const st of o.stocks) byType[String(st.type).toUpperCase()] = Number(st.count ?? 0);
    mappedYmStocks.push({
      marketplace: "yandex_market", marketplace_product_id: String(o.offerId), size_id: null, seller_sku: o.offerId,
      warehouse: null, warehouse_id: String(w.warehouseId), region: null, fulfillment_model: "FBS",
      available: (byType.AVAILABLE ?? 0) || (byType.FIT ?? 0), reserved: byType.FREEZE ?? 0,
      in_transit_to_customer: 0, in_transit_from_customer: 0,
    });
  }
}
assert(StockSchema.array().safeParse(mappedYmStocks).success, "YM stocks mapping matches shared schema");
assert(mappedYmStocks[0].available === 74 && mappedYmStocks[0].reserved === 6,
  "YM stock types normalized: AVAILABLE->available, FREEZE->reserved, DEFECT excluded");
console.log("Ozon/YM real-API mappings ok (FBO/FBS split, stock-type normalization)");

/* ------------------------------------------------------------------ *
 * 8d. WB sandbox: sandbox mode must route to the test hosts, BUT "Analytics"
 *     has no sandbox and stays on production. That is a trap (stocks in
 *     sandbox mode read the real account), so the behaviour is pinned by a
 *     test rather than only by a comment.
 * ------------------------------------------------------------------ */
const prodClient: any = new WbClient("t", "conn", false);
const sandboxClient: any = new WbClient("t", "conn", true);
const hostOf = (c: any, g: string) => c.hostFor(g);

for (const g of ["content", "prices", "statistics"]) {
  assert(hostOf(sandboxClient, g).includes("sandbox"), `sandbox mode routes ${g} to sandbox host`);
  assert(!hostOf(prodClient, g).includes("sandbox"), `prod mode keeps ${g} on production host`);
}
for (const g of WB_GROUPS_WITHOUT_SANDBOX) {
  assert(!hostOf(sandboxClient, g).includes("sandbox"), `${g} has no sandbox — stays on production even in sandbox mode`);
}
console.log(`wb sandbox routing ok: 3 groups routed, ${WB_GROUPS_WITHOUT_SANDBOX.join("/")} stay production (no sandbox upstream)`);

/* ------------------------------------------------------------------ *
 * 9. Rate limiter: when the limit is exhausted the failure must be FAST and
 *    carry retry_after_ms, instead of blocking for maxWaitMs.
 * ------------------------------------------------------------------ */
const rl = new RateLimiter();
const rule = { requests: 1, perMs: 60_000 }; // same as the statistics group
await rl.acquire("t", rule);
const t0 = Date.now();
let rateErr: any;
try {
  await rl.acquire("t", rule, 15_000);
} catch (e) {
  rateErr = e;
}
const elapsed = Date.now() - t0;
assert(rateErr?.code === "RATE_LIMITED", "second acquire is rate limited");
assert(elapsed < 1_000, `rate limit fails fast (took ${elapsed}ms, must not block for maxWaitMs)`);
assert(typeof rateErr?.opts?.details?.retry_after_ms === "number", "RATE_LIMITED carries retry_after_ms");
console.log(`rate limiter ok: failed in ${elapsed}ms with retry_after_ms=${rateErr.opts.details.retry_after_ms}`);

// Waiting is worthwhile when a token arrives in time — check that path too.
const rl2 = new RateLimiter();
const fast = { requests: 1, perMs: 300 };
await rl2.acquire("f", fast);
const t1 = Date.now();
await rl2.acquire("f", fast, 5_000);
const waited = Date.now() - t1;
assert(waited >= 200 && waited < 2_000, `limiter waits when token arrives in time (waited ${waited}ms)`);
console.log(`rate limiter waits when useful: ${waited}ms`);

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL SMOKE TESTS PASSED");
process.exit(0);
