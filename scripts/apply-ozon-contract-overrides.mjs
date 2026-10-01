import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
export function applyOzonOverrides(records) {
  const decisions=JSON.parse(fs.readFileSync(path.join(root,'policies/ozon-contract-overrides.json'),'utf8'));
  const map=new Map(decisions.map(x=>[x.method_id,x]));
  for(const record of records) {
    const decision=map.get(record.method_id);
    if(!decision) continue;
    if(decision.path !== record.path) throw new Error(`Ozon override path drift: ${record.method_id}`);
    Object.assign(record,decision.patch??{});
    record.contract_review={source:decision.source,retrieved_at_utc:decision.retrieved_at_utc,effective_at:decision.effective_at};
    if(decision.deny) record.admission='denied';
  }
  for(const id of map.keys()) if(!records.some(x=>x.method_id===id)) throw new Error(`Missing Ozon override operation: ${id}`);
  return records;
}
if(process.argv.includes('--apply')) {
  const file=path.join(root,'inventory/ozon-operations.json');
  const records=applyOzonOverrides(JSON.parse(fs.readFileSync(file,'utf8')));
  const policy=path.join(root,'policies/ozon-read-allowlist.json');
  const approved=new Set(JSON.parse(fs.readFileSync(policy,'utf8')).map(x=>x.method_id));
  fs.writeFileSync(file,JSON.stringify(records,null,2)+'\n');
  fs.writeFileSync(policy,JSON.stringify(records.filter(x=>approved.has(x.method_id)&&x.admission!=='denied').map(({classification,...x})=>x),null,2)+'\n');
}
