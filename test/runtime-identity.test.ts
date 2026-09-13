import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadRuntimeIdentity } from "../src/core/runtimeIdentity.js";

const root = mkdtempSync(path.join(tmpdir(), "marketplace-runtime-identity-"));
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "MARKETPLACE_MCP_MANIFEST.yaml");
const commit = "a".repeat(40);

function manifest(options: { version?: string; mode?: string; writeEnabled?: boolean } = {}) {
  return [
    'schema_version: "1.0"',
    `mcp_version: "${options.version ?? "0.4.0"}"`,
    `production_mode: ${options.mode ?? "READ_ONLY"}`,
    "controlled_write_architecture: true",
    `write_runtime_enabled: ${options.writeEnabled ?? false}`,
    "global_write_switch_allowed: false",
    "capabilities:",
    "  - capability_id: test.read",
    "    operation_class: READ",
    "    status: candidate",
    "    reference: package.json",
    "",
  ].join("\n");
}

function writeFixture(rawManifest = manifest()) {
  writeFileSync(packagePath, JSON.stringify({ version: "0.4.0" }));
  writeFileSync(manifestPath, rawManifest);
}

function load(env: NodeJS.ProcessEnv, selectedManifestPath = manifestPath) {
  return loadRuntimeIdentity({ env, manifestPath: selectedManifestPath, packagePath });
}

try {
  writeFixture();
  const production = load({ MARKETPLACE_RUNTIME_ENV: "production", GIT_COMMIT: commit });
  assert.deepEqual(production, {
    version: "0.4.0",
    commit,
    manifest_sha256: createHash("sha256").update(Buffer.from(manifest())).digest("hex"),
    mode: "READ_ONLY",
    write_runtime_enabled: false,
  }, "production identity is derived from package, commit, and exact Manifest bytes");
  assert(Object.isFrozen(production), "runtime identity is immutable");

  const development = load({ MARKETPLACE_RUNTIME_ENV: "development" });
  assert.equal(development.commit, null, "explicit development runtime is unbound");

  const environmentMatrix: Array<[string, NodeJS.ProcessEnv, RegExp]> = [
    ["missing environment without commit", {}, /MARKETPLACE_RUNTIME_ENV is required/],
    ["missing environment with commit", { GIT_COMMIT: commit }, /MARKETPLACE_RUNTIME_ENV is required/],
    ["unknown environment", { MARKETPLACE_RUNTIME_ENV: "staging" }, /must be production or development/],
    ["production without commit", { MARKETPLACE_RUNTIME_ENV: "production" }, /GIT_COMMIT is required in production/],
    ["production short commit", { MARKETPLACE_RUNTIME_ENV: "production", GIT_COMMIT: "abc123" }, /full 40-character hexadecimal/],
    ["production malformed commit", { MARKETPLACE_RUNTIME_ENV: "production", GIT_COMMIT: "z".repeat(40) }, /full 40-character hexadecimal/],
    ["development with commit", { MARKETPLACE_RUNTIME_ENV: "development", GIT_COMMIT: commit }, /GIT_COMMIT must be absent in development/],
  ];
  for (const [name, env, expected] of environmentMatrix) {
    assert.throws(() => load(env), expected, name);
  }

  assert.throws(
    () => load({ MARKETPLACE_RUNTIME_ENV: "development" }, path.join(root, "missing.yaml")),
    /Manifest read failed/,
    "missing Manifest fails closed",
  );
  const directoryManifest = path.join(root, "manifest-directory");
  mkdirSync(directoryManifest);
  assert.throws(
    () => load({ MARKETPLACE_RUNTIME_ENV: "development" }, directoryManifest),
    /Manifest read failed/,
    "unreadable Manifest fails closed",
  );

  writeFixture("capabilities: [");
  assert.throws(() => load({ MARKETPLACE_RUNTIME_ENV: "development" }), /Manifest parse failed/, "invalid YAML fails closed");

  writeFixture(manifest().replace('schema_version: "1.0"', 'schema_version: "2.0"'));
  assert.throws(() => load({ MARKETPLACE_RUNTIME_ENV: "development" }), /schema_version must be 1.0/, "schema-invalid Manifest fails closed");

  writeFixture(manifest({ mode: "READ_WRITE" }));
  assert.throws(() => load({ MARKETPLACE_RUNTIME_ENV: "development" }), /production_mode must remain READ_ONLY/, "unsafe mode fails closed");

  writeFixture(manifest({ writeEnabled: true }));
  assert.throws(() => load({ MARKETPLACE_RUNTIME_ENV: "development" }), /write_runtime_enabled must remain false/, "WRITE-enabled Manifest fails closed");

  writeFixture(manifest({ version: "0.5.0" }));
  assert.throws(() => load({ MARKETPLACE_RUNTIME_ENV: "development" }), /mcp_version must match package version/, "non-canonical version fails closed");

  const manifestA = manifest();
  const manifestB = `# same semantics, different exact bytes\r\n${manifest().replaceAll("\n", "\r\n")}`;
  writeFixture(manifestA);
  const hashA = load({ MARKETPLACE_RUNTIME_ENV: "development" }).manifest_sha256;
  writeFixture(manifestB);
  const hashB = load({ MARKETPLACE_RUNTIME_ENV: "development" }).manifest_sha256;
  assert.notEqual(hashA, hashB, "semantically equivalent Manifest bytes produce different SHA-256 values");

  console.log("Runtime identity loader: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
