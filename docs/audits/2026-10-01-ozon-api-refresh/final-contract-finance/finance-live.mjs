import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Client} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {PgStore} from '/app/dist/core/store.js';
const report={started_at_utc:new Date().toISOString(),write_requests_sent:0,target:'isolated candidate',date:'2026-09-30'};
const client=new Client({name:'ozon-finance-reconciliation',version:'1.0'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:'Bearer '+fs.readFileSync('/run/secrets/mcp_auth','utf8').trim()}}}));
function body(result){return result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);}
async function call(name,args){const result=await client.callTool({name,arguments:args});const b=body(result);if(result.isError)throw Error(b.error?.code??'MCP_ERROR');return b;}
let store;
try {
  report.runtime_identity=(await call('marketplace_runtime_identity',{})).data;
  const tools=(await client.listTools()).tools;report.write_tools_visible=tools.filter(t=>/^(create|update|delete|remove|set|import|cancel|ship|approve)_|_(create|update|delete|remove|set|import|cancel|ship|approve)$/.test(t.name)).length;assert.equal(report.write_tools_visible,0);
  const connections=(await call('connections_list',{})).data;
  const list=connections.items??connections.connections??connections;
  const conn=list.find(c=>c.marketplace==='ozon'&&!c.mock&&!c.sandbox&&c.status==='active'&&c.name?.toLocaleLowerCase()==='ясны очи');
  assert(conn,'NAMED_REAL_CONNECTION_REQUIRED');
  const connection_id=conn.connection_id;
  store=await PgStore.connect(process.env.DATABASE_URL);const credentials=await store.getCredentials(connection_id);
  report.performance=credentials.performance_access_token?'CREDENTIAL_PRESENT_NOT_TESTED':'NOT_APPLICABLE_NO_CREDENTIALS';
  // Independent bounded direct control: no MCP normalization/chunking; credentials stay in this host process.
  async function direct(path,params){assert(['/v1/finance/accrual/by-day','/v1/finance/accrual/postings'].includes(path));
    const response=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Client-Id':credentials.client_id,'Api-Key':credentials.api_key},body:JSON.stringify(params),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('DIRECT_HTTP_'+response.status);
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16*1024*1024){await reader.cancel();throw Error('DIRECT_FINITE_LIMIT');}chunks.push(Buffer.from(r.value));}}finally{reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'),(_k,v,c)=>typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v)?c.source:v);
  }
  function totals(rows,getMoney){const sums=new Map();for(const row of rows){const m=getMoney(row);assert(m&&typeof m.amount==='string'&&typeof m.currency==='string','EXACT_MONEY_REQUIRED');const match=m.amount.match(/^(-?)(\d+)(?:\.(\d+))?$/);assert(match,'DECIMAL_MONEY_REQUIRED');const scale=(match[3]??'').length;const value=BigInt(match[2]+(match[3]??''))*(match[1]?-1n:1n);const old=sums.get(m.currency)??{value:0n,scale};const common=Math.max(scale,old.scale);sums.set(m.currency,{value:old.value*10n**BigInt(common-old.scale)+value*10n**BigInt(common-scale),scale:common});}return Object.fromEntries([...sums].sort().map(([c,{value,scale}])=>{const sign=value<0n?'-':'';const digits=(value<0n?-value:value).toString().padStart(scale+1,'0');return[c,sign+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits)];}));}
  const rows=[],mcpUpstream=[],directRows=[],directUpstream=[];let params={date:report.date,last_id:''};let chunks=0,upstream=0,maxMcpBytes=0;
  for(let n=0;n<10000;n++){
    const r=await client.callTool({name:'ozon_read_execute',arguments:{connection_id,method_id:'GetFinanceAccrualByDay',params}});maxMcpBytes=Math.max(maxMcpBytes,Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result:r})));assert(maxMcpBytes<=256*1024);
    const b=body(r);if(r.isError)throw Error(b.error?.code??'FINANCE_BY_DAY_ERROR');rows.push(...b.data.accruals);chunks++;
    const continuation=b.meta.continuation;
    if(continuation.phase==='UPSTREAM_LAST_ID'){upstream++;mcpUpstream.push(b.data.last_id);}
    if(!continuation.has_more)break;
    params={...params,...continuation.request_patch};assert.equal(params.date,report.date);assert(n<9999,'MCP_FINANCE_LOOP_LIMIT');
  }
  let last_id='';const seen=new Set();
  for(let n=0;n<1000;n++){const data=await direct('/v1/finance/accrual/by-day',{date:report.date,last_id});directRows.push(...data.accruals);directUpstream.push(data.last_id);if(!data.last_id)break;assert(!seen.has(data.last_id),'DIRECT_CURSOR_REPEAT');seen.add(data.last_id);last_id=data.last_id;assert(n<999,'DIRECT_PAGE_LIMIT');}
  assert.deepEqual(mcpUpstream,directUpstream,'Exact upstream cursor traversal');assert.deepEqual(rows,directRows,'Every complete finance record must match direct Ozon control');
  const ids=rows.map(r=>String(r.accrual_id));assert.equal(new Set(ids).size,ids.length,'Unique accrual IDs');
  const postingRows=rows.filter(r=>r.accrued_category==='POSTING');const postingNumbers=[...new Set(postingRows.map(r=>r.unit_number))];assert(postingNumbers.every(x=>typeof x==='string'&&x.length>0));
  const candidatePostings=[],directPostings=[];let batches=0;
  for(let i=0;i<postingNumbers.length;i+=10){const request={posting_numbers:postingNumbers.slice(i,i+10)};candidatePostings.push(...(await call('ozon_read_execute',{connection_id,method_id:'GetFinanceAccrualPostings',params:request})).data.posting_accruals);directPostings.push(...(await direct('/v1/finance/accrual/postings',request)).posting_accruals);batches++;}
  assert(postingNumbers.length>0,'REAL_POSTING_REQUIRED');assert.deepEqual(candidatePostings,directPostings,'Posting finance must exactly match separate direct control');
  const sum=totals(rows,r=>r.total_amount),control=totals(directRows,r=>r.total_amount);assert.deepEqual(sum,control);
  report.finance_by_day={status:'PASS',upstream_pages:upstream,local_chunks:chunks,records:rows.length,unique_accrual_ids:new Set(ids).size,posting_linked:postingRows.length,non_posting:rows.length-postingRows.length,money_totals:sum,max_mcp_bytes:maxMcpBytes};
  report.finance_postings={status:'PASS',posting_numbers:postingNumbers.length,batches,records:candidatePostings.length};
  report.finance_reconciliation={status:'PASS',candidate_reconstructed_totals:sum,direct_control_totals:control,difference:Object.fromEntries(Object.keys(sum).map(c=>[c,'0'])),exact_records:true,exact_ids:true,exact_cursor_traversal:true,exact_postings:true,semantic_difference:'By-day includes POSTING/ITEM/NON_ITEM/CONTAINER_FEES for one accrual date. Postings returns posting-specific accrual history for supplied posting numbers; their all-date totals are not asserted equal to day-wide totals.'};
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.name==='AssertionError'?'ASSERTION_FAILED':String(error.message).replace(/[^A-Z0-9_]/g,'').slice(0,100);}
finally{await store?.pool.end();}
await client.close();report.completed_at_utc=new Date().toISOString();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
