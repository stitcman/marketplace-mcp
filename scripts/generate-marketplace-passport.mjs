import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";
import { validateManifestContract, validateManifestRepository } from "../src/core/manifestContract.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname.slice(process.platform === "win32" ? 1 : 0));
const manifestPath = path.join(root, "MARKETPLACE_MCP_MANIFEST.yaml");
const passportPath = path.join(root, "MARKETPLACE_MCP_PASSPORT.md");
const manifest = parse(fs.readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(`Manifest validation failed: ${message}`);
}
const validatedManifest = validateManifestContract(manifest, packageJson.version);
validateManifestRepository(validatedManifest, root);

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
- Candidate source baseline: \`${manifest.candidate_commit}\` (${manifest.candidate_commit_basis})
- Runtime mode: \`${manifest.production_mode}\`
- Architecture: \`READ + Controlled WRITE\`; WRITE runtime is disabled
- Candidate tool surface: **${manifest.tool_surface.candidate_tools} tools**, including audited \`${manifest.runtime_identity.tool}\`
- Runtime binding: declared build commit + SHA-256 of exact Manifest bytes
- Final provenance boundary: external attestation of commit + Manifest SHA-256 + image digest
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
