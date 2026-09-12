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
  "MP_E2E_EXPECTED_COMMIT",
  "MP_E2E_EXPECTED_MANIFEST_SHA256",
  "MP_E2E_BASE_URL",
  "MP_E2E_AUTH_TOKEN",
  "MP_E2E_EVIDENCE_DIR",
] as const;

export interface RealE2EConfig {
  marketplace: Marketplace;
  connectionId: string;
  expectedCommit: string;
  expectedManifestSha256: string;
  baseUrl: URL;
  authToken: string;
  evidenceDirectory: string;
}

export function assertRealE2EPreflight(
  env: NodeJS.ProcessEnv,
  identity: RuntimeIdentity,
  repoRoot: string,
): RealE2EConfig {
  const config = readConfig(env, repoRoot);
  if (identity.mode !== "READ_ONLY") throw new Error("runtime mode must be READ_ONLY");
  if (identity.write_runtime_enabled !== false) throw new Error("WRITE runtime must be disabled");
  if (identity.commit !== config.expectedCommit) throw new Error("runtime commit mismatch");
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
    const parsed = JSON.parse(text);
    const identity = (parsed.data ?? parsed) as RuntimeIdentity;
    assertRealE2EPreflight(env, identity, repoRoot);

    const listed = await client.listTools();
    const tools = listed.tools.map((tool) => tool.name).sort();
    assert(tools.length > 0, "Remote MCP tool catalog must not be empty");
    return { identity, tools };
  } finally {
    await client.close();
  }
}

function readConfig(env: NodeJS.ProcessEnv, repoRoot: string): RealE2EConfig {
  for (const name of REQUIRED_ENV) {
    if (!env[name]?.trim()) throw new Error(`${name} is required`);
  }

  const marketplace = env.MP_E2E_MARKETPLACE as string;
  if (!MARKETPLACES.includes(marketplace as Marketplace)) {
    throw new Error(`MP_E2E_MARKETPLACE must be one of: ${MARKETPLACES.join(", ")}`);
  }
  const expectedCommit = env.MP_E2E_EXPECTED_COMMIT!.toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw new Error("MP_E2E_EXPECTED_COMMIT must be a full Git commit");
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
