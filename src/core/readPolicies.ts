import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Marketplace } from "./store.js";
import type { ReadMethod } from "./readPolicy.js";
import { MpError } from './errors.js';

const names: Record<Marketplace, string> = { ozon: "ozon", wildberries: "wb", yandex_market: "ym" };
const cache = new Map<Marketplace, ReadMethod[]>();
export function isOzonMethodActive(method: ReadMethod & {lifecycle?: {status: string; removed_at: string}}, at = new Date()): boolean {
  return !method.lifecycle || method.lifecycle.status !== 'removed' && at.toISOString().slice(0,10) < method.lifecycle.removed_at;
}

export function getReadPolicy(marketplace: Marketplace): ReadMethod[] {
  const found = cache.get(marketplace);
  if (found) return marketplace === 'ozon' ? found.filter(m=>isOzonMethodActive(m)) : found;
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
  return marketplace === 'ozon' ? methods.filter(m=>isOzonMethodActive(m)) : methods;
}

export function findReadMethod(marketplace: Marketplace, methodId: string): ReadMethod | null {
  return getReadPolicy(marketplace).find((method) => method.method_id === methodId) ?? null;
}

export function requireReadMethod(marketplace: Marketplace, methodId: string): ReadMethod {
  const method=findReadMethod(marketplace,methodId);
  if(method) return method;
  if(marketplace==='ozon') {
    const decisions=JSON.parse(fs.readFileSync(new URL('../../policies/ozon-contract-overrides.json',import.meta.url),'utf8'));
    const lifecycle=decisions.find((d:any)=>d.method_id===methodId)?.patch?.lifecycle;
    if(lifecycle) throw new MpError('LOCAL_DENY',`Ozon method retired on ${lifecycle.removed_at}; restart with ${lifecycle.replacement.join(', ')}`,{marketplace});
  }
  throw new MpError('LOCAL_DENY','Unknown or non-READ method_id',{marketplace});
}
