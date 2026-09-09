import { MpError } from "./errors.js";
import { rateLimiter, withRetries, type LimitRule } from "./rateLimiter.js";
import type { ReadMethod, ReadTransport } from "./readPolicy.js";
import type { Marketplace } from "./store.js";

const hosts: Record<Marketplace, Record<string, string>> = {
  ozon: { default: "https://api-seller.ozon.ru", performance: "https://api-performance.ozon.ru" },
  yandex_market: { default: "https://api.partner.market.yandex.ru" },
  wildberries: {
    statistics: "https://statistics-api.wildberries.ru", analytics: "https://seller-analytics-api.wildberries.ru",
    content: "https://content-api.wildberries.ru", prices: "https://discounts-prices-api.wildberries.ru",
    common: "https://common-api.wildberries.ru", marketplace: "https://marketplace-api.wildberries.ru",
    supplies: "https://supplies-api.wildberries.ru", advertising: "https://advert-api.wildberries.ru",
    feedbacks: "https://feedbacks-api.wildberries.ru", questions: "https://feedbacks-api.wildberries.ru",
    returns: "https://returns-api.wildberries.ru", tariffs: "https://common-api.wildberries.ru",
    chats: "https://buyer-chat-api.wildberries.ru", documents: "https://documents-api.wildberries.ru",
  },
};

const limits: Record<Marketplace, LimitRule> = {
  ozon: { requests: 100, perMs: 60_000 },
  wildberries: { requests: 3, perMs: 60_000 },
  yandex_market: { requests: 100, perMs: 60_000 },
};

export class MarketplaceReadTransport implements ReadTransport {
  async send(input: { marketplace: Marketplace; connectionId: string; method: ReadMethod; params: Record<string, unknown>; credentials: Record<string, string> }) {
    const { marketplace, connectionId, method, credentials } = input;
    if (marketplace === "ozon" && method.endpoint_group === "performance") {
      throw new MpError("FEATURE_NOT_AVAILABLE_FOR_ACCOUNT", "Ozon Performance methods require separate read credentials; Seller Admin Read-Only credentials are not reused", { marketplace });
    }
    const host = hosts[marketplace][method.endpoint_group] ?? hosts[marketplace].default;
    if (!host) throw new MpError("FEATURE_NOT_SUPPORTED", `No pinned host for endpoint group ${method.endpoint_group}`, { marketplace });
    const params = structuredClone(input.params);
    let resolvedPath = method.path;
    resolvedPath = resolvedPath.replace(/\{([^}]+)\}/g, (_match, key) => {
      const value = params[key];
      if (value === undefined || value === null || value === "") throw new MpError("LOCAL_DENY", `Missing path parameter ${key}`, { marketplace });
      delete params[key];
      return encodeURIComponent(String(value));
    });
    const url = new URL(resolvedPath, host);
    const httpMethod = method.http_method.toUpperCase();
    const useQuery = httpMethod === "GET" || httpMethod === "DELETE";
    if (useQuery) for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item));
      else if (typeof value !== "object") url.searchParams.set(key, String(value));
      else url.searchParams.set(key, JSON.stringify(value));
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (marketplace === "ozon") {
      if (!credentials.client_id || !credentials.api_key) throw new MpError("AUTH_FAILED", "Ozon connection is missing client_id/api_key", { marketplace });
      headers["Client-Id"] = credentials.client_id;
      headers["Api-Key"] = credentials.api_key;
    } else if (marketplace === "wildberries") {
      if (!credentials.token) throw new MpError("AUTH_FAILED", "Wildberries connection is missing token", { marketplace });
      headers.Authorization = credentials.token;
    } else {
      if (!credentials.api_key) throw new MpError("AUTH_FAILED", "Yandex Market connection is missing api_key", { marketplace });
      headers["Api-Key"] = credentials.api_key;
    }
    if (!useQuery) headers["Content-Type"] = "application/json";
    await rateLimiter.acquire(`${marketplace}:${connectionId}:${method.endpoint_group}`, limits[marketplace]);
    return withRetries(async () => {
      let response: Response;
      try {
        response = await fetch(url, { method: httpMethod, headers, body: useQuery ? undefined : JSON.stringify(params), signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new MpError("UPSTREAM_TIMEOUT", `${marketplace} request failed or timed out`, { marketplace, retryable: true });
      }
      if (response.status === 401) throw new MpError("AUTH_FAILED", `${marketplace} rejected the credential`, { marketplace });
      if (response.status === 403) throw new MpError("MARKETPLACE_PERMISSION_DENIED", `${marketplace} denied the required credential permission`, { marketplace });
      if (response.status === 429 || response.status === 420) throw new MpError("RATE_LIMITED", `${marketplace} rate limit reached`, { marketplace, retryable: true });
      if (response.status >= 500) throw new MpError("MARKETPLACE_UNAVAILABLE", `${marketplace} returned ${response.status}`, { marketplace, retryable: true });
      if (!response.ok) throw new MpError("INVALID_ARGUMENT", `${marketplace} returned ${response.status}`, { marketplace });
      if (response.status === 204) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!/json/i.test(contentType)) {
        const bytes = Buffer.from(await response.arrayBuffer());
        return { __download: true, bytes, mime_type: contentType.split(";")[0] || "application/octet-stream" };
      }
      return response.json();
    });
  }
}
