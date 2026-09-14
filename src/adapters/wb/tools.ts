/**
 * Wildberries READ tools (spec §19). Namespace wb_* (spec §12).
 * Every tool: explicit connection context, permission check, normalized response,
 * limit/cursor pagination (spec §26). Mock connections are served by mock data of the
 * same shape (see schema.ts), so the demo never promises fields the API does not return.
 */
import { z } from "zod";
import type { ToolRegistrar } from "../../core/toolVisibility.js";
import type { Store } from "../../core/store.js";
import { resolveConnection, requirePermission } from "../../core/connections.js";
import { envelope } from "../../core/respond.js";
import { audited } from "../../core/audit.js";
import { WbClient } from "./client.js";
import { mockOrders, mockPrices, mockProducts, mockStocks } from "./mock.js";
import {
  listEnvelopeSchema,
  OrderSchema,
  PriceSchema,
  ProductSchema,
  StockSchema,
  type Order,
  type Price,
  type Product,
  type Stock,
} from "./schema.js";

const connectionArg = {
  connection_id: z
    .string()
    .uuid()
    .optional()
    .describe("Wildberries connection id. Required when more than one is configured (see connections_list)."),
};

function paginate<T>(items: T[], limit: number, cursor?: string) {
  const offset = cursor ? parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10) || 0 : 0;
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < items.length;
  return {
    items: page,
    has_more: hasMore,
    next_cursor: hasMore ? Buffer.from(String(nextOffset)).toString("base64") : null,
  };
}

async function wbClientFor(store: Store, conn: { connection_id: string; sandbox: boolean }): Promise<WbClient> {
  const creds = await store.getCredentials(conn.connection_id);
  return new WbClient(creds.token ?? "", conn.connection_id, conn.sandbox);
}

/** nmID -> vendorCode map: stocks-report omits the seller article, so we enrich from product cards. */
async function fetchSkuMap(client: WbClient): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const raw = await client.request<any>("content", "/content/v2/get/cards/list", {
    method: "POST",
    body: { settings: { sort: { ascending: true }, cursor: { limit: 100 }, filter: { withPhoto: -1 } } },
  });
  for (const c of raw?.cards ?? []) {
    if (c?.nmID != null && c?.vendorCode) map[String(c.nmID)] = c.vendorCode;
  }
  return map;
}

