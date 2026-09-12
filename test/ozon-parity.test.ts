import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { findReadMethod, getReadPolicy } from "../src/core/readPolicies.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import {
  executeApprovedReadPage,
  redactForEvidence,
  type ReadMethod,
  type ReadTransport,
} from "../src/core/readPolicy.js";

const OZON = "00000000-0000-4000-8000-000000000011";

const required = [
  ["AccessAPI_RolesByToken", "catalog.read", "none"],
  ["SellerAPI_SellerInfo", "catalog.read", "none"],
  ["WarehouseListV2", "warehouses.read", "bounded"],
  ["returnsList", "returns.read", "bounded"],
  ["PostingFbsUnfulfilledList", "orders.read", "bounded"],
] as const;

const policy = getReadPolicy("ozon");
assert(policy.length > required.length, "representative parity methods must not narrow the full Ozon READ allowlist");
for (const [methodId, permission, pagination] of required) {
  const method = findReadMethod("ozon", methodId);
  assert(method, `${methodId}: available through generic READ`);
  assert.equal(method.permission, permission, `${methodId}: least-privilege permission`);
  assert.equal(method.pagination, pagination, `${methodId}: pagination class`);
}

const store = new MemoryStore();
const ozon = await store.getConnection(OZON);
assert(ozon, "Ozon demo connection exists");
assert.deepEqual(
  [...ozon.permissions].sort(),
  ["catalog.read", "orders.read", "prices.read", "returns.read", "stocks.read", "warehouses.read"].sort(),
  "Ozon READ connection exposes only the required READ permissions",
);

class FixedTransport implements ReadTransport {
  calls = 0;
  constructor(private readonly response: unknown) {}
  async send() {
    this.calls += 1;
    return this.response;
  }
}

{
  const restricted = await store.addConnection({
    marketplace: "ozon",
    name: "Restricted Ozon READ",
    status: "active",
    mock: false,
    sandbox: false,
    permissions: ["catalog.read", "orders.read"],
  }, { client_id: "test-client", api_key: "test-key" });
  for (const methodId of ["WarehouseListV2", "returnsList"]) {
    const method = findReadMethod("ozon", methodId);
    assert(method, `${methodId}: method exists`);
    const transport = new FixedTransport({});
    await assert.rejects(
      executeApprovedReadPage({ store, marketplace: "ozon", connectionId: restricted.connection_id, method, params: { limit: 1 }, transport }),
      (error: any) => error?.code === "PERMISSION_DENIED",
      `${methodId}: missing least-privilege permission is denied`,
    );
    assert.equal(transport.calls, 0, `${methodId}: permission denial sends HTTP_REQUESTS_SENT=0`);
  }
}

async function page(methodId: string, params: Record<string, unknown>, response: unknown) {
  const method = findReadMethod("ozon", methodId);
  assert(method, `${methodId}: method exists`);
  const transport = new FixedTransport(response);
  const result = await executeApprovedReadPage({
    store,
    marketplace: "ozon",
    connectionId: OZON,
    method,
    params,
    transport,
  });
  assert.equal(transport.calls, 1, `${methodId}: one page sends one request`);
  return result;
}

for (const [methodId] of required) {
  const params = methodId === "WarehouseListV2" || methodId === "returnsList" || methodId === "PostingFbsUnfulfilledList"
    ? { limit: 1 }
    : {};
  const raw = { result: { marker: methodId } };
  const result = await page(methodId, params, raw);
  assert.deepEqual(result.payload, raw, `${methodId}: raw payload is preserved`);
}

{
  const raw = { result: [{ warehouse_id: 1 }], cursor: "cursor-2" };
  const result = await page("WarehouseListV2", { limit: 1, cursor: "cursor-1" }, raw);
  assert.deepEqual(result.payload, raw, "cursor page remains lossless");
  assert.deepEqual(result.continuation, {
    kind: "cursor",
    has_more: true,
    request_patch: { cursor: "cursor-2" },
  });
}

{
  const result = await page("WarehouseListV2", { limit: 1, cursor: "cursor-1" }, { result: [], cursor: "cursor-1" });
  assert.deepEqual(result.continuation, { kind: "cursor", has_more: false, request_patch: null }, "repeated cursor stops");
}

{
  const raw = { result: { postings: [{ posting_number: "A" }, { posting_number: "B" }], has_next: true } };
  const result = await page(
    "PostingAPI_GetFbsPostingUnfulfilledList",
    { filter: { cutoff_from: "2026-01-01T00:00:00Z", cutoff_to: "2026-01-02T00:00:00Z" }, limit: 2, offset: 4 },
    raw,
  );
  assert.deepEqual(result.continuation, {
    kind: "offset",
    has_more: true,
    request_patch: { offset: 6 },
  }, "offset advances by returned records without gaps or duplicates");
}

{
  const result = await page(
    "PostingAPI_GetFbsPostingUnfulfilledList",
    { filter: { cutoff_from: "2026-01-01T00:00:00Z", cutoff_to: "2026-01-02T00:00:00Z" }, limit: 2, offset: 4 },
    { result: { postings: [{ posting_number: "A" }] } },
  );
  assert.deepEqual(result.continuation, { kind: "offset", has_more: false, request_patch: null }, "short offset page stops");
}

