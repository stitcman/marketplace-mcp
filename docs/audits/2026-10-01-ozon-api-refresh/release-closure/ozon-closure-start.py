import json,subprocess,pathlib
b=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
def run(*a): return subprocess.check_output(a,text=True).strip()
p=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
preload="""import {PgStore} from '/app/dist/core/store.js';
const u=new URL(process.env.DATABASE_URL);u.searchParams.set('options','-c default_transaction_read_only=on');process.env.DATABASE_URL=u.toString();
const original=PgStore.connect;PgStore.connect=async function(url){const store=await original.call(this,url);const r=await store.pool.query('SHOW transaction_read_only');if(r.rows[0].transaction_read_only!=='on')throw Error('READ_ONLY_DATABASE_REQUIRED');return store;};
PgStore.prototype.logToolCall=async function(log){globalThis.gateAudit??=[];globalThis.gateAudit.push({tool:log.tool,status:log.status,error_code:log.error_code});};
PgStore.prototype.addConnection=async function(){throw Error('LOCAL_WRITE_DENIED');};
"""
(b/'probe').mkdir(exist_ok=True);(b/'probe').chmod(0o755)
(b/'probe/readonly-preload.mjs').write_text(preload)
cmd=p['Config']['Cmd'][0].replace('node dist/index.js --http','node --import /gate/readonly-preload.mjs dist/index.js --http')
a=['docker','run','-d','--name','marketplace-mcp-ozon-candidate-20261001','--network','marketplace-mcp-internal','--read-only','--security-opt','no-new-privileges:true','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--memory','256m','--cpus','0.5','--pids-limit','128','--user','0:0','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','-p','127.0.0.1:19272:3000','-v','/run/credentials/marketplace-mcp.service:/run/secrets:ro','-v',str(b/'probe')+':/gate:ro','--entrypoint','/bin/sh','marketplace-mcp/ozon-isolated:4e29543','-eu','-c',cmd]
cid=run(*a)
run('docker','network','connect','marketplace-mcp-egress',cid)
image=json.loads(run('docker','image','inspect','marketplace-mcp/ozon-isolated:4e29543'))[0]
data={'container_id':cid,'image_id':image['Id'],'RepoTags':image.get('RepoTags'),'RepoDigests':image.get('RepoDigests'),'port':'127.0.0.1:19272','source_commit':'4e29543d05fbd9c0b322b756d87226c94edbb463','database_mode':'default_transaction_read_only=on; verified SHOW before startup','audit_sink':'memory; no production audit INSERT','secret_mount':'same production read-only mount; no plaintext exported','overlay':'readonly-preload.mjs; unmodified candidate dist/manifest'}
(b/'evidence/candidate-container.json').write_text(json.dumps(data,indent=2));print(json.dumps(data,indent=2))
