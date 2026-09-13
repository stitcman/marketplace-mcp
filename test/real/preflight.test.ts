import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EvidenceEnvelope, RuntimeIdentity } from "../../src/core/runtimeIdentity.js";
import { assertRealE2EPreflight, parseRuntimeIdentityEnvelope } from "./read-e2e.js";
import { writeEvidence } from "./evidence.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const outputDirectory = mkdtempSync(path.join(tmpdir(), "marketplace-mcp-e2e-"));
const expectedCommit = "1".repeat(40);
const expectedManifest = "2".repeat(64);

const identity: RuntimeIdentity = {
  version: "1.0.0-rc.1",
  commit: expectedCommit,
  manifest_sha256: expectedManifest,
  mode: "READ_ONLY",
  write_runtime_enabled: false,
};

const env: NodeJS.ProcessEnv = {
  MP_E2E_MARKETPLACE: "ozon",
  MP_E2E_CONNECTION_ID: "00000000-0000-4000-8000-000000000011",
  MP_E2E_EXPECTED_RUNTIME_ENV: "production",
  MP_E2E_EXPECTED_COMMIT: expectedCommit,
  MP_E2E_EXPECTED_MANIFEST_SHA256: expectedManifest,
  MP_E2E_BASE_URL: "https://mcp.example.test/mcp",
  MP_E2E_AUTH_TOKEN: "runtime-only-test-token",
  MP_E2E_EVIDENCE_DIR: outputDirectory,
};

