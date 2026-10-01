import json, pathlib, subprocess, hashlib, os, sys
commit=sys.argv[1]
assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
base=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
stage=base/'final-contract-finance'
stage.mkdir(exist_ok=True)
def run(*args): return subprocess.check_output(args,text=True).strip()
prod=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
assert prod['Id']=='c4c5d9d769cd093753105e3073b3a2e4bade29d5767414368f701b0f2cd777b5'
assert prod['Image']=='sha256:df5059c568ae3566f14c21e96268792d02496b90ae29646c059b318459cd6c7d'
archive=base/'rollback/router-ffc7ef2.tar'
assert hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()=='a27c133b01ed6bb354283c686502dd3a4eab6c66dc8ce9e7630626ab5f491bf1'
assert run('docker','image','inspect','--format','{{.Id}}',prod['Image'])==prod['Image']
compose=base/'rollback/compose-baseline.yaml'
env=os.environ.copy();env['CREDENTIALS_DIRECTORY']='/run/credentials/marketplace-mcp.service'
subprocess.check_output(['docker','compose','--dry-run','-p','marketplace-mcp','-f',str(compose),'up','-d','--no-deps','--pull','never','router'],env=env,stderr=subprocess.STDOUT)
source=stage/('source-'+commit[:12]);source.mkdir(exist_ok=False)
subprocess.check_call(['tar','-xf','/tmp/ozon-final-candidate.tar','-C',str(source)])
tag='marketplace-mcp/ozon-isolated:'+commit[:12]
with (stage/'build.log').open('w') as log:
 subprocess.check_call(['docker','build','--build-arg','GIT_COMMIT='+commit,'-t',tag,str(source)],stdout=log,stderr=log)
probe=stage/'probe';probe.mkdir(exist_ok=True);probe.chmod(0o755)
(probe/'readonly-preload.mjs').write_bytes((base/'probe/readonly-preload.mjs').read_bytes())
cmd=prod['Config']['Cmd'][0].replace('node dist/index.js --http','node --import /gate/readonly-preload.mjs dist/index.js --http')
name='marketplace-mcp-ozon-final-'+commit[:12]
cid=run('docker','run','-d','--name',name,'--network','marketplace-mcp-internal','--read-only','--security-opt','no-new-privileges:true','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--memory','256m','--cpus','0.5','--pids-limit','128','--user','0:0','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','-p','127.0.0.1:19273:3000','-v','/run/credentials/marketplace-mcp.service:/run/secrets:ro','-v',str(probe)+':/gate:ro','--entrypoint','/bin/sh',tag,'-eu','-c',cmd)
run('docker','network','connect','marketplace-mcp-egress',cid)
image=json.loads(run('docker','image','inspect',tag))[0]
after=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
assert after['Id']==prod['Id'] and after['Image']==prod['Image']
result={'commit':commit,'container':name,'container_id':cid,'image_id':image['Id'],'RepoTags':image['RepoTags'],'RepoDigests':image.get('RepoDigests',[]),'version':json.loads(run('docker','exec',name,'cat','/app/package.json'))['version'],'manifest_sha256':run('docker','exec',name,'sha256sum','/app/MARKETPLACE_MCP_MANIFEST.yaml').split()[0],'port':'127.0.0.1:19273','rollback':'READY','production_unchanged':True,'database':'readonly; audit sink memory','build_log_sha256':hashlib.file_digest((stage/'build.log').open('rb'),'sha256').hexdigest()}
(stage/'candidate-identity.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
