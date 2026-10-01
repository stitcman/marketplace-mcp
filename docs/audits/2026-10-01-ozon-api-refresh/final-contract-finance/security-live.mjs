import fs from 'node:fs';
import {exactTotals as totals,reconcilePostingDay} from './finance-reconcile.mjs';
import assert from 'node:assert/strict';
import {Client} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {PgStore} from '/app/dist/core/store.js';
const report={started_at_utc:new Date().toISOString(),write_requests_sent:0,target:'isolated candidate',date:'2026-09-30'};
const client=new Client({name:'ozon-finance-reconciliation',version:'1.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_PROBE_URL??'http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:'Bearer '+process.env.MCP_AUTH_TOKEN}}}));
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
  const ids=JSON.parse(fs.readFileSync('/gate/denied-method-ids.json','utf8'));let denials=0;
  for(const method_id of ids)for(const name of ['ozon_read_execute','ozon_read_file']){const result=await client.callTool({name,arguments:{connection_id,method_id,params:{}}});assert(result.isError);assert.equal(body(result).error.code,'LOCAL_DENY');denials++;}
  for(const name of ['ozon_read_execute','ozon_read_file'])for(const params of [{task_id:1,url:'https://example.invalid'},{task_id:1,filter:{headers:{Authorization:'synthetic'}}},{task_id:1,filter:{endpoint_group:'performance'}}]){const result=await client.callTool({name,arguments:{connection_id,method_id:'PostingFbsPackageLabelGet',params}});assert(result.isError);assert.equal(body(result).error.code,'LOCAL_DENY');denials++;}
  report.local_deny_responses=denials;report.scope='real candidate MCP execute/file/report local denials; immutable source transport-spy proves denial before upstream';report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.name;}await client.close();console.log(JSON.stringify(report,null,2));if(report.status!=='PASS')process.exitCode=1;
