import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "./core/store.js";
import { registerCommonTools } from "./adapters/common/tools.js";
import { registerWbTools } from "./adapters/wb/tools.js";
import { registerOzonTools } from "./adapters/ozon/tools.js";
import { registerYmTools } from "./adapters/ym/tools.js";
import { registerReadTools } from "./adapters/common/readTools.js";

export function buildServer(store: Store): McpServer {
  const server = new McpServer({
    name: "marketplace-mcp",
    version: "0.4.0",
  });
  registerCommonTools(server, store);
  registerWbTools(server, store);
  registerOzonTools(server, store);
  registerYmTools(server, store);
  registerReadTools(server, store, "ozon");
  registerReadTools(server, store, "wildberries");
  registerReadTools(server, store, "yandex_market");
  return server;
}
