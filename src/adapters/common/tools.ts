/**
 * Shared MCP tools (spec §13): connections and capabilities.
 * connections_list never returns credentials.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Store } from "../../core/store.js";
import { envelope } from "../../core/respond.js";
import { audited } from "../../core/audit.js";
import { MpError } from "../../core/errors.js";
import { WbClient } from "../wb/client.js";
import { OzonClient } from "../ozon/client.js";
import { YmClient } from "../ym/client.js";

/**
 * Which platform token scope/category each tool needs. All three marketplaces model
 * this differently, and it helps the agent understand up front why a particular call
 * hit a 403.
 *
 * Wildberries category names are kept in Russian on purpose: they are the literal
 * labels in the seller cabinet UI, where the user has to find and tick them.
 */
const TOKEN_CATEGORIES: Record<string, Record<string, string>> = {
  wildberries: {
    wb_products_list: "Контент (Content)",
    wb_stocks_get: "Аналитика (Analytics)",
    wb_prices_get: "Цены и скидки (Prices and discounts)",
    wb_orders_list: "Статистика (Statistics)",
  },
  ozon: {
    ozon_products_list: "Seller API (Client-Id + Api-Key)",
    ozon_stocks_get: "Seller API (Client-Id + Api-Key)",
    ozon_prices_get: "Seller API (Client-Id + Api-Key)",
    ozon_orders_list: "Seller API (Client-Id + Api-Key)",
  },
  yandex_market: {
    ym_products_list: "offers-and-cards-management:read-only",
    ym_stocks_get: "offers-and-cards-management:read-only",
    ym_prices_get: "offers-and-cards-management:read-only",
    ym_orders_list: "inventory-and-order-processing:read-only",
  },
};

/** Which credential keys a connection of each marketplace must carry. */
const REQUIRED_CREDENTIALS: Record<string, string[]> = {
  wildberries: ["token"],
  ozon: ["client_id", "api_key"],
  yandex_market: ["api_key"],
};