try {
  const runtimeEnvelope = {
    success: true,
    marketplace: null,
    connection_id: null,
    data: identity,
    meta: {
      fetched_at: "2026-09-13T10:00:00.000Z",
      source: "internal",
      cached: false,
      next_cursor: null,
    },
  };
  assert.deepEqual(parseRuntimeIdentityEnvelope(runtimeEnvelope), identity, "strict runtime identity envelope is accepted");
  assert.throws(
    () => parseRuntimeIdentityEnvelope(identity),
    /standard success envelope/,
    "raw runtime identity is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, success: false }),
    /standard success envelope/,
    "non-success envelope is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ success: true }),
    /standard success envelope/,
    "envelope without data is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, data: { ...identity, version: "" } }),
    /version must be a non-empty string/,
    "empty runtime version is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, data: { ...identity, environment_dump: "secret" } }),
    /exactly five approved fields/,
    "runtime identity with an extra field is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, data: { ...identity, manifest_sha256: "A".repeat(64) } }),
    /lowercase hex digest/,
    "non-canonical Manifest digest is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, debug: true }),
    /exactly the standard fields/,
    "extra envelope field is rejected",
  );
  const { meta: _missingMeta, ...envelopeWithoutMeta } = runtimeEnvelope;
  assert.throws(
    () => parseRuntimeIdentityEnvelope(envelopeWithoutMeta),
    /exactly the standard fields/,
    "missing envelope meta is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, meta: { ...runtimeEnvelope.meta, debug: true } }),
    /meta must contain exactly the standard fields/,
    "extra envelope meta field is rejected",
  );
  assert.throws(
    () => parseRuntimeIdentityEnvelope({ ...runtimeEnvelope, meta: { ...runtimeEnvelope.meta, source: "official_api" } }),
    /envelope meta is invalid/,
    "non-internal identity source is rejected",
  );

  const config = assertRealE2EPreflight(env, identity, repoRoot);
  assert.equal(config.marketplace, "ozon", "valid preflight returns the selected marketplace");
  assert.equal(config.connectionId, env.MP_E2E_CONNECTION_ID, "valid preflight returns the connection ID");
  assert.equal(config.baseUrl.href, "https://mcp.example.test/mcp", "valid preflight normalizes the MCP URL");

  for (const name of [
    "MP_E2E_MARKETPLACE",
    "MP_E2E_CONNECTION_ID",
    "MP_E2E_EXPECTED_RUNTIME_ENV",
    "MP_E2E_EXPECTED_MANIFEST_SHA256",
    "MP_E2E_BASE_URL",
    "MP_E2E_AUTH_TOKEN",
    "MP_E2E_EVIDENCE_DIR",
  ]) {
    assert.throws(
      () => assertRealE2EPreflight({ ...env, [name]: "" }, identity, repoRoot),
      new RegExp(`${name} is required`),
      `${name}: missing input fails closed`,
    );
  }

  assert.throws(
    () => assertRealE2EPreflight({ ...env, MP_E2E_MARKETPLACE: "amazon" }, identity, repoRoot),
    /MP_E2E_MARKETPLACE must be one of/,
    "unknown marketplace fails closed",
  );
  assert.throws(
    () => assertRealE2EPreflight({ ...env, MP_E2E_EXPECTED_RUNTIME_ENV: "staging" }, identity, repoRoot),
    /MP_E2E_EXPECTED_RUNTIME_ENV must be production or development/,
    "unknown expected runtime environment fails closed",
  );
  assert.throws(
    () => assertRealE2EPreflight({ ...env, MP_E2E_BASE_URL: "https://user:password@mcp.example.test/mcp" }, identity, repoRoot),
    /MP_E2E_BASE_URL must not contain credentials/,
    "URL-embedded credentials fail closed",
  );
  assert.throws(
    () => assertRealE2EPreflight(env, { ...identity, commit: "3".repeat(40) }, repoRoot),
    /runtime commit mismatch/,
    "runtime commit drift fails closed",
  );
  assert.throws(
    () => assertRealE2EPreflight(env, { ...identity, manifest_sha256: "4".repeat(64) }, repoRoot),
    /Manifest SHA-256 mismatch/,
    "Manifest drift fails closed",
  );
  assert.throws(
    () => assertRealE2EPreflight(env, { ...identity, mode: "READ_WRITE" as "READ_ONLY" }, repoRoot),
    /runtime mode must be READ_ONLY/,
    "non-READ_ONLY runtime fails closed",
  );
  assert.throws(
    () => assertRealE2EPreflight(env, { ...identity, write_runtime_enabled: true as false }, repoRoot),
    /WRITE runtime must be disabled/,
    "WRITE-enabled runtime fails closed",
  );
  assert.throws(
    () => assertRealE2EPreflight(env, { ...identity, commit: null }, repoRoot),
    /production runtime commit must be a full Git SHA/,
    "production commit cannot be null",
  );
  const developmentEnv = { ...env, MP_E2E_EXPECTED_RUNTIME_ENV: "development" };
  delete developmentEnv.MP_E2E_EXPECTED_COMMIT;
  const developmentConfig = assertRealE2EPreflight(developmentEnv, { ...identity, commit: null }, repoRoot);
  assert.equal(developmentConfig.expectedCommit, null, "development harness accepts only an unbound runtime");
  assert.throws(
    () => assertRealE2EPreflight(developmentEnv, identity, repoRoot),
    /development runtime commit must be null/,
    "development harness rejects a bound runtime",
  );
  assert.throws(
    () => assertRealE2EPreflight({ ...env, MP_E2E_EVIDENCE_DIR: path.join(repoRoot, "evidence") }, identity, repoRoot),
    /evidence directory must be outside the Git worktree/,
    "Git-local evidence fails closed",
  );

  const envelope: EvidenceEnvelope = {
    schema_version: "1.0",
    marketplace: "ozon",
    runtime: identity,
    account_identity_sha256: "5".repeat(64),
    started_at: "2026-09-12T20:00:00.000Z",
    completed_at: "2026-09-12T20:00:01.000Z",
    checks: [{ name: "preflight", status: "PASS", sha256: "6".repeat(64) }],
    audit_correlation_ids: ["audit-1"],
  };
  const first = writeEvidence(envelope, outputDirectory);
  const second = writeEvidence({ ...envelope }, outputDirectory);
  assert.equal(first.path, second.path, "same evidence identity uses the same deterministic path");
  assert.equal(first.sha256, second.sha256, "same evidence produces the same hash");
  const bytes = readFileSync(first.path);
  assert.equal(first.sha256, createHash("sha256").update(bytes).digest("hex"), "returned hash covers exact file bytes");
  assert.deepEqual(JSON.parse(bytes.toString("utf8")), envelope, "persisted evidence preserves the approved envelope");
  const serialized = bytes.toString("utf8");
  assert(serialized.indexOf('"account_identity_sha256"') < serialized.indexOf('"audit_correlation_ids"'), "evidence keys use stable lexical order");
  assert(serialized.indexOf('"audit_correlation_ids"') < serialized.indexOf('"checks"'), "evidence key order does not depend on insertion order");
  if (process.platform !== "win32") {
    assert.equal(statSync(first.path).mode & 0o777, 0o600, "evidence is owner-readable and owner-writable only");
  }

  assert.throws(
    () => writeEvidence({ ...envelope, metadata: { authorization: "Bearer secret" } } as EvidenceEnvelope, outputDirectory),
    /sensitive evidence key rejected: metadata\.authorization/,
    "sensitive nested evidence keys are rejected before persistence",
  );
  assert.throws(
    () => writeEvidence({ ...envelope, runtime: { ...identity, commit: "../outside" } }, outputDirectory),
    /evidence runtime commit must be a full Git commit/,
    "untrusted identity cannot escape the evidence directory",
  );

  console.log("Real E2E preflight: PASS (offline; no network or credentials)");
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
