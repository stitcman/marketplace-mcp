import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EvidenceEnvelope } from "../../src/core/runtimeIdentity.js";

const SENSITIVE_KEY = /(api.?key|authorization|bearer|token|secret|password|credential)/i;

export interface WrittenEvidence {
  path: string;
  sha256: string;
}

export function writeEvidence(envelope: EvidenceEnvelope, outputDirectory: string): WrittenEvidence {
  assertNoSensitiveKeys(envelope);
  if (!/^[0-9a-f]{40}$/.test(envelope.runtime.commit)) {
    throw new Error("evidence runtime commit must be a full Git commit");
  }
  if (!/^[0-9a-f]{64}$/.test(envelope.runtime.manifest_sha256)) {
    throw new Error("evidence Manifest SHA-256 must be a lowercase hex digest");
  }
  const bytes = Buffer.from(`${JSON.stringify(sortRecursively(envelope), null, 2)}\n`, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = `${envelope.marketplace}-${envelope.runtime.commit}-${envelope.runtime.manifest_sha256}.json`;
  const outputPath = path.join(outputDirectory, fileName);

  mkdirSync(outputDirectory, { recursive: true });
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath);
    if (!existing.equals(bytes)) throw new Error(`evidence identity collision: ${outputPath}`);
    return { path: outputPath, sha256 };
  }
  writeFileSync(outputPath, bytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { path: outputPath, sha256 };
}

function assertNoSensitiveKeys(value: unknown, at = ""): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoSensitiveKeys(child, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = at ? `${at}.${key}` : key;
    if (SENSITIVE_KEY.test(key)) throw new Error(`sensitive evidence key rejected: ${childPath}`);
    assertNoSensitiveKeys(child, childPath);
  }
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => [key, sortRecursively(child)]),
  );
}
