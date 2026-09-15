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
  encodeCursor,
  decodeCursor,
} from "./schema.js";

type WbStocksCursor =
  | { phase: "FBO"; offset: number }
  | {
      phase: "FBS";
      card_cursor?: { updatedAt?: string; nmID?: number };
      variant_offset: number;
      warehouse_index: number;
    };

type WbOrdersCursor = {
  last_change_date: string;
  seen_order_ids: string[];
};

const WB_STOCKS_DEFAULT_LIMIT = 100;
const WB_STOCKS_MAX_LIMIT = 1000;
const WB_FBS_CARD_PAGE_LIMIT = 100;

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
        "FBO requires the Analytics token category; FBS requires the Marketplace token category. " +
        "WB does not expose a separate reserved quantity here, so reserved=0 is a normalization placeholder.",
      inputSchema: {
        ...connectionArg,
        fulfillment_model: z
          .enum(["FBO", "FBS", "all"])
          .default("all")
          .describe("FBO — WB warehouses, FBS — seller warehouses, all — both (two API calls)"),
        seller_sku: z.string().optional().describe("Filter by seller article"),
        marketplace_product_id: z.string().optional().describe("Filter by WB article (nmID)"),
        limit: z.number().int().min(1).max(WB_STOCKS_MAX_LIMIT).default(WB_STOCKS_DEFAULT_LIMIT).describe("Page size, max 1000"),
        cursor: z.string().optional().describe("Opaque continuation cursor from next_cursor"),
      },
      outputSchema: listEnvelopeSchema(StockSchema).shape,
    },
    audited(store, "wb_stocks_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "wildberries", args.connection_id);
      setCtx({ marketplace: "wildberries", connectionId: conn.connection_id });
      requirePermission(conn, "stocks.read");
      const model: "FBO" | "FBS" | "all" = args.fulfillment_model ?? "all";
      const limit = args.limit ?? WB_STOCKS_DEFAULT_LIMIT;

      const applyFilters = (items: Stock[]) =>
        items
          .filter((s) => model === "all" || s.fulfillment_model === model)
          .filter((s) => !args.seller_sku || s.seller_sku === args.seller_sku)
          .filter((s) => !args.marketplace_product_id || s.marketplace_product_id === args.marketplace_product_id);

      if (conn.mock) {
        const page = paginate(applyFilters(mockStocks), limit, args.cursor);
        return envelope(page, { marketplace: "wildberries", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await wbClientFor(store, conn);

      const initialPhase: "FBO" | "FBS" = model === "FBS" ? "FBS" : "FBO";
      const defaultState: WbStocksCursor = initialPhase === "FBO"
        ? { phase: "FBO", offset: 0 }
        : { phase: "FBS", variant_offset: 0, warehouse_index: 0 };
      const state = args.cursor
        ? decodeCursor<WbStocksCursor>(args.cursor, defaultState)
        : defaultState;

      if (state.phase === "FBO") {
        const nmIds = args.marketplace_product_id ? [Number(args.marketplace_product_id)] : undefined;
        const raw = await client.request<any>("analytics", "/api/analytics/v1/stocks-report/wb-warehouses", {
          method: "POST",
          body: { ...(nmIds ? { nmIds } : {}), limit, offset: state.offset },
        });
        let items: Stock[] = (raw?.data?.items ?? []).map((r: any) => ({
          marketplace: "wildberries" as const,
          marketplace_product_id: String(r.nmId),
          size_id: r.chrtId != null ? String(r.chrtId) : null,
          seller_sku: null, // filled in below from the product cards
          warehouse: r.warehouseName ?? null,
          warehouse_id: r.warehouseId != null ? String(r.warehouseId) : null,
          region: r.regionName ?? null,
          fulfillment_model: "FBO",
          available: r.quantity ?? 0,
          reserved: 0, // WB does not expose reserved quantities in stocks-report
          in_transit_to_customer: r.inWayToClient ?? 0,
          in_transit_from_customer: r.inWayFromClient ?? 0,
        }));

        if (items.length > 0) {
          const skuMap = await fetchSkuMap(client);
          items = items.map((stock) => ({ ...stock, seller_sku: skuMap[stock.marketplace_product_id] ?? null }));
        }
        const filtered = applyFilters(items);
        const upstreamHasMore = items.length >= limit;
        const nextState: WbStocksCursor | null = upstreamHasMore
          ? { phase: "FBO", offset: state.offset + items.length }
          : model === "all"
            ? { phase: "FBS", variant_offset: 0, warehouse_index: 0 }
            : null;
        const nextCursor = nextState ? encodeCursor(nextState) : null;
        return envelope(
          { items: filtered, has_more: nextCursor !== null, next_cursor: nextCursor },
          { marketplace: "wildberries", connectionId: conn.connection_id, nextCursor },
        );
      }

      const warehousesRaw = await client.request<any[]>("marketplace", "/api/v3/warehouses");
      const warehouses = (warehousesRaw ?? [])
        .filter((warehouse: any) => warehouse?.id != null && warehouse?.isDeleting !== true)
        .sort((left: any, right: any) => Number(left.id) - Number(right.id));
      const warehouse = warehouses[state.warehouse_index];
      if (!warehouse) {
        return envelope(
          { items: [], has_more: false, next_cursor: null },
          { marketplace: "wildberries", connectionId: conn.connection_id },
        );
      }

      const filterText = args.marketplace_product_id ?? args.seller_sku;
      const cardsRaw = await client.request<any>("content", "/content/v2/get/cards/list", {
        method: "POST",
        body: {
          settings: {
            sort: { ascending: true },
            cursor: { limit: WB_FBS_CARD_PAGE_LIMIT, ...(state.card_cursor ?? {}) },
            filter: { withPhoto: -1, ...(filterText ? { textSearch: filterText } : {}) },
          },
        },
      });
      const variants = (cardsRaw?.cards ?? []).flatMap((card: any) =>
        (card?.sizes ?? []).map((size: any) => ({
          chrtId: Number(size.chrtID),
          nmId: String(card.nmID),
          sellerSku: card.vendorCode ?? null,
        })).filter((variant: any) => Number.isFinite(variant.chrtId)),
      );
      const batch = variants.slice(state.variant_offset, state.variant_offset + limit);
      const byChrtId = new Map<number, { chrtId: number; nmId: string; sellerSku: string | null }>(
        batch.map((variant: any) => [variant.chrtId, variant]),
      );
      const stocksRaw = batch.length === 0
        ? { stocks: [] }
        : await client.request<any>("marketplace", `/api/v3/stocks/${warehouse.id}`, {
            method: "POST",
            body: { chrtIds: batch.map((variant: any) => variant.chrtId) },
          });
      const items: Stock[] = (stocksRaw?.stocks ?? []).map((stock: any) => {
        const variant = byChrtId.get(Number(stock.chrtId));
        return {
          marketplace: "wildberries" as const,
          marketplace_product_id: variant?.nmId ?? "",
          size_id: stock.chrtId != null ? String(stock.chrtId) : null,
          seller_sku: variant?.sellerSku ?? null,
          warehouse: warehouse.name ?? null,
          warehouse_id: String(warehouse.id),
          region: null,
          fulfillment_model: "FBS" as const,
          available: stock.amount ?? 0,
          reserved: 0,
          in_transit_to_customer: 0,
          in_transit_from_customer: 0,
        };
      });

      const nextCardCursor = cardsRaw?.cursor?.total >= WB_FBS_CARD_PAGE_LIMIT
        ? { updatedAt: cardsRaw?.cursor?.updatedAt, nmID: cardsRaw?.cursor?.nmID }
        : undefined;
      let nextState: WbStocksCursor | null = null;
      if (state.warehouse_index + 1 < warehouses.length) {
        nextState = { ...state, warehouse_index: state.warehouse_index + 1 };
      } else if (state.variant_offset + batch.length < variants.length) {
        nextState = { ...state, variant_offset: state.variant_offset + batch.length, warehouse_index: 0 };
      } else if (nextCardCursor) {
        nextState = { phase: "FBS", card_cursor: nextCardCursor, variant_offset: 0, warehouse_index: 0 };
      }
      const nextCursor = nextState ? encodeCursor(nextState) : null;
      return envelope(
        { items: applyFilters(items).slice(0, limit), has_more: nextCursor !== null, next_cursor: nextCursor },
        { marketplace: "wildberries", connectionId: conn.connection_id, nextCursor },
      );
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
      const cursorState = args.cursor
        ? decodeCursor<WbOrdersCursor>(args.cursor, { last_change_date: dateFrom, seen_order_ids: [] })
        : null;
      // Statistics API: GET /api/v1/supplier/orders?dateFrom=... (limit: 1 request per minute)
      const raw = await client.request<any[]>("statistics", "/api/v1/supplier/orders", {
        query: { dateFrom: cursorState?.last_change_date ?? dateFrom },
      });
      const eligible = (raw ?? []).filter((order) => {
        if (!cursorState) return true;
        const changedAt = String(order.lastChangeDate ?? "");
        const orderId = String(order.srid ?? order.gNumber ?? "");
        if (changedAt < cursorState.last_change_date) return false;
        return changedAt !== cursorState.last_change_date || !cursorState.seen_order_ids.includes(orderId);
      });
      const limit = args.limit ?? 100;
      const pageRows = eligible.slice(0, limit);
      const items: Order[] = pageRows.map((o) => ({
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
      const hasMore = eligible.length > pageRows.length || (raw?.length ?? 0) >= 80_000;
      let nextCursor: string | null = null;
      if (hasMore && pageRows.length > 0) {
        const lastChangeDate = String(pageRows.at(-1)?.lastChangeDate ?? cursorState?.last_change_date ?? dateFrom);
        const previousSeen = cursorState?.last_change_date === lastChangeDate ? cursorState.seen_order_ids : [];
        const pageSeen = pageRows
          .filter((order) => String(order.lastChangeDate ?? "") === lastChangeDate)
          .map((order) => String(order.srid ?? order.gNumber ?? ""));
        nextCursor = encodeCursor({ last_change_date: lastChangeDate, seen_order_ids: [...new Set([...previousSeen, ...pageSeen])] });
      }
      return envelope(
        { items, has_more: nextCursor !== null, next_cursor: nextCursor },
        { marketplace: "wildberries", connectionId: conn.connection_id, nextCursor },
      );
    }),
  );
}
