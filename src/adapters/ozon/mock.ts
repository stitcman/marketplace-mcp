/**
 * Ozon mock data for demo mode. The types come from the shared schema, so any
 * divergence from the real adapter's shape becomes a compile error.
 *
 * Product titles and warehouse names stay in Russian on purpose: that is what the
 * real API returns, so the demo stays faithful.
 */
import type { Order, Price, Product, Stock } from "../common/schema.js";

export const mockProducts: Product[] = [
  {
    ref: { marketplace: "ozon", marketplace_product_id: "704531", seller_sku: "ZR-001", barcode: "4600000000017", title: "Щётка для одежды ZERBERG Classic" },
    brand: "ZERBERG",
    category: "Уход за одеждой",
  },
  {
    ref: { marketplace: "ozon", marketplace_product_id: "704532", seller_sku: "ZR-002", barcode: "4600000000024", title: "Щётка для обуви ZERBERG Pro" },
    brand: "ZERBERG",
    category: "Уход за обувью",
  },
  {
    ref: { marketplace: "ozon", marketplace_product_id: "704533", seller_sku: "ZR-003", barcode: "4600000000031", title: "Ролик для чистки одежды ZERBERG, 3 шт" },
    brand: "ZERBERG",
    category: "Уход за одеждой",
  },
];

export const mockStocks: Stock[] = [
  { marketplace: "ozon", marketplace_product_id: "704531", size_id: null, seller_sku: "ZR-001", warehouse: "Хоругвино", warehouse_id: "17717", region: null, fulfillment_model: "FBO", available: 96, reserved: 8, in_transit_to_customer: 0, in_transit_from_customer: 0 },
  { marketplace: "ozon", marketplace_product_id: "704532", size_id: null, seller_sku: "ZR-002", warehouse: "Хоругвино", warehouse_id: "17717", region: null, fulfillment_model: "FBO", available: 3, reserved: 1, in_transit_to_customer: 0, in_transit_from_customer: 0 },
  { marketplace: "ozon", marketplace_product_id: "704533", size_id: null, seller_sku: "ZR-003", warehouse: "Софьино", warehouse_id: "17718", region: null, fulfillment_model: "FBO", available: 240, reserved: 15, in_transit_to_customer: 0, in_transit_from_customer: 0 },
  { marketplace: "ozon", marketplace_product_id: "704533", size_id: null, seller_sku: "ZR-003", warehouse: "Склад продавца", warehouse_id: "99001", region: null, fulfillment_model: "FBS", available: 42, reserved: 2, in_transit_to_customer: 0, in_transit_from_customer: 0 },
];

export const mockPrices: Price[] = [
  { marketplace: "ozon", marketplace_product_id: "704531", seller_sku: "ZR-001", price: { amount: "950.00", currency: "RUB" }, discount_percent: 21, price_after_discount: { amount: "750.00", currency: "RUB" } },
  { marketplace: "ozon", marketplace_product_id: "704532", seller_sku: "ZR-002", price: { amount: "1350.00", currency: "RUB" }, discount_percent: 26, price_after_discount: { amount: "999.00", currency: "RUB" } },
  { marketplace: "ozon", marketplace_product_id: "704533", seller_sku: "ZR-003", price: { amount: "560.00", currency: "RUB" }, discount_percent: 13, price_after_discount: { amount: "487.00", currency: "RUB" } },
];

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

export const mockOrders: Order[] = Array.from({ length: 18 }, (_, i) => {
  const skus = ["ZR-001", "ZR-003", "ZR-002", "ZR-003", "ZR-001"];
  const sku = skus[i % skus.length];
  const nmId = { "ZR-001": "704531", "ZR-002": "704532", "ZR-003": "704533" }[sku]!;
  const price = { "ZR-001": "750.00", "ZR-002": "999.00", "ZR-003": "487.00" }[sku]!;
  return {
    marketplace: "ozon" as const,
    order_id: `${48920000 + i}-0001-1`,
    created_at: daysAgo(Math.floor(i / 2)),
    marketplace_product_id: nmId,
    seller_sku: sku,
    quantity: 1,
    amount: { amount: price, currency: "RUB" },
    warehouse: i % 4 === 0 ? "Софьино" : "Хоругвино",
    status: i < 14 ? "delivered" : "awaiting_deliver",
    is_cancelled: i === 17,
  };
});
