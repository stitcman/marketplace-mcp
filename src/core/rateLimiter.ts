/**
 * Rate limiting (spec §27): a separate token bucket per marketplace + connection +
 * endpoint group. This in-memory implementation targets a single instance; for
 * horizontal scaling it is replaced by a Redis-backed limiter with the same interface.
 */
import { MpError } from "./errors.js";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface LimitRule {
  /** requests per period */
  requests: number;
  /** period in milliseconds */
  perMs: number;
}

/**
 * Per-seller-account limits by Wildberries endpoint group.
 * Verified against the official OpenAPI specifications on 2026-08-28
 * (see README → "Marketplace API compliance").
 */
export const WB_LIMITS: Record<string, LimitRule> = {
  statistics: { requests: 1, perMs: 60_000 }, // supplier/orders: 1 request per minute
  analytics: { requests: 3, perMs: 60_000 }, // stocks-report: 3 per minute, 20s interval
  content: { requests: 100, perMs: 60_000 }, // "Content" category
  prices: { requests: 10, perMs: 6_000 }, // "Prices and discounts" category
  common: { requests: 3, perMs: 30_000 }, // /ping: 3 per 30s, counted per domain
};

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  /**
   * Acquires a token. If the next token would arrive later than maxWaitMs, we do not
   * block pointlessly — we fail immediately with RATE_LIMITED and retry_after_ms, so
   * the calling agent knows when retrying actually makes sense.
   */
  async acquire(key: string, rule: LimitRule, maxWaitMs = 15_000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const now = Date.now();
      const b = this.buckets.get(key) ?? { tokens: rule.requests, updatedAt: now };
      // refill
      const refill = ((now - b.updatedAt) / rule.perMs) * rule.requests;
      b.tokens = Math.min(rule.requests, b.tokens + refill);
      b.updatedAt = now;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        this.buckets.set(key, b);
        return;
      }
      this.buckets.set(key, b);

      const waitForToken = Math.ceil(((1 - b.tokens) / rule.requests) * rule.perMs);
      // Waiting only makes sense if a token arrives inside the wait window.
      if (now + waitForToken > deadline) {
        throw new MpError(
          "RATE_LIMITED",
          `Rate limit reached for "${key.split(":").pop()}"; retry in ~${Math.ceil(waitForToken / 1000)}s`,
          { retryable: true, details: { retry_after_ms: waitForToken } },
        );
      }
      await sleep(waitForToken);
    }
  }
}

export const rateLimiter = new RateLimiter();

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Exponential backoff + jitter (spec §27–28) for network errors, 429s and 5xx. READ only. */
export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; retryOn?: (e: unknown) => boolean } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 1_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable =
        opts.retryOn?.(e) ?? (e instanceof MpError ? e.opts.retryable === true : true);
      if (!retryable || attempt === retries) break;
      const delay = baseMs * 2 ** attempt + Math.random() * baseMs;
      await sleep(delay);
    }
  }
  throw lastErr;
}
