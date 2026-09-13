import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeIdentity } from "../../src/core/runtimeIdentity.js";

const MARKETPLACES = ["ozon", "wildberries", "yandex_market"] as const;
type Marketplace = (typeof MARKETPLACES)[number];

const REQUIRED_ENV = [
  "MP_E2E_MARKETPLACE",
  "MP_E2E_CONNECTION_ID",
  "MP_E2E_EXPECTED_RUNTIME_ENV",
  "MP_E2E_EXPECTED_MANIFEST_SHA256",
  "MP_E2E_BASE_URL",
  "MP_E2E_AUTH_TOKEN",
  "MP_E2E_EVIDENCE_DIR",
] as const;

export interface RealE2EConfig {
  marketplace: Marketplace;
  connectionId: string;
  runtimeEnvironment: "production" | "development";
  expectedCommit: string | null;
  expectedManifestSha256: string;
  baseUrl: URL;
  authToken: string;
  evidenceDirectory: string;
}

const RUNTIME_IDENTITY_KEYS = [
  "commit",
  "manifest_sha256",
  "mode",
  "version",
  "write_runtime_enabled",
] as const;
const ENVELOPE_KEYS = ["connection_id", "data", "marketplace", "meta", "success"] as const;
const META_KEYS = ["cached", "fetched_at", "next_cursor", "source"] as const;

export function parseRuntimeIdentityEnvelope(value: unknown): RuntimeIdentity {
  if (!isRecord(value) || value.success !== true || !isRecord(value.data)) {
    throw new Error("runtime identity must use the standard success envelope");
  }
  assert.deepEqual(Object.keys(value).sort(), [...ENVELOPE_KEYS], "runtime identity envelope must contain exactly the standard fields");
  if (value.marketplace !== null || value.connection_id !== null || !isRecord(value.meta)) {
    throw new Error("runtime identity envelope context must be internal and account-independent");
  }
  assert.deepEqual(Object.keys(value.meta).sort(), [...META_KEYS], "runtime identity envelope meta must contain exactly the standard fields");
  if (
    typeof value.meta.fetched_at !== "string"
    || !Number.isFinite(Date.parse(value.meta.fetched_at))
    || value.meta.source !== "internal"
    || value.meta.cached !== false
    || value.meta.next_cursor !== null
  ) {
    throw new Error("runtime identity envelope meta is invalid");
  }
  const data = value.data;
  const keys = Object.keys(data).sort();
  assert.deepEqual(keys, [...RUNTIME_IDENTITY_KEYS], "runtime identity data must contain exactly five approved fields");
  if (typeof data.version !== "string" || data.version.trim() === "") {
    throw new Error("runtime identity version must be a non-empty string");
  }
  if (data.commit !== null && (typeof data.commit !== "string" || !/^[0-9a-f]{40}$/.test(data.commit))) {
    throw new Error("runtime identity commit must be null or a full Git SHA");
  }
  if (typeof data.manifest_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(data.manifest_sha256)) {
    throw new Error("runtime identity Manifest SHA-256 must be a lowercase hex digest");
  }
  if (data.mode !== "READ_ONLY") throw new Error("runtime identity mode must be READ_ONLY");
  if (data.write_runtime_enabled !== false) throw new Error("runtime identity WRITE runtime must be disabled");
  return {
    version: data.version,
    commit: data.commit,
    manifest_sha256: data.manifest_sha256,
    mode: data.mode,
    write_runtime_enabled: data.write_runtime_enabled,
  };
}

export function assertRealE2EPreflight(
  env: NodeJS.ProcessEnv,
  identity: RuntimeIdentity,
  repoRoot: string,
): RealE2EConfig {
  const config = readConfig(env, repoRoot);
  if (identity.mode !== "READ_ONLY") throw new Error("runtime mode must be READ_ONLY");
  if (identity.write_runtime_enabled !== false) throw new Error("WRITE runtime must be disabled");
  if (config.runtimeEnvironment === "production") {
    if (identity.commit === null || !/^[0-9a-f]{40}$/.test(identity.commit)) throw new Error("production runtime commit must be a full Git SHA");
    if (identity.commit !== config.expectedCommit) throw new Error("runtime commit mismatch");
  } else if (identity.commit !== null) {
    throw new Error("development runtime commit must be null");
  }
  if (identity.manifest_sha256.toLowerCase() !== config.expectedManifestSha256) {
    throw new Error("runtime Manifest SHA-256 mismatch");
  }
  return config;
}