{
  const raw = { returns: [{ id: 41 }], last_id: 41 };
  const result = await page("returnsList", { limit: 1, last_id: 40 }, raw);
  assert.deepEqual(result.continuation, {
    kind: "last_id",
    has_more: true,
    request_patch: { last_id: 41 },
  });
}

{
  const result = await page("returnsList", { limit: 1, last_id: 41 }, { returns: [], last_id: 41 });
  assert.deepEqual(result.continuation, { kind: "last_id", has_more: false, request_patch: null }, "empty repeated last_id stops");
}

{
  const result = await page("returnsList", { limit: 1 }, { returns: [{ id: 1 }], last_id: 0 });
  assert.deepEqual(result.continuation, { kind: "last_id", has_more: false, request_patch: null }, "zero last_id stops");
}

{
  const raw = {
    result: {
      postings: [{ posting_number: "P-1", buyer_name: "Иван", phone: "+70000000000", address: "Москва" }],
    },
  };
  const result = await page("PostingFbsUnfulfilledList", { limit: 1 }, raw);
  assert.deepEqual(result.payload, raw, "normalization payload preserves marketplace PII and fields losslessly");

  const evidence = redactForEvidence({
    ...raw,
    api_key: "secret-api-key",
    authorization: "secret-bearer",
    nested: { client_id: "12345", email: "buyer@example.test" },
  });
  const serialized = JSON.stringify(evidence);
  for (const forbidden of ["Иван", "+70000000000", "Москва", "secret-api-key", "secret-bearer", "12345", "buyer@example.test"]) {
    assert(!serialized.includes(forbidden), `redacted evidence excludes ${forbidden}`);
  }
  assert(serialized.includes("[REDACTED]"), "evidence retains explicit redaction markers");
}

{
  const method = findReadMethod("ozon", "AccessAPI_RolesByToken");
  assert(method, "roles method exists");
  const transport = new FixedTransport({ roles: [{ name: "x".repeat(300_000) }] });
  await assert.rejects(
    executeApprovedReadPage({ store, marketplace: "ozon", connectionId: OZON, method, params: {}, transport }),
    (error: any) => error?.code === "BULK_LIMIT_EXCEEDED",
    "oversized raw pages fail explicitly instead of truncating normalization input",
  );
}

{
  const integrationStore = new MemoryStore();
  const connection = await integrationStore.addConnection({
    marketplace: "ozon",
    name: "Ozon parity integration",
    status: "active",
    mock: false,
    sandbox: false,
    permissions: ["warehouses.read"],
  }, { client_id: "credential-client-id", api_key: "credential-api-key" });
  const server = buildServer(integrationStore);
  const client = new Client({ name: "ozon-parity", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const tools = await client.listTools();
  const executeTool = tools.tools.find((tool) => tool.name === "ozon_read_execute");
  assert(executeTool, "generic Ozon execute tool exists");
  const inputProperties = (executeTool.inputSchema as any).properties ?? {};
  for (const credentialName of ["client_id", "api_key", "authorization", "token"]) {
    assert(!(credentialName in inputProperties), `${credentialName}: absent from generic tool arguments`);
  }
  assert(!("include_sensitive" in inputProperties), "raw normalization output is not controlled by an evidence-redaction flag");
  assert(!("view" in inputProperties), "generic execution has one explicit lossless page contract");

  const capabilityResponse: any = await client.callTool({ name: "marketplace_capabilities", arguments: { connection_id: OZON } });
  const capabilityPayload = JSON.parse(capabilityResponse.content[0].text);
  assert.deepEqual(capabilityPayload.data.capabilities, {
    catalog_read: true,
    stocks_read: true,
    orders_read: true,
    price_read: true,
    warehouses_read: true,
    returns_read: true,
    price_write: false,
  }, "Ozon capability summary exposes all required READ permissions and disabled WRITE");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: [{ warehouse_id: 7, name: "FBS" }], cursor: "cursor-2" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    const response: any = await client.callTool({
      name: "ozon_read_execute",
      arguments: { connection_id: connection.connection_id, method_id: "WarehouseListV2", params: { limit: 1, cursor: "cursor-1" } },
    });
    const payload = JSON.parse(response.content[0].text);
    assert.deepEqual(payload.data, { result: [{ warehouse_id: 7, name: "FBS" }], cursor: "cursor-2" }, "generic output preserves the raw page");
    assert.deepEqual(payload.meta.continuation, {
      kind: "cursor",
      has_more: true,
      request_patch: { cursor: "cursor-2" },
    }, "generic output exposes the continuation contract");
    const serialized = JSON.stringify(payload);
    assert(!serialized.includes("credential-client-id"), "client ID never enters tool output");
    assert(!serialized.includes("credential-api-key"), "API key never enters tool output");
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([client.close(), server.close()]);
  }
}

console.log("Ozon parity contract: PASS (5 capabilities; cursor/offset/last_id; raw/evidence split)");
