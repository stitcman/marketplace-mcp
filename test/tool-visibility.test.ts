import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import { buildServer } from "../src/server.js";
import type { RuntimeIdentity } from "../src/core/runtimeIdentity.js";

const ORIGINAL_PUBLIC_TOOLS = [
  "connection_get",
  "connection_test",
  "connections_list",
  "marketplace_capabilities",
  "ozon_orders_list",
  "ozon_prices_get",
  "ozon_products_list",
  "ozon_stocks_get",
  "wb_orders_list",
  "wb_prices_get",
  "wb_products_list",
  "wb_stocks_get",
  "ym_campaigns_list",
  "ym_orders_list",
  "ym_prices_get",
  "ym_products_list",
  "ym_stocks_get",
] as const;

const EXPECTED_MODEL_VISIBLE = [...ORIGINAL_PUBLIC_TOOLS, "ozon_read_execute"].sort();

function isModelVisible(tool: { _meta?: Record<string, unknown> }): boolean {
  const metadata = tool._meta ?? {};
  const ui = metadata.ui as { visibility?: unknown } | undefined;
  if (Array.isArray(ui?.visibility)) return ui.visibility.includes("model");
  return metadata["openai/visibility"] !== "private";
}

const store = new MemoryStore();
const runtimeIdentity: RuntimeIdentity = Object.freeze({
  version: "0.4.0",
  commit: "d".repeat(40),
  manifest_sha256: "e".repeat(64),
  mode: "READ_ONLY",
  write_runtime_enabled: false,
});
const server = buildServer(store, runtimeIdentity);
const client = new Client({ name: "tool-visibility", version: "0.0.1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

try {
  const listed = await client.listTools();
  const registered = listed.tools.map((tool) => tool.name).sort();
  const modelVisible = listed.tools.filter(isModelVisible).map((tool) => tool.name).sort();
  const modelHidden = listed.tools.filter((tool) => !isModelVisible(tool)).map((tool) => tool.name).sort();

  assert.equal(registered.length, 33, "internal MCP catalog remains 33 tools");
  assert.deepEqual(modelVisible, EXPECTED_MODEL_VISIBLE, "ChatGPT model-visible surface is the frozen 17 plus ozon_read_execute");
  assert.equal(modelVisible.length, 18, "ChatGPT model-visible surface contains exactly 18 tools");
  assert.equal(modelHidden.length, 15, "exactly 15 internal tools are hidden from the model");
  assert(modelVisible.includes("ozon_read_execute"), "ozon_read_execute is model-visible");

  for (const name of ORIGINAL_PUBLIC_TOOLS) {
    assert(modelVisible.includes(name), `original public tool remains model-visible: ${name}`);
  }
  for (const name of ["wb_read_execute", "ym_read_execute"]) {
    assert(registered.includes(name), `${name} remains internally registered`);
    assert(modelHidden.includes(name), `${name} remains hidden from the model`);
  }
  assert(!modelVisible.some((name) => /(?:write|delete|update|credential|admin)/i.test(name)), "no mutation or credential-management tool is model-visible");
} finally {
  await Promise.all([client.close(), server.close()]);
}

console.log("ChatGPT tool visibility: PASS (33 internal; 18 model-visible; 15 hidden)");
