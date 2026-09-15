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

async function callOrders(cursor?: string) {
  const store = new MemoryStore();
  const connection = await store.addConnection({
    marketplace: "wildberries",
    name: "WB orders continuation test",
    status: "active",
    mock: false,
    sandbox: false,
    permissions: ["orders.read"],
  }, { token: "test-token" });
  const server = buildServer(store, runtimeIdentity);
  const client = new Client({ name: "wb-orders-continuation", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const response: any = await client.callTool({
      name: "wb_orders_list",
      arguments: {
        connection_id: connection.connection_id,
        date_from: "2026-09-14T00:00:00",
        limit: 2,
        ...(cursor ? { cursor } : {}),
      },
    });
    return JSON.parse(response.content.find((item: any) => item.type === "text").text);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

const originalFetch = globalThis.fetch;
const requestedDates: string[] = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  assert(url.pathname === "/api/v1/supplier/orders", `unexpected URL ${url}`);
  const dateFrom = url.searchParams.get("dateFrom") ?? "";
  requestedDates.push(dateFrom);
  const rows = dateFrom === "2026-09-14T01:00:00"
    ? [
        { srid: "B", date: "2026-09-14T00:30:00", lastChangeDate: "2026-09-14T01:00:00", nmId: 2, supplierArticle: "B", priceWithDisc: 20, warehouseName: "W", isCancel: false },
        { srid: "C", date: "2026-09-14T01:30:00", lastChangeDate: "2026-09-14T02:00:00", nmId: 3, supplierArticle: "C", priceWithDisc: 30, warehouseName: "W", isCancel: false },
      ]
    : [
        { srid: "A", date: "2026-09-14T00:00:00", lastChangeDate: "2026-09-14T00:30:00", nmId: 1, supplierArticle: "A", priceWithDisc: 10, warehouseName: "W", isCancel: false },
        { srid: "B", date: "2026-09-14T00:30:00", lastChangeDate: "2026-09-14T01:00:00", nmId: 2, supplierArticle: "B", priceWithDisc: 20, warehouseName: "W", isCancel: false },
        { srid: "C", date: "2026-09-14T01:30:00", lastChangeDate: "2026-09-14T02:00:00", nmId: 3, supplierArticle: "C", priceWithDisc: 30, warehouseName: "W", isCancel: false },
      ];
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
};

try {
  const first = await callOrders();
  assert(first.success === true, "orders page 1 must succeed");
  assert(first.data.items.map((item: any) => item.order_id).join(",") === "A,B", "orders page 1 must return the requested bounded page");
  assert(first.data.has_more === true && first.data.next_cursor, "orders page 1 must expose continuation");

  const second = await callOrders(first.data.next_cursor);
  assert(second.success === true, "orders page 2 must succeed");
  assert(requestedDates.join(",") === "2026-09-14T00:00:00,2026-09-14T01:00:00", "orders page 2 must advance upstream dateFrom to lastChangeDate");
  assert(second.data.items.map((item: any) => item.order_id).join(",") === "C", "orders page 2 must remove the inclusive boundary duplicate");
  console.log("WB orders lastChangeDate continuation: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
