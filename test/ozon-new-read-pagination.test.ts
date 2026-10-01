import assert from 'node:assert/strict';
import {MemoryStore} from '../src/core/store.js';
import {requireReadMethod} from '../src/core/readPolicies.js';
import {executeApprovedReadPage,MAX_RESPONSE_BYTES} from '../src/core/readPolicy.js';
import {asToolResult,envelope} from '../src/core/respond.js';
const store=new MemoryStore();
const conn=await store.addConnection({marketplace:'ozon',name:'synthetic new contracts',status:'active',mock:false,sandbox:false,permissions:['advertising.read','analytics.read','warehouses.read','finance.read']},{client_id:'synthetic',api_key:'synthetic'});
let errors=0;
for(const [id,params,payload,patch] of [
 ['ActionsProducts',{action_id:1,limit:1,last_id:''},{products:[{id:1}],last_id:'next'},{last_id:'next'}],
 ['ActionsAutoAddProductsListV2',{action_id:1,auto_add_date:'2026-09-30T00:00:00Z',limit:1,offset:0},{products:[{id:1}],total:2},{offset:1}],
 ['AnalyticsDecommissionedGoods',{filter:{},page:0,page_size:1},{items:[{id:1}],total_count:1},{page:1}],
 ['WarehouseRfbsReturnPointList',{filters:{},limit:1,last_id:0},{points:[{id:12}]},{last_id:12}],
] as const){try{const page=await executeApprovedReadPage({store,marketplace:'ozon',connectionId:conn.connection_id,method:requireReadMethod('ozon',id),params,transport:{async send(){return payload;}}});assert.equal(page.continuation.has_more,true,id);assert.deepEqual(page.continuation.request_patch,patch,id);const nextParams={...params,...page.continuation.request_patch};let secondCalls=0;const second=await executeApprovedReadPage({store,marketplace:'ozon',connectionId:conn.connection_id,method:requireReadMethod('ozon',id),params:nextParams,transport:{async send(){secondCalls++;return {products:[],points:[],items:[],total_count:0,last_id:''};}}});assert.equal(secondCalls,1);assert.equal(second.continuation.has_more,false);console.log('PASS '+id+' documented pagination two pages');}catch(error){errors++;console.error('FAIL '+id+': '+(error as Error).message);}}
try {
 const method=requireReadMethod('ozon','GetFinanceAccrualPostings');const rows=Array.from({length:20},(_,i)=>({posting_number:String(i),accruals:[{detail:'\"'.repeat(6000)}]}));
 const params:Record<string,unknown>={posting_numbers:['synthetic']};const output:any[]=[];let calls=0;
 for(let n=0;n<100;n++){const page=await executeApprovedReadPage({store,marketplace:'ozon',connectionId:conn.connection_id,method,params,transport:{async send(input){assert.equal(input.params.mcp_cursor,undefined);calls++;return {posting_accruals:rows};}}});assert(Buffer.byteLength(JSON.stringify(asToolResult(envelope(page.payload,{marketplace:'ozon',connectionId:conn.connection_id,continuation:page.continuation}))))<MAX_RESPONSE_BYTES);output.push(...(page.payload as any).posting_accruals);if(!page.continuation.has_more)break;Object.assign(params,page.continuation.request_patch);assert(n<99);}
 assert.deepEqual(output,rows);assert.equal(calls,1);console.log('PASS complete MCP postings ceiling, lossless chunks, HTTP READ only');
}catch(error){errors++;console.error('FAIL postings ceiling: '+(error as Error).message);}
if(errors)process.exitCode=1;
