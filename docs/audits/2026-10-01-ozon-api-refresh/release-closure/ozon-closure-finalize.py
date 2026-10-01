import json,pathlib,subprocess,hashlib,shutil,os
b=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001')
def run(*a,**kw):return subprocess.check_output(a,text=True,**kw).strip()
prior=json.loads((b/'evidence/production-identity.json').read_text());p=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
assert p['Id']==prior['container_id'] and p['Image']==prior['image_id']
snapshot=b/'rollback/compose-baseline.yaml'
if not snapshot.exists():shutil.copyfile(prior['compose_path'],snapshot)
snapshot.chmod(0o600)
snapshot_sha=hashlib.sha256(snapshot.read_bytes()).hexdigest()
assert snapshot_sha==prior['compose_sha256'],'BASELINE_COMPOSE_DRIFT'
archive=pathlib.Path(prior['rollback']['archive']);sha=hashlib.sha256()
with archive.open('rb') as stream:
 while block:=stream.read(1048576):sha.update(block)
assert sha.hexdigest()==prior['rollback']['archive_sha256'],'ROLLBACK_ARCHIVE_DRIFT'
load_output=run('docker','image','load','-i',str(archive))
loaded=json.loads(run('docker','image','inspect',prior['RepoTags'][0]))[0]
load_verified=loaded['Id']==prior['image_id'] and loaded.get('RepoDigests')==prior['RepoDigests'] and 'Loaded image:' in load_output
assert load_verified,'ROLLBACK_LOAD_IDENTITY_MISMATCH'
env=os.environ.copy();env['CREDENTIALS_DIRECTORY']='/run/credentials/marketplace-mcp.service'
dry=run('docker','compose','--dry-run','-p','marketplace-mcp','-f',str(snapshot),'up','-d','--no-deps','--pull','never','router',env=env,stderr=subprocess.STDOUT)
candidate=json.loads(run('docker','inspect','marketplace-mcp-ozon-candidate-20261001'))[0]
logs=run('docker','logs','--tail','20','marketplace-mcp-ozon-candidate-20261001',stderr=subprocess.STDOUT)
logmeta={'lines':len(logs.splitlines()),'error_lines':sum('error' in x.lower() for x in logs.splitlines()),'sha256':hashlib.sha256(logs.encode()).hexdigest()}
run('docker','stop','--time','10','marketplace-mcp-ozon-candidate-20261001')
after=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
unchanged=after['Id']==prior['container_id'] and after['Image']==prior['image_id']
ready=load_verified and snapshot_sha==prior['compose_sha256'] and 'DRY-RUN MODE' in dry and unchanged
report={'rollback_ready':ready,'image_load_verified':load_verified,'load_output':load_output,'loaded_image_id':loaded['Id'],'loaded_RepoDigests':loaded.get('RepoDigests'),'image_id':prior['image_id'],'image_digest':prior['RepoDigests'][0],'archive':prior['rollback']['archive'],'archive_sha256':sha.hexdigest(),'compose_snapshot':str(snapshot),'compose_snapshot_sha256':snapshot_sha,'compose_dry_run':dry,'restore_command':'CREDENTIALS_DIRECTORY=/run/credentials/marketplace-mcp.service docker compose -p marketplace-mcp -f '+str(snapshot)+' up -d --no-deps --pull never router','load_command':prior['rollback']['load_command'],'restore_scope':'router only; no down, no volumes, no PostgreSQL/MOS recreation','baseline_unchanged':unchanged,'production_health':after['State']['Health']['Status'],'candidate_state':json.loads(run('docker','inspect','marketplace-mcp-ozon-candidate-20261001'))[0]['State']['Status'],'candidate_logs':logmeta,'deployment':'BLOCKED','post_deploy_smoke':'NOT_RUN'}
(b/'evidence/rollback-and-final-state.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
