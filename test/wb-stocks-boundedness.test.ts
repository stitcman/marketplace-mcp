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

let failures = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL: ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function withRealWbClient(run: (client: Client) => Promise<void>) {
  const store = new MemoryStore();
  const connection = await store.addConnection({
    marketplace: "wildberries",
    name: "WB boundedness test",
    status: "active",
    mock: false,
    sandbox: false,
    permissions: ["catalog.read", "stocks.read", "orders.read", "prices.read"],
  }, { token: "test-token" });
  const server = buildServer(store, runtimeIdentity);
  const client = new Client({ name: "wb-stocks-boundedness", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await run(Object.assign(client, { connectionId: connection.connection_id }));
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function connectionId(client: Client): string {
  return (client as Client & { connectionId: string }).connectionId;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function payloadOf(response: any) {
  const text = response.content?.find((item: any) => item.type === "text")?.text;
  assert(typeof text === "string", "tool response must contain JSON text");
  return JSON.parse(text);
}

await check("public stocks contract exposes default 100, max 1000, and cursor", async () => {
  await withRealWbClient(async (client) => {
    const tools = await client.listTools();
    const stocks = tools.tools.find((tool) => tool.name === "wb_stocks_get");
    const props = (stocks?.inputSchema as any)?.properties;
    assert(props?.limit?.default === 100, "wb_stocks_get limit must default to 100");
    assert(props?.limit?.maximum === 1000, "wb_stocks_get limit must have hard maximum 1000");
    assert(props?.cursor?.type === "string", "wb_stocks_get must expose an opaque cursor");
  });
});

await check("FBO propagates a bounded limit and advances offset continuation", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/analytics/v1/stocks-report/wb-warehouses") {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      assert(body.limit <= 1000, "FBO upstream limit must never exceed 1000");
      const start = Number(body.offset ?? 0) + 1;
      return jsonResponse({ data: { items: Array.from({ length: body.limit }, (_, index) => ({
        nmId: start + index,
        chrtId: 1000 + start + index,
        warehouseId: 507,
        warehouseName: "Warehouse",
        regionName: "Region",
        quantity: 10,
        inWayToClient: 1,
        inWayFromClient: 2,
      })) } });
    }
    if (url.pathname === "/content/v2/get/cards/list") return jsonResponse({ cards: [], cursor: { total: 0 } });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    await withRealWbClient(async (client) => {
      const first = payloadOf(await client.callTool({
        name: "wb_stocks_get",
        arguments: { connection_id: connectionId(client), fulfillment_model: "FBO", limit: 2 },
      }));
      assert(first.success === true, `FBO page 1 must succeed: ${JSON.stringify(first)}`);
      assert(first.data.items.length === 2, "FBO page 1 must respect public limit");
      assert(first.data.has_more === true && typeof first.data.next_cursor === "string", "FBO page 1 must expose continuation");
      const second = payloadOf(await client.callTool({
        name: "wb_stocks_get",
        arguments: { connection_id: connectionId(client), fulfillment_model: "FBO", limit: 2, cursor: first.data.next_cursor },
      }));
      assert(second.data.items.length === 2, "FBO page 2 must respect public limit");
      assert(second.data.items[0].marketplace_product_id !== first.data.items[0].marketplace_product_id, "FBO page 2 must differ from page 1");
      assert(bodies.length === 2 && bodies[0].limit === 2 && bodies[0].offset === 0 && bodies[1].offset === 2, "FBO must advance offset by returned rows");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check("default FBO call cannot create an unbounded response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedLimit = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/analytics/v1/stocks-report/wb-warehouses") {
      const body = JSON.parse(String(init?.body));
      requestedLimit = body.limit;
      assert(body.limit <= 100, "default upstream work must be bounded by the public default");
      return jsonResponse({ data: { items: Array.from({ length: body.limit }, (_, index) => ({
        nmId: index + 1, chrtId: index + 1, warehouseId: 1, warehouseName: "W", regionName: "R", quantity: 1,
      })) } });
    }
    if (url.pathname === "/content/v2/get/cards/list") return jsonResponse({ cards: [], cursor: { total: 0 } });
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    await withRealWbClient(async (client) => {
      const result = payloadOf(await client.callTool({
        name: "wb_stocks_get",
        arguments: { connection_id: connectionId(client), fulfillment_model: "FBO" },
      }));
      assert(result.success === true, `default FBO call must succeed: ${JSON.stringify(result)}`);
      assert(requestedLimit === 100, "default FBO upstream limit must be exactly 100");
      assert(result.data.items.length === 100, "serialized output must be bounded by default limit");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check("FBS uses Marketplace inventory and paginates deterministically across every warehouse", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; pathname: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, pathname: url.pathname, body });
    if (url.hostname === "marketplace-api.wildberries.ru" && url.pathname === "/api/v3/warehouses") {
      return jsonResponse([
        { id: 20, name: "Warehouse B", isDeleting: false },
        { id: 10, name: "Warehouse A", isDeleting: false },
      ]);
    }
    if (url.pathname === "/content/v2/get/cards/list") {
      return jsonResponse({
        cards: [
          { nmID: 101, vendorCode: "A", sizes: [{ chrtID: 1001, skus: ["1"] }] },
          { nmID: 102, vendorCode: "B", sizes: [{ chrtID: 1002, skus: ["2"] }] },
        ],
        cursor: { total: 2, updatedAt: "2026-01-01T00:00:00Z", nmID: 102 },
      });
    }
    const match = url.pathname.match(/^\/api\/v3\/stocks\/(\d+)$/);
    if (url.hostname === "marketplace-api.wildberries.ru" && match) {
      assert(method === "POST", "FBS inventory must use POST read endpoint");
      assert(JSON.stringify(body?.chrtIds) === "[1001,1002]", "FBS inventory must send bounded chrtIds");
      return jsonResponse({ stocks: body.chrtIds.map((chrtId: number) => ({ chrtId, amount: Number(match[1]) + chrtId })) });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  try {
    await withRealWbClient(async (client) => {
      const first = payloadOf(await client.callTool({
        name: "wb_stocks_get",
        arguments: { connection_id: connectionId(client), fulfillment_model: "FBS", limit: 2 },
      }));
      assert(first.success === true && first.data.items.length === 2, "FBS page 1 must be bounded");
      assert(first.data.items.every((item: any) => item.warehouse_id === "10"), "first FBS page must use the first sorted warehouse");
      assert(first.data.has_more === true && first.data.next_cursor, "FBS page 1 must continue to the next warehouse");
      const second = payloadOf(await client.callTool({
        name: "wb_stocks_get",
        arguments: { connection_id: connectionId(client), fulfillment_model: "FBS", limit: 2, cursor: first.data.next_cursor },
      }));
      assert(second.success === true && second.data.items.length === 2, "FBS page 2 must be bounded");
      assert(second.data.items.every((item: any) => item.warehouse_id === "20"), "second FBS page must advance to the next warehouse");
      assert(!calls.some((call) => call.pathname.includes("seller-warehouses")), "obsolete Analytics seller-warehouses endpoint must never be used");
      assert(calls.filter((call) => /^\/api\/v3\/stocks\//.test(call.pathname)).length === 2, "exactly one bounded inventory request is made per page");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

if (failures > 0) {
  console.error(`WB stocks boundedness: FAIL (${failures} checks)`);
  process.exit(1);
}

console.log("WB stocks boundedness: PASS");