export function registerCommonTools(server: McpServer, store: Store) {
  server.registerTool(
    "connections_list",
    {
      title: "List connections",
      description:
        "Returns every connected marketplace seller account (never keys or secrets). " +
        "Call this first to learn the connection_id required by the other tools.",
      inputSchema: {},
    },
    audited(store, "connections_list", async () => {
      const items = (await store.listConnections()).map((c) => ({
        connection_id: c.connection_id,
        marketplace: c.marketplace,
        name: c.name,
        status: c.status,
        mock: c.mock,
        sandbox: c.sandbox,
        permissions: c.permissions,
      }));
      return envelope({ items }, { source: "internal" });
    }),
  );

  server.registerTool(
    "connection_get",
    {
      title: "Get connection",
      description: "Returns details of a single connection by connection_id (never secrets).",
      inputSchema: { connection_id: z.string().uuid() },
    },
    audited(store, "connection_get", async (args, setCtx) => {
      const c = await store.getConnection(args.connection_id);
      if (!c) throw new MpError("CONNECTION_NOT_FOUND", `Connection ${args.connection_id} not found`);
      setCtx({ marketplace: c.marketplace, connectionId: c.connection_id });
      const { connection_id, marketplace, name, status, mock, sandbox, permissions, created_at } = c;
      return envelope({ connection_id, marketplace, name, status, mock, sandbox, permissions, created_at }, { marketplace, connectionId: connection_id, source: "internal" });
    }),
  );

  server.registerTool(
    "connection_test",
    {
      title: "Test connection",
      description:
        "Performs a real read-only connectivity check: token validity and API availability. " +
        "The seller account is not modified.",
      inputSchema: { connection_id: z.string().uuid() },
    },
    audited(store, "connection_test", async (args, setCtx) => {
      const c = await store.getConnection(args.connection_id);
      if (!c) throw new MpError("CONNECTION_NOT_FOUND", `Connection ${args.connection_id} not found`);
      setCtx({ marketplace: c.marketplace, connectionId: c.connection_id });

      if (c.mock) {
        return envelope({ ok: true, checked: "mock", message: "Mock connections are always available" }, { marketplace: c.marketplace, connectionId: c.connection_id, source: "mock" });
      }
      if (c.marketplace === "wildberries") {
        const creds = await store.getCredentials(c.connection_id);
        const client = new WbClient(creds.token ?? "", c.connection_id, c.sandbox);
        // Each WB API category has its own /ping on its own domain, and a token may
        // have access to some categories but not others. We probe the ones our tools
        // actually use and report a per-category picture.
        const groups = [
          { group: "common" as const, label: "Common" },
          { group: "content" as const, label: "Content" },
          { group: "analytics" as const, label: "Analytics (stocks)" },
          { group: "statistics" as const, label: "Statistics (orders)" },
          { group: "prices" as const, label: "Prices and discounts" },
        ];
        const checks = [];
        for (const g of groups) {
          try {
            await client.ping(g.group);
            checks.push({ category: g.label, ok: true, error: null });
          } catch (e) {
            checks.push({
              category: g.label,
              ok: false,
              error: e instanceof MpError ? e.code : "UNKNOWN",
            });
          }
        }
        const ok = checks.some((c2) => c2.ok);
        return envelope(
          { ok, checks, hint: ok ? null : "No category responded — check the token and its scopes in the WB seller cabinet" },
          { marketplace: c.marketplace, connectionId: c.connection_id },
        );
      }
      if (c.marketplace === "ozon") {
        const creds = await store.getCredentials(c.connection_id);
        if (!creds.client_id || !creds.api_key)
          throw new MpError("AUTH_FAILED", "Ozon connection is missing credentials: client_id and api_key are required", { marketplace: c.marketplace });
        // Ozon has no ping method: the cheapest call is a product list with limit=1.
        const client = new OzonClient(creds.client_id, creds.api_key, c.connection_id);
        await client.ping();
        return envelope({ ok: true, checked: "ozon_product_list" }, { marketplace: c.marketplace, connectionId: c.connection_id });
      }

      if (c.marketplace === "yandex_market") {
        const creds = await store.getCredentials(c.connection_id);
        if (!creds.api_key)
          throw new MpError("AUTH_FAILED", "Yandex Market connection has no api_key configured", { marketplace: c.marketplace });
        // GET /v2/campaigns doubles as a check and shows which businesses/shops the key can see.
        const client = new YmClient(creds.api_key, c.connection_id);
        const campaigns = await client.campaigns();
        return envelope(
          {
            ok: true,
            checked: "ym_campaigns",
            campaigns: campaigns.map((x) => ({ campaign_id: String(x.id), business_id: x.businessId != null ? String(x.businessId) : null, domain: x.domain })),
          },
          { marketplace: c.marketplace, connectionId: c.connection_id },
        );
      }

      throw new MpError("FEATURE_NOT_SUPPORTED", `connection_test is not implemented for ${c.marketplace} yet`, { marketplace: c.marketplace });
    }),
  );

  server.registerTool(
    "marketplace_capabilities",
    {
      title: "Connection capabilities",
      description:
        "Shows which data categories are actually available to the AI for this connection " +
        "(token scopes plus server policy). Call before using the marketplace-specific tools.",
      inputSchema: { connection_id: z.string().uuid() },
    },
    audited(store, "marketplace_capabilities", async (args, setCtx) => {
      const c = await store.getConnection(args.connection_id);
      if (!c) throw new MpError("CONNECTION_NOT_FOUND", `Connection ${args.connection_id} not found`);
      setCtx({ marketplace: c.marketplace, connectionId: c.connection_id });
      const has = (p: string) => c.permissions.includes(p);
      return envelope(
        {
          marketplace: c.marketplace,
          connection: c.name,
          capabilities: {
            catalog_read: has("catalog.read"),
            stocks_read: has("stocks.read"),
            orders_read: has("orders.read"),
            price_read: has("prices.read"),
            price_write: false, // WRITE lands in a later stage with preview/confirmation
          },
          // Which platform token scopes the tools require (spec §6):
          required_token_categories: TOKEN_CATEGORIES[c.marketplace] ?? null,
          required_credentials: REQUIRED_CREDENTIALS[c.marketplace] ?? null,
          sandbox: c.sandbox,
          // Honest warning: WB does not provide a sandbox for every category.
          // Stocks live under "Analytics", which has none — so in sandbox mode
          // wb_stocks_get still reads the production account. The agent must know.
          sandbox_warning:
            c.sandbox && c.marketplace === "wildberries"
              ? "The Analytics and Common categories have no sandbox: wb_stocks_get and connection_test hit the production API even in sandbox mode"
              : null,
        },
        { marketplace: c.marketplace, connectionId: c.connection_id, source: "internal" },
      );
    }),
  );
}
