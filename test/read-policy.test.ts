import assert from "node:assert/strict";
import { MemoryStore } from "../src/core/store.js";
import { executeApprovedRead, type ReadMethod, type ReadTransport } from "../src/core/readPolicy.js";

const OZON = "00000000-0000-4000-8000-000000000011";
const WB = "00000000-0000-4000-8000-000000000001";
const method: ReadMethod = {
  method_id: "test.read",
  domain: "catalog",
  path: "/v1/items/{itemId}",
  http_method: "POST",
  safety: "read",
  reason: "test read",
  permission: "catalog.read",
  endpoint_group: "catalog",
  pagination: "none",
  file_download: false,
  report_job: false,
  sensitive_data: false,
  source_version: "test",
  source_hash: "0".repeat(64),
  input_schema: {
    type: "object",
    required: ["itemId"],
    properties: { itemId: { type: "string", maxLength: 20 }, limit: { type: "integer", minimum: 1, maximum: 100 } },
    additionalProperties: false,
  },
};

class SpyTransport implements ReadTransport {
  calls = 0;
  async send() { this.calls++; return { items: [{ id: "1", buyerName: "Иван", customerPhone: "+70000000000", deliveryAddress: "Москва" }] }; }
}

async function denied(label: string, fn: () => Promise<unknown>, transport: SpyTransport) {
  await assert.rejects(fn, (error: any) => error?.code && ["LOCAL_DENY", "PERMISSION_DENIED", "CONNECTION_NOT_FOUND", "INVALID_ARGUMENT", "WRITE_DISABLED"].includes(error.code), label);
  assert.equal(transport.calls, 0, `${label}: HTTP_REQUESTS_SENT=0`);
}

const store = new MemoryStore();

{
  const transport = new SpyTransport();
  const result = await executeApprovedRead({ store, marketplace: "ozon", connectionId: OZON, method, params: { itemId: "sku-1", limit: 10 }, transport });
  assert.equal(transport.calls, 1, "allowed READ sends exactly one HTTP request");
  assert.equal((result as any).items.length, 1);
}

{
  const transport = new SpyTransport();
  const result = await executeApprovedRead({ store, marketplace: "ozon", connectionId: OZON, method: { ...method, sensitive_data: true }, params: { itemId: "sku-1" }, transport });
  assert.equal((result as any).items[0].buyerName, "[REDACTED]");
  assert.equal((result as any).items[0].customerPhone, "[REDACTED]");
  assert.equal((result as any).items[0].deliveryAddress, "[REDACTED]");
}

{
  const transport = new SpyTransport();
  await denied("wrong marketplace", () => executeApprovedRead({ store, marketplace: "ozon", connectionId: WB, method, params: { itemId: "1" }, transport }), transport);
}

{
  const transport = new SpyTransport();
  await denied("bad params", () => executeApprovedRead({ store, marketplace: "ozon", connectionId: OZON, method, params: { itemId: 7 }, transport }), transport);
}

{
  const transport = new SpyTransport();
  await denied("oversized input", () => executeApprovedRead({ store, marketplace: "ozon", connectionId: OZON, method, params: { itemId: "x".repeat(70_000) }, transport }), transport);
}

{
  const transport = new SpyTransport();
  await denied("write method", () => executeApprovedRead({ store, marketplace: "ozon", connectionId: OZON, method: { ...method, safety: "write" as any }, params: { itemId: "1" }, transport }), transport);
}

console.log("read policy boundary: PASS");
