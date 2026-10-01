import { z } from "zod";
import type { Marketplace, Store } from "../../core/store.js";
import type { ToolRegistrar } from "../../core/toolVisibility.js";
import { audited } from "../../core/audit.js";
import { envelope } from "../../core/respond.js";
import { findReadMethod, getReadPolicy, requireReadMethod } from "../../core/readPolicies.js";
import { executeApprovedRead, executeApprovedReadPage } from "../../core/readPolicy.js";
import { MarketplaceReadTransport } from "../../core/genericReadTransport.js";
import { resolveConnection } from "../../core/connections.js";
import { MpError } from "../../core/errors.js";
import { cacheArtifact } from "../../core/fileCache.js";

const prefixes: Record<Marketplace, string> = { ozon: "ozon", wildberries: "wb", yandex_market: "ym" };
const transport = new MarketplaceReadTransport();
const connectionId = z.string().uuid();
const outputSchema = {
  success: z.literal(true), marketplace: z.string(), connection_id: z.string().nullable(), data: z.unknown(),
  meta: z.object({
    fetched_at: z.string(), source: z.enum(["official_api", "mock", "cache", "internal"]), cached: z.boolean(), next_cursor: z.string().nullable(),
    continuation: z.object({ kind: z.enum(["none", "cursor", "offset", "last_id", "local_chunk"]), phase:z.enum(['LOCAL_CHUNK','UPSTREAM_LAST_ID']).optional(), has_more: z.boolean(), request_patch: z.record(z.unknown()).nullable() }).optional(),
  }),
};

export function registerReadTools(server: ToolRegistrar, store: Store, marketplace: Marketplace) {
  const prefix = prefixes[marketplace];
  server.registerTool(`${prefix}_read_search`, { title: `${prefix.toUpperCase()} approved READ search`, description: "Searches only the local version-controlled READ allowlist.", inputSchema: { query: z.string().min(1).max(200), domain: z.string().max(80).optional(), limit: z.number().int().min(1).max(50).default(10) }, outputSchema },
    audited(store, `${prefix}_read_search`, async (args) => {
      const query = args.query.toLowerCase();
      const items = getReadPolicy(marketplace).filter((m) => (!args.domain || m.domain === args.domain) && `${m.method_id} ${m.domain} ${m.summary ?? ""}`.toLowerCase().includes(query)).slice(0, args.limit)
        .map(({ method_id, domain, summary, permission, pagination, file_download, report_job, sensitive_data }) => ({ method_id, domain, summary, permission, pagination, file_download, report_job, sensitive_data }));
      return envelope({ items, count: items.length }, { marketplace, source: "internal" });
    }));

  server.registerTool(`${prefix}_read_describe`, { title: `${prefix.toUpperCase()} approved READ describe`, description: "Describes one locally approved READ method, including its request schema and source binding.", inputSchema: { method_id: z.string().min(1).max(200) }, outputSchema },
    audited(store, `${prefix}_read_describe`, async (args) => {
      const method = requireReadMethod(marketplace, args.method_id);
      return envelope(method, { marketplace, source: "internal" });
    }));

  server.registerTool(`${prefix}_read_capabilities`, { title: `${prefix.toUpperCase()} READ capabilities`, description: "Returns local/credential capability state without returning credentials.", inputSchema: { connection_id: connectionId, domain: z.string().max(80).optional() }, outputSchema },
    audited(store, `${prefix}_read_capabilities`, async (args, setCtx) => {
      const connection = await resolveConnection(store, marketplace, args.connection_id); setCtx({ marketplace, connectionId: connection.connection_id });
      const credentials = await store.getCredentials(connection.connection_id);
      const credentialPresent = marketplace === "ozon" ? Boolean(credentials.client_id && credentials.api_key) : marketplace === "wildberries" ? Boolean(credentials.token) : Boolean(credentials.api_key);
      const methods = getReadPolicy(marketplace).filter((m) => !args.domain || m.domain === args.domain).map((m) => ({ method_id: m.method_id, locally_allowed: true,
        state: !connection.permissions.includes(m.permission) ? "credential_denied" : !credentialPresent ? "unverified" : marketplace === "ozon" && m.endpoint_group === "performance" ? "not_supported" : "unverified" }));
      return envelope({ items: methods, count: methods.length }, { marketplace, connectionId: connection.connection_id, source: "internal" });
    }));

  const executeSchema = { connection_id: connectionId, method_id: z.string().min(1).max(200), params: z.record(z.unknown()).default({}) };
  server.registerTool(`${prefix}_read_execute`, { title: `${prefix.toUpperCase()} approved READ execute`, description: "Executes one allowlisted READ page and returns its lossless marketplace payload plus generic continuation metadata. Evidence and audit representations are redacted separately.", inputSchema: executeSchema, outputSchema },
    audited(store, `${prefix}_read_execute`, async (args, setCtx) => {
      setCtx({ marketplace, connectionId: args.connection_id });
      const method = requireReadMethod(marketplace, args.method_id);
      const connection = await resolveConnection(store, marketplace, args.connection_id);
      if (connection.mock) {
        const data = { mock: true, method_id: method.method_id, params: args.params };
        return envelope(data, { marketplace, connectionId: args.connection_id, source: "mock" });
      }
      const page = await executeApprovedReadPage({ store, marketplace, connectionId: args.connection_id, method, params: args.params, transport });
      return envelope(page.payload, { marketplace, connectionId: args.connection_id, source: "official_api", continuation: page.continuation });
    }));

  server.registerTool(`${prefix}_read_file`, { title: `${prefix.toUpperCase()} approved READ file`, description: "Runs an approved report/file READ and returns bounded cache metadata, never binary/base64.", inputSchema: { connection_id: connectionId, method_id: z.string().min(1).max(200), params: z.record(z.unknown()).default({}) }, outputSchema },
    audited(store, `${prefix}_read_file`, async (args, setCtx) => {
      setCtx({ marketplace, connectionId: args.connection_id });
      const method = findReadMethod(marketplace, args.method_id);
      if (!method || (!method.file_download && !method.report_job)) throw new MpError("LOCAL_DENY", "Method is not approved for file/report handling", { marketplace });
      const data = await executeApprovedRead({ store, marketplace, connectionId: args.connection_id, method, params: args.params, transport, includeSensitive: true, preserveArtifact: true });
      const metadata = await cacheArtifact({ marketplace, methodId: method.method_id, payload: data });
      return envelope(metadata, { marketplace, connectionId: args.connection_id, source: "cache", cached: true });
    }));
}
