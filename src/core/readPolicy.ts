import { resolveConnection, requirePermission } from "./connections.js";
import { MpError } from "./errors.js";
import type { Marketplace, Store } from "./store.js";
import { ozonFinanceChunks } from './ozonFinanceChunks.js';

export interface JsonSchema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
}

export interface ReadMethod {
  method_id: string;
  domain: string;
  path: string;
  http_method: string;
  safety: "read";
  reason: string;
  permission: string;
  endpoint_group: string;
  pagination: "none" | "bounded" | string;
  pagination_contract?: {kind: 'cursor' | 'last_id' | 'page'; response_field?: string; items_path?: string; last_item_field?: string};
  file_download: boolean;
  report_job: boolean;
  sensitive_data: boolean;
  summary?: string;
  description?: string;
  input_schema?: JsonSchema;
  source_version: string;
  source_hash: string;
}

export interface ReadTransport {
  send(input: {
    marketplace: Marketplace;
    connectionId: string;
    method: ReadMethod;
    params: Record<string, unknown>;
    credentials: Record<string, string>;
  }): Promise<unknown>;
}

export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 256 * 1024;

export interface ReadContinuation {
  kind: "none" | "cursor" | "offset" | "last_id" | "local_chunk" | "page";
  phase?: 'LOCAL_CHUNK' | 'UPSTREAM_LAST_ID';
  has_more: boolean;
  request_patch: Record<string, unknown> | null;
}

export interface ApprovedReadPage {
  payload: unknown;
  continuation: ReadContinuation;
}

export async function executeApprovedRead(input: {
  store: Store;
  marketplace: Marketplace;
  connectionId: string;
  method: ReadMethod;
  params: Record<string, unknown>;
  transport: ReadTransport;
  includeSensitive?: boolean;
  preserveArtifact?: boolean;
}): Promise<unknown> {
  const raw = await performApprovedRead(input);
  if (input.preserveArtifact && raw && typeof raw === "object" && (raw as any).__download === true) return raw;
  const redacted = input.method.sensitive_data && !input.includeSensitive ? redactForEvidence(raw) : raw;
  return boundResponse(redacted);
}

export async function executeApprovedReadPage(input: {
  store: Store;
  marketplace: Marketplace;
  connectionId: string;
  method: ReadMethod;
  params: Record<string, unknown>;
  transport: ReadTransport;
}): Promise<ApprovedReadPage> {
  if(input.marketplace==='ozon'&&['GetFinanceAccrualByDay','GetFinanceAccrualPostings'].includes(input.method.method_id)) {
    const {mcp_cursor,...params}=input.params;
    const conn=await resolveConnection(input.store,input.marketplace,input.connectionId);
    if(input.method.safety!=='read')deny('Method is not READ');
    requirePermission(conn,input.method.permission);
    rejectTransportOverrides(params);
    const error=validate(params,input.method.input_schema??{type:'object'},'params');
    if(error)deny(error);
    if(Buffer.byteLength(JSON.stringify(params))>MAX_REQUEST_BYTES)deny('Input exceeds request limit');
    const binding=ozonFinanceChunks.binding(conn.connection_id,input.method.method_id,params);
    if(mcp_cursor!==undefined&&mcp_cursor!==null)return ozonFinanceChunks.resume(mcp_cursor,binding);
    const payload=await performApprovedRead({...input,params});
    const base=continuationFor(input.method,params,payload);
    const continuation:ReadContinuation=input.method.method_id==='GetFinanceAccrualByDay'?{...base,phase:'UPSTREAM_LAST_ID',request_patch:base.has_more?{date:params.date,...base.request_patch,mcp_cursor:null}:null}:base;
    return ozonFinanceChunks.split(payload,continuation,binding,conn.connection_id,params,input.method.method_id==='GetFinanceAccrualByDay'?'accruals':'posting_accruals');
  }
  const payload = await performApprovedRead(input);
  requireBoundedRawPage(payload);
  return { payload, continuation: continuationFor(input.method, input.params, payload) };
}

async function performApprovedRead(input: {
  store: Store;
  marketplace: Marketplace;
  connectionId: string;
  method: ReadMethod;
  params: Record<string, unknown>;
  transport: ReadTransport;
}): Promise<unknown> {
  const { store, marketplace, connectionId, method, params, transport } = input;
  const conn = await resolveConnection(store, marketplace, connectionId);
  if (method.safety !== "read") deny("Method is not present as READ in the local allowlist");
  requirePermission(conn, method.permission);

  const requestBytes = Buffer.byteLength(JSON.stringify(params), "utf8");
  if (requestBytes > MAX_REQUEST_BYTES) deny(`Input exceeds ${MAX_REQUEST_BYTES} bytes`);
  if(marketplace==='ozon') rejectTransportOverrides(params);
  const schemaError = validate(params, method.input_schema ?? { type: "object" }, "params");
  if (schemaError) deny(schemaError);

  const credentials = await store.getCredentials(conn.connection_id);
  return transport.send({ marketplace, connectionId: conn.connection_id, method, params, credentials });
}

function deny(message: string): never {
  throw new MpError("LOCAL_DENY", message);
}

function rejectTransportOverrides(value: unknown, depth=0): void {
  if(depth>32) deny('Ozon input nesting exceeds the local limit');
  if(!value || typeof value!=='object') return;
  if(Array.isArray(value)) {for(const child of value)rejectTransportOverrides(child,depth+1);return;}
  for(const [key,child] of Object.entries(value)) {
    if(/^(authorization|api[-_]?key|client[-_]?id|client[-_]?secret|password|headers|host|url|base[-_]?url|connection[-_]?id)$/i.test(key)) deny('Ozon authorization, account and routing are server-controlled');
    rejectTransportOverrides(child,depth+1);
  }
}

