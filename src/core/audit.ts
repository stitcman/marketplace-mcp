/**
 * Audit log (spec §32): every tool call is recorded — timestamp, tool, marketplace,
 * connection_id, duration, status, error code. Secrets never reach the audit log.
 */
import type { Store } from "./store.js";
import { MpError, toErrorPayload } from "./errors.js";
import { asToolResult } from "./respond.js";

export interface ToolContext {
  marketplace: string | null;
  connectionId: string | null;
}

/**
 * Wraps a tool handler: audit + unified error format.
 * The handler returns an envelope payload and reports its context (marketplace,
 * connection) through setCtx, so the audit record stays accurate even on failure.
 */
export function audited(
  store: Store,
  toolName: string,
  handler: (args: any, setCtx: (ctx: Partial<ToolContext>) => void) => Promise<object>,
) {
  return async (args: any) => {
    const started = Date.now();
    const ctx: ToolContext = { marketplace: null, connectionId: null };
    const setCtx = (c: Partial<ToolContext>) => Object.assign(ctx, c);
    try {
      const payload = await handler(args ?? {}, setCtx);
      await safeLog(store, {
        tool: toolName,
        marketplace: ctx.marketplace,
        connection_id: ctx.connectionId,
        duration_ms: Date.now() - started,
        status: "ok",
        error_code: null,
        client: null,
      });
      return asToolResult(payload);
    } catch (e) {
      const payload = toErrorPayload(e, ctx.marketplace ?? undefined);
      await safeLog(store, {
        tool: toolName,
        marketplace: ctx.marketplace,
        connection_id: ctx.connectionId,
        duration_ms: Date.now() - started,
        status: "error",
        error_code: e instanceof MpError ? e.code : "INTERNAL",
        client: null,
      });
      return asToolResult(payload, true);
    }
  };
}

async function safeLog(store: Store, l: Parameters<Store["logToolCall"]>[0]) {
  try {
    await store.logToolCall(l);
  } catch (err) {
    console.error("[audit] failed to write tool_calls:", err instanceof Error ? err.message : err);
  }
}
