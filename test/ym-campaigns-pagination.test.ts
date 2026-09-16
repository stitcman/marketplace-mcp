import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import type { RuntimeIdentity } from "../src/core/runtimeIdentity.js";

const runtimeIdentity: RuntimeIdentity = Object.freeze({
  version: "0.4.0",
  commit: "d".repeat(40),
  manifest_sha256: "e".repeat(64),
  mode: "READ_ONLY",
  write_runtime_enabled: false,
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
  marketplace: "yandex_market",
  name: "Yandex campaigns pagination test",
  status: "active",
  mock: false,
  sandbox: false,
  permissions: ["catalog.read"],
}, { api_key: "test-api-key" });
const server = buildServer(store, runtimeIdentity);
const client = new Client({ name: "ym-campaigns-pagination", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const originalFetch = globalThis.fetch;
const requests: URL[] = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requests.push(url);
  assert(url.pathname === "/v2/campaigns", `unexpected URL ${url}`);
  const token = url.searchParams.get("pageToken");
  return new Response(JSON.stringify(token
    ? { campaigns: [{ id: 2, domain: "second", business: { id: 7, name: "B" }, placementType: "FBS" }], paging: {} }
    : { campaigns: [{ id: 1, domain: "first", business: { id: 7, name: "B" }, placementType: "FBY" }], paging: { nextPageToken: "next-page" } },
  ), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const first = payloadOf(await client.callTool({
    name: "ym_campaigns_list",
    arguments: { connection_id: connection.connection_id, limit: 5 },
  }));
  assert(first.success === true, `campaigns page 1 must succeed: ${JSON.stringify(first)}`);
  assert(first.data.items.length === 1, "campaigns page 1 must return upstream items");
  assert(first.data.has_more === true && typeof first.data.next_cursor === "string", "nextPageToken must become next_cursor");
  assert(requests.length === 1, "campaigns page 1 must issue one upstream request");
  assert(requests[0].searchParams.get("limit") === "5", "campaigns page 1 must send requested limit");
  assert(!requests[0].searchParams.has("page"), "campaigns page 1 must not send legacy page");
  assert(!requests[0].searchParams.has("pageSize"), "campaigns page 1 must not send legacy pageSize");
  assert(!requests[0].searchParams.has("pageToken"), "campaigns page 1 must omit pageToken");
  assert(!requests[0].searchParams.has("page_token"), "campaigns page 1 must not send page_token");

  const second = payloadOf(await client.callTool({
    name: "ym_campaigns_list",
    arguments: { connection_id: connection.connection_id, limit: 5, cursor: first.data.next_cursor },
  }));
  assert(second.success === true && second.data.items[0].campaign_id === "2", "campaigns page 2 must differ from page 1");
  assert(requests.length === 2 && requests[1].searchParams.get("pageToken") === "next-page", "campaigns continuation must send decoded pageToken");
  assert(!requests[1].searchParams.has("page_token"), "campaigns continuation must not send page_token");
  console.log("YM campaigns pagination: PASS");
} finally {
  globalThis.fetch = originalFetch;
  await Promise.all([client.close(), server.close()]);
}
