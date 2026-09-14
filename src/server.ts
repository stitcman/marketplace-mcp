import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "./core/store.js";
import { registerCommonTools } from "./adapters/common/tools.js";
import { registerWbTools } from "./adapters/wb/tools.js";
import { registerOzonTools } from "./adapters/ozon/tools.js";
import { registerYmTools } from "./adapters/ym/tools.js";
import { registerReadTools } from "./adapters/common/readTools.js";
import type { RuntimeIdentity } from "./core/runtimeIdentity.js";
import { withChatgptVisibility } from "./core/toolVisibility.js";

export function buildServer(store: Store, runtimeIdentity: Readonly<RuntimeIdentity>): McpServer {
  const server = new McpServer({
    name: "marketplace-mcp",
    version: runtimeIdentity.version,
  });
  const tools = withChatgptVisibility(server);
  registerCommonTools(tools, store, runtimeIdentity);
  registerWbTools(tools, store);
  registerOzonTools(tools, store);
  registerYmTools(tools, store);
  registerReadTools(tools, store, "ozon");
  registerReadTools(tools, store, "wildberries");
  registerReadTools(tools, store, "yandex_market");
  return server;
}
