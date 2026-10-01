import sys,json,pathlib,subprocess
stage=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001/final-contract-finance/'+sys.argv[1][:12]+'')
run=lambda *args:subprocess.check_output(args,text=True).strip()
identity=json.loads((stage/'candidate-identity.json').read_text());candidate=json.loads(run('docker','inspect',identity['container']))[0];assert candidate['Id']==identity['container_id']
prod=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0];assert prod['Image']=='sha256:df5059c568ae3566f14c21e96268792d02496b90ae29646c059b318459cd6c7d'
cmd=prod['Config']['Cmd'][0].replace('node dist/index.js --http','node --import /gate/readonly-preload.mjs /gate/finance-live.mjs')
name='marketplace-mcp-ozon-finance-control-'+sys.argv[1][:12]+''
run('docker','create','--name',name,'--network','marketplace-mcp-internal','--read-only','--security-opt','no-new-privileges:true','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--memory','512m','--memory-swap','512m','--cpus','0.5','--pids-limit','128','--user','0:0','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','-e','MCP_PROBE_URL=http://'+identity['container']+':3000/mcp','-v','/run/credentials/marketplace-mcp.service:/run/secrets:ro','-v',str(stage/'probe')+':/gate:ro','--entrypoint','/bin/sh',identity['image_id'],'-eu','-c',cmd)
run('docker','network','connect','marketplace-mcp-egress',name)
run('docker','update','--memory','256m','--memory-swap','256m',identity['container'])
before=run('docker','exec',identity['container'],'cat','/sys/fs/cgroup/memory.events')
process=subprocess.run(['docker','start','-a',name],capture_output=True,text=True,timeout=900)
try:r=json.loads(process.stdout)
except Exception:r={'status':'FAIL','error':'CONTROL_NO_SANITIZED_JSON'}
control=json.loads(run('docker','inspect',name))[0];r['control_container_id']=control['Id'];r['control_memory_limit']=control['HostConfig']['Memory'];r['control_exit_code']=control['State']['ExitCode'];r['control_oom_killed']=control['State']['OOMKilled'];r['server_memory_limit']=json.loads(run('docker','inspect',identity['container']))[0]['HostConfig']['Memory'];r['server_memory_events_before']=before;r['server_memory_events_after']=run('docker','exec',identity['container'],'cat','/sys/fs/cgroup/memory.events');assert json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]['Id']==prod['Id'];r['production_unchanged']=True
(stage/'finance-separate-control.json').write_text(json.dumps(r,indent=2));print(json.dumps(r,indent=2))
