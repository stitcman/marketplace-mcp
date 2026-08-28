/** Normalized response envelope (spec §16) + packing into MCP content. */

export interface Envelope<T> {
  success: true;
  marketplace: string | null;
  connection_id: string | null;
  data: T;
  meta: {
    fetched_at: string;
    source: "official_api" | "mock" | "cache" | "internal";
    cached: boolean;
    next_cursor: string | null;
  };
}

export function envelope<T>(
  data: T,
  o: {
    marketplace?: string;
    connectionId?: string;
    source?: Envelope<T>["meta"]["source"];
    cached?: boolean;
    nextCursor?: string | null;
  } = {},
): Envelope<T> {
  return {
    success: true,
    marketplace: o.marketplace ?? null,
    connection_id: o.connectionId ?? null,
    data,
    meta: {
      fetched_at: new Date().toISOString(),
      source: o.source ?? "official_api",
      cached: o.cached ?? false,
      next_cursor: o.nextCursor ?? null,
    },
  };
}

/**
 * MCP tool result: text content with JSON + structuredContent for clients that read it.
 *
 * structuredContent is attached to successful responses only: tools declare an
 * outputSchema describing the success shape, while an error has a different shape
 * ({success:false, error}). Attaching it on errors would make the client reject the
 * response as schema-invalid, and the agent would see a transport failure instead of
 * a meaningful error code.
 */
export function asToolResult(payload: object, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? {} : { structuredContent: payload as Record<string, unknown> }),
    isError,
  };
}
