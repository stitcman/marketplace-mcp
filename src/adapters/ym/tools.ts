/**
 * Yandex Market READ tools (spec §21). Namespace ym_* (spec §12).
 *
 * The platform's defining trait is its two-level account model: businessId is the
 * account, campaignId is a shop inside it, and different methods operate at different
 * levels. Hence ym_campaigns_list: the agent learns the identifiers first and only
 * then asks for data. When an account exposes several businesses and business_id is
 * omitted, the tools that need it return AMBIGUOUS_CONNECTION with the list — the same
 * rule as multi-account support (spec §5): never choose silently.
 */
import { z } from "zod";
import type { ToolRegistrar } from "../../core/toolVisibility.js";
import type { Store } from "../../core/store.js";
import { resolveConnection, requirePermission } from "../../core/connections.js";
import { envelope } from "../../core/respond.js";
import { audited } from "../../core/audit.js";
import { MpError } from "../../core/errors.js";
import { YmClient } from "./client.js";
import { mockCampaigns, mockOrders, mockPrices, mockProducts, mockStocks } from "./mock.js";
import {
  decodeCursor,
  encodeCursor,
  listEnvelopeSchema,
  OrderSchema,
  PriceSchema,
  ProductSchema,
  StockSchema,
  type Order,
  type Price,
  type Product,
  type Stock,
} from "../common/schema.js";

const connectionArg = {
  connection_id: z
    .string()
    .uuid()
    .optional()
    .describe("Yandex Market connection id. Required when more than one is configured."),
};

const businessArg = {
  business_id: z
    .string()
    .optional()
    .describe("Business account id (businessId). If omitted, taken from the connection or resolved via ym_campaigns_list."),
};

function paginate<T>(items: T[], limit: number, cursor?: string) {
  const offset = decodeCursor<number>(cursor, 0);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < items.length;
  return { items: page, has_more: hasMore, next_cursor: hasMore ? encodeCursor(nextOffset) : null };
}

async function ymClientFor(store: Store, connectionId: string): Promise<YmClient> {
  const creds = await store.getCredentials(connectionId);
  if (!creds.api_key) {
    throw new MpError("AUTH_FAILED", "Yandex Market connection has no api_key configured", { marketplace: "yandex_market" });
  }
  return new YmClient(creds.api_key, connectionId);
}

/**
 * Resolves businessId: explicit argument → stored on the connection → from /v2/campaigns.
 * When several accounts are reachable, returns AMBIGUOUS_CONNECTION instead of guessing.
 */
async function resolveBusinessId(
  client: YmClient,
  explicit: string | undefined,
  stored: string | undefined,
): Promise<string> {
  if (explicit) return explicit;
  if (stored) return stored;
  const campaigns = await client.campaigns();
  const businesses = [...new Map(campaigns.filter((c) => c.businessId != null).map((c) => [String(c.businessId), c])).values()];
  if (businesses.length === 0)
    throw new MpError("NOT_FOUND", "The token grants access to no Yandex Market business account", { marketplace: "yandex_market" });
  if (businesses.length > 1)
    throw new MpError("AMBIGUOUS_CONNECTION", "The token can reach several business accounts — pass business_id explicitly", {
      marketplace: "yandex_market",
      details: businesses.map((b) => ({ business_id: String(b.businessId), name: b.businessName })),
    });
  return String(businesses[0].businessId);
}

type YmSellerStocksCursor = {
  v: 1; kind: "ym_seller_stocks"; business_id: string; warehouse_page_token: string | null;
  warehouse_index: number; stock_page_token: string | null;
};
type YmOrdersCursor = {
  v: 1; kind: "ym_orders"; business_id: string; date_from: string; date_to: string;
  request_page_token: string | null; normalized_offset: number; next_page_token: string | null;
};

function sellerStocksCursor(cursor: string | undefined, businessId: string): YmSellerStocksCursor | null {
  if (!cursor) return null;
  const value = decodeCursor<unknown>(cursor, null);
  if (!value || typeof value !== "object") throw new MpError("INVALID_ARGUMENT", "Invalid Yandex seller stocks cursor", { marketplace: "yandex_market" });
  const state = value as Partial<YmSellerStocksCursor>;
  if (state.v !== 1 || state.kind !== "ym_seller_stocks" || state.business_id !== businessId ||
    (state.warehouse_page_token !== null && typeof state.warehouse_page_token !== "string") ||
    typeof state.warehouse_index !== "number" || !Number.isInteger(state.warehouse_index) || state.warehouse_index < 0 ||
    (state.stock_page_token !== null && typeof state.stock_page_token !== "string"))
    throw new MpError("INVALID_ARGUMENT", "Invalid or incompatible Yandex seller stocks cursor", { marketplace: "yandex_market" });
  return state as YmSellerStocksCursor;
}

