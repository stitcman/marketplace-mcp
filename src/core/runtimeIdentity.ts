import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { validateManifestContract } from "./manifestContract.js";

export interface RuntimeIdentity {
  version: string;
  commit: string | null;
  manifest_sha256: string;
  mode: "READ_ONLY";
  write_runtime_enabled: false;
}

export interface RuntimeIdentityOptions {
  env: NodeJS.ProcessEnv;
  manifestPath: string;
  packagePath: string;
}

export function loadRuntimeIdentity(options: RuntimeIdentityOptions): Readonly<RuntimeIdentity> {
  const runtimeEnvironment = options.env.MARKETPLACE_RUNTIME_ENV;
  if (runtimeEnvironment === undefined || runtimeEnvironment === "") {
    throw new Error("MARKETPLACE_RUNTIME_ENV is required");
  }
  if (runtimeEnvironment !== "production" && runtimeEnvironment !== "development") {
    throw new Error("MARKETPLACE_RUNTIME_ENV must be production or development");
  }

  const declaredCommit = options.env.GIT_COMMIT;
  let commit: string | null;
  if (runtimeEnvironment === "production") {
    if (declaredCommit === undefined || declaredCommit === "") throw new Error("GIT_COMMIT is required in production");
    if (!/^[0-9a-fA-F]{40}$/.test(declaredCommit)) {
      throw new Error("GIT_COMMIT must be a full 40-character hexadecimal Git SHA");
    }
    commit = declaredCommit.toLowerCase();
  } else {
    if (declaredCommit !== undefined) throw new Error("GIT_COMMIT must be absent in development");
    commit = null;
  }

  let rawManifest: Buffer;
  try {
    rawManifest = readFileSync(options.manifestPath);
  } catch (error) {
    throw new Error(`Manifest read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifestSha256 = createHash("sha256").update(rawManifest).digest("hex");

  let parsedManifest: unknown;
  try {
    parsedManifest = parse(rawManifest.toString("utf8"));
  } catch (error) {
    throw new Error(`Manifest parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let version: string;
  try {
    const packageJson = JSON.parse(readFileSync(options.packagePath, "utf8")) as { version?: unknown };
    if (typeof packageJson.version !== "string" || packageJson.version.length === 0) throw new Error("version is required");
    version = packageJson.version;
  } catch (error) {
    throw new Error(`Package version read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const manifest = validateManifestContract(parsedManifest, version);
  return Object.freeze({
    version,
    commit,
    manifest_sha256: manifestSha256,
    mode: manifest.production_mode,
    write_runtime_enabled: manifest.write_runtime_enabled,
  });
}

export interface EvidenceCheck {
  name: string;
  status: "PASS" | "FAIL";
  sha256: string;
}

export interface EvidenceEnvelope {
  schema_version: "1.0";
  marketplace: "ozon" | "wildberries" | "yandex_market";
  runtime: RuntimeIdentity;
  account_identity_sha256: string;
  started_at: string;
  completed_at: string;
  checks: EvidenceCheck[];
  audit_correlation_ids: string[];
}
