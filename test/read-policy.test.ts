import assert from "node:assert/strict";
import fs from "node:fs";
import { MemoryStore } from "../src/core/store.js";
import { executeApprovedRead, type ReadMethod, type ReadTransport } from "../src/core/readPolicy.js";

const OZON = "00000000-0000-4000-8000-000000000011";
const WB = "00000000-0000-4000-8000-000000000001";
const YM = "00000000-0000-4000-8000-000000000021";
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

const ozonInventory = JSON.parse(fs.readFileSync(new URL("../inventory/ozon-operations.json", import.meta.url), "utf8"));
for (const methodId of [
  "ProductAPI_ImportProductsPrices",
  "ProductAPI_ProductsStocksV2",
  "ProductAPI_ImportProductsV3",
  "ProductAPI_ProductArchive",
  "PostingAPI_PostingCancel",
  "carriagePassCreate",
  "PromosProductsActivate",
  "ChatAPI_ChatSendFile",
  "ReviewAPI_CommentCreate",
]) {
  const forbidden = ozonInventory.find((item: any) => item.method_id === methodId);
  assert(forbidden, `${methodId}: present in inventory`);
  assert(["WRITE", "DESTRUCTIVE"].includes(forbidden.classification), `${methodId}: classified forbidden`);
  const transport = new SpyTransport();
  await denied(methodId, () => executeApprovedRead({ store, marketplace: "ozon", connectionId: OZON, method: forbidden as any, params: {}, transport }), transport);
}
console.log("Ozon write-negative spy transport: PASS (9/9 HTTP_REQUESTS_SENT=0)");

for (const [marketplace, connectionId, inventoryFile, methodIds] of [
  ["wildberries", WB, "wb-operations.json", [
    "wb_prices_set_post_api_v2_upload_task", "wb_stocks_update_put_api_v3_stocks_warehouse_id",
    "wb_cards_update_post_content_v2_cards_update", "wb_cards_create_post_content_v2_cards_upload",
    "wb_media_save_by_links_post_content_v3_media_save", "wb_order_cancel_patch_api_v3_orders_order_id_cancel",
    "wb_warehouse_create_post_api_v3_warehouses", "wb_advert_bids_set_patch_api_advert_v1_bids",
    "wb_question_reply_patch_api_v1_questions", "wb_tag_delete_delete_content_v2_tag_tag_id",
  ]],
  ["yandex_market", YM, "ym-operations.json", [
    "updateBusinessPrices", "updateStocksOnPartnerWarehouses", "updateOfferContent", "updateOrderStatus",
    "updateGoodsQuestionTextEntity", "sendMessageToChat",
  ]],
] as const) {
  const inventory = JSON.parse(fs.readFileSync(new URL(`../inventory/${inventoryFile}`, import.meta.url), "utf8"));
  for (const methodId of methodIds) {
    const forbidden = inventory.find((item: any) => item.method_id === methodId);
    assert(forbidden && ["WRITE", "DESTRUCTIVE"].includes(forbidden.classification), `${methodId}: classified forbidden`);
    const transport = new SpyTransport();
    await denied(methodId, () => executeApprovedRead({ store, marketplace, connectionId, method: forbidden as any, params: {}, transport }), transport);
  }
  console.log(`${marketplace} write-negative spy transport: PASS (${methodIds.length}/${methodIds.length} HTTP_REQUESTS_SENT=0)`);
}

const ymInventory = JSON.parse(fs.readFileSync(new URL("../inventory/ym-operations.json", import.meta.url), "utf8"));
const ymAllowlist = JSON.parse(fs.readFileSync(new URL("../policies/ym-read-allowlist.json", import.meta.url), "utf8"));
for (const testCase of [
  {
    methodId: "deleteDocuments",
    classification: "DESTRUCTIVE",
    params: { businessId: 1, documentIds: [1] },
  },
  {
    methodId: "updateDocuments",
    classification: "WRITE",
    params: {
      businessId: 1,
      documents: [{ id: 1, number: "DOC-1", type: "CONFORMITY_CERTIFICATE" }],
    },
  },
] as const) {
  const operation = ymInventory.find((item: any) => item.method_id === testCase.methodId);
  assert.equal(operation?.classification, testCase.classification, `${testCase.methodId}: exact forbidden class`);
  assert(!ymAllowlist.some((item: any) => item.method_id === testCase.methodId), `${testCase.methodId}: absent from READ allowlist`);
  const transport = new SpyTransport();
  await denied(
    testCase.methodId,
    () => executeApprovedRead({ store, marketplace: "yandex_market", connectionId: YM, method: operation, params: testCase.params, transport }),
    transport,
  );
}
console.log("Yandex document mutations: PASS (2/2 HTTP_REQUESTS_SENT=0)");
