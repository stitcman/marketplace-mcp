/**
 * HTTP client for the official Wildberries API.
 *
 * Authorization (spec §6.1): WB uses the `HeaderApiKey` security scheme —
 * `type: apiKey, name: Authorization` — meaning the RAW TOKEN goes into the header
 * with no `Bearer` prefix. Verified against the official OpenAPI specifications
 * (2026-08-28): the word "Bearer" does not appear in them at all.
 *
 * Different WB API sections live on different hosts with different rate limits,
 * so the client splits them by endpoint group (see WB_LIMITS).
 */
import { MpError } from "../../core/errors.js";
import { rateLimiter, withRetries, WB_LIMITS } from "../../core/rateLimiter.js";

const HOSTS = {
  statistics: "https://statistics-api.wildberries.ru",
  analytics: "https://seller-analytics-api.wildberries.ru",
  content: "https://content-api.wildberries.ru",
  prices: "https://discounts-prices-api.wildberries.ru",
  common: "https://common-api.wildberries.ru",
} as const;

/**
 * WB sandbox (test environment). Its token is created in the seller cabinet
 * separately from the production one and only works with generated test data.
 *
 * IMPORTANT: NOT every category has a sandbox. "Analytics" has none — and that is
 * exactly where stocks live (stocks-report). So in sandbox mode wb_stocks_get still
 * talks to the production host; it is the one tool that is not isolated in the
 * sandbox. Verified against the official specifications on 2026-08-28.
 */
const SANDBOX_HOSTS: Partial<Record<keyof typeof HOSTS, string>> = {
  statistics: "https://statistics-api-sandbox.wildberries.ru",
  content: "https://content-api-sandbox.wildberries.ru",
  prices: "https://discounts-prices-api-sandbox.wildberries.ru",
  // analytics and common have no sandbox — they stay on production
};

export type WbGroup = keyof typeof HOSTS;

export const WB_HOSTS = HOSTS;

/** Groups without a sandbox: in sandbox mode they still hit production. */
export const WB_GROUPS_WITHOUT_SANDBOX: WbGroup[] = ["analytics", "common"];

export class WbClient {
  constructor(
    private token: string,
    private connectionId: string,
    private sandbox = false,
  ) {}

  /** Host for the current mode: the sandbox domain when the category has one. */
  private hostFor(group: WbGroup): string {
    return (this.sandbox && SANDBOX_HOSTS[group]) || HOSTS[group];
  }

  /**
   * Returns null for 204 (No Content) — WB replies that way when there is no data.
   */
  async request<T>(
    group: WbGroup,
    path: string,
    init: { method?: string; query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const limiterKey = `wildberries:${this.connectionId}:${group}`;
    await rateLimiter.acquire(limiterKey, WB_LIMITS[group]);

    const url = new URL(path, this.hostFor(group));
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

    return withRetries(async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: init.method ?? "GET",
          headers: {
            Authorization: this.token, // secret: never log it, never put it in errors
            "Content-Type": "application/json",
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError")
          throw new MpError("UPSTREAM_TIMEOUT", "WB API did not respond within 30s", { marketplace: "wildberries", retryable: true });
        throw new MpError("MARKETPLACE_UNAVAILABLE", "Network error while calling the WB API", { marketplace: "wildberries", retryable: true });
      }

      if (res.status === 401)
        throw new MpError("AUTH_FAILED", "WB API rejected the token (401). Check the connection token.", { marketplace: "wildberries" });
      if (res.status === 403)
        throw new MpError(
          "MARKETPLACE_PERMISSION_DENIED",
          "The connected WB token lacks the required access category (403)",
          { marketplace: "wildberries" },
        );
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("X-Ratelimit-Retry") ?? res.headers.get("Retry-After") ?? "0");
        throw new MpError("RATE_LIMITED", "WB API returned 429 (rate limit exceeded)", {
          marketplace: "wildberries",
          retryable: true,
          details: retryAfter > 0 ? { retry_after_ms: retryAfter * 1000 } : undefined,
        });
      }
      if (res.status >= 500)
        throw new MpError("MARKETPLACE_UNAVAILABLE", `WB API returned ${res.status}`, { marketplace: "wildberries", retryable: true });
      if (!res.ok)
        throw new MpError("INVALID_ARGUMENT", `WB API returned ${res.status}`, { marketplace: "wildberries" });

      // 204 No Content — no data, which is not an error.
      if (res.status === 204) return null as T;
      return (await res.json()) as T;
    });
  }

  /**
   * Token check. Every API category has its own /ping on its own domain, and the
   * limit (3 requests per 30s) applies per domain.
   */
  async ping(group: WbGroup = "common"): Promise<{ TS?: string; Status?: string }> {
    return this.request(group, "/ping");
  }
}
