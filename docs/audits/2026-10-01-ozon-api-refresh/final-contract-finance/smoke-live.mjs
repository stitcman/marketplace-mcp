import assert from 'node:assert/strict';
import {Client} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {getReadPolicy} from '/app/dist/core/readPolicies.js';
const report={started_at_utc:new Date().toISOString(),target:'isolated candidate',reads:[],write_requests_sent:0};
const client=new Client({name:'ozon-release-closure',version:'1.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_PROBE_URL??'http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:'Bearer '+process.env.MCP_AUTH_TOKEN}}}));
const tools=(await client.listTools()).tools;
report.catalog={count:tools.length,write_tools:tools.filter(t=>/^(create|update|delete|remove|set|import|cancel|ship|approve)_|_(create|update|delete|remove|set|import|cancel|ship|approve)$/.test(t.name)).map(t=>t.name)};
function body(r){if(r.structuredContent)return r.structuredContent;for(const c of r.content??[])if(c.type==='text'){try{return JSON.parse(c.text)}catch{}}return null}
async function call(name,args,label=name){try{const r=await client.callTool({name,arguments:args});const b=body(r);const d=b?.data;const items=d?.items??d?.result?.items??d?.result?.postings??d?.postings??(Array.isArray(d?.result)?d.result:null);report.reads.push({label,tool:name,method_id:args.method_id??null,result:r.isError?'FAIL':'PASS',error_code:r.isError?b?.error?.code??b?.error_code??b?.code??'UNKNOWN':null,source:b?.meta?.source??null,count:Array.isArray(items)?items.length:null,has_more:b?.meta?.continuation?.has_more??Boolean(b?.meta?.next_cursor),data_keys:d&&typeof d==='object'?Object.keys(d):[],at_utc:new Date().toISOString()});return b;}catch(e){report.reads.push({label,result:'FAIL',error_kind:e.name});return null}}
report.identity=(await call('marketplace_runtime_identity',{}))?.data;
const list=await call('connections_list',{});const arr=list?.data?.items??list?.data?.connections??(Array.isArray(list?.data)?list.data:[]);const conn=arr.find(x=>x.marketplace==='ozon'&&!x.mock&&!x.sandbox&&x.status==='active'&&x.name?.toLocaleLowerCase()==='\u044f\u0441\u043d\u044b \u043e\u0447\u0438');
if(!conn){report.connection='BLOCKED_NO_REAL_CONNECTION';console.log(JSON.stringify(report));await client.close();process.exit(1)}
const connection_id=conn.connection_id;report.connection={active:true,mock:false,sandbox:false};
const p1=await call('ozon_prices_get',{connection_id,limit:1},'prices v5 page 1');if(p1?.meta?.next_cursor)await call('ozon_prices_get',{connection_id,limit:1,cursor:p1.meta.next_cursor},'prices v5 page 2');
const s1=await call('ozon_stocks_get',{connection_id,limit:1,contract_version:'v2',fulfillment_model:'all'},'stocks v4 page 1');if(s1?.meta?.next_cursor)await call('ozon_stocks_get',{connection_id,limit:1,contract_version:'v2',fulfillment_model:'all',cursor:s1.meta.next_cursor},'stocks v4 page 2');
const rf=await call('ozon_stocks_get',{connection_id,limit:100,contract_version:'v2',fulfillment_model:'rFBS'},'stocks rFBS');report.rfbs_observed=(rf?.data?.items??[]).length;
const policy=getReadPolicy('ozon');async function raw(path,params,label){const m=policy.find(x=>x.path===path);if(!m){report.reads.push({label,result:'BLOCKED_LOCAL_POLICY'});return null;}return call('ozon_read_execute',{connection_id,method_id:m.method_id,params},label)}
const dates={since:'2026-09-28T00:00:00Z',to:'2026-10-01T00:00:00Z'};
const fbs=await raw('/v4/posting/fbs/list',{filter:dates,limit:1,sort_dir:'ASC'},'FBS v4');
await raw('/v4/posting/fbs/unfulfilled/list',{filter:{cutoff_from:dates.since,cutoff_to:dates.to},limit:1,sort_dir:'ASC'},'FBS unfulfilled');
await raw('/v3/posting/fbo/list',{filter:dates,limit:1,sort_dir:'ASC'},'FBO v3');
await raw('/v1/finance/accrual/types',{},'finance accrual types');
await raw('/v1/roles',{},'roles');
for(const fulfillment_model of ['FBO','FBS'])await call('ozon_stocks_get',{connection_id,limit:100,contract_version:'v2',fulfillment_model},'stocks '+fulfillment_model);
report.status=report.reads.every(x=>x.result==='PASS')&&report.reads.some(x=>x.label==='prices v5 page 2')&&report.reads.some(x=>x.label==='stocks v4 page 2')&&report.rfbs_observed>0&&report.catalog.write_tools.length===0?'PASS':'FAIL';
report.completed_at_utc=new Date().toISOString();await client.close();console.log(JSON.stringify(report,null,2));
if(report.status!=='PASS')process.exitCode=1;
