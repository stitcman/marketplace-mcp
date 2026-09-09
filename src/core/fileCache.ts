import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { MpError } from "./errors.js";
import type { Marketplace } from "./store.js";

const ROOT = process.env.MARKETPLACE_MCP_CACHE_DIR ?? "/opt/marketplace-mcp/data/cache";
const TTL_MS = 72 * 60 * 60 * 1000;
const MIN_FREE_BYTES = 5 * 1024 ** 3;
const MAX_FILE_BYTES = 50 * 1024 ** 2;
const QUOTA_BYTES = 1024 ** 3;
const names: Record<Marketplace, string> = { ozon: "ozon", wildberries: "wildberries", yandex_market: "yandex-market" };

export async function cacheArtifact(input: { marketplace: Marketplace; methodId: string; payload: unknown }) {
  const downloaded = findDownload(input.payload);
  if (!downloaded) throw new MpError("FEATURE_NOT_AVAILABLE_FOR_ACCOUNT", "The marketplace response did not contain a downloadable artifact", { marketplace: input.marketplace });
  const dir = path.join(ROOT, names[input.marketplace]);
  await fs.mkdir(dir, { recursive: true });
  await expire(dir);
  const free = await fs.statfs(dir);
  const freeBytes = Number(free.bavail) * Number(free.bsize);
  if (freeBytes < MIN_FREE_BYTES) throw new MpError("LOCAL_DENY", "File cache denied: less than 5 GB would remain free", { marketplace: input.marketplace });
  const used = await directoryBytes(dir);
  let bytes: Buffer;
  let mimeType: string;
  if (downloaded.bytes) {
    bytes = downloaded.bytes;
    mimeType = downloaded.mime_type ?? "application/octet-stream";
  } else {
    const url = new URL(downloaded.url!);
    if (!allowedDownloadHost(input.marketplace, url.hostname)) throw new MpError("LOCAL_DENY", "Artifact URL host is not allowed", { marketplace: input.marketplace });
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new MpError("MARKETPLACE_UNAVAILABLE", `Artifact download returned ${response.status}`, { marketplace: input.marketplace });
    bytes = Buffer.from(await response.arrayBuffer());
    mimeType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
  }
  if (bytes.length > MAX_FILE_BYTES || used + bytes.length > QUOTA_BYTES) throw new MpError("LOCAL_DENY", "Artifact exceeds cache size/quota limits", { marketplace: input.marketplace });
  if (!/^(application\/(pdf|zip|json|octet-stream|vnd\.|csv)|text\/(csv|plain))/i.test(mimeType)) throw new MpError("LOCAL_DENY", `Unsupported artifact MIME type: ${mimeType}`, { marketplace: input.marketplace });
  const created = new Date();
  const id = randomUUID();
  const extension = extensionFor(mimeType);
  const file = path.join(dir, `${id}${extension}`);
  await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  return { file_id: id, marketplace: input.marketplace, method_id: input.methodId, mime_type: mimeType, size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"), created_at: created.toISOString(), expires_at: new Date(created.getTime() + TTL_MS).toISOString(), server_path: file };
}

function findDownload(value: any): { url?: string; bytes?: Buffer; mime_type?: string } | null {
  if (value?.__download && Buffer.isBuffer(value.bytes)) return value;
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (/^(url|download_url|file_url)$/i.test(key) && typeof child === "string" && /^https:\/\//.test(child)) return { url: child };
    const nested = findDownload(child);
    if (nested) return nested;
  }
  return null;
}

function allowedDownloadHost(marketplace: Marketplace, hostname: string) {
  const suffixes: Record<Marketplace, string[]> = { ozon: [".ozon.ru", ".ozone.ru"], wildberries: [".wildberries.ru", ".wb.ru"], yandex_market: [".yandex.ru", ".yandex.net"] };
  return suffixes[marketplace].some((suffix) => hostname.endsWith(suffix));
}

async function expire(dir: string) {
  const now = Date.now();
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) if (entry.isFile()) {
    const file = path.join(dir, entry.name);
    const stat = await fs.stat(file);
    if (now - stat.mtimeMs > TTL_MS) await fs.unlink(file);
  }
}
async function directoryBytes(dir: string) { let total = 0; for (const entry of await fs.readdir(dir, { withFileTypes: true })) if (entry.isFile()) total += (await fs.stat(path.join(dir, entry.name))).size; return total; }
function extensionFor(mime: string) { if (/pdf/i.test(mime)) return ".pdf"; if (/csv/i.test(mime)) return ".csv"; if (/zip/i.test(mime)) return ".zip"; if (/json/i.test(mime)) return ".json"; if (/spreadsheet|excel/i.test(mime)) return ".xlsx"; return ".bin"; }
