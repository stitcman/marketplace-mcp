import {exactTotals as totals,reconcilePostingDay} from './finance-reconcile.mjs';
import assert from 'node:assert/strict';
import {Client} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import {PgStore} from '/app/dist/core/store.js';
const report={started_at_utc:new Date().toISOString(),write_requests_sent:0,target:'isolated candidate',date:'2026-09-30'};
const client=new Client({name:'ozon-finance-reconciliation',version:'1.0'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:'Bearer '+process.env.MCP_AUTH_TOKEN}}}));
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
  const types=(await call('ozon_read_execute',{connection_id,method_id:'GetFinanceAccrualTypes',params:{}})).data.accrual_types;report.types_sample=types.slice(0,3);report.relevant=types.filter(t=>[3,17,29,32,69,94].includes(Number(t.id??t.type_id)));report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.name;}await client.close();console.log(JSON.stringify(report,null,2));