function validate(value: unknown, schema: JsonSchema, at: string): string | null {
  if (schema.enum && !schema.enum.some((x) => Object.is(x, value))) return `${at} is not an allowed value`;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) return `${at} has invalid type`;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${at} is too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${at} is too long`;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return `${at} is below minimum`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${at} exceeds maximum`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${at} has too few items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${at} has too many items`;
    if (schema.items) for (let i = 0; i < value.length; i++) {
      const error = validate(value[i], schema.items, `${at}[${i}]`);
      if (error) return error;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? []) if (!(required in object)) return `${at}.${required} is required`;
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(object)) if (!allowed.has(key)) return `${at}.${key} is not allowed`;
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in object) {
      const error = validate(object[key], child, `${at}.${key}`);
      if (error) return error;
    }
  }
  return null;
}

function matchesType(value: unknown, type: string) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

const sensitiveKeyPart = /(api.?key|authorization|bearer|token|secret|password|credential|client.?id|buyer|customer|recipient|phone|telephone|address|email|fio|message|chattext|full.?name)/i;
export function redactForEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, sensitiveKeyPart.test(key) ? "[REDACTED]" : redactForEvidence(child)]));
}

function continuationFor(method: ReadMethod, params: Record<string, unknown>, payload: unknown): ReadContinuation {
  if (method.pagination_contract) {
    const contract = method.pagination_contract;
    const kind = contract.kind;
    if(kind==='page') {
      const count=recordCount(payload), remaining=field(payload,'total_count');
      const has_more=count>0 && (typeof remaining==='number'?remaining>0:count>=Number(params.page_size));
      return {kind,has_more,request_patch:has_more?{page:Number(params.page??0)+1}:null};
    }
    let next = field(payload, contract.response_field ?? kind);
    if (contract.last_item_field) {
      const items = (contract.items_path ?? '').split('.').reduce<any>((v, key) => v?.[key], payload);
      const limit = typeof params.limit === 'number' ? params.limit : 0;
      if (!Array.isArray(items) || limit <= 0 || items.length < limit) return {kind, has_more:false, request_patch:null};
      next = items.at(-1)?.[contract.last_item_field];
    }
    const explicit = booleanField(payload, 'has_next');
    const terminal = next === undefined || next === null || next === '' || (kind === 'last_id' && next === 0);
    if (explicit === true && terminal) throw new MpError('INVALID_ARGUMENT', 'Upstream has_next=true without a continuation token');
    const has_more = explicit !== false && !terminal && next !== params[kind];
    return {kind, has_more, request_patch:has_more ? {[kind]:next} : null};
  }
  const properties = method.input_schema?.properties ?? {};
  if ("cursor" in properties) return tokenContinuation("cursor", params.cursor, payload);
  if ("offset" in properties && "limit" in properties) return offsetContinuation(params, payload);
  if ("last_id" in properties) return tokenContinuation("last_id", params.last_id, payload);
  return { kind: "none", has_more: false, request_patch: null };
}

function tokenContinuation(kind: "cursor" | "last_id", current: unknown, payload: unknown): ReadContinuation {
  const next = field(payload, kind) ?? field(payload, kind === "cursor" ? "next_cursor" : "last_id");
  const count = recordCount(payload);
  const explicit = booleanField(payload, "has_next");
  const terminal = next === undefined || next === null || next === "" || (kind === "last_id" && next === 0);
  const hasMore = count > 0 && explicit !== false && !terminal && next !== current;
  return { kind, has_more: hasMore, request_patch: hasMore ? { [kind]: next } : null };
}

function offsetContinuation(params: Record<string, unknown>, payload: unknown): ReadContinuation {
  const count = recordCount(payload);
  const limit = typeof params.limit === "number" ? params.limit : 0;
  const offset = typeof params.offset === "number" ? params.offset : 0;
  const explicit = booleanField(payload, "has_next");
  const hasMore = count > 0 && (explicit === true || (explicit === undefined && limit > 0 && count >= limit));
  return { kind: "offset", has_more: hasMore, request_patch: hasMore ? { offset: offset + count } : null };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function field(payload: unknown, name: string): unknown {
  const root = object(payload);
  const result = object(root?.result);
  return root?.[name] ?? result?.[name];
}

function booleanField(payload: unknown, name: string): boolean | undefined {
  const value = field(payload, name);
  return typeof value === "boolean" ? value : undefined;
}

function recordCount(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length;
  const root = object(payload);
  if (!root) return 0;
  const resultValue = root.result;
  const result = object(resultValue);
  for (const value of [root.products, root.points, root.accruals, root.items, root.postings, root.returns, root.warehouses, result?.items, result?.postings, result?.returns, result?.warehouses, resultValue]) {
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

function requireBoundedRawPage(payload: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > MAX_RESPONSE_BYTES) {
    throw new MpError("BULK_LIMIT_EXCEEDED", `Upstream page exceeds ${MAX_RESPONSE_BYTES} bytes; reduce the page limit`);
  }
}

function boundResponse(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") <= MAX_RESPONSE_BYTES) return value;
  if (value && typeof value === "object" && Array.isArray((value as any).items)) {
    const source = value as any;
    const items = [...source.items];
    while (items.length && Buffer.byteLength(JSON.stringify({ ...source, items }), "utf8") > MAX_RESPONSE_BYTES) items.pop();
    return { ...source, items, count: items.length, has_more: true, truncated: true };
  }
  return { truncated: true, byte_length: Buffer.byteLength(encoded, "utf8"), message: "Response exceeded the local MCP response limit" };
}