function ordersCursor(cursor: string | undefined, businessId: string, fromDate: string, toDate: string): YmOrdersCursor | null {
  if (!cursor) return null;
  const value = decodeCursor<unknown>(cursor, null);
  if (!value || typeof value !== "object") throw new MpError("INVALID_ARGUMENT", "Invalid Yandex orders cursor", { marketplace: "yandex_market" });
  const state = value as Partial<YmOrdersCursor>;
  if (state.v !== 1 || state.kind !== "ym_orders" || state.business_id !== businessId || state.date_from !== fromDate || state.date_to !== toDate ||
    (state.request_page_token !== null && typeof state.request_page_token !== "string") || typeof state.normalized_offset !== "number" || !Number.isInteger(state.normalized_offset) || state.normalized_offset < 0 ||
    (state.next_page_token !== null && typeof state.next_page_token !== "string"))
    throw new MpError("INVALID_ARGUMENT", "Invalid or incompatible Yandex orders cursor", { marketplace: "yandex_market" });
  return state as YmOrdersCursor;
}

export function registerYmTools(server: ToolRegistrar, store: Store) {
  server.registerTool(
    "ym_campaigns_list",
    {
      title: "Yandex Market: list businesses and shops",
      description:
        "Returns the Yandex Market shops (campaignId) and business accounts (businessId) the token can reach. " +
        "Yandex Market has a two-level structure: an account holds several shops, and different methods " +
        "need different identifiers. Call this before the other ym_* tools.",
      inputSchema: {
        ...connectionArg,
        limit: z.number().int().min(1).max(100).default(100).describe("Page size, max 100"),
        cursor: z.string().optional().describe("Cursor from the previous response (next_cursor)"),
      },
    },
    audited(store, "ym_campaigns_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "yandex_market", args.connection_id);
      setCtx({ marketplace: "yandex_market", connectionId: conn.connection_id });
      requirePermission(conn, "catalog.read");

      const limit = args.limit ?? 100;
      if (conn.mock) {
        const page = paginate(mockCampaigns, limit, args.cursor);
        return envelope(page, { marketplace: "yandex_market", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ymClientFor(store, conn.connection_id);
      const pageToken = decodeCursor<string>(args.cursor, "");
      const page = await client.campaignsPage(limit, pageToken || undefined);
      const items = page.items.map((c) => ({
        campaign_id: String(c.id),
        business_id: c.businessId != null ? String(c.businessId) : null,
        business_name: c.businessName,
        domain: c.domain,
        placement_type: c.placementType,
      }));
      const hasMore = page.nextPageToken != null;
      const nextCursor = hasMore ? encodeCursor(page.nextPageToken) : null;
      return envelope({ items, has_more: hasMore, next_cursor: nextCursor }, { marketplace: "yandex_market", connectionId: conn.connection_id, nextCursor });
    }),
  );

  server.registerTool(
    "ym_products_list",
    {
      title: "Yandex Market: list products",
      description:
        "Returns Yandex Market products: seller article (offerId), title, category, barcode, Market SKU. " +
        "Read-only. Operates at the business-account level (businessId), not per shop.",
      inputSchema: {
        ...connectionArg,
        ...businessArg,
        limit: z.number().int().min(1).max(200).default(100).describe("Page size, max 200"),
        cursor: z.string().optional().describe("Cursor from the previous response (next_cursor)"),
      },
      outputSchema: listEnvelopeSchema(ProductSchema).shape,
    },
    audited(store, "ym_products_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "yandex_market", args.connection_id);
      setCtx({ marketplace: "yandex_market", connectionId: conn.connection_id });
      requirePermission(conn, "catalog.read");
      const limit = args.limit ?? 100;

      if (conn.mock) {
        const page = paginate(mockProducts, limit, args.cursor);
        return envelope(page, { marketplace: "yandex_market", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ymClientFor(store, conn.connection_id);
      const creds = await store.getCredentials(conn.connection_id);
      const businessId = await resolveBusinessId(client, args.business_id, creds.business_id);
      const pageToken = decodeCursor<string>(args.cursor, "");

      const raw = await client.request<any>("default", `/v2/businesses/${businessId}/offer-mappings`, {
        method: "POST",
        query: { limit: String(limit), ...(pageToken ? { pageToken } : {}) },
        body: {},
      });
      const mappings: any[] = raw?.result?.offerMappings ?? [];
      const items: Product[] = mappings.map((m) => {
        const o = m.offer ?? {};
        return {
          ref: {
            marketplace: "yandex_market" as const,
            marketplace_product_id: m.mapping?.marketSku != null ? String(m.mapping.marketSku) : String(o.offerId ?? ""),
            seller_sku: o.offerId ?? null,
            barcode: Array.isArray(o.barcodes) ? o.barcodes[0] ?? null : null,
            title: o.name ?? null,
          },
          brand: o.vendor ?? null,
          category: o.category ?? null,
        };
      });

      const nextToken = raw?.result?.paging?.nextPageToken ?? "";
      const hasMore = Boolean(nextToken);
      return envelope(
        { items, has_more: hasMore, next_cursor: hasMore ? encodeCursor(nextToken) : null },
        { marketplace: "yandex_market", connectionId: conn.connection_id, nextCursor: hasMore ? encodeCursor(nextToken) : null },
      );
    }),
  );

  server.registerTool(
    "ym_stocks_get",
    {
      title: "Yandex Market: get stocks",
      description:
        "Returns Yandex Market stock levels: available to order and reserved. Read-only. " +
        "Market stock types (AVAILABLE/FIT/FREEZE/DEFECT/…) are normalized: sellable quantity is " +
        "kept separate from reserved and defective stock. " +
        "IMPORTANT: Yandex Market splits stocks across two methods and a single call does NOT cover both. " +
        "Without campaign_id you get seller warehouses (FBS/DBS/Express). " +
        "With campaign_id you get Market warehouses (FBY, i.e. the FBO model), which is also the only " +
        "working path for accounts with warehouse groups. To see all stock, call it twice: " +
        "without campaign_id and with it (shop ids come from ym_campaigns_list).",
      inputSchema: {
        ...connectionArg,
        ...businessArg,
        campaign_id: z
          .string()
          .optional()
          .describe(
            "Shop id (campaignId). Required for stocks in Market warehouses (FBY/LaaS) " +
            "and for accounts that use warehouse groups. Discover it via ym_campaigns_list.",
          ),
        seller_sku: z.string().optional().describe("Filter by seller article (offerId)"),
        limit: z.number().int().min(1).max(100).default(100).describe("Page size, max 100"),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(StockSchema).shape,
    },
    audited(store, "ym_stocks_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "yandex_market", args.connection_id);
      setCtx({ marketplace: "yandex_market", connectionId: conn.connection_id });
      requirePermission(conn, "stocks.read");
      const limit = args.limit ?? 100;
      // Same criterion as the real branch: with campaign_id — Market warehouses (FBO),
      // without it — the account's own warehouses (FBS).
      const wantModel: "FBO" | "FBS" = args.campaign_id ? "FBO" : "FBS";
      const applyFilter = (items: Stock[]) =>
        items
          .filter((s) => s.fulfillment_model === wantModel)
          .filter((s) => !args.seller_sku || s.seller_sku === args.seller_sku);

      if (conn.mock) {
        const page = paginate(applyFilter(mockStocks), limit, args.cursor);
        return envelope(page, { marketplace: "yandex_market", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ymClientFor(store, conn.connection_id);
      const creds = await store.getCredentials(conn.connection_id);
      const pageToken = decodeCursor<string>(args.cursor, "");

      // Yandex Market has two stock methods and the choice between them is not cosmetic:
      //  - POST /v2/campaigns/{campaignId}/offers/stocks — Market warehouses (FBY/LaaS, i.e. FBO)
      //    and the ONLY working option for accounts with warehouse groups;
      //  - POST /v3/businesses/{businessId}/offers/stocks — account warehouses (FBS/DBS/Express),
      //    works only when there are no warehouse groups.
      // Without campaign_id, FBY stock is invisible entirely, so the tool supports both paths.
      const campaignId: string | undefined = args.campaign_id;
      const businessId = await resolveBusinessId(client, args.business_id, creds.business_id);
      let partnerWarehouseId: string | undefined;
      let partnerWarehouseName: string | null = null;
      let campaignFulfillment: "FBO" | "FBS" | undefined;
      let sellerNextCursor: YmSellerStocksCursor | null = null;
      let stockPageToken: string | undefined;
      if (!campaignId) {
        const cursor = sellerStocksCursor(args.cursor, businessId);
        const warehousePage = await client.request<any>("stocks", `/v3/businesses/${businessId}/warehouses`, {
          method: "POST",
          query: { limit: "30", ...(cursor?.warehouse_page_token ? { pageToken: cursor.warehouse_page_token } : {}) },
          body: {},
        });
        const warehouses: any[] = warehousePage?.result?.warehouses ?? warehousePage?.warehouses ?? [];
        const sorted = [...warehouses].sort((a, b) => String(a.id ?? a.partnerWarehouseId).localeCompare(String(b.id ?? b.partnerWarehouseId), undefined, { numeric: true }));
        const warehouseIndex = cursor?.warehouse_index ?? 0;
        const selected = sorted[warehouseIndex];
        if (!selected || (selected.id ?? selected.partnerWarehouseId) == null)
          throw new MpError("NOT_FOUND", "Yandex Market returned no seller warehouse for this business", { marketplace: "yandex_market" });
        partnerWarehouseId = String(selected.id ?? selected.partnerWarehouseId);
        partnerWarehouseName = selected.name ?? selected.warehouseName ?? null;
        stockPageToken = cursor?.stock_page_token ?? undefined;
        sellerNextCursor = {
          v: 1, kind: "ym_seller_stocks", business_id: businessId,
          warehouse_page_token: cursor?.warehouse_page_token ?? null, warehouse_index: warehouseIndex, stock_page_token: null,
        };
      } else {
        const campaign = (await client.campaignsPage(100)).items.find((item) => String(item.id) === campaignId);
        if (!campaign)
          throw new MpError("NOT_FOUND", "Yandex Market campaign is not available to this connection", { marketplace: "yandex_market" });
        campaignFulfillment = campaign.placementType === "FBY" ? "FBO" : "FBS";
      }
      const path = campaignId
        ? `/v2/campaigns/${campaignId}/offers/stocks`
        : `/v3/businesses/${businessId}/offers/stocks`;

      const raw = await client.request<any>("stocks", path, {
        method: "POST",
        query: { limit: String(limit), ...(campaignId ? (decodeCursor<string>(args.cursor, "") ? { pageToken: decodeCursor<string>(args.cursor, "") } : {}) : (stockPageToken ? { pageToken: stockPageToken } : {})) },
        body: partnerWarehouseId ? { partnerWarehouseId: Number(partnerWarehouseId) } : {},
      });

      // Response: warehouses[] → offers[] → stocks[] by type.
      // AVAILABLE/FIT — sellable, FREEZE — reserved,
      // DEFECT/EXPIRED/QUARANTINE/UTILIZATION — not sellable, excluded from available.
      const result = raw?.result ?? {};
      const warehouses: any[] = result.warehouses ?? (result.partnerWarehouseId != null ? [{ warehouseId: result.partnerWarehouseId, offers: result.offers ?? [] }] : []);
      const items: Stock[] = [];
      for (const w of warehouses) {
        for (const o of w.offers ?? []) {
          const byType: Record<string, number> = {};
          for (const s of o.stocks ?? []) byType[String(s.type ?? "").toUpperCase()] = Number(s.count ?? 0);
          const available = (byType.AVAILABLE ?? 0) || (byType.FIT ?? 0);
          items.push({
            marketplace: "yandex_market",
            marketplace_product_id: String(o.offerId ?? ""),
            size_id: null,
            seller_sku: o.offerId ?? null,
            warehouse: partnerWarehouseName,
            warehouse_id: w.warehouseId != null ? String(w.warehouseId) : partnerWarehouseId ?? null,
            region: null,
            // A per-shop query covers Market warehouses (FBY), i.e. FBO;
            // a per-account query covers seller warehouses, i.e. FBS.
            fulfillment_model: campaignFulfillment ?? "FBS",
            available,
            reserved: byType.FREEZE ?? 0,
            in_transit_to_customer: 0,
            in_transit_from_customer: 0,
          });
        }
      }

      const nextToken = result?.paging?.nextPageToken ?? "";
      let nextCursor: string | null;
      if (campaignId) nextCursor = nextToken ? encodeCursor(nextToken) : null;
      else {
        const state = sellerNextCursor!;
        if (nextToken) state.stock_page_token = nextToken;
        else {
          const warehousePage = await client.request<any>("stocks", `/v3/businesses/${businessId}/warehouses`, {
            method: "POST", query: { limit: "30", ...(state.warehouse_page_token ? { pageToken: state.warehouse_page_token } : {}) }, body: {},
          });
          const currentWarehouses: any[] = warehousePage?.result?.warehouses ?? warehousePage?.warehouses ?? [];
          const count = currentWarehouses.length;
          const discoveryNext = warehousePage?.result?.paging?.nextPageToken ?? warehousePage?.paging?.nextPageToken ?? null;
          if (state.warehouse_index + 1 < count) state.warehouse_index += 1;
          else if (discoveryNext) { state.warehouse_page_token = discoveryNext; state.warehouse_index = 0; }
          else sellerNextCursor = null;
        }
        nextCursor = sellerNextCursor ? encodeCursor(sellerNextCursor) : null;
      }
      const hasMore = Boolean(nextCursor);
      return envelope(
        { items: items.filter((item) => !args.seller_sku || item.seller_sku === args.seller_sku), has_more: hasMore, next_cursor: nextCursor },
        { marketplace: "yandex_market", connectionId: conn.connection_id, nextCursor },
      );
    }),
  );

  server.registerTool(
    "ym_prices_get",
    {
      title: "Yandex Market: get prices",
      description:
        "Returns Yandex Market prices: base price, price for the customer, currency. " +
        "Read-only; never changes prices. Money values are decimal strings.",
      inputSchema: {
        ...connectionArg,
        ...businessArg,
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(PriceSchema).shape,
    },
    audited(store, "ym_prices_get", async (args, setCtx) => {
      const conn = await resolveConnection(store, "yandex_market", args.connection_id);
      setCtx({ marketplace: "yandex_market", connectionId: conn.connection_id });
      requirePermission(conn, "prices.read");
      const limit = args.limit ?? 100;

      if (conn.mock) {
        const page = paginate(mockPrices, limit, args.cursor);
        return envelope(page, { marketplace: "yandex_market", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ymClientFor(store, conn.connection_id);
      const creds = await store.getCredentials(conn.connection_id);
      const businessId = await resolveBusinessId(client, args.business_id, creds.business_id);
      const pageToken = decodeCursor<string>(args.cursor, "");

      // Prices arrive together with products in offer-mappings (basicPrice + discountBase).
      const raw = await client.request<any>("default", `/v2/businesses/${businessId}/offer-mappings`, {
        method: "POST",
        query: { limit: String(limit), ...(pageToken ? { pageToken } : {}) },
        body: {},
      });
      const mappings: any[] = raw?.result?.offerMappings ?? [];
      const items: Price[] = mappings
        .filter((m) => m.offer?.basicPrice)
        .map((m) => {
          const o = m.offer;
          const bp = o.basicPrice ?? {};
          const currency = bp.currencyId ?? "RUB";
          const actual = Number(bp.value ?? 0);
          const base = Number(bp.discountBase ?? actual);
          const discount = base > 0 && actual > 0 && base >= actual ? Math.round(((base - actual) / base) * 100) : 0;
          return {
            marketplace: "yandex_market" as const,
            marketplace_product_id: m.mapping?.marketSku != null ? String(m.mapping.marketSku) : String(o.offerId ?? ""),
            seller_sku: o.offerId ?? null,
            price: { amount: String(base), currency },
            discount_percent: discount,
            price_after_discount: { amount: String(actual), currency },
          };
        });

      const nextToken = raw?.result?.paging?.nextPageToken ?? "";
      const hasMore = Boolean(nextToken);
      return envelope(
        { items, has_more: hasMore, next_cursor: hasMore ? encodeCursor(nextToken) : null },
        { marketplace: "yandex_market", connectionId: conn.connection_id, nextCursor: hasMore ? encodeCursor(nextToken) : null },
      );
    }),
  );

  server.registerTool(
    "ym_orders_list",
    {
      title: "Yandex Market: list orders",
      description:
        "Returns Yandex Market orders for a period (30 days by default): date, items, amount, status, shop. " +
        "Read-only. A single request spans at most 30 days (API limitation).",
      inputSchema: {
        ...connectionArg,
        ...businessArg,
        date_from: z.string().optional().describe("ISO start date (defaults to −30 days). Range must not exceed 30 days."),
        date_to: z.string().optional().describe("ISO end date (defaults to today). Range must not exceed 30 days."),
        limit: z.number().int().min(1).max(50).default(50).describe("Page size, max 50 (API limitation)"),
        cursor: z.string().optional(),
      },
      outputSchema: listEnvelopeSchema(OrderSchema).shape,
    },
    audited(store, "ym_orders_list", async (args, setCtx) => {
      const conn = await resolveConnection(store, "yandex_market", args.connection_id);
      setCtx({ marketplace: "yandex_market", connectionId: conn.connection_id });
      requirePermission(conn, "orders.read");
      const limit = args.limit ?? 50;
      const fromIso = args.date_from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
      const toIso = args.date_to ?? new Date().toISOString();
      const fromDate = fromIso.slice(0, 10);
      const toDate = toIso.slice(0, 10);
      if (new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime() > 30 * 86_400_000)
        throw new MpError("INVALID_ARGUMENT", "Yandex Market orders date range must not exceed 30 days", { marketplace: "yandex_market" });

      if (conn.mock) {
        const page = paginate(mockOrders.filter((o) => (o.created_at ?? "") >= fromIso), limit, args.cursor);
        return envelope(page, { marketplace: "yandex_market", connectionId: conn.connection_id, source: "mock", nextCursor: page.next_cursor });
      }

      const client = await ymClientFor(store, conn.connection_id);
      const creds = await store.getCredentials(conn.connection_id);
      const businessId = await resolveBusinessId(client, args.business_id, creds.business_id);
      const cursor = ordersCursor(args.cursor, businessId, fromDate, toDate);
      const requestPageToken = cursor?.request_page_token ?? null;

      const raw = await client.request<any>("orders", `/v1/businesses/${businessId}/orders`, {
        method: "POST",
        query: { limit: String(limit), ...(requestPageToken ? { pageToken: requestPageToken } : {}) },
        body: { dates: { creationDateFrom: fromDate, creationDateTo: toDate } },
      });

      // An order contains several items — we normalize to one row per item, as with WB
      // and Ozon, so the response shape is identical across all platforms.
      const items: Order[] = [];
      for (const o of raw?.orders ?? []) {
        const status = String(o.status ?? "").toLowerCase();
        const cancelled = status === "cancelled" || status === "canceled";
        for (const it of o.items ?? []) {
          const qty = Number(it.count ?? 1);
          const unit = Number(it.price ?? it.buyerPrice ?? it.prices?.buyerPrice ?? 0);
          items.push({
            marketplace: "yandex_market",
            order_id: o.orderId != null ? String(o.orderId) : null,
            created_at: o.creationDate ?? null,
            marketplace_product_id: it.marketSku != null ? String(it.marketSku) : null,
            seller_sku: it.offerId ?? null,
            quantity: qty,
            amount: { amount: (unit * qty).toFixed(2), currency: "RUB" },
            warehouse: o.campaignId != null ? `campaign:${o.campaignId}` : null,
            status,
            is_cancelled: cancelled,
          });
        }
      }

      const offset = cursor?.normalized_offset ?? 0;
      const nextToken = cursor?.next_page_token ?? raw?.paging?.nextPageToken ?? null;
      const pageItems = items.slice(offset, offset + limit);
      let nextCursor: string | null = null;
      if (offset + pageItems.length < items.length) {
        nextCursor = encodeCursor({ v: 1, kind: "ym_orders", business_id: businessId, date_from: fromDate, date_to: toDate, request_page_token: requestPageToken, normalized_offset: offset + pageItems.length, next_page_token: nextToken } satisfies YmOrdersCursor);
      } else if (nextToken) {
        nextCursor = encodeCursor({ v: 1, kind: "ym_orders", business_id: businessId, date_from: fromDate, date_to: toDate, request_page_token: nextToken, normalized_offset: 0, next_page_token: null } satisfies YmOrdersCursor);
      }
      const hasMore = Boolean(nextCursor);
      return envelope(
        { items: pageItems, has_more: hasMore, next_cursor: nextCursor },
        { marketplace: "yandex_market", connectionId: conn.connection_id, nextCursor },
      );
    }),
  );
}
