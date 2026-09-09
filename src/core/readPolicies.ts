import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Marketplace } from "./store.js";
import type { ReadMethod } from "./readPolicy.js";

const names: Record<Marketplace, string> = { ozon: "ozon", wildberries: "wb", yandex_market: "ym" };
const cache = new Map<Marketplace, ReadMethod[]>();

export function getReadPolicy(marketplace: Marketplace): ReadMethod[] {
  const found = cache.get(marketplace);
  if (found) return found;
  const fileName = `${names[marketplace]}-read-allowlist.json`;
  const candidates = [
    path.resolve(process.cwd(), "policies", fileName),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../policies", fileName),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`Read policy manifest not found: ${fileName}`);
  const methods = JSON.parse(fs.readFileSync(file, "utf8")) as ReadMethod[];
  if (!Array.isArray(methods) || methods.some((method) => method.safety !== "read")) throw new Error(`Invalid read policy manifest: ${fileName}`);
  const ids = new Set<string>();
  for (const method of methods) {
    if (!method.method_id || ids.has(method.method_id)) throw new Error(`Duplicate/empty method_id in ${fileName}`);
    ids.add(method.method_id);
  }
  cache.set(marketplace, methods);
  return methods;
}

export function findReadMethod(marketplace: Marketplace, methodId: string): ReadMethod | null {
  return getReadPolicy(marketplace).find((method) => method.method_id === methodId) ?? null;
}
