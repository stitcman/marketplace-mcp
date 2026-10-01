import json,subprocess,pathlib
b=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
# Business payload travels only between local processes on the production host;
# it is not printed, logged, persisted, committed, or copied to the operator.
payload=subprocess.check_output(['docker','exec','marketplace-mcp-ozon-candidate-20261001','node','/gate/mos-payload.mjs'])
code="""import {OzonControlSyncParser} from '/app/modules/integration/src/ozon-control-sync.ts';let text='';for await(const chunk of process.stdin)text+=chunk;const out=[];for(const row of JSON.parse(text)){try{const p=new OzonControlSyncParser(row.capability).parse(Buffer.from(JSON.stringify(row.payload)));out.push({capability:row.capability,result:'PASS',records:p.records.length,next_cursor_present:Boolean(p.nextCursor)});}catch(e){out.push({capability:row.capability,result:'FAIL',error_kind:e.name});}}console.log(JSON.stringify({source:'actual running MOS API filesystem pure parser; no DB imports/runtime sync',candidate:'4e29543d05fbd9c0b322b756d87226c94edbb463',payload_source:'candidate real MCP READ, host-only memory pipe',results:out,mos_mutations:0}));"""
raw=subprocess.check_output(['docker','exec','-i','mos-pilot-b-api-1','node','--experimental-strip-types','--input-type=module','-e',code],input=payload)
r=json.loads(raw);(b/'evidence/mos-candidate-live-parser.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
