/**
 * Yandex Market mock data for demo mode. The types come from the shared schema, so a
 * divergence from the real adapter's shape is caught by the compiler.
 *
 * Product titles and warehouse names stay in Russian on purpose: that is what the real
 * API returns, so the demo stays faithful.
 */
import type { Order, Price, Product, Stock } from "../common/schema.js";

/** Shops in the account: one Yandex Market businessId can hold several campaignIds. */
export const mockCampaigns = [
  { campaign_id: "21explicit", business_id: "9910001", business_name: "ZERBERG", domain: "zerberg-fbs.ru", placement_type: "FBS" },
  { campaign_id: "21express", business_id: "9910001", business_name: "ZERBERG", domain: "zerberg-express.ru", placement_type: "FBY" },
];

export const mockProducts: Product[] = [
  {
    ref: { marketplace: "yandex_market", marketplace_product_id: "101228841", seller_sku: "ZR-001", barcode: "4600000000017", title: "Щётка для одежды ZERBERG Classic" },
    brand: "ZERBERG",
    category: "Товары для дома",
  },
  {
    ref: { marketplace: "yandex_market", marketplace_product_id: "101228842", seller_sku: "ZR-002", barcode: "4600000000024", title: "Щётка для обуви ZERBERG Pro" },
    brand: "ZERBERG",
    category: "Уход за обувью",
  },
  {
    ref: { marketplace: "yandex_market", marketplace_product_id: "101228843", seller_sku: "ZR-003", barcode: "4600000000031", title: "Ролик для чистки одежды ZERBERG, 3 шт" },
    brand: "ZERBERG",
    category: "Товары для дома",
  },
];

/**
 * Stocks: FBO rows correspond to Market warehouses (FBY) and come from the campaign
 * method; FBS rows are seller warehouses from the business method.
 * ym_stocks_get filters them by the same criterion as the real adapter.
 */
export const mockStocks: Stock[] = [
  { marketplace: "yandex_market", marketplace_product_id: "101228841", size_id: null, seller_sku: "ZR-001", warehouse: "Склад Маркета Томилино", warehouse_id: "10000012", region: null, fulfillment_model: "FBO", available: 74, reserved: 6, in_transit_to_customer: 0, in_transit_from_customer: 0 },
  { marketplace: "yandex_market", marketplace_product_id: "101228842", size_id: null, seller_sku: "ZR-002", warehouse: "Склад Маркета Томилино", warehouse_id: "10000012", region: null, fulfillment_model: "FBO", available: 2, reserved: 0, in_transit_to_customer: 0, in_transit_from_customer: 0 },
  { marketplace: "yandex_market", marketplace_product_id: "101228843", size_id: null, seller_sku: "ZR-003", warehouse: "Собственный склад", warehouse_id: "20000034", region: null, fulfillment_model: "FBS", available: 133, reserved: 9, in_transit_to_customer: 0, in_transit_from_customer: 0 },
];

export const mockPrices: Price[] = [
  { marketplace: "yandex_market", marketplace_product_id: "101228841", seller_sku: "ZR-001", price: { amount: "920.00", currency: "RUB" }, discount_percent: 20, price_after_discount: { amount: "736.00", currency: "RUB" } },
  { marketplace: "yandex_market", marketplace_product_id: "101228842", seller_sku: "ZR-002", price: { amount: "1310.00", currency: "RUB" }, discount_percent: 25, price_after_discount: { amount: "982.50", currency: "RUB" } },
  { marketplace: "yandex_market", marketplace_product_id: "101228843", seller_sku: "ZR-003", price: { amount: "550.00", currency: "RUB" }, discount_percent: 10, price_after_discount: { amount: "495.00", currency: "RUB" } },
];

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export const mockOrders: Order[] = Array.from({ length: 14 }, (_, i) => {
  const skus = ["ZR-003", "ZR-001", "ZR-003", "ZR-002"];
  const sku = skus[i % skus.length];
  const msku = { "ZR-001": "101228841", "ZR-002": "101228842", "ZR-003": "101228843" }[sku]!;
  const price = { "ZR-001": "736.00", "ZR-002": "982.50", "ZR-003": "495.00" }[sku]!;
  return {
    marketplace: "yandex_market" as const,
    order_id: String(31500000 + i),
    created_at: daysAgo(Math.floor(i / 2)),
    marketplace_product_id: msku,
    seller_sku: sku,
    quantity: 1,
    amount: { amount: price, currency: "RUB" },
    warehouse: i % 3 === 0 ? "Собственный склад" : "Склад Маркета Томилино",
    status: i < 11 ? "delivered" : "processing",
    is_cancelled: i === 13,
  };
});
