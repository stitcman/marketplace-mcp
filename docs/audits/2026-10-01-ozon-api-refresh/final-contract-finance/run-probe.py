import json,pathlib,subprocess,sys
assert len(sys.argv[2])==40 and all(c in '0123456789abcdef' for c in sys.argv[2])
stage=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001/final-contract-finance')/sys.argv[2][:12]
identity=json.loads((stage/'candidate-identity.json').read_text())
probe=sys.argv[1]
assert probe in ['finance-live','smoke-live','mos-payload']
prod=json.loads(subprocess.check_output(['docker','inspect','marketplace-mcp-router-1'],text=True))[0]
assert prod['Image']=='sha256:df5059c568ae3566f14c21e96268792d02496b90ae29646c059b318459cd6c7d'
cmd=prod['Config']['Cmd'][0].replace('node dist/index.js --http','node --import /gate/readonly-preload.mjs /gate/'+probe+'.mjs')
result=subprocess.run(['docker','exec',identity['container'],'/bin/sh','-eu','-c',cmd],capture_output=True,text=True,timeout=900)
try:
 report=json.loads(result.stdout)
except Exception:
 report={'status':'FAIL','error':'PROBE_NO_SANITIZED_JSON','exit_code':result.returncode,'known_error_classes':[code for code in ['EACCES','ENOENT','ECONNREFUSED','ERR_MODULE_NOT_FOUND','SyntaxError','TypeError','AUTH_FAILED','Connection refused'] if code in result.stderr]}
(stage/(probe+'.json')).write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
sys.exit(result.returncode)
