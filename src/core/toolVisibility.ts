import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const CHATGPT_PUBLIC_TOOLS = new Set([
  "connection_get",
  "connection_test",
  "connections_list",
  "marketplace_capabilities",
  "ozon_orders_list",
  "ozon_prices_get",
  "ozon_products_list",
  "ozon_read_execute",
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
]);

export type ToolRegistrar = Pick<McpServer, "registerTool">;

export function withChatgptVisibility(server: McpServer): ToolRegistrar {
  return {
    registerTool(name, config, callback) {
      const modelVisible = CHATGPT_PUBLIC_TOOLS.has(name);
      const existingMeta = config._meta ?? {};
      const existingUi = existingMeta.ui && typeof existingMeta.ui === "object"
        ? existingMeta.ui as Record<string, unknown>
        : {};

      return server.registerTool(name, {
        ...config,
        _meta: {
          ...existingMeta,
          ui: {
            ...existingUi,
            visibility: modelVisible ? ["model"] : ["app"],
          },
          "openai/visibility": modelVisible ? "public" : "private",
        },
      }, callback);
    },
  };
}
