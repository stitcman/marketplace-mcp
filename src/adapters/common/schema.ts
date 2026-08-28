/**
 * Shared normalized response schemas for ALL marketplaces (spec §16).
 *
 * Why one module for three platforms: Wildberries, Ozon and Yandex Market model
 * "product", "stock" and "order" completely differently. Normalization is half the
 * value of this server: the agent should ask the same question and get the same
 * shape back regardless of the platform.
 *
 * These schemas are also declared as tool outputSchemas, so the SDK validates
 * structuredContent before it is sent. A mock↔real divergence therefore fails in
 * tests rather than in the customer's account.
 */
import { z } from "zod";

export const MarketplaceSchema = z.enum(["wildberries", "ozon", "yandex_market"]);

/** Money is a decimal string plus a currency — never a float (spec §16). */
export const MoneySchema = z.object({
  amount: z.string().describe('Decimal string amount, e.g. "1290.00"'),
  currency: z.string().describe("ISO 4217 currency code, e.g. RUB"),
});

/**
 * Product reference. marketplace_product_id is the platform's own identifier
 * (WB: nmID, Ozon: product_id, Yandex Market: marketSku); seller_sku is the seller's
 * article (WB: vendorCode, Ozon: offer_id, Yandex Market: offerId).
 */
export const ProductRefSchema = z.object({
  marketplace: MarketplaceSchema,
  marketplace_product_id: z.string().describe("Product identifier on the marketplace"),
  seller_sku: z.string().nullable().describe("Seller's own article/SKU"),
  barcode: z.string().nullable(),
  title: z.string().nullable(),
});

export const ProductSchema = z.object({
  ref: ProductRefSchema,
  brand: z.string().nullable(),
  category: z.string().nullable(),
});

/**
 * Stock row. One row = one product (or size) in one warehouse under one fulfillment
 * model. FBO and FBS are deliberately never merged into a single number (spec §19).
 */
export const StockSchema = z.object({
  marketplace: MarketplaceSchema,
  marketplace_product_id: z.string(),
  size_id: z.string().nullable().describe("Size/variant id when the platform distinguishes them (WB chrtId)"),
  seller_sku: z.string().nullable(),
  warehouse: z.string().nullable(),
  warehouse_id: z.string().nullable(),
  region: z.string().nullable(),
  fulfillment_model: z.enum(["FBO", "FBS"]).describe("FBO — marketplace warehouse, FBS — seller warehouse"),
  available: z.number().describe("Available for customers to order"),
  reserved: z.number().describe("Reserved for existing orders"),
  in_transit_to_customer: z.number().describe("In transit to the customer"),
  in_transit_from_customer: z.number().describe("In transit from the customer (returns)"),
});

export const PriceSchema = z.object({
  marketplace: MarketplaceSchema,
  marketplace_product_id: z.string(),
  seller_sku: z.string().nullable(),
  price: MoneySchema.describe("Price before discount"),
  discount_percent: z.number(),
  price_after_discount: MoneySchema.describe("Price the customer actually sees"),
});

export const OrderSchema = z.object({
  marketplace: MarketplaceSchema,
  order_id: z.string().nullable().describe("Order/posting identifier on the platform"),
  created_at: z.string().nullable().describe("UTC ISO 8601"),
  marketplace_product_id: z.string().nullable(),
  seller_sku: z.string().nullable(),
  quantity: z.number(),
  amount: MoneySchema,
  warehouse: z.string().nullable(),
  status: z.string().describe("Platform status, lower-cased"),
  is_cancelled: z.boolean(),
});

const MetaSchema = z.object({
  fetched_at: z.string(),
  source: z.enum(["official_api", "mock", "cache", "internal"]),
  cached: z.boolean(),
  next_cursor: z.string().nullable(),
});

/** List envelope: success + data{items,has_more,next_cursor} + meta. */
export function listEnvelopeSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    success: z.literal(true),
    marketplace: z.string().nullable(),
    connection_id: z.string().nullable(),
    data: z.object({
      items: z.array(item),
      has_more: z.boolean(),
      next_cursor: z.string().nullable(),
    }),
    meta: MetaSchema,
  });
}

export type Marketplace = z.infer<typeof MarketplaceSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Stock = z.infer<typeof StockSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type Order = z.infer<typeof OrderSchema>;

/** Pagination cursors: opaque base64 on the outside, anything we like on the inside. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeCursor<T>(cursor: string | undefined, fallback: T): T {
  if (!cursor) return fallback;
  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8")) as T;
  } catch {
    return fallback;
  }
}
