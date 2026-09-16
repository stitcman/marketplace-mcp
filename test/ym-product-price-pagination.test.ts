import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import type { RuntimeIdentity } from "../src/core/runtimeIdentity.js";

const runtimeIdentity: RuntimeIdentity = Object.freeze({
  version: "0.4.0", commit: "d".repeat(40), manifest_sha256: "e".repeat(64), mode: "READ_ONLY", write_runtime_enabled: false,
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function payloadOf(response: any) {
  const text = response.content?.find((item: any) => item.type === "text")?.text;
  assert(typeof text === "string", "tool response must contain JSON text");
  return JSON.parse(text);
}

const store = new MemoryStore();
const connection = await store.addConnection({
  marketplace: "yandex_market", name: "Yandex product-price pagination test", status: "active", mock: false, sandbox: false,
  permissions: ["catalog.read", "prices.read"],
}, { api_key: "test-api-key", business_id: "7" });
const server = buildServer(store, runtimeIdentity);
const client = new Client({ name: "ym-product-price-pagination", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const originalFetch = globalThis.fetch;
const requests: URL[] = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requests.push(url);
  assert(url.pathname === "/v2/businesses/7/offer-mappings", `unexpected URL ${url}`);
  return new Response(JSON.stringify({
    result: {
      offerMappings: [{ offer: { offerId: `offer-${requests.length}`, name: "Name", basicPrice: { value: 10, discountBase: 12, currencyId: "RUB" } } }],
      paging: url.searchParams.get("pageToken") ? {} : { nextPageToken: "next-page" },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  for (const name of ["ym_products_list", "ym_prices_get"] as const) {
    const first = payloadOf(await client.callTool({ name, arguments: { connection_id: connection.connection_id, business_id: "7", limit: 5 } }));
    assert(first.success === true && first.data.next_cursor, `${name} page 1 must expose a continuation`);
    const second = payloadOf(await client.callTool({ name, arguments: { connection_id: connection.connection_id, business_id: "7", limit: 5, cursor: first.data.next_cursor } }));
    assert(second.success === true, `${name} page 2 must succeed`);
    const request = requests.at(-1)!;
    assert(request.searchParams.get("limit") === "5", `${name} must preserve bounded limit`);
    assert(request.searchParams.get("pageToken") === "next-page", `${name} must map cursor to official pageToken`);
    assert(!request.searchParams.has("page_token"), `${name} must not send page_token`);
  }
  console.log("YM product/price pagination: PASS");
} finally {
  globalThis.fetch = originalFetch;
  await Promise.all([client.close(), server.close()]);
}
