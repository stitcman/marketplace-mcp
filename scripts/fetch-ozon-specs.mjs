import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { contracts } from './ozon-spec-diff.mjs';
const out=path.resolve(process.argv[2]??'docs/audits/2026-10-01-ozon-api-refresh/sources');
fs.mkdirSync(out,{recursive:true});
const results=[];
for(const family of ['seller','performance']) {
  const source=`https://docs.ozon.ru/api/${family}/swagger.json`;
  const retrieved_at_utc=new Date().toISOString();
  try {
    let url=new URL(source);let response;const seen=new Set();
    for(let attempt=0;attempt<6;attempt++) {
      if(seen.has(url.href))throw Error('REDIRECT_LOOP');seen.add(url.href);
      response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20_000),headers:{Accept:'application/json'}});
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');if(!location)throw Error('REDIRECT_WITHOUT_LOCATION');
      const next=new URL(location,url);if(next.protocol!=='https:'||next.hostname!=='docs.ozon.ru')throw Error('REDIRECT_OUTSIDE_OFFICIAL_HOST');url=next;
      if(attempt===5)throw Error('REDIRECT_LIMIT');
    }
    if(!response?.ok)throw Error(`HTTP_${response?.status}`);
    const reader=response.body.getReader();const chunks=[];let length=0;
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>10*1024*1024){await reader.cancel();throw Error('SPEC_SIZE_LIMIT');}chunks.push(Buffer.from(value));}
    const bytes=Buffer.concat(chunks);const spec=JSON.parse(bytes);if(!spec.paths||!spec.info)throw Error('NOT_A_COMPLETE_SPEC');
    const operations=contracts(spec,family);if(!operations.length)throw Error('EMPTY_SPEC');
    const file=`${family}-current.openapi.json`;fs.writeFileSync(path.join(out,file),bytes);
    results.push({family,source,retrieved_at_utc,status:'FETCHED',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),version:spec.info.version,operations:operations.length,file});
  } catch(error) {results.push({family,source,retrieved_at_utc,status:'UNAVAILABLE',reason:error.message});}
}
fs.writeFileSync(path.join(out,'fetch-results.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));
if(results.some(x=>x.status!=='FETCHED'))process.exitCode=1;
