import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export function operationKey(family,method,apiPath) {
  const host=family==='performance'?'https://api-performance.ozon.ru':'https://api-seller.ozon.ru';
  return `${family} ${host} ${method.toUpperCase()} ${apiPath}`;
}
function pointer(spec,ref) {
  if(!ref.startsWith('#/')) throw Error(`External reference requires a pinned source: ${ref}`);
  const value=ref.slice(2).split('/').reduce((v,k)=>v?.[k.replaceAll('~1','/').replaceAll('~0','~')],spec);
  if(value===undefined) throw Error(`Unresolved reference: ${ref}`);
  return value;
}
export function contracts(spec,family) {
  const records=[];
  for(const [apiPath,item] of Object.entries(spec.paths??{})) {
    for(const method of ['get','post','put','patch','delete','head','options']) {
      if(!item[method])continue;
      const operation=item[method];const refs={};const seen=new Set();
      function collect(value) {
        if(!value||typeof value!=='object')return;
        if(value.$ref&&!seen.has(value.$ref)){seen.add(value.$ref);refs[value.$ref]=pointer(spec,value.$ref);collect(refs[value.$ref]);}
        for(const child of Object.values(value))collect(child);
      }
      collect(operation);collect(item.parameters);
      const security=operation.security??spec.security??[];const security_schemes={};
      for(const requirement of security)for(const name of Object.keys(requirement)) {
        const scheme=spec.components?.securitySchemes?.[name]??spec.securityDefinitions?.[name];
        if(!scheme)throw Error(`Unresolved security scheme: ${name}`);
        security_schemes[name]=scheme;collect(scheme);
      }
      const servers=operation.servers??item.servers??spec.servers??[];
      records.push({key:operationKey(family,method,apiPath),operation_id:operation.operationId??null,path:apiPath,method:method.toUpperCase(),family,contract:{operation,path_parameters:item.parameters??[],security,security_schemes,servers,refs}});
    }
  }
  return records;
}
export function diffContracts(before,after) {
  const old=new Map(before.map(x=>[x.key,x]));const next=new Map(after.map(x=>[x.key,x]));
  if(old.size!==before.length||next.size!==after.length)throw Error('Duplicate family/host/method/path');
  return [...new Set([...old.keys(),...next.keys()])].sort().map(key=>({key,change:!old.has(key)?'added':!next.has(key)?'absent_from_snapshot':JSON.stringify(old.get(key).contract)===JSON.stringify(next.get(key).contract)?'unchanged':'changed',before:old.get(key)??null,after:next.get(key)??null,admission:'DENY_UNTIL_REVIEWED',removal_proven:false}));
}
// Supply complete, separately pinned official snapshots. No allowlist is mutated.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [family,beforeFile,afterFile,output]=process.argv.slice(2);
  if(!['seller','performance'].includes(family)||!beforeFile||!afterFile||!output){console.error('usage: node scripts/ozon-spec-diff.mjs seller|performance before.json after.json output.json');process.exitCode=2;}
  else {
    const beforeBytes=fs.readFileSync(beforeFile),afterBytes=fs.readFileSync(afterFile);
    const records=diffContracts(contracts(JSON.parse(beforeBytes),family),contracts(JSON.parse(afterBytes),family));
    fs.writeFileSync(output,JSON.stringify({family,before_sha256:sha(beforeBytes),after_sha256:sha(afterBytes),records},null,2)+'\n');
    console.log(JSON.stringify({family,operations:records.length,changed:records.filter(x=>x.change!=='unchanged').length}));
  }
}
