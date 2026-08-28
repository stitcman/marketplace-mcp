/**
 * Multi-account support (spec §5): the AI must name the connection explicitly.
 * When several connections exist for the same marketplace and connection_id is
 * omitted, we return AMBIGUOUS_CONNECTION with the list — we NEVER silently pick
 * the first one.
 */
import { MpError } from "./errors.js";
import type { Connection, Marketplace, Store } from "./store.js";

export async function resolveConnection(
  store: Store,
  marketplace: Marketplace,
  connectionId?: string,
): Promise<Connection> {
  if (connectionId) {
    const c = await store.getConnection(connectionId);
    if (!c) throw new MpError("CONNECTION_NOT_FOUND", `Connection ${connectionId} not found`);
    if (c.marketplace !== marketplace)
      throw new MpError(
        "INVALID_ARGUMENT",
        `Connection ${c.name} belongs to ${c.marketplace}, but this tool targets ${marketplace}`,
      );
    if (c.status !== "active")
      throw new MpError("PERMISSION_DENIED", `Connection ${c.name} is disabled`, { marketplace });
    return c;
  }

  const all = (await store.listConnections()).filter(
    (c) => c.marketplace === marketplace && c.status === "active",
  );
  if (all.length === 0)
    throw new MpError("CONNECTION_NOT_FOUND", `No active ${marketplace} connections. Add a seller account first.`);
  if (all.length > 1)
    throw new MpError(
      "AMBIGUOUS_CONNECTION",
      `Multiple ${marketplace} connections — pass connection_id explicitly`,
      {
        details: all.map((c) => ({ connection_id: c.connection_id, name: c.name })),
      },
    );
  return all[0];
}

export function requirePermission(c: Connection, permission: string) {
  if (!c.permissions.includes(permission)) {
    throw new MpError(
      "PERMISSION_DENIED",
      `Connection ${c.name} lacks the ${permission} permission`,
      { marketplace: c.marketplace },
    );
  }
}
