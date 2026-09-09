import { resolveConnection, requirePermission } from "./connections.js";
import { MpError } from "./errors.js";
import type { Marketplace, Store } from "./store.js";

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
  const { store, marketplace, connectionId, method, params, transport } = input;
  const conn = await resolveConnection(store, marketplace, connectionId);
  if (method.safety !== "read") deny("Method is not present as READ in the local allowlist");
  requirePermission(conn, method.permission);

  const requestBytes = Buffer.byteLength(JSON.stringify(params), "utf8");
  if (requestBytes > MAX_REQUEST_BYTES) deny(`Input exceeds ${MAX_REQUEST_BYTES} bytes`);
  const schemaError = validate(params, method.input_schema ?? { type: "object" }, "params");
  if (schemaError) deny(schemaError);

  const credentials = await store.getCredentials(conn.connection_id);
  const raw = await transport.send({ marketplace, connectionId: conn.connection_id, method, params, credentials });
  if (input.preserveArtifact && raw && typeof raw === "object" && (raw as any).__download === true) return raw;
  const redacted = method.sensitive_data && !input.includeSensitive ? redactSensitive(raw) : raw;
  return boundResponse(redacted);
}

function deny(message: string): never {
  throw new MpError("LOCAL_DENY", message);
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

const sensitiveKeyPart = /(buyer|customer|client|recipient|phone|telephone|address|email|fio|message|chattext|full.?name)/i;
function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, sensitiveKeyPart.test(key) ? "[REDACTED]" : redactSensitive(child)]));
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
