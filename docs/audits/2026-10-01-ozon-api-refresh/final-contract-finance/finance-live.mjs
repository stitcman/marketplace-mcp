import {exactTotals as totals,reconcilePostingDay} from './finance-reconcile.mjs';
import assert from 'node:assert/strict';
import {Client} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {PgStore} from '/app/dist/core/store.js';
const report={started_at_utc:new Date().toISOString(),write_requests_sent:0,target:'isolated candidate',date:'2026-09-30'};
const client=new Client({name:'ozon-finance-reconciliation',version:'1.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_PROBE_URL??'http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:'Bearer '+process.env.MCP_AUTH_TOKEN}}}));
function body(result){return result.structuredContent??JSON.parse(result.content.find(x=>x.type==='text').text);}
async function call(name,args){const result=await client.callTool({name,arguments:args});const b=body(result);report.max_packed_call_bytes=Math.max(report.max_packed_call_bytes??0,Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result})));assert(report.max_packed_call_bytes<=256*1024,'FULL_MCP_CEILING');if(result.isError)throw Error(b.error?.code??'MCP_ERROR');return b;}
let store;
try {
  report.runtime_identity=(await call('marketplace_runtime_identity',{})).data;
  const tools=(await client.listTools()).tools;report.write_tools_visible=tools.filter(t=>/^(create|update|delete|remove|set|import|cancel|ship|approve)_|_(create|update|delete|remove|set|import|cancel|ship|approve)$/.test(t.name)).length;assert.equal(report.write_tools_visible,0);
  const connections=(await call('connections_list',{})).data;
  const list=connections.items??connections.connections??connections;
  const conn=list.find(c=>c.marketplace==='ozon'&&!c.mock&&!c.sandbox&&c.status==='active'&&c.name?.toLocaleLowerCase()==='ясны очи');
  assert(conn,'NAMED_REAL_CONNECTION_REQUIRED');
  const connection_id=conn.connection_id;
  store=await PgStore.connect(process.env.DATABASE_URL);report.database_transaction_readonly=(await store.pool.query('SHOW transaction_read_only')).rows[0].transaction_read_only;assert.equal(report.database_transaction_readonly,'on');const credentials=await store.getCredentials(connection_id);
  report.performance=credentials.performance_access_token?'CREDENTIAL_PRESENT_NOT_TESTED':'NOT_APPLICABLE_NO_CREDENTIALS';
  // Independent bounded direct control: no MCP normalization/chunking; credentials stay in this host process.
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function direct(path,params){await pause(1200);report.phase='direct:'+path;assert(['/v1/finance/accrual/by-day','/v1/finance/accrual/postings'].includes(path));
    let response;for(let attempt=0;attempt<4;attempt++){response=await fetch('https://api-seller.ozon.ru'+path,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Client-Id':credentials.client_id,'Api-Key':credentials.api_key},body:JSON.stringify(params),signal:AbortSignal.timeout(30000)});if(response.status!==429)break;report.rate_limit_retries=(report.rate_limit_retries??0)+1;const retry=response.headers.get('retry-after'),seconds=retry?Number(retry):10*(attempt+1);await response.body?.cancel();if(attempt===3||!Number.isFinite(seconds)||seconds>60)throw Error('DIRECT_RATE_LIMIT_BLOCKED');await pause(Math.max(10*(attempt+1),seconds)*1000);}
    if(!response.ok)throw Error('DIRECT_HTTP_'+response.status);
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16*1024*1024){await reader.cancel();throw Error('DIRECT_FINITE_LIMIT');}chunks.push(Buffer.from(r.value));}}finally{reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'),(_k,v,c)=>typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v)?c.source:v);
  }
  const rows=[],mcpUpstream=[],directRows=[],directUpstream=[];let params={date:report.date,last_id:''};let chunks=0,upstream=0,maxMcpBytes=0;
  for(let n=0;n<10000;n++){
    const r=await client.callTool({name:'ozon_read_execute',arguments:{connection_id,method_id:'GetFinanceAccrualByDay',params}});maxMcpBytes=Math.max(maxMcpBytes,Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result:r})));assert(maxMcpBytes<=256*1024);
    const b=body(r);if(r.isError)throw Error(b.error?.code??'FINANCE_BY_DAY_ERROR');rows.push(...b.data.accruals);chunks++;
    const continuation=b.meta.continuation;
    if(continuation.phase==='UPSTREAM_LAST_ID'){upstream++;mcpUpstream.push(b.data.last_id);}
    if(!continuation.has_more)break;
    params={...params,...continuation.request_patch};assert.equal(params.date,report.date);assert(n<9999,'MCP_FINANCE_LOOP_LIMIT');
  }
  report.finance_by_day_progress={records:rows.length,local_chunks:chunks,upstream_pages:upstream,max_mcp_bytes:maxMcpBytes};
  let last_id='';const seen=new Set();
  for(let n=0;n<1000;n++){const data=await direct('/v1/finance/accrual/by-day',{date:report.date,last_id});directRows.push(...data.accruals);directUpstream.push(data.last_id);if(!data.last_id)break;assert(!seen.has(data.last_id),'DIRECT_CURSOR_REPEAT');seen.add(data.last_id);last_id=data.last_id;assert(n<999,'DIRECT_PAGE_LIMIT');}
  assert.deepEqual(mcpUpstream,directUpstream,'Exact upstream cursor traversal');assert.deepEqual(rows,directRows,'Every complete finance record must match direct Ozon control');
  const ids=rows.map(r=>String(r.accrual_id));assert.equal(new Set(ids).size,ids.length,'Unique accrual IDs');
  const postingRows=rows.filter(r=>r.accrued_category==='POSTING');const postingNumbers=[...new Set(postingRows.map(r=>r.unit_number))];assert(postingNumbers.every(x=>typeof x==='string'&&x.length>0));
  const daySum=totals(rows,r=>r.total_amount);report.finance_by_day={status:'PASS',upstream_pages:upstream,local_chunks:chunks,records:rows.length,unique_accrual_ids:new Set(ids).size,posting_linked:postingRows.length,non_posting:rows.length-postingRows.length,money_totals:daySum,max_mcp_bytes:maxMcpBytes,direct_exact_records:true,direct_exact_cursors:true};
  const candidatePostings=[],directPostings=[];let batches=0;
  let postingChunks=0;
  async function candidatePosting(request){let params={...request},all=[];for(let n=0;n<1000;n++){report.phase='candidate:postings';const b=await call('ozon_read_execute',{connection_id,method_id:'GetFinanceAccrualPostings',params});all.push(...b.data.posting_accruals);postingChunks++;if(!b.meta.continuation.has_more)return all;params={...params,...b.meta.continuation.request_patch};}throw Error('POSTINGS_CHUNK_LIMIT');}
  assert(postingNumbers.length>0,'REAL_POSTING_REQUIRED');
  const single={posting_numbers:[postingNumbers[0]]};
  assert.deepEqual(await candidatePosting(single),(await direct('/v1/finance/accrual/postings',single)).posting_accruals,'Single real posting direct control');
  report.single_posting='PASS';
  for(let i=0;i<postingNumbers.length;i+=100){await pause(1200);const request={posting_numbers:postingNumbers.slice(i,i+100)};candidatePostings.push(...await candidatePosting(request));directPostings.push(...(await direct('/v1/finance/accrual/postings',request)).posting_accruals);batches++;report.finance_postings_progress={batches,posting_numbers_completed:Math.min(i+100,postingNumbers.length),total_posting_numbers:postingNumbers.length,records:candidatePostings.length,local_chunks:postingChunks};}
  assert(postingNumbers.length>0,'REAL_POSTING_REQUIRED');assert.deepEqual(candidatePostings,directPostings,'Posting finance must exactly match separate direct control');
  const sum=totals(rows,r=>r.total_amount),control=totals(directRows,r=>r.total_amount);assert.deepEqual(sum,control);
  report.finance_by_day={status:'PASS',upstream_pages:upstream,local_chunks:chunks,records:rows.length,unique_accrual_ids:new Set(ids).size,posting_linked:postingRows.length,non_posting:rows.length-postingRows.length,money_totals:sum,max_mcp_bytes:maxMcpBytes};
  const types=(await call('ozon_read_execute',{connection_id,method_id:'GetFinanceAccrualTypes',params:{}})).data.accrual_types;report.relevant_accrual_types=types.filter(t=>[3,17,29,32,69,94].includes(t.id));
  const crossEndpoint=reconcilePostingDay(postingRows,candidatePostings,report.date,types);report.cross_endpoint=crossEndpoint;assert.equal(crossEndpoint.status,'PASS','CROSS_ENDPOINT_MONEY_MISMATCH');
  report.finance_postings={status:'PASS',local_chunks:postingChunks,posting_numbers:postingNumbers.length,batches,records:candidatePostings.length};
  report.finance_reconciliation={status:'PASS',candidate_reconstructed_totals:sum,direct_control_totals:control,difference:Object.fromEntries(Object.keys(sum).map(c=>[c,'0'])),exact_records:true,exact_ids:true,exact_cursor_traversal:true,exact_postings:true,cross_endpoint:crossEndpoint};
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.name==='AssertionError'?'ASSERTION_FAILED':String(error.message).replace(/[^A-Z0-9_]/g,'').slice(0,100);}
finally{await store?.pool.end();}
await client.close();report.probe_peak_rss_kib=process.resourceUsage().maxRSS;report.completed_at_utc=new Date().toISOString();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
