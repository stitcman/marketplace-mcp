import subprocess,json,pathlib
stage=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001/final-contract-finance/fae5ae77cd22')
code=pathlib.Path('/tmp/ozon-mos-finance-scan.mjs').read_text()
r=json.loads(subprocess.check_output(['docker','exec','mos-pilot-b-api-1','node','--input-type=module','-e',code],text=True))
(stage/'mos-finance-consumer.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
