import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import type { RuntimeIdentity } from "../src/core/runtimeIdentity.js";
const identity: RuntimeIdentity = Object.freeze({ version: "0.4.0", commit: "d".repeat(40), manifest_sha256: "e".repeat(64), mode: "READ_ONLY", write_runtime_enabled: false });
const assert = (v: unknown, m: string): asserts v => { if (!v) throw new Error(m); };
const store = new MemoryStore(); const connection = await store.addConnection({ marketplace: "yandex_market", name: "YM orders", status: "active", mock: false, sandbox: false, permissions: ["orders.read"] }, { api_key: "test", business_id: "7" });
const server = buildServer(store, identity); const client = new Client({ name: "ym-orders-contract", version: "1" }); const [ct, st] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(ct), server.connect(st)]);
const originalFetch = globalThis.fetch; const requests: Array<{ url: URL; body: any }> = [];
const orders = Array.from({ length: 12 }, (_, index) => ({ orderId: index + 1, campaignId: 9, status: "PROCESSING", creationDate: "2026-09-15T00:00:00Z", items: [{ offerId: `sku-${index + 1}`, count: 2, prices: { buyerPrice: 12.5 }, marketSku: index + 3 }] }));
globalThis.fetch = async (input, init) => { const url = new URL(String(input)); const body = JSON.parse(String(init?.body)); requests.push({ url, body }); const firstPage = !url.searchParams.has("pageToken"); return new Response(JSON.stringify(firstPage ? { orders, paging: { nextPageToken: "upstream-2" } } : { orders: [], paging: {} }), { status: 200, headers: { "content-type": "application/json" } }); };
try {
  const call = async (cursor?: string, dateTo = "2026-09-16") => JSON.parse((await client.callTool({ name: "ym_orders_list", arguments: { connection_id: connection.connection_id, business_id: "7", date_from: "2026-09-14", date_to: dateTo, limit: 5, ...(cursor ? { cursor } : {}) } })).content.find((x: any) => x.type === "text").text);
  const first = await call(); assert(first.success && first.data.items.length === 5 && first.data.items[0].amount.amount === "25.00", "public limit must bound normalized order rows and map buyer price");
  const second = await call(first.data.next_cursor); assert(second.success && second.data.items.length === 5 && second.data.items[0].seller_sku === "sku-6", "compound cursor must resume inside one upstream page");
  const third = await call(second.data.next_cursor); assert(third.success && third.data.items.length === 2 && third.data.has_more, "final residual must be returned without duplicates before advancing upstream");
  const fourth = await call(third.data.next_cursor); assert(fourth.success && fourth.data.items.length === 0 && !fourth.data.has_more, "cursor must advance to the following upstream page only after residual rows");
  assert(requests.slice(0, 3).every((r) => r.url.searchParams.get("limit") === "5" && !r.url.searchParams.has("page_token") && !r.url.searchParams.has("pageToken")) && requests[3].url.searchParams.get("pageToken") === "upstream-2", "residual normalized rows must re-fetch the same bounded upstream request");
  assert(JSON.stringify(requests[0].body) === JSON.stringify({ dates: { creationDateFrom: "2026-09-14", creationDateTo: "2026-09-16" } }), "orders must use official dates body");
  const cursorText = Buffer.from(first.data.next_cursor, "base64").toString("utf8"); assert(!cursorText.includes("sku-1") && !cursorText.includes("orderId"), "orders cursor must not serialize normalized order data");
  const mismatch = await call(first.data.next_cursor, "2026-09-17"); assert(!mismatch.success && mismatch.error.code === "INVALID_ARGUMENT", "cursor binding must reject changed date range");
  const malformed = await call("not-a-valid-cursor"); assert(!malformed.success && malformed.error.code === "INVALID_ARGUMENT", "malformed orders cursor must reject safely");
  const unknownVersion = await call(Buffer.from(JSON.stringify({ v: 2, kind: "ym_orders" })).toString("base64")); assert(!unknownVersion.success && unknownVersion.error.code === "INVALID_ARGUMENT", "unknown orders cursor version must reject safely");
  console.log("YM orders contract: PASS");
} finally { globalThis.fetch = originalFetch; await Promise.all([client.close(), server.close()]); }