export async function runRealE2EHarness(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = process.cwd(),
): Promise<{ identity: RuntimeIdentity; tools: string[] }> {
  const config = readConfig(env, repoRoot);
  const client = new Client({ name: "marketplace-real-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(config.baseUrl, {
    requestInit: { headers: { Authorization: `Bearer ${config.authToken}` } },
  });

  await client.connect(transport);
  try {
    const response: any = await client.callTool({ name: "marketplace_runtime_identity", arguments: {} });
    if (response.isError) throw new Error("marketplace_runtime_identity returned an MCP error");
    const text = response.content?.find((item: any) => item.type === "text")?.text;
    if (typeof text !== "string") throw new Error("marketplace_runtime_identity returned no JSON text");
    const identity = parseRuntimeIdentityEnvelope(JSON.parse(text));
    assertRealE2EPreflight(env, identity, repoRoot);

    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => tool.name).sort();
    assert.equal(tools.length, 33, "Remote MCP tool catalog must contain exactly 33 tools");
    assert(tools.includes("marketplace_runtime_identity"), "Remote MCP runtime identity tool must be registered");
    return { identity, tools };
  } finally {
    await client.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(env: NodeJS.ProcessEnv, repoRoot: string): RealE2EConfig {
  for (const name of REQUIRED_ENV) {
    if (!env[name]?.trim()) throw new Error(`${name} is required`);
  }

  const marketplace = env.MP_E2E_MARKETPLACE as string;
  if (!MARKETPLACES.includes(marketplace as Marketplace)) {
    throw new Error(`MP_E2E_MARKETPLACE must be one of: ${MARKETPLACES.join(", ")}`);
  }
  const runtimeEnvironment = env.MP_E2E_EXPECTED_RUNTIME_ENV;
  if (runtimeEnvironment !== "production" && runtimeEnvironment !== "development") {
    throw new Error("MP_E2E_EXPECTED_RUNTIME_ENV must be production or development");
  }
  const declaredExpectedCommit = env.MP_E2E_EXPECTED_COMMIT;
  let expectedCommit: string | null;
  if (runtimeEnvironment === "production") {
    if (!declaredExpectedCommit?.trim()) throw new Error("MP_E2E_EXPECTED_COMMIT is required for production");
    expectedCommit = declaredExpectedCommit.toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error("MP_E2E_EXPECTED_COMMIT must be a full Git commit");
  } else {
    if (declaredExpectedCommit !== undefined) throw new Error("MP_E2E_EXPECTED_COMMIT must be absent for development");
    expectedCommit = null;
  }
  const expectedManifestSha256 = env.MP_E2E_EXPECTED_MANIFEST_SHA256!.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
    throw new Error("MP_E2E_EXPECTED_MANIFEST_SHA256 must be a SHA-256 hex digest");
  }

  const baseUrl = new URL(env.MP_E2E_BASE_URL!);
  if (baseUrl.username || baseUrl.password) throw new Error("MP_E2E_BASE_URL must not contain credentials");
  if (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname))) {
    throw new Error("MP_E2E_BASE_URL must use HTTPS except on loopback");
  }
  const evidenceDirectory = path.resolve(env.MP_E2E_EVIDENCE_DIR!);
  const root = path.resolve(repoRoot);
  const relative = path.relative(root, evidenceDirectory);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("evidence directory must be outside the Git worktree");
  }

  return {
    marketplace: marketplace as Marketplace,
    connectionId: env.MP_E2E_CONNECTION_ID!,
    runtimeEnvironment,
    expectedCommit,
    expectedManifestSha256,
    baseUrl,
    authToken: env.MP_E2E_AUTH_TOKEN!,
    evidenceDirectory,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await runRealE2EHarness();
  console.log(JSON.stringify({
    status: "PREFLIGHT_PASS",
    marketplace: process.env.MP_E2E_MARKETPLACE,
    runtime: result.identity,
    tool_count: result.tools.length,
  }));
}
