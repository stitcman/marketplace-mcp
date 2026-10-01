import assert from "node:assert/strict";
import fs from "node:fs";

for (const marketplace of ["ozon", "wb", "ym"] as const) {
  const inventory = JSON.parse(fs.readFileSync(new URL(`../inventory/${marketplace}-operations.json`, import.meta.url), "utf8"));
  const allowlist = JSON.parse(fs.readFileSync(new URL(`../policies/${marketplace}-read-allowlist.json`, import.meta.url), "utf8"));
  assert(inventory.length > 0, `${marketplace}: inventory is not empty`);
  assert.equal(inventory.filter((m: any) => !["READ", "SEMANTIC_READ_JOB", "WRITE", "DESTRUCTIVE"].includes(m.classification)).length, 0, `${marketplace}: unclassified=0`);
  assert(allowlist.every((m: any) => m.safety === "read"), `${marketplace}: allowlist contains READ only`);
  assert(allowlist.every((m: any) => inventory.some((i: any) => i.method_id === m.method_id && ["READ", "SEMANTIC_READ_JOB"].includes(i.classification))), `${marketplace}: allowlist is a subset of inventory`);
  assert.equal(new Set(allowlist.map((m: any) => m.method_id)).size, allowlist.length, `${marketplace}: method_id values are unique`);
  for (const operation of inventory.filter((m: any) => ["WRITE", "DESTRUCTIVE"].includes(m.classification))) {
    assert(!allowlist.some((m: any) => m.method_id === operation.method_id), `${marketplace}: forbidden ${operation.method_id} absent from allowlist`);
  }
  assert(allowlist.every((m: any) => m.input_schema?.type === "object"), `${marketplace}: every allowed method has a request schema`);
  assert(allowlist.every((m: any) => !Object.keys(m.input_schema?.properties ?? {}).some((key) => /^(client-id|api-key|authorization|token)$/i.test(key))), `${marketplace}: credentials are absent from MCP input schemas`);
  if (marketplace === "ozon") {
    const key = (m: any) => `${m.endpoint_group === 'performance' ? 'performance https://api-performance.ozon.ru' : 'seller https://api-seller.ozon.ru'} ${m.http_method} ${m.path}`;
    assert.equal(new Set(inventory.map(key)).size,inventory.length,'ozon: family/host/verb/path identities unique');
    assert(allowlist.every((m:any)=>m.admission!=='denied' && m.lifecycle?.status!=='removed'),'ozon: retired/denied methods absent');
    assert.equal(new Set(inventory.map((m:any)=>m.method_id)).size,inventory.length,'ozon: aliases require explicit resolution, no collisions');
    assert(inventory.filter((m:any)=>m.admission==='denied').every((m:any)=>!allowlist.some((a:any)=>a.method_id===m.method_id)),'ozon: all explicit denials enforced');
  }
  console.log(`${marketplace}: inventory=${inventory.length}, allowed=${allowlist.length}, unclassified=0`);
}