export function registerWbTools(server: ToolRegistrar, store: Store) {
  server.registerTool(
    "wb_products_list",
    {
      title: "WB: list products",
      description:
        "Returns Wildberries product cards: WB article (nmID), seller article, barcode, title, brand, category. " +
        "Read-only; the seller account is not modified. Use it to survey the assortment; " +
        "do not use it for stocks (wb_stocks_get) or prices (wb_prices_get).",
      inputSchema: {
        ...connectionArg,
        limit: z.number().int().min(1).max(100).default(50).describe("Page size, max 100"),
        cursor: z.string().optional().describe("Cursor from the previous response (next_cursor)"),
      },
      outputSchema: listEnvelopeSchema(ProductSchema).shape,
    },
    audited(store, "wb_products_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "wildberries", args.connection_id);
      setCtx({ marketplace: "wildberries", connectionId: conn.connection_id });
      requirePermission(conn, "catalog.read");
      const limit = args.limit ?? 50;

      if (conn.mock) {
        const page = paginate(mockProducts, limit, args.cursor);
        return envelope(page, { marketplace: "wildberries", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await wbClientFor(store, conn);
      // Content API: POST /content/v2/get/cards/list — WB cursor pagination.
      // The WB cursor ({updatedAt, nmID}) is hidden inside our own base64 cursor.
      const wbCursor = args.cursor ? JSON.parse(Buffer.from(args.cursor, "base64").toString("utf8")) : {};
      const raw = await client.request<any>("content", "/content/v2/get/cards/list", {
        method: "POST",
        body: {
          settings: {
            sort: { ascending: true },
            cursor: { limit, ...wbCursor },
            filter: { withPhoto: -1 },
          },
        },
      });
      const cards: any[] = raw?.cards ?? [];
      const items: Product[] = cards.map((c) => ({
        ref: {
          marketplace: "wildberries" as const,
          marketplace_product_id: String(c.nmID),
          seller_sku: c.vendorCode ?? null,
          barcode: c.sizes?.[0]?.skus?.[0] ?? null,
          title: c.title ?? null,
        },
        brand: c.brand ?? null,
        category: c.subjectName ?? null,
      }));
      // Documented stop rule: keep paging while cursor.total >= limit.
      // cursor.total is the number of cards RETURNED, not the grand total.
      const returned = raw?.cursor?.total ?? items.length;
      const hasMore = returned >= limit;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify({ updatedAt: raw?.cursor?.updatedAt, nmID: raw?.cursor?.nmID })).toString("base64")
        : null;
      return envelope({ items, has_more: hasMore, next_cursor: nextCursor }, { marketplace: "wildberries", connectionId: conn.connection_id, nextCursor });
    }),
  );

  server.registerTool(
    "wb_stocks_get",
    {
      title: "WB: get stocks",
      description:
        "Returns current stock levels split by FBO (WB warehouses) and FBS (seller warehouses): " +
        "available to order, in transit to customer, in transit from customer. Read-only. " +
        "Fulfillment models are never merged into one number. WB refreshes this data every 30 minutes. " +
        "Requires the Analytics (Аналитика) token category.",
      inputSchema: {
        ...connectionArg,
        fulfillment_model: z
          .enum(["FBO", "FBS", "all"])
          .default("all")
          .describe("FBO — WB warehouses, FBS — seller warehouses, all — both (two API calls)"),
        seller_sku: z.string().optional().describe("Filter by seller article"),
        marketplace_product_id: z.string().optional().describe("Filter by WB article (nmID)"),
      },
      outputSchema: listEnvelopeSchema(StockSchema).shape,
    },
    audited(store, "wb_stocks_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "wildberries", args.connection_id);
      setCtx({ marketplace: "wildberries", connectionId: conn.connection_id });
      requirePermission(conn, "stocks.read");
      const model: "FBO" | "FBS" | "all" = args.fulfillment_model ?? "all";

      const applyFilters = (items: Stock[]) =>
        items
          .filter((s) => model === "all" || s.fulfillment_model === model)
          .filter((s) => !args.seller_sku || s.seller_sku === args.seller_sku)
          .filter((s) => !args.marketplace_product_id || s.marketplace_product_id === args.marketplace_product_id);

      if (conn.mock) {
        const items = applyFilters(mockStocks);
        return envelope({ items, has_more: false, next_cursor: null }, { marketplace: "wildberries", connectionId: conn.connection_id, source: "mock" });
      }

      const client = await wbClientFor(store, conn);

      // Analytics API. The old GET /api/v1/supplier/stocks was switched off on 2026-06-23.
      // FBO: POST /api/analytics/v1/stocks-report/wb-warehouses
      // FBS: POST /api/analytics/v1/stocks-report/seller-warehouses
      const nmIds = args.marketplace_product_id ? [Number(args.marketplace_product_id)] : undefined;
      const body = { ...(nmIds ? { nmIds } : {}), limit: 250_000, offset: 0 };

      const fetchGroup = async (path: string, fulfillment: "FBO" | "FBS"): Promise<Stock[]> => {
        const raw = await client.request<any>("analytics", path, { method: "POST", body });
        return (raw?.data?.items ?? []).map((r: any) => ({
          marketplace: "wildberries" as const,
          marketplace_product_id: String(r.nmId),
          size_id: r.chrtId != null ? String(r.chrtId) : null,
          seller_sku: null, // filled in below from the product cards
          warehouse: r.warehouseName ?? null,
          warehouse_id: r.warehouseId != null ? String(r.warehouseId) : null,
          region: r.regionName ?? null,
          fulfillment_model: fulfillment,
          available: r.quantity ?? 0,
          reserved: 0, // WB does not expose reserved quantities in stocks-report
          in_transit_to_customer: r.inWayToClient ?? 0,
          in_transit_from_customer: r.inWayFromClient ?? 0,
        }));
      };

      let items: Stock[] = [];
      if (model === "FBO" || model === "all") items.push(...(await fetchGroup("/api/analytics/v1/stocks-report/wb-warehouses", "FBO")));
      if (model === "FBS" || model === "all") items.push(...(await fetchGroup("/api/analytics/v1/stocks-report/seller-warehouses", "FBS")));

      // stocks-report returns only nmId — we enrich the seller article from product cards,
      // otherwise filtering by seller_sku and human-readable output would be impossible.
      if (items.length > 0) {
        const skuMap = await fetchSkuMap(client);
        items = items.map((s) => ({ ...s, seller_sku: skuMap[s.marketplace_product_id] ?? null }));
      }

      return envelope({ items: applyFilters(items), has_more: false, next_cursor: null }, { marketplace: "wildberries", connectionId: conn.connection_id });
    }),
  );

  server.registerTool(
    "wb_prices_get",
    {
      title: "WB: get prices",
      description:
        "Returns current Wildberries prices and discounts. Read-only; never changes prices. " +
        "Money values are decimal strings with a currency, never floats.",
      inputSchema: {
        ...connectionArg,
        limit: z.number().int().min(1).max(1000).default(1000).describe("Page size, max 1000"),
        cursor: z.string().optional().describe("Cursor from the previous response (next_cursor)"),
      },
      outputSchema: listEnvelopeSchema(PriceSchema).shape,
    },
    audited(store, "wb_prices_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "wildberries", args.connection_id);
      setCtx({ marketplace: "wildberries", connectionId: conn.connection_id });
      requirePermission(conn, "prices.read");
      const limit = args.limit ?? 1000;

      if (conn.mock) {
        const page = paginate(mockPrices, limit, args.cursor);
        return envelope(page, { marketplace: "wildberries", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await wbClientFor(store, conn);
      // Discounts-Prices API: GET /api/v2/list/goods/filter — offset pagination,
      // repeat until an empty array comes back.
      const offset = args.cursor ? parseInt(Buffer.from(args.cursor, "base64").toString("utf8"), 10) || 0 : 0;
      const raw = await client.request<any>("prices", "/api/v2/list/goods/filter", {
        query: { limit: String(limit), offset: String(offset) },
      });
      const goods: any[] = raw?.data?.listGoods ?? [];
      const items: Price[] = goods.map((g) => {
        const size = g.sizes?.[0] ?? {};
        const currency = g.currencyIsoCode4217 ?? "RUB";
        return {
          marketplace: "wildberries" as const,
          marketplace_product_id: String(g.nmID ?? ""),
          seller_sku: g.vendorCode ?? null,
          price: { amount: String(size.price ?? g.price ?? 0), currency },
          discount_percent: g.discount ?? 0,
          price_after_discount: { amount: String(size.discountedPrice ?? 0), currency },
        };
      });
      const hasMore = goods.length >= limit;
      const nextCursor = hasMore ? Buffer.from(String(offset + goods.length)).toString("base64") : null;
      return envelope({ items, has_more: hasMore, next_cursor: nextCursor }, { marketplace: "wildberries", connectionId: conn.connection_id, nextCursor });
    }),
  );

  server.registerTool(
    "wb_orders_list",
    {
      title: "WB: list orders",
      description:
        "Returns Wildberries orders for a period (30 days by default): date, article, amount, warehouse, status. " +
        "Read-only. WB refreshes this data every 30 minutes and retains it for 90 days. " +
        "For aggregate sales stats, call this tool and compute on the AI side.",
      inputSchema: {
        ...connectionArg,
        date_from: z.string().optional().describe("ISO start date (defaults to −30 days). Maximum depth is 90 days."),
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(OrderSchema).shape,
    },
    audited(store, "wb_orders_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "wildberries", args.connection_id);
      setCtx({ marketplace: "wildberries", connectionId: conn.connection_id });
      requirePermission(conn, "orders.read");

      const dateFrom = args.date_from ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

      if (conn.mock) {
        const filtered = mockOrders.filter((o) => (o.created_at ?? "") >= dateFrom);
        const page = paginate(filtered, args.limit ?? 100, args.cursor);
        return envelope(page, { marketplace: "wildberries", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await wbClientFor(store, conn);
      // Statistics API: GET /api/v1/supplier/orders?dateFrom=... (limit: 1 request per minute)
      const raw = await client.request<any[]>("statistics", "/api/v1/supplier/orders", {
        query: { dateFrom },
      });
      const all: Order[] = (raw ?? []).map((o) => ({
        marketplace: "wildberries" as const,
        order_id: o.srid ?? o.gNumber ?? null,
        created_at: o.date ?? null,
        marketplace_product_id: o.nmId != null ? String(o.nmId) : null,
        seller_sku: o.supplierArticle ?? null,
        quantity: 1, // 1 row = 1 order = 1 unit of goods (per WB documentation)
        amount: { amount: String(o.priceWithDisc ?? o.totalPrice ?? 0), currency: "RUB" },
        warehouse: o.warehouseName ?? null,
        status: o.isCancel ? "cancelled" : "created",
        is_cancelled: Boolean(o.isCancel),
      }));
      const page = paginate(all, args.limit ?? 100, args.cursor);
      return envelope(page, { marketplace: "wildberries", connectionId: conn.connection_id, nextCursor: page.next_cursor });
    }),
  );
}
