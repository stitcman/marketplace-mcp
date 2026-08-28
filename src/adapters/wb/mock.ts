/**
 * WB mock data for demo mode: the server works fully without API keys.
 *
 * IMPORTANT: the types come from schema.ts — the same source the real-API branch uses.
 * Any mock↔real shape divergence becomes a compile error instead of a surprise once a
 * real token is connected.
 *
 * Product titles and warehouse names are intentionally left in Russian: that is exactly
 * what the real marketplace APIs return, so the demo stays faithful.
 */
import type { Order, Price, Product, Stock } from "./schema.js";

export const mockProducts: Product[] = [
  {
    ref: { marketplace: "wildberries", marketplace_product_id: "118638974", seller_sku: "ZR-001", barcode: "4600000000017", title: "Щётка для одежды ZERBERG Classic" },
    brand: "ZERBERG",
    category: "Щётки для одежды",
  },
  {
    ref: { marketplace: "wildberries", marketplace_product_id: "118638975", seller_sku: "ZR-002", barcode: "4600000000024", title: "Щётка для обуви ZERBERG Pro" },
    brand: "ZERBERG",
    category: "Уход за обувью",
  },
  {
    ref: { marketplace: "wildberries", marketplace_product_id: "118638976", seller_sku: "ZR-003", barcode: "4600000000031", title: "Ролик для чистки одежды ZERBERG, 3 шт" },
    brand: "ZERBERG",
    category: "Ролики для чистки",
  },
];

/** nmID → seller article: the real stocks-report returns only nmId, so seller_sku is
 *  enriched from the product cards (see tools.ts). */
export const mockSkuByNmId: Record<string, string> = {
  "118638974": "ZR-001",
  "118638975": "ZR-002",
  "118638976": "ZR-003",
};

export const mockStocks: Stock[] = [
  // Spec §19: never merge FBO/FBW with FBS; keep available separate from in-transit.
  { marketplace: "wildberries", marketplace_product_id: "118638974", size_id: "91663228", seller_sku: "ZR-001", warehouse: "Склад WB", warehouse_id: "-999999", region: "Склад WB", fulfillment_model: "FBO", available: 180, reserved: 0, in_transit_to_customer: 16, in_transit_from_customer: 3 },
  { marketplace: "wildberries", marketplace_product_id: "118638975", size_id: "91663229", seller_sku: "ZR-002", warehouse: "Склад WB", warehouse_id: "-999999", region: "Склад WB", fulfillment_model: "FBO", available: 7, reserved: 0, in_transit_to_customer: 2, in_transit_from_customer: 1 },
  { marketplace: "wildberries", marketplace_product_id: "118638976", size_id: "91663230", seller_sku: "ZR-003", warehouse: "Склад WB", warehouse_id: "-999999", region: "Склад WB", fulfillment_model: "FBO", available: 512, reserved: 0, in_transit_to_customer: 31, in_transit_from_customer: 4 },
  { marketplace: "wildberries", marketplace_product_id: "118638976", size_id: "91663230", seller_sku: "ZR-003", warehouse: "Склад продавца Иркутск", warehouse_id: "123456", region: "Дальневосточный и Сибирский", fulfillment_model: "FBS", available: 90, reserved: 0, in_transit_to_customer: 0, in_transit_from_customer: 0 },
];

export const mockPrices: Price[] = [
  { marketplace: "wildberries", marketplace_product_id: "118638974", seller_sku: "ZR-001", price: { amount: "890.00", currency: "RUB" }, discount_percent: 25, price_after_discount: { amount: "667.50", currency: "RUB" } },
  { marketplace: "wildberries", marketplace_product_id: "118638975", seller_sku: "ZR-002", price: { amount: "1290.00", currency: "RUB" }, discount_percent: 30, price_after_discount: { amount: "903.00", currency: "RUB" } },
  { marketplace: "wildberries", marketplace_product_id: "118638976", seller_sku: "ZR-003", price: { amount: "540.00", currency: "RUB" }, discount_percent: 15, price_after_discount: { amount: "459.00", currency: "RUB" } },
];

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export const mockOrders: Order[] = Array.from({ length: 25 }, (_, i) => {
  const skus = ["ZR-001", "ZR-003", "ZR-003", "ZR-002", "ZR-001", "ZR-003"];
  const sku = skus[i % skus.length];
  const price = { "ZR-001": "667.50", "ZR-002": "903.00", "ZR-003": "459.00" }[sku]!;
  const nmId = { "ZR-001": "118638974", "ZR-002": "118638975", "ZR-003": "118638976" }[sku]!;
  return {
    marketplace: "wildberries" as const,
    order_id: `WB-${202608000 + i}`,
    created_at: daysAgo(Math.floor(i / 2)),
    marketplace_product_id: nmId,
    seller_sku: sku,
    quantity: 1,
    amount: { amount: price, currency: "RUB" },
    warehouse: i % 5 === 0 ? "Казань" : "Коледино",
    status: i < 20 ? "delivered" : "in_delivery",
    is_cancelled: i === 24,
  };
});
