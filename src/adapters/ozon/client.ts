/**
 * HTTP client for the Ozon Seller API.
 *
 * Authorization (spec §6.2): TWO headers — `Client-Id` and `Api-Key`. This differs
 * both from WB (a single raw token) and from Yandex Market (its own Api-Key header),
 * which is exactly why credentials are stored as a set of keys rather than one token column.
 *
 * Every Seller API method is a POST, including reads.
 *
 * The Performance API (advertising) lives on a separate host with OAuth client_credentials
 * and its own key pair — that is a later stage and is not implemented here.
 */
import { MpError } from "../../core/errors.js";
import { rateLimiter, withRetries } from "../../core/rateLimiter.js";
import type { LimitRule } from "../../core/rateLimiter.js";

const HOST = "https://api-seller.ozon.ru";

/**
 * Ozon does not publish a single per-method rate limit table; the practical rule of
 * thumb is around 100 requests per minute per account. The value is deliberately
 * conservative: better to throttle ourselves than to collect 429s from the platform.
 */
export const OZON_LIMITS: Record<string, LimitRule> = {
  default: { requests: 100, perMs: 60_000 },
};

export class OzonClient {
  constructor(
    private clientId: string,
    private apiKey: string,
    private connectionId: string,
  ) {}

  async request<T>(path: string, body: unknown = {}): Promise<T> {
    await rateLimiter.acquire(`ozon:${this.connectionId}:default`, OZON_LIMITS.default);

    return withRetries(async () => {
      let res: Response;
      try {
        res = await fetch(new URL(path, HOST), {
          method: "POST",
          headers: {
            "Client-Id": this.clientId, // secret: never log it
            "Api-Key": this.apiKey, // secret: never log it
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError")
          throw new MpError("UPSTREAM_TIMEOUT", "Ozon API did not respond within 30s", { marketplace: "ozon", retryable: true });
        throw new MpError("MARKETPLACE_UNAVAILABLE", "Network error while calling the Ozon API", { marketplace: "ozon", retryable: true });
      }

      if (res.status === 401)
        throw new MpError("AUTH_FAILED", "Ozon API rejected the credentials (401). Check Client-Id and Api-Key.", { marketplace: "ozon" });
      if (res.status === 403)
        throw new MpError("MARKETPLACE_PERMISSION_DENIED", "The Ozon key has no access to this method (403)", { marketplace: "ozon" });
      if (res.status === 404)
        throw new MpError("NOT_FOUND", "Ozon API: method or object not found (404)", { marketplace: "ozon" });
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "0");
        throw new MpError("RATE_LIMITED", "Ozon API returned 429 (rate limit exceeded)", {
          marketplace: "ozon",
          retryable: true,
          details: retryAfter > 0 ? { retry_after_ms: retryAfter * 1000 } : undefined,
        });
      }
      if (res.status >= 500)
        throw new MpError("MARKETPLACE_UNAVAILABLE", `Ozon API returned ${res.status}`, { marketplace: "ozon", retryable: true });
      if (!res.ok) {
        // Ozon puts the reason in {code,message,details} — we take message only,
        // so nothing extra leaks into the model's response.
        //
        // IMPORTANT: Ozon reports bad credentials with status 400, not 401 (verified
        // against the production host on 2026-08-28): code 5 — "Invalid Api-Key",
        // code 16 — headers missing. Without this branch a credentials problem would
        // look like an argument error to the agent, and it would fix the wrong thing.
        let msg = `Ozon API returned ${res.status}`;
        let code: number | undefined;
        try {
          const j: any = await res.json();
          if (j?.message) msg = `Ozon API: ${j.message}`;
          if (typeof j?.code === "number") code = j.code;
        } catch {
          /* body is not JSON — keep the generic message */
        }
        if (code === 5 || code === 16)
          throw new MpError("AUTH_FAILED", msg, { marketplace: "ozon" });
        throw new MpError("INVALID_ARGUMENT", msg, { marketplace: "ozon" });
      }

      if (res.status === 204) return null as T;
      return (await res.json()) as T;
    });
  }

  /**
   * Cheap credentials check: a product list with limit=1.
   * Ozon has no dedicated ping method.
   */
  async ping(): Promise<void> {
    await this.request("/v3/product/list", { filter: { visibility: "ALL" }, last_id: "", limit: 1 });
  }
}
