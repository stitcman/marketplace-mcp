/** Unified error model (spec §31). Every error the AI sees goes through MpError. */

export type ErrorCode =
  | "LOCAL_DENY"
  | "AUTH_FAILED"
  | "PERMISSION_DENIED"
  | "MARKETPLACE_PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "MARKETPLACE_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "FEATURE_NOT_SUPPORTED"
  | "FEATURE_NOT_AVAILABLE_FOR_ACCOUNT"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_EXPIRED"
  | "WRITE_DISABLED"
  | "BULK_LIMIT_EXCEEDED"
  | "STALE_DATA"
  | "UPSTREAM_TIMEOUT"
  | "CONNECTION_NOT_FOUND"
  | "AMBIGUOUS_CONNECTION";

export class MpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public opts: { marketplace?: string; retryable?: boolean; details?: unknown } = {},
  ) {
    super(message);
  }

  toJSON() {
    return {
      success: false as const,
      error: {
        code: this.code,
        message: this.message,
        marketplace: this.opts.marketplace ?? null,
        retryable: this.opts.retryable ?? false,
        ...(this.opts.details !== undefined ? { details: this.opts.details } : {}),
      },
    };
  }
}

/** Wraps unknown errors, never leaking internal details or secrets into the model's response. */
export function toErrorPayload(e: unknown, marketplace?: string) {
  if (e instanceof MpError) return e.toJSON();
  const msg = e instanceof Error ? e.message : String(e);
  // Never include stack traces or authorization headers.
  return new MpError("MARKETPLACE_UNAVAILABLE", msg, { marketplace, retryable: true }).toJSON();
}
