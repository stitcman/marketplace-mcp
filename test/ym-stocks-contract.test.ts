import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import type { RuntimeIdentity } from "../src/core/runtimeIdentity.js";

const identity: RuntimeIdentity = Object.freeze({ version: "0.4.0", commit: "d".repeat(40), manifest_sha256: "e".repeat(64), mode: "READ_ONLY", write_runtime_enabled: false });
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const payload = (r: any) => JSON.parse(r.content.find((x: any) => x.type === "text").text);
const store = new MemoryStore();
const connection = await store.addConnection({ marketplace: "yandex_market", name: "YM stocks", status: "active", mock: false, sandbox: false, permissions: ["stocks.read", "catalog.read"] }, { api_key: "test", business_id: "7" });
const server = buildServer(store, identity); const client = new Client({ name: "ym-stocks-contract", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
const originalFetch = globalThis.fetch; const calls: URL[] = []; const sellerRequests: string[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)); calls.push(url);
  if (url.pathname === "/v3/businesses/7/warehouses") {
    assert(url.searchParams.get("limit") === "30", "seller warehouse discovery must use the official bounded maximum limit=30");
    const token = url.searchParams.get("pageToken");
    return json(token ? { result: { warehouses: [{ id: 30, name: "C", models: [{ type: "FBS", apiAvailability: "AVAILABLE" }] }], paging: {} } } : { result: { warehouses: [{ id: 20, name: "B", models: [{ type: "FBS", apiAvailability: "AVAILABLE" }] }, { id: 10, name: "A", models: [{ type: "FBS", apiAvailability: "AVAILABLE" }] }], paging: { nextPageToken: "warehouse-2" } } });
  }
  if (url.pathname === "/v3/businesses/7/offers/stocks") {
    const body = JSON.parse(String(init?.body)); const warehouse = String(body.partnerWarehouseId ?? ""); const token = url.searchParams.get("pageToken");
    assert(!url.searchParams.has("partnerWarehouseId"), "seller stock warehouse id must not be sent as a query parameter");
    assert(Number.isInteger(body.partnerWarehouseId), "seller stock body must contain numeric partnerWarehouseId from discovery warehouse.id");
    sellerRequests.push(`${warehouse}:${token ?? ""}`);
    assert(!url.searchParams.has("page_token"), "seller stocks must not send page_token");
    if (warehouse === "10") return json(token ? { result: { partnerWarehouseId: 10, offers: [{ offerId: "a-2", stocks: [{ type: "FIT", count: 2 }] }], paging: {} } } : { result: { partnerWarehouseId: 10, offers: [{ offerId: "a-1", stocks: [{ type: "AVAILABLE", count: 1 }, { type: "FREEZE", count: 1 }] }], paging: { nextPageToken: "stock-a-2" } } });
    if (warehouse === "20") return json({ result: { partnerWarehouseId: 20, offers: [], paging: {} } });
    if (warehouse === "30") return json({ result: { partnerWarehouseId: 30, offers: [{ offerId: "c-1", stocks: [{ type: "AVAILABLE", count: 3 }] }], paging: {} } });
  }
  if (url.pathname === "/v2/campaigns") return json({ campaigns: [{ id: 100, business: { id: 7 }, placementType: "FBY" }, { id: 200, business: { id: 7 }, placementType: "FBS" }] });
  if (url.pathname === "/v2/campaigns/100/offers/stocks") return json({ result: { warehouses: [{ warehouseId: 1, offers: [{ offerId: "fby", stocks: [{ type: "AVAILABLE", count: 3 }] }] }], paging: {} } });
  if (url.pathname === "/v2/campaigns/200/offers/stocks") return json({ result: { warehouses: [{ warehouseId: 1, offers: [{ offerId: "fbs", stocks: [{ type: "FIT", count: 3 }] }] }], paging: {} } });
  throw new Error(`unexpected URL ${url}`);
};
try {
  const call = async (cursor?: string) => payload(await client.callTool({ name: "ym_stocks_get", arguments: { connection_id: connection.connection_id, business_id: "7", limit: 1, ...(cursor ? { cursor } : {}) } }));
  const first = await call(); assert(first.success, "seller stock request must put numeric discovery warehouse.id in body.partnerWarehouseId"); assert(first.data.items[0].seller_sku === "a-1" && first.data.items[0].warehouse === "A", "first deterministic warehouse page must be returned with its name"); assert(first.data.items[0].available === 1 && first.data.items[0].reserved === 1, "stock type normalization must keep available and reserved separate");
  const second = await call(first.data.next_cursor); assert(second.success && second.data.items[0].seller_sku === "a-2" && second.data.items[0].warehouse_id === "10", "same warehouse stock continuation must not skip or duplicate");
  const third = await call(second.data.next_cursor); assert(third.success && third.data.items.length === 0 && third.data.has_more, "empty warehouse must advance boundedly without terminating later warehouses");
  const fourth = await call(third.data.next_cursor); assert(fourth.success && fourth.data.items[0].seller_sku === "c-1" && !fourth.data.has_more, "later warehouse-discovery page must be reached exactly once");
  assert(sellerRequests.join(",") === "10:,10:stock-a-2,20:,30:", "seller cursor must preserve warehouse/page state without replaying prior stock pages");
  const invalid = await call(Buffer.from(JSON.stringify({ v: 2, kind: "ym_seller_stocks" })).toString("base64")); assert(!invalid.success && invalid.error.code === "INVALID_ARGUMENT", "unknown seller cursor version must reject safely");
  const fby = payload(await client.callTool({ name: "ym_stocks_get", arguments: { connection_id: connection.connection_id, campaign_id: "100", limit: 5 } })); assert(fby.success && fby.data.items[0].fulfillment_model === "FBO", "FBY campaign must normalize as FBO");
  const fbs = payload(await client.callTool({ name: "ym_stocks_get", arguments: { connection_id: connection.connection_id, campaign_id: "200", limit: 5 } })); assert(fbs.success && fbs.data.items[0].fulfillment_model === "FBS", "FBS campaign must normalize as FBS");
  console.log("YM stock contract: PASS");
} finally { globalThis.fetch = originalFetch; await Promise.all([client.close(), server.close()]); }
