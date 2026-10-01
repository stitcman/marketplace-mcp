import json,subprocess,pathlib,hashlib,os
base=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
def run(*a): return subprocess.check_output(a,text=True).strip()
prod=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
image=json.loads(run('docker','image','inspect',prod['Image']))[0]
labels=prod['Config']['Labels']; config=pathlib.Path(labels['com.docker.compose.project.config_files'])
identity={'hostname':run('hostname'),'container_id':prod['Id'],'image_id':image['Id'],'RepoTags':image.get('RepoTags'),'RepoDigests':image.get('RepoDigests'),'compose_project':labels['com.docker.compose.project'],'compose_path':str(config),'compose_sha256':hashlib.sha256(config.read_bytes()).hexdigest(),'environment_keys':[x.split('=',1)[0] for x in prod['Config']['Env']],'networks':list(prod['NetworkSettings']['Networks']),'health':prod['State'].get('Health',{}).get('Status')}
env={x.split('=',1)[0]:x.split('=',1)[1] for x in prod['Config']['Env']}
identity['embedded_commit']=env.get('GIT_COMMIT')
identity['version']=json.loads(run('docker','exec','marketplace-mcp-router-1','cat','/app/package.json'))['version']
identity['manifest_sha256']=run('docker','exec','marketplace-mcp-router-1','sha256sum','/app/MARKETPLACE_MCP_MANIFEST.yaml').split()[0]
archive=base/'rollback/router-ffc7ef2.tar'
sha=hashlib.sha256()
with archive.open('rb') as f:
 while b:=f.read(1048576): sha.update(b)
identity['rollback']={'archive':str(archive),'bytes':archive.stat().st_size,'archive_sha256':sha.hexdigest(),'image_id':image['Id'],'digests':image.get('RepoDigests'),'image_present':run('docker','image','inspect','--format','{{.Id}}',image['Id'])==image['Id'],'load_command':'docker image load -i '+str(archive),'restore_command':'CREDENTIALS_DIRECTORY=/run/credentials/marketplace-mcp.service docker compose -p marketplace-mcp -f '+str(config)+' up -d --no-deps --pull never router','production_image_reference':image['RepoTags'][0]}
# Validate Compose expansion privately: no secret values leave the host.
compose_env=os.environ.copy();compose_env['CREDENTIALS_DIRECTORY']='/run/credentials/marketplace-mcp.service'
resolved=json.loads(subprocess.check_output(['docker','compose','-p','marketplace-mcp','-f',str(config),'config','--format','json'],env=compose_env,text=True))
identity['rollback']['compose_validation']=resolved['services']['router']['image']==image['RepoTags'][0]
(base/'evidence/production-identity.json').write_text(json.dumps(identity,indent=2))
print(json.dumps(identity,indent=2))
