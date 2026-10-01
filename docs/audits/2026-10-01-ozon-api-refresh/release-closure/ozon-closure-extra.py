import pathlib,json,subprocess
b=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
def run(*a):return subprocess.check_output(a,text=True).strip()
p=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
cmd=p['Config']['Cmd'][0];cmd=cmd[:cmd.index('exec su node')]+'exec node --import /gate/readonly-preload.mjs /gate/credentials.mjs'
cred=json.loads(run('docker','exec','marketplace-mcp-ozon-candidate-20261001','/bin/sh','-eu','-c',cmd))
(b/'evidence/credential-presence.json').write_text(json.dumps(cred,indent=2));print(json.dumps(cred))
mos=[]
for name in ['mos-pilot-b-api-1','mos-pilot-b-worker-1','mos-pilot-b-web-1']:
 c=json.loads(run('docker','inspect',name))[0];labels=c['Config'].get('Labels',{});env={x.split('=',1)[0]:x.split('=',1)[1] for x in c['Config']['Env']}
 mos.append({'name':name,'container_id':c['Id'],'image_id':c['Image'],'health':c['State'].get('Health',{}).get('Status'),'compose_path':labels.get('com.docker.compose.project.config_files'),'source_commit_labels':{k:v for k,v in labels.items() if k in ['org.opencontainers.image.revision','org.opencontainers.image.version']},'source_commit_env':{k:v for k,v in env.items() if k in ['GIT_COMMIT','RELEASE_SHA','COMMIT_SHA','SOURCE_COMMIT']},'mcp_environment_keys':[k for k in env if 'MCP' in k.upper()],'mount_destinations':[x['Destination'] for x in c['Mounts']]})
(b/'evidence/mos-runtime.json').write_text(json.dumps({'inspection':'docker inspect only; no MOS exec/mutation','containers':mos,'compatibility':'BLOCKED_NO_SOURCE_COMMIT_OR_PROVEN_MCP_CONSUMER_BINDING'},indent=2));print(json.dumps(mos,indent=2))
