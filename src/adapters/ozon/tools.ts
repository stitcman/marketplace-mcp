/**
 * Ozon READ tools (spec §20). Namespace ozon_* (spec §12).
 *
 * Platform quirks reflected here:
 *  - every method is a POST, including reads;
 *  - cursor pagination via last_id on product methods, limit/offset on postings;
 *  - stocks arrive as one row per product with a list of types (fbo/fbs) — we expand
 *    them into separate rows so fulfillment models never get mixed;
 *  - orders come from two independent methods (FBO and FBS) with different shapes.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import type { ToolRegistrar } from "../../core/toolVisibility.js";
import type { Store } from "../../core/store.js";
import { resolveConnection, requirePermission } from "../../core/connections.js";
import { envelope } from "../../core/respond.js";
import { audited } from "../../core/audit.js";
import { MpError } from "../../core/errors.js";
import { OzonClient } from "./client.js";
import { mockOrders, mockPrices, mockProducts, mockStocks } from "./mock.js";
import {
  decodeCursor,
  encodeCursor,
  listEnvelopeSchema,
  OrderSchema,
  PriceSchema,
  ProductSchema,
  StockSchema,
  MoneySchema,
  type Order,
  type Price,
  type Product,
  type Stock,
} from "../common/schema.js";

// Ozon v2 is opt-in: the shared FBO/FBS schema consumed by MOS is unchanged.
const OzonStockV2Schema = StockSchema.extend({
  fulfillment_model: z.enum(["FBO", "FBS", "rFBS", "FBP", "UNKNOWN"]),
  available: z.number().nullable(), reserved: z.number().nullable(),
  source_type: z.string(), source_sku: z.string().nullable(),
});
const OzonPriceSchema = PriceSchema.extend({ declared_price: MoneySchema.nullable().optional() });
type OzonStockV2 = z.infer<typeof OzonStockV2Schema>;

function cursorBinding(connection: string, tool: string, filter: unknown): string {
  return createHash("sha256").update(JSON.stringify([connection, tool, filter])).digest("hex");
}
function upstreamCursor(cursor: string | undefined, binding: string): string {
  if (!cursor) return "";
  const state = decodeCursor<any>(cursor, null);
  if (state?.v !== 2 || state.binding !== binding || typeof state.upstream !== "string") {
    throw new MpError("INVALID_ARGUMENT", "Incompatible Ozon cursor or account/filter mismatch; restart without cursor");
  }
  return state.upstream;
}
function cursorPage(raw: any, current: string, binding: string) {
  const next = raw?.cursor ?? raw?.result?.cursor;
  const explicit = raw?.has_next ?? raw?.result?.has_next;
  if (explicit === true && (typeof next !== "string" || !next)) {
    throw new MpError("INVALID_ARGUMENT", "Ozon response has_next=true without a continuation cursor");
  }
  const has_more = explicit !== false && typeof next === "string" && next !== "" && next !== current;
  return { has_more, next_cursor: has_more ? encodeCursor({ v: 2, binding, upstream: next }) : null };
}

const connectionArg = {
  connection_id: z
    .string()
    .uuid()
    .optional()
    .describe("Ozon connection id. Required when more than one is configured (see connections_list)."),
};

function paginate<T>(items: T[], limit: number, cursor?: string) {
  const offset = decodeCursor<number>(cursor, 0);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < items.length;
  return { items: page, has_more: hasMore, next_cursor: hasMore ? encodeCursor(nextOffset) : null };
}

async function ozonClientFor(store: Store, connectionId: string): Promise<OzonClient> {
  const creds = await store.getCredentials(connectionId);
  if (!creds.client_id || !creds.api_key) {
    throw new MpError(
      "AUTH_FAILED",
      "Ozon connection is missing credentials: client_id and api_key are required",
      { marketplace: "ozon" },
    );
  }
  return new OzonClient(creds.client_id, creds.api_key, connectionId);
}

export function registerOzonTools(server: ToolRegistrar, store: Store) {
  server.registerTool(
    "ozon_products_list",
    {
      title: "Ozon: list products",
      description:
        "Returns Ozon products: product_id, seller article (offer_id), title, category. " +
        "Read-only. Use it to survey the assortment; " +
        "do not use it for stocks (ozon_stocks_get) or prices (ozon_prices_get).",
      inputSchema: {
        ...connectionArg,
        limit: z.number().int().min(1).max(1000).default(100).describe("Page size, max 1000"),
        cursor: z.string().optional().describe("Cursor from the previous response (next_cursor)"),
      },
      outputSchema: listEnvelopeSchema(ProductSchema).shape,
    },
    audited(store, "ozon_products_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "ozon", args.connection_id);
      setCtx({ marketplace: "ozon", connectionId: conn.connection_id });
      requirePermission(conn, "catalog.read");
      const limit = args.limit ?? 100;

      if (conn.mock) {
        const page = paginate(mockProducts, limit, args.cursor);
        return envelope(page, { marketplace: "ozon", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ozonClientFor(store, conn.connection_id);
      const lastId = decodeCursor<string>(args.cursor, "");
      // POST /v3/product/list returns identifiers only; titles and categories are
      // fetched in one batch through /v3/product/info/list.
      const list = await client.request<any>("/v3/product/list", {
        filter: { visibility: "ALL" },
        last_id: lastId,
        limit,
      });
      const rows: any[] = list?.result?.items ?? [];
      const productIds = rows.map((r) => r.product_id).filter((v) => v != null);

      let details: Record<string, any> = {};
      if (productIds.length > 0) {
        const info = await client.request<any>("/v3/product/info/list", { product_id: productIds });
        for (const it of info?.items ?? info?.result?.items ?? []) {
          if (it?.id != null) details[String(it.id)] = it;
          else if (it?.product_id != null) details[String(it.product_id)] = it;
        }
      }

      const items: Product[] = rows.map((r) => {
        const d = details[String(r.product_id)] ?? {};
        return {
          ref: {
            marketplace: "ozon" as const,
            marketplace_product_id: String(r.product_id),
            seller_sku: r.offer_id ?? d.offer_id ?? null,
            barcode: d.barcode || (Array.isArray(d.barcodes) ? d.barcodes[0] ?? null : null),
            title: d.name ?? null,
          },
          brand: null, // Ozon keeps brand in product attributes — a separate call, out of scope for READ v0.3
          // ?? binds tighter than ?:, so mixing them in one expression is a trap — be explicit.
          category: d.type_name ? String(d.type_name) : d.description_category_id != null ? String(d.description_category_id) : null,
        };
      });

      const nextId = list?.result?.last_id ?? "";
      const hasMore = Boolean(nextId) && rows.length >= limit;
      return envelope(
        { items, has_more: hasMore, next_cursor: hasMore ? encodeCursor(nextId) : null },
        { marketplace: "ozon", connectionId: conn.connection_id, nextCursor: hasMore ? encodeCursor(nextId) : null },
      );
    }),
  );

  server.registerTool(
    "ozon_stocks_get",
    {
      title: "Ozon: get stocks",
      description:
        "Returns Ozon stock levels split by FBO (Ozon warehouses) and FBS (seller warehouses): " +
        "available to order and reserved. Read-only. Fulfillment models are never merged.",
      inputSchema: {
        ...connectionArg,
        fulfillment_model: z.enum(["FBO", "FBS", "all"]).default("all").describe("FBO — Ozon warehouses, FBS — seller warehouses"),
        seller_sku: z.string().optional().describe("Filter by seller article (offer_id)"),
        limit: z.number().int().min(1).max(1000).default(100),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(StockSchema).shape,
    },
    audited(store, "ozon_stocks_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "ozon", args.connection_id);
      setCtx({ marketplace: "ozon", connectionId: conn.connection_id });
      requirePermission(conn, "stocks.read");
      const model: "FBO" | "FBS" | "all" = args.fulfillment_model ?? "all";
      const limit = args.limit ?? 100;

      const applyFilters = (items: Stock[]) =>
        items
          .filter((s) => model === "all" || s.fulfillment_model === model)
          .filter((s) => !args.seller_sku || s.seller_sku === args.seller_sku);

      if (conn.mock) {
        const page = paginate(applyFilters(mockStocks), limit, args.cursor);
        return envelope(page, { marketplace: "ozon", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ozonClientFor(store, conn.connection_id);
      const binding = cursorBinding(conn.connection_id, "ozon_stocks_get", [model, args.seller_sku ?? null, args.contract_version ?? "v1"]);
      const current = upstreamCursor(args.cursor, binding);
      const raw = await client.request<any>("/v4/product/info/stocks", {
        filter: { visibility: "ALL" },
        cursor: current,
        limit,
      });
      const rows: any[] = raw?.items ?? raw?.result?.items ?? [];

      // One Ozon row = a product with stock entries per type. We expand it so FBO and
      // FBS become separate rows and cannot be accidentally summed together.
      const items: Stock[] = [];
      for (const r of rows) {
        for (const s of r.stocks ?? []) {
          const type = String(s.type ?? "").toLowerCase();
          const fulfillment: "FBO" | "FBS" = type === "fbs" ? "FBS" : "FBO";
          items.push({
            marketplace: "ozon",
            marketplace_product_id: String(r.product_id ?? ""),
            size_id: null,
            seller_sku: r.offer_id ?? null,
            warehouse: null, // per-warehouse breakdown lives in analytics/stock_on_warehouses
            warehouse_id: s.warehouse_id != null ? String(s.warehouse_id) : null,
            region: null,
            fulfillment_model: fulfillment,
            available: s.present ?? 0,
            reserved: s.reserved ?? 0,
            in_transit_to_customer: 0, // Ozon does not expose in-transit data in this method
            in_transit_from_customer: 0,
          });
        }
      }

      const page = cursorPage(raw, current, binding);
      return envelope(
        { items: applyFilters(items), ...page },
        { marketplace: "ozon", connectionId: conn.connection_id, nextCursor: page.next_cursor },
      );
    }),
  );

  server.registerTool(
    "ozon_prices_get",
    {
      title: "Ozon: get prices",
      description:
        "Returns current Ozon prices: price before discount, price for the customer, currency. " +
        "Read-only; never changes prices. Money values are decimal strings.",
      inputSchema: {
        ...connectionArg,
        limit: z.number().int().min(1).max(1000).default(100),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(OzonPriceSchema).shape,
    },
    audited(store, "ozon_prices_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "ozon", args.connection_id);
      setCtx({ marketplace: "ozon", connectionId: conn.connection_id });
      requirePermission(conn, "prices.read");
      const limit = args.limit ?? 100;

      if (conn.mock) {
        const page = paginate(mockPrices, limit, args.cursor);
        return envelope(page, { marketplace: "ozon", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ozonClientFor(store, conn.connection_id);
      const binding = cursorBinding(conn.connection_id, "ozon_prices_get", null);
      const current = upstreamCursor(args.cursor, binding);
      // v4 is deprecated; v5 is the current version.
      const raw = await client.request<any>("/v5/product/info/prices", {
        filter: { visibility: "ALL" },
        cursor: current,
        limit,
      });
      const rows: any[] = raw?.items ?? raw?.result?.items ?? [];
      const items: Price[] = rows.map((r) => {
        const p = r.price ?? {};
        const currency = p.currency_code ?? "RUB";
        const base = Number(p.old_price ?? p.price ?? 0);
        const actual = Number(p.price ?? 0);
        const discount = base > 0 && actual > 0 && base >= actual ? Math.round(((base - actual) / base) * 100) : 0;
        return {
          marketplace: "ozon" as const,
          marketplace_product_id: String(r.product_id ?? ""),
          seller_sku: r.offer_id ?? null,
          price: { amount: String(p.old_price ?? p.price ?? "0"), currency },
          discount_percent: discount,
          price_after_discount: { amount: String(p.price ?? "0"), currency },
        };
      });

      const page = cursorPage(raw, current, binding);
      return envelope(
        { items, ...page },
        { marketplace: "ozon", connectionId: conn.connection_id, nextCursor: page.next_cursor },
      );
    }),
  );

  server.registerTool(
    "ozon_orders_list",
    {
      title: "Ozon: list orders",
      description:
        "Returns Ozon postings for a period (30 days by default): posting number, date, items, amount, status. " +
        "FBO and FBS are independent order streams on Ozon; both are returned by default. Read-only.",
      inputSchema: {
        ...connectionArg,
        fulfillment_model: z.enum(["FBO", "FBS", "all"]).default("all"),
        date_from: z.string().optional().describe("ISO start date (defaults to −30 days)"),
        limit: z.number().int().min(1).max(1000).default(100),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(OrderSchema).shape,
    },
    audited(store, "ozon_orders_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "ozon", args.connection_id);
      setCtx({ marketplace: "ozon", connectionId: conn.connection_id });
      requirePermission(conn, "orders.read");
      const model: "FBO" | "FBS" | "all" = args.fulfillment_model ?? "all";
      const limit = args.limit ?? 100;
      const since = args.date_from
        ? new Date(args.date_from).toISOString()
        : new Date(Date.now() - 30 * 86_400_000).toISOString();
      const to = new Date().toISOString();

      if (conn.mock) {
        const page = paginate(mockOrders.filter((o) => (o.created_at ?? "") >= since), limit, args.cursor);
        return envelope(page, { marketplace: "ozon", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ozonClientFor(store, conn.connection_id);
      const offset = decodeCursor<number>(args.cursor, 0);

      // A posting contains several items; we normalize to one row per item so the shape
      // matches WB (1 row = 1 unit of goods in an order).
      const flatten = (postings: any[], fulfillment: "FBO" | "FBS"): Order[] => {
        const out: Order[] = [];
        for (const p of postings ?? []) {
          const products = p.products ?? [];
          const status = String(p.status ?? "").toLowerCase();
          if (products.length === 0) {
            out.push({
              marketplace: "ozon", order_id: p.posting_number ?? String(p.order_id ?? ""), created_at: p.created_at ?? p.in_process_at ?? null,
              marketplace_product_id: null, seller_sku: null, quantity: 0,
              amount: { amount: "0", currency: "RUB" }, warehouse: p.analytics_data?.warehouse_name ?? null,
              status, is_cancelled: status.includes("cancel"),
            });
            continue;
          }
          for (const it of products) {
            const qty = Number(it.quantity ?? 1);
            const unit = Number(it.price ?? 0);
            out.push({
              marketplace: "ozon",
              order_id: p.posting_number ?? String(p.order_id ?? ""),
              created_at: p.created_at ?? p.in_process_at ?? null,
              marketplace_product_id: it.sku != null ? String(it.sku) : null,
              seller_sku: it.offer_id ?? null,
              quantity: qty,
              amount: { amount: (unit * qty).toFixed(2), currency: it.currency_code ?? "RUB" },
              warehouse: p.analytics_data?.warehouse_name ?? null,
              status,
              is_cancelled: status.includes("cancel"),
            });
          }
        }
        return out;
      };

      const collected: Order[] = [];
      if (model === "FBO" || model === "all") {
        const fbo = await client.request<any>("/v2/posting/fbo/list", {
          dir: "DESC", filter: { since, to }, limit, offset, with: { analytics_data: true },
        });
        collected.push(...flatten(fbo?.result ?? [], "FBO"));
      }
      if (model === "FBS" || model === "all") {
        const fbs = await client.request<any>("/v3/posting/fbs/list", {
          dir: "DESC", filter: { since, to }, limit, offset, with: { analytics_data: true },
        });
        collected.push(...flatten(fbs?.result?.postings ?? [], "FBS"));
      }

      // Exactly `limit` postings came back — assume there is another page.
      const hasMore = collected.length >= limit;
      const nextCursor = hasMore ? encodeCursor(offset + limit) : null;
      return envelope(
        { items: collected, has_more: hasMore, next_cursor: nextCursor },
        { marketplace: "ozon", connectionId: conn.connection_id, nextCursor },
      );
    }),
  );
}
