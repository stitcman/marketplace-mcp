import fs from "node:fs";
import path from "node:path";

export interface ManifestCapability {
  capability_id: string;
  operation_class: "READ" | "WRITE" | "DESTRUCTIVE" | "SEMANTIC_READ_JOB";
  status: "production" | "candidate" | "planned" | "disabled" | "deprecated";
  reference: string;
  [key: string]: unknown;
}

export interface MarketplaceManifest {
  schema_version: "1.0";
  mcp_version: string;
  production_mode: "READ_ONLY";
  controlled_write_architecture: true;
  write_runtime_enabled: false;
  global_write_switch_allowed: false;
  capabilities: ManifestCapability[];
  [key: string]: unknown;
}

export function validateManifestContract(value: unknown, expectedVersion: string): MarketplaceManifest {
  requireValue(Boolean(value) && typeof value === "object" && !Array.isArray(value), "root must be an object");
  const manifest = value as Record<string, unknown>;
  requireValue(manifest.schema_version === "1.0", "schema_version must be 1.0");
  requireValue(typeof manifest.mcp_version === "string" && manifest.mcp_version.length > 0, "mcp_version is required");
  requireValue(manifest.mcp_version === expectedVersion, "mcp_version must match package version");
  requireValue(manifest.production_mode === "READ_ONLY", "production_mode must remain READ_ONLY");
  requireValue(manifest.controlled_write_architecture === true, "controlled_write_architecture must be true");
  requireValue(manifest.write_runtime_enabled === false, "write_runtime_enabled must remain false");
  requireValue(manifest.global_write_switch_allowed === false, "global write switch must remain forbidden");
  requireValue(Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0, "capabilities are required");

  const capabilities = manifest.capabilities as Array<Record<string, unknown>>;
  requireValue(
    new Set(capabilities.map((item) => item.capability_id)).size === capabilities.length,
    "capability_id values must be unique",
  );
  for (const item of capabilities) {
    requireValue(typeof item.capability_id === "string" && item.capability_id.length > 0, "capability_id is required");
    requireValue(
      ["READ", "WRITE", "DESTRUCTIVE", "SEMANTIC_READ_JOB"].includes(String(item.operation_class)),
      `${item.capability_id} has invalid operation_class`,
    );
    requireValue(
      ["production", "candidate", "planned", "disabled", "deprecated"].includes(String(item.status)),
      `${item.capability_id} has invalid status`,
    );
    if (["WRITE", "DESTRUCTIVE"].includes(String(item.operation_class))) {
      requireValue(item.status === "disabled", `${item.capability_id} must be disabled`);
    }
    requireValue(typeof item.reference === "string" && item.reference.length > 0, `${item.capability_id} reference is required`);
  }
  return manifest as unknown as MarketplaceManifest;
}

export function validateManifestRepository(manifest: MarketplaceManifest, root: string): void {
  for (const item of manifest.capabilities) {
    requireValue(fs.existsSync(path.join(root, item.reference)), `${item.capability_id} reference does not exist: ${item.reference}`);
  }
  requireValue(!fs.existsSync(path.join(root, "marketplace-mcp.lock.json")), "consumer MOS lock must not exist in this repository");
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Manifest validation failed: ${message}`);
}
