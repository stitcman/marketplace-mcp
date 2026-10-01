import sys,json,subprocess,pathlib
b=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001/final-contract-finance/'+sys.argv[1][:12]+'')
identity=json.loads((b/'candidate-identity.json').read_text())
prod=json.loads(subprocess.check_output(['docker','inspect','marketplace-mcp-router-1'],text=True))[0]
cmd=prod['Config']['Cmd'][0].replace('node dist/index.js --http','node --import /gate/readonly-preload.mjs /gate/mos-payload.mjs')
mos_before=json.loads(subprocess.check_output(['docker','inspect','mos-pilot-b-api-1'],text=True))[0]
# Business payload travels only between local processes on the production host;
# it is not printed, logged, persisted, committed, or copied to the operator.
payload=subprocess.check_output(['docker','exec',identity['container'],'/bin/sh','-eu','-c',cmd])
code="""import {OzonControlSyncParser} from '/app/modules/integration/src/ozon-control-sync.ts';let text='';for await(const chunk of process.stdin)text+=chunk;const out=[];for(const row of JSON.parse(text)){try{const p=new OzonControlSyncParser(row.capability).parse(Buffer.from(JSON.stringify(row.payload)));out.push({capability:row.capability,result:'PASS',records:p.records.length,next_cursor_present:Boolean(p.nextCursor)});}catch(e){out.push({capability:row.capability,result:'FAIL',error_kind:e.name});}}console.log(JSON.stringify({source:'actual running MOS API filesystem pure parser; no DB imports/runtime sync',candidate:'CANDIDATE_COMMIT',payload_source:'candidate real MCP READ, host-only memory pipe',results:out,mos_mutations:0}));"""
code=code.replace("CANDIDATE_COMMIT",sys.argv[1])
raw=subprocess.check_output(['docker','exec','-i','mos-pilot-b-api-1','node','--experimental-strip-types','--input-type=module','-e',code],input=payload)
r=json.loads(raw);after=json.loads(subprocess.check_output(['docker','inspect','mos-pilot-b-api-1'],text=True))[0];assert after['Id']==mos_before['Id'] and after['Image']==mos_before['Image'];r['mos_container_id']=after['Id'];r['mos_image_id']=after['Image'];r['status']='PASS' if all(x['result']=='PASS' for x in r['results']) else 'FAIL';(b/'mos-candidate-live-parser.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
