import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "./core/store.js";
import { registerCommonTools } from "./adapters/common/tools.js";
import { registerWbTools } from "./adapters/wb/tools.js";
import { registerOzonTools } from "./adapters/ozon/tools.js";
import { registerYmTools } from "./adapters/ym/tools.js";
import { registerReadTools } from "./adapters/common/readTools.js";
import type { RuntimeIdentity } from "./core/runtimeIdentity.js";

export function buildServer(store: Store, runtimeIdentity: Readonly<RuntimeIdentity>): McpServer {
  const server = new McpServer({
    name: "marketplace-mcp",
    version: runtimeIdentity.version,
  });
  registerCommonTools(server, store, runtimeIdentity);
  registerWbTools(server, store);
  registerOzonTools(server, store);
  registerYmTools(server, store);
  registerReadTools(server, store, "ozon");
  registerReadTools(server, store, "wildberries");
  registerReadTools(server, store, "yandex_market");
  return server;
}
