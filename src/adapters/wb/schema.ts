/**
 * Wildberries-specific layer on top of the shared schemas (../common/schema.ts).
 *
 * This module used to hold its own ProductSchema/StockSchema definitions. Once Ozon
 * and Yandex Market were added, the single source of truth moved to common/schema.ts —
 * otherwise the three adapters would drift apart in shape, and normalization is exactly
 * what this server exists for.
 *
 * The module is kept as a re-export point: it documents what the shared schema fields
 * mean specifically on Wildberries.
 *
 *   marketplace_product_id — nmID
 *   seller_sku             — vendorCode
 *   size_id                — chrtId (on WB one stock row = one size)
 */
export {
  MoneySchema,
  ProductRefSchema,
  ProductSchema,
  StockSchema,
  PriceSchema,
  OrderSchema,
  listEnvelopeSchema,
  encodeCursor,
  decodeCursor,
  type Product,
  type Stock,
  type Price,
  type Order,
} from "../common/schema.js";
