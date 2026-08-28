/**
 * API key encryption (spec §7): AES-256-GCM with a master key from the environment
 * (MASTER_KEY, 64 hex chars). Only ciphertext is stored in the database (iv:tag:data,
 * base64). Secrets are never logged and never reach MCP responses — see errors.ts / audit.ts.
 * In production the master key comes from the host's secret manager, not from a .env in the repo.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey(): Buffer {
  const hex = process.env.MASTER_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("MASTER_KEY env var must be 64 hex chars (32 bytes). Generate: openssl rand -hex 32");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split(":").map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Masking for logs and errors: reveals only the last 4 characters. */
export function mask(secret: string): string {
  return secret.length <= 4 ? "****" : "****" + secret.slice(-4);
}
