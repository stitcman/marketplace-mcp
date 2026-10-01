// Read-only official-source probe. Never executes downloaded JavaScript or changes policies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { contracts } from './ozon-spec-diff.mjs';
const directory=path.resolve(process.argv[2]??'docs/audits/2026-10-01-ozon-api-refresh/release-gate-followup/sources');
fs.mkdirSync(directory,{recursive:true});
const sources=[
  {family:'seller',kind:'spec',url:'https://docs.ozon.ru/api/seller/swagger.json?1790833747847'},
  {family:'performance',kind:'spec',url:'https://docs.ozon.ru/api/performance/swagger.json'},
  {family:'seller',kind:'loader',url:'https://docs.ozon.ru/api/seller/scripts/loadSwagger.js'},
  {family:'seller',kind:'loader',url:'https://docs.ozon.ru/api/seller/scripts/initRedoc.js'},
];
const records=[];
for(const source of sources){
  let url=new URL(source.url);const chain=[];const seen=new Set();const retrieved_at_utc=new Date().toISOString();
  try {
    let response;
    for(let step=0;step<6;step++){
      if(seen.has(url.href))throw Error('REDIRECT_LOOP');seen.add(url.href);
      response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10_000)});
      const location=response.headers.get('location');chain.push({url:url.href,status:response.status,location});
      if(![301,302,303,307,308].includes(response.status))break;
      if(!location)throw Error('REDIRECT_WITHOUT_LOCATION');
      const next=new URL(location,url);
      if(next.protocol!=='https:'||next.hostname!=='docs.ozon.ru')throw Error('REDIRECT_OUTSIDE_OFFICIAL_HOST');
      url=next;if(step===5)throw Error('REDIRECT_LIMIT');
    }
    if(!response?.ok)throw Error(`HTTP_${response?.status}`);
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>10*1024*1024){await reader.cancel();throw Error('SIZE_LIMIT');}chunks.push(Buffer.from(value));}
    const bytes=Buffer.concat(chunks);let operation_count=null;
    if(source.kind==='spec'){
      const spec=JSON.parse(bytes);if(!spec.paths||!spec.info)throw Error('NOT_COMPLETE_SPEC');
      operation_count=contracts(spec,source.family).length;if(!operation_count)throw Error('EMPTY_SPEC');
    }
    const file=`${source.family}-${source.kind}-${path.basename(new URL(source.url).pathname)}`;
    fs.writeFileSync(path.join(directory,file),bytes);
    records.push({...source,retrieved_at_utc,status:'FETCHED',final_url:url.href,chain,file,operation_count,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }catch(error){records.push({...source,retrieved_at_utc,status:'UNAVAILABLE',reason:error.message,final_url:url.href,chain});}
}
fs.writeFileSync(path.join(directory,'official-asset-probe.json'),JSON.stringify(records,null,2)+'\n');
console.log(JSON.stringify(records.map(({chain,...record})=>({...record,redirect_count:chain.length}))));
if(records.filter(x=>x.kind==='spec').some(x=>x.status!=='FETCHED'))process.exitCode=1;
