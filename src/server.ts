import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "./core/store.js";
import { registerCommonTools } from "./adapters/common/tools.js";
import { registerWbTools } from "./adapters/wb/tools.js";
import { registerOzonTools } from "./adapters/ozon/tools.js";
import { registerYmTools } from "./adapters/ym/tools.js";

export function buildServer(store: Store): McpServer {
  const server = new McpServer({
    name: "marketplace-mcp",
    version: "0.3.0",
  });
  registerCommonTools(server, store);
  registerWbTools(server, store);
  registerOzonTools(server, store);
  registerYmTools(server, store);
  return server;
}
