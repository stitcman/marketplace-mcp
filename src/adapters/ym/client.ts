/**
 * HTTP client for the Yandex Market Partner API.
 *
 * Authorization (spec §6.3): its own `Api-Key: <key>` header.
 * This is NOT `Authorization: Api-Key ...` — in the official OpenAPI specification
 * (github.com/yandex-market/yandex-market-partner-api) the security scheme is declared
 * as `type: apiKey, name: Api-Key, in: header`. OAuth is still supported but marked
 * legacy for new integrations.
 *
 * Account hierarchy: businessId (business account) → campaignId (shops inside it).
 * Some methods work at the account level, others at the shop level; GET /v2/campaigns
 * returns both identifiers.
 */
import { MpError } from "../../core/errors.js";
import { rateLimiter, withRetries } from "../../core/rateLimiter.js";
import type { LimitRule } from "../../core/rateLimiter.js";

const HOST = "https://api.partner.market.yandex.ru";

/**
 * Limits taken from the official specification (x-resource-limit-config), verified
 * 2026-08-28. Yandex Market defines limits per method rather than per category.
 */
export const YM_LIMITS: Record<string, LimitRule> = {
  campaigns: { requests: 1_000, perMs: 3_600_000 }, // getCampaigns: 1000/hour
  stocks: { requests: 500, perMs: 60_000 }, // getStocksOnPartnerWarehouses: 500/min
  orders: { requests: 10_000, perMs: 3_600_000 }, // getBusinessOrders: 10000/hour
  default: { requests: 1_000, perMs: 3_600_000 },
};

export type YmGroup = keyof typeof YM_LIMITS;

export class YmClient {
  constructor(
    private apiKey: string,
    private connectionId: string,
  ) {}

  async request<T>(
    group: YmGroup,
    path: string,
    init: { method?: string; query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    await rateLimiter.acquire(`yandex_market:${this.connectionId}:${group}`, YM_LIMITS[group] ?? YM_LIMITS.default);

    const url = new URL(path, HOST);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    return withRetries(async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: init.method ?? "GET",
          headers: {
            "Api-Key": this.apiKey, // secret: never log it
            "Content-Type": "application/json",
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError")
          throw new MpError("UPSTREAM_TIMEOUT", "Yandex Market API did not respond within 30s", { marketplace: "yandex_market", retryable: true });
        throw new MpError("MARKETPLACE_UNAVAILABLE", "Network error while calling the Yandex Market API", { marketplace: "yandex_market", retryable: true });
      }

      if (res.status === 401)
        throw new MpError("AUTH_FAILED", "Yandex Market rejected the Api-Key (401). Check the connection token.", { marketplace: "yandex_market" });
      if (res.status === 403)
        throw new MpError("MARKETPLACE_PERMISSION_DENIED", "The Api-Key lacks the required scopes (403). Check the token scopes in the seller cabinet.", { marketplace: "yandex_market" });
      if (res.status === 404)
        throw new MpError("NOT_FOUND", "Yandex Market: object not found (404)", { marketplace: "yandex_market" });
      // 420 on Yandex Market means rate limit exceeded (a non-standard status code).
      if (res.status === 429 || res.status === 420) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "0");
        throw new MpError("RATE_LIMITED", `Yandex Market returned ${res.status} (rate limit exceeded)`, {
          marketplace: "yandex_market",
          retryable: true,
          details: retryAfter > 0 ? { retry_after_ms: retryAfter * 1000 } : undefined,
        });
      }
      if (res.status >= 500)
        throw new MpError("MARKETPLACE_UNAVAILABLE", `Yandex Market returned ${res.status}`, { marketplace: "yandex_market", retryable: true });
      if (!res.ok) {
        let msg = `Yandex Market returned ${res.status}`;
        try {
          const j: any = await res.json();
          const err = j?.errors?.[0] ?? j?.error;
          if (err?.message) msg = `Yandex Market: ${err.message}`;
        } catch {
          /* body is not JSON */
        }
        throw new MpError("INVALID_ARGUMENT", msg, { marketplace: "yandex_market" });
      }

      if (res.status === 204) return null as T;
      return (await res.json()) as T;
    });
  }

  /** Shops in the account — doubles as the cheapest possible key check. */
  async campaigns(): Promise<Array<{ id: number; domain: string | null; businessId: number | null; businessName: string | null; placementType: string | null }>> {
    const raw = await this.request<any>("campaigns", "/v2/campaigns", { query: { pageSize: "100" } });
    return (raw?.campaigns ?? []).map((c: any) => ({
      id: c.id,
      domain: c.domain ?? null,
      businessId: c.business?.id ?? null,
      businessName: c.business?.name ?? null,
      placementType: c.placementType ?? null,
    }));
  }
}
