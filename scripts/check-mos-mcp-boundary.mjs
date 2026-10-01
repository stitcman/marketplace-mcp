// Offline only: reads MOS source and exercises its pure parser. No database or network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { MemoryStore } from '../src/core/store.ts';
import { executeApprovedReadPage } from '../src/core/readPolicy.ts';
const root=path.resolve(import.meta.dirname,'..');
const mos=path.resolve(process.argv[2]??'C:/MOS-worktrees/integration');
const candidate='4e29543d05fbd9c0b322b756d87226c94edbb463';
const old=JSON.parse(execFileSync('git',['-C',root,'show','ffc7ef2465e3df84d6be6fb5aba4015d170b2d61:policies/ozon-read-allowlist.json'],{encoding:'utf8'}));
const current=JSON.parse(fs.readFileSync(path.join(root,'policies/ozon-read-allowlist.json'),'utf8'));
const {OzonControlSyncParser}=await import(pathToFileURL(path.join(mos,'modules/integration/src/ozon-control-sync.ts')).href);
const files=['official-ozon-request-contracts.ts','ozon-seller-http-transport.ts','ozon-control-sync.ts','ozon-control-sync-acceptance.ts'].map(name=>path.join(mos,'modules/integration/src',name));
const hashes=()=>files.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
const beforeHashes=hashes();
const scan=spawnSync('rg',['-l','ozon_prices_get|ozon_stocks_get|ozon_orders_list|ozon_read_execute|meta\\.continuation|@modelcontextprotocol','modules','apps','packages','scripts','-g','*.ts','-g','*.tsx','-g','*.mjs','-g','!*.test.*'],{cwd:mos,encoding:'utf8'});
if(![0,1].includes(scan.status))throw Error(`Consumer scan failed: ${scan.stderr}`);
const consumerFiles=scan.stdout.trim().split(/\r?\n/).filter(Boolean);
const store=new MemoryStore();
const conn=await store.addConnection({marketplace:'ozon',name:'synthetic boundary',status:'active',mock:false,sandbox:false,permissions:['catalog.read','prices.read','stocks.read','warehouses.read','orders.read']},{client_id:'synthetic',api_key:'synthetic'});
const product={product_id:1,offer_id:'SYNTHETIC',price:{price:'1.25',currency_code:'RUB',declared_price:{amount:'0.00',currency:'RUB'}}};
const stocks={...product,stocks:[{type:'fbo',present:2,reserved:1},{type:'fbs',present:3,reserved:0},{type:'rfbs',present:4,reserved:0}]};
const posting={posting_number:'SYNTHETIC',status:'delivered',products:[{quantity:2,price:{amount:'1.25',currency:'RUB'}},{quantity:1,price:{amount:'0.00',currency:'RUB'}}]};
const cases=[
  ['ProductAPI_GetProductInfoPrices','catalog.prices',{filter:{visibility:'ALL'},limit:1},{items:[product],cursor:'next',total_items:5}],
  ['ProductAPI_GetProductInfoStocks','inventory.stock_totals',{filter:{visibility:'ALL'},limit:1},{items:[stocks],cursor:'next',total_items:5}],
  ...[['PostingFbsList','commerce.fbs_postings'],['PostingFboList','commerce.fbo_postings'],['PostingFbsUnfulfilledList','commerce.fbs_unfulfilled']].map(([method,capability])=>[method,capability,{limit:1,sort_dir:'ASC',filter:method==='PostingFbsUnfulfilledList'?{cutoff_from:'2026-09-30T00:00:00Z',cutoff_to:'2026-10-01T00:00:00Z'}:{since:'2026-09-30T00:00:00Z',to:'2026-10-01T00:00:00Z'}},{postings:[posting],cursor:'next',has_next:true}]),
];
const results=[];
for(const [method_id,capability,params,payload] of cases){
  const pages=[];
  for(const methods of [old,current]){
    const method=methods.find(x=>x.method_id===method_id);assert(method);
    pages.push(await executeApprovedReadPage({store,marketplace:'ozon',connectionId:conn.connection_id,method,params,transport:{async send(){return structuredClone(payload);}}}));
  }
  assert.deepEqual(pages[0].payload,pages[1].payload,`${method_id}: raw data OLD -> NEW unchanged`);
  const parser=new OzonControlSyncParser(capability);
  const parsed=pages.map(page=>parser.parse(new TextEncoder().encode(JSON.stringify(page.payload))));
  assert.deepEqual(parsed[0],parsed[1]);assert.equal(parsed[1].nextCursor,'next');
  results.push({method_id,capability,result:'PASS_SYNTHETIC_RAW_AND_PARSER_COMPARISON',records:parsed[1].records.length,next_cursor_preserved:true});
}
assert.deepEqual(beforeHashes,hashes(),'MOS source unchanged');
const out={as_of_utc:new Date().toISOString(),candidate,mos_commit:execFileSync('git',['-C',mos,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_hashes:beforeHashes,actual_mcp_consumer_files:consumerFiles,checked_source_uses:'Own Seller SourceContract transport; no MCP consumer discovered',offline_boundary:consumerFiles.length?'BLOCKED_DISCOVERED_CONSUMER_REQUIRES_REVIEW':'PASS',mos_compatibility:'BLOCKED_RUNTIME_BINDING_UNVERIFIED',production_runtime_inspected:false,results,network_requests:0,mos_mutations:0,finance_and_reports:'No active request builder; finance explicitly blocked in MOS acceptance limitations'};
out.comparison_scope='OLD/NEW policy records through the current generic executor and the actual MOS pure parser; not a comparison of two running server binaries';
fs.writeFileSync(path.join(root,'docs/audits/2026-10-01-ozon-api-refresh/release-gate-followup/mos-compatibility.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({offline_boundary:out.offline_boundary,mos_compatibility:out.mos_compatibility,cases:results.length,network_requests:0,mos_mutations:0}));
