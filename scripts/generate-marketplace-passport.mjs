import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

const root = path.resolve(new URL("..", import.meta.url).pathname.slice(process.platform === "win32" ? 1 : 0));
const manifestPath = path.join(root, "MARKETPLACE_MCP_MANIFEST.yaml");
const passportPath = path.join(root, "MARKETPLACE_MCP_PASSPORT.md");
const manifest = parse(fs.readFileSync(manifestPath, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Manifest validation failed: ${message}`);
}
requireValue(manifest.schema_version === "1.0", "schema_version must be 1.0");
requireValue(manifest.production_mode === "READ_ONLY", "production_mode must remain READ_ONLY");
requireValue(manifest.controlled_write_architecture === true, "controlled_write_architecture must be true");
requireValue(manifest.write_runtime_enabled === false, "write_runtime_enabled must remain false");
requireValue(manifest.global_write_switch_allowed === false, "global write switch must remain forbidden");
requireValue(Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0, "capabilities are required");
requireValue(new Set(manifest.capabilities.map((item) => item.capability_id)).size === manifest.capabilities.length, "capability_id values must be unique");

for (const item of manifest.capabilities) {
  requireValue(["READ", "WRITE", "DESTRUCTIVE", "SEMANTIC_READ_JOB"].includes(item.operation_class), `${item.capability_id} has invalid operation_class`);
  requireValue(["production", "candidate", "planned", "disabled", "deprecated"].includes(item.status), `${item.capability_id} has invalid status`);
  if (["WRITE", "DESTRUCTIVE"].includes(item.operation_class)) requireValue(item.status === "disabled", `${item.capability_id} must be disabled`);
  requireValue(fs.existsSync(path.join(root, item.reference)), `${item.capability_id} reference does not exist: ${item.reference}`);
}

requireValue(!fs.existsSync(path.join(root, "marketplace-mcp.lock.json")), "consumer MOS lock must not exist in this repository");

const title = (value) => value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const list = (items) => items.length ? items.map((item) => `- \`${item.capability_id}\` — ${item.status}`).join("\n") : "- None";
const production = manifest.capabilities.filter((item) => item.status === "production");
const candidate = manifest.capabilities.filter((item) => item.status === "candidate");
const disabled = manifest.capabilities.filter((item) => ["WRITE", "DESTRUCTIVE"].includes(item.operation_class));

const marketplaceRows = Object.entries(manifest.marketplaces).map(([name, state]) =>
  `| ${title(name)} | ${state.production_read} | ${state.candidate_extended_read} | ${state.representative_real_e2e} |`,
).join("\n");

const output = `<!-- Generated from MARKETPLACE_MCP_MANIFEST.yaml. Do not edit independently. -->
# Marketplace MCP Passport

## Release identity

- MCP version: \`${manifest.mcp_version}\`
- Production repository baseline: \`${manifest.production_commit}\` (${manifest.production_commit_basis})
- Candidate: \`${manifest.candidate_commit}\`
- Runtime mode: \`${manifest.production_mode}\`
- Architecture: \`READ + Controlled WRITE\`; WRITE runtime is disabled
- v1 readiness: **${manifest.v1_readiness.percent}%** (${manifest.v1_readiness.method})

## Marketplace readiness

| Marketplace | Production READ | Candidate extended READ | Representative real E2E |
|---|---|---|---|
${marketplaceRows}

## Production capabilities

${list(production)}

## Candidate capabilities

${list(candidate)}

## Disabled WRITE and DESTRUCTIVE capabilities

${list(disabled)}

## Known blockers

${manifest.blockers.map((item) => `- **${item.blocker_id}:** ${item.summary} Evidence: \`${item.evidence}\`.`).join("\n")}

## Next milestone

${manifest.v1_readiness.next_milestone}

This Passport is a generated human view. The machine-readable source of truth is \`MARKETPLACE_MCP_MANIFEST.yaml\`; the complete endpoint inventories remain under \`inventory/\` and are not duplicated here.
`;

if (process.argv.includes("--check")) {
  requireValue(fs.existsSync(passportPath), "Passport is missing; run npm run baseline:generate");
  requireValue(fs.readFileSync(passportPath, "utf8") === output, "Passport is stale; run npm run baseline:generate");
  console.log("marketplace baseline: PASS");
} else {
  fs.writeFileSync(passportPath, output);
  console.log(`generated ${path.relative(root, passportPath)}`);
}
