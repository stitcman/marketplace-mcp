import subprocess,json,pathlib
b=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
code="""const fs=require('fs'),crypto=require('crypto');const names=['official-ozon-request-contracts.ts','ozon-seller-http-transport.ts','ozon-control-sync.ts','ozon-control-sync-acceptance.ts'];const hashes={};for(const n of names){const p='/app/modules/integration/src/'+n;hashes[n]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}console.log(JSON.stringify({hashes}));"""
r=json.loads(subprocess.check_output(['docker','exec','mos-pilot-b-api-1','node','-e',code],text=True));(b/'evidence/mos-source-hashes.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
