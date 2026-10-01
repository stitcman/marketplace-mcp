import assert from 'node:assert/strict';
import { MemoryStore } from '../src/core/store.js';
import { findReadMethod, isOzonMethodActive, requireReadMethod } from '../src/core/readPolicies.js';
import { executeApprovedReadPage } from '../src/core/readPolicy.js';
const store = new MemoryStore();
const conn = await store.addConnection({marketplace: 'ozon', name: 'synthetic contracts', status: 'active', mock: false, sandbox: false, permissions: ['finance.read','documents.read','catalog.read','warehouses.read']}, {client_id:'synthetic',api_key:'synthetic'});
let calls = 0;
let payload: unknown = {};
const transport = {async send() {calls++; return payload;}};
async function page(id: string, params: Record<string,unknown>) {
  const method = findReadMethod('ozon',id);
  assert(method, `${id} is allowed`);
  return executeApprovedReadPage({store,marketplace:'ozon',connectionId:conn.connection_id,method,params,transport});
}
let failures=0;
async function check(name: string, fn:()=>Promise<void>) {try{await fn();console.log(`PASS ${name}`);}catch(e){failures++;console.error(`FAIL ${name}: ${(e as Error).message}`);}}
await check('certificate products uses last product_id, not removed page/page_size',async()=>{
  payload={result:{items:[{product_id:123}],count:19}};
  const result=await page('CertificateProductsList',{certificate_id:1,limit:1});
  assert.deepEqual(result.continuation,{kind:'last_id',has_more:true,request_patch:{last_id:123}});
  const before=calls;
  await assert.rejects(page('CertificateProductsList',{certificate_id:1,page:1,page_size:1}), (e:any)=>e.code==='LOCAL_DENY');
  assert.equal(calls,before);
});
await check('finance by-day continuation follows last_id and preserves date',async()=>{
  payload={accruals:[{total_amount:{amount:'-1.25',currency:'RUB'}}],last_id:'next'};
  const result=await page('GetFinanceAccrualByDay',{date:'2026-09-30',last_id:''});
  assert.deepEqual(result.continuation,{kind:'last_id',has_more:true,request_patch:{last_id:'next'}});
});
await check('documented retired finance and logistics are absent from execution',async()=>{
  for(const id of ['FinanceAPI_FinanceTransactionListV3','SupplyOrderAPI_GetSupplyOrderTimeslots','PostingAPI_GetCarriageAvailableList']) assert.equal(findReadMethod('ozon',id),null,id);
});
await check('barcode generation is a product mutation and denied locally',async()=>{
  assert.equal(findReadMethod('ozon','generate-barcode'),null);
});
await check('scheduled removal respects the documented effective date',async()=>{
  const method=findReadMethod('ozon','PromosCandidates')!;
  assert.equal(isOzonMethodActive(method,new Date('2026-10-12T23:59:59Z')),true);
  assert.equal(isOzonMethodActive(method,new Date('2026-10-13T00:00:00Z')),false);
  assert.throws(()=>requireReadMethod('ozon','FinanceAPI_FinanceTransactionListV3'),/accrual\/by-day/);
});
if(failures) process.exitCode=1;
