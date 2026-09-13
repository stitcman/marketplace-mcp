import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore } from "../src/core/store.js";
import type { RuntimeIdentity } from "../src/core/runtimeIdentity.js";
import { buildServer } from "../src/server.js";

const identity: RuntimeIdentity = Object.freeze({
  version: "0.4.0",
  commit: "b".repeat(40),
  manifest_sha256: "c".repeat(64),
  mode: "READ_ONLY",
  write_runtime_enabled: false,
});
const store = new MemoryStore();
const server = buildServer(store, identity);
const client = new Client({ name: "runtime-identity-test", version: "0.0.1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

try {
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 33, "catalog contains exactly 33 tools");
  assert(tools.tools.some((tool) => tool.name === "marketplace_runtime_identity"), "runtime identity tool is registered");

  const response: any = await client.callTool({ name: "marketplace_runtime_identity", arguments: {} });
  const payload = JSON.parse(response.content[0].text);
  assert.deepEqual(payload.data, identity, "identity tool returns the startup identity unchanged");
  assert.deepEqual(Object.keys(payload.data).sort(), [
    "commit",
    "manifest_sha256",
    "mode",
    "version",
    "write_runtime_enabled",
  ], "identity data contains exactly five fields");
  assert(store.auditLog.some((entry) => entry.tool === "marketplace_runtime_identity" && entry.status === "ok"), "identity call is audited");
} finally {
  await Promise.all([client.close(), server.close()]);
}

console.log("Runtime identity tool: PASS");
