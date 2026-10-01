import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MemoryStore } from '../src/core/store.js';
import { registerReadTools } from '../src/adapters/common/readTools.js';
const store=new MemoryStore();
const conn=await store.addConnection({marketplace:'ozon',name:'synthetic denial',status:'active',mock:false,sandbox:false,permissions:['catalog.read','stocks.read','warehouses.read','orders.read','prices.read','reports.read']},{client_id:'synthetic',api_key:'synthetic'});
const handlers=new Map<string,any>();
registerReadTools({registerTool(name:string,_config:any,handler:any){handlers.set(name,handler);}} as any,store,'ozon');
const before=globalThis.fetch;
let requests=0;
globalThis.fetch=async()=>{requests++;throw Error('Forbidden transport reached');};
try {
  const inventory=JSON.parse(fs.readFileSync(new URL('../inventory/ozon-operations.json',import.meta.url),'utf8'));
  let denials=0;
  for(const method of inventory.filter((x:any)=>['WRITE','DESTRUCTIVE'].includes(x.classification)||x.admission==='denied')) {
    const result=await handlers.get('ozon_read_execute')({connection_id:conn.connection_id,method_id:method.method_id,params:{}});
    assert.equal(JSON.parse(result.content[0].text).error.code,'LOCAL_DENY',method.method_id);denials++;
  }
  for(const params of [{url:'https://example.invalid'}, {authorization:'synthetic'}, {filter:{visibility:'ALL',api_key:'synthetic'},limit:1}, {filter:{visibility:'ALL',connection_id:'another-account'},limit:1}]) {
    const result=await handlers.get('ozon_read_execute')({connection_id:conn.connection_id,method_id:'ProductAPI_GetProductInfoPrices',params});
    assert.equal(JSON.parse(result.content[0].text).error.code,'LOCAL_DENY');
  }
  const unknown=await handlers.get('ozon_read_execute')({connection_id:conn.connection_id,method_id:'UNKNOWN',params:{}});
  assert.equal(JSON.parse(unknown.content[0].text).error.code,'LOCAL_DENY');
  assert.equal(requests,0);
  console.log(`PASS ${denials} forbidden/retired Ozon operations + unknown and nested credential/account substitutions; HTTP_REQUESTS_SENT=0`);
} finally {globalThis.fetch=before;}
