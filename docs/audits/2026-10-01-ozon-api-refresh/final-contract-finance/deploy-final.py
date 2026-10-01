import sys,json,pathlib,subprocess,hashlib,os,time,datetime
commit=sys.argv[1]
assert len(commit)==40 and all(c in '0123456789abcdef' for c in commit)
base=pathlib.Path('/opt/marketplace-mcp/release-closure-20261001');stage=base/'final-contract-finance'/commit[:12]
run=lambda *a:subprocess.check_output(a,text=True).strip()
env=os.environ.copy();env['CREDENTIALS_DIRECTORY']='/run/credentials/marketplace-mcp.service'
compose=pathlib.Path('/opt/marketplace-mcp/deployment/compose.yaml');baseline=base/'rollback/compose-baseline.yaml'
old=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
assert old['Id']=='c4c5d9d769cd093753105e3073b3a2e4bade29d5767414368f701b0f2cd777b5'
assert old['Image']=='sha256:df5059c568ae3566f14c21e96268792d02496b90ae29646c059b318459cd6c7d'
assert hashlib.file_digest((base/'rollback/router-ffc7ef2.tar').open('rb'),'sha256').hexdigest()=='a27c133b01ed6bb354283c686502dd3a4eab6c66dc8ce9e7630626ab5f491bf1'
assert hashlib.sha256(compose.read_bytes()).hexdigest()=='3f4a740316dc4e5b1d7fa22f296225004b19a3e1697e795f529c0dac0d79b94d'
assert compose.read_bytes()==baseline.read_bytes()
identity=json.loads((stage/'candidate-identity.json').read_text());assert identity['commit']==commit and identity['version']=='1.1.0'
for name in ['smoke-live','finance-separate-control','security-live','mos-candidate-live-parser']:
 assert json.loads((stage/(name+'.json')).read_text())['status']=='PASS',name
contract=json.loads((stage/'full-contract-validation.json').read_text());assert contract['counts']['total']==529 and contract['unsafe_admission']==0 and contract['unknown_classification']==0
protected={name:json.loads(run('docker','inspect',name))[0]['Id'] for name in ['mos-pilot-b-api-1','marketplace-mcp-postgres-1']}
image=identity['image_id'];assert run('docker','image','inspect','--format','{{.Id}}',image)==image
tag='marketplace-mcp/router-upstream:v1.1.0-'+commit[:7];run('docker','tag',image,tag)
cfg=lambda:json.loads(subprocess.check_output(['docker','compose','-p','marketplace-mcp','-f',str(compose),'config','--format','json'],env=env,text=True))
before=cfg();text=compose.read_text();needle='marketplace-mcp/router-upstream:ffc7ef2';assert text.count(needle)==1
result={'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runtime_commit':commit,'image_id':image,'image_tag':tag,'rollback_image_id':old['Image'],'rollback_archive':str(base/'rollback/router-ffc7ef2.tar'),'rollback_ready':True}
try:
 compose.write_text(text.replace(needle,tag));compose.chmod(0o600)
 after=cfg();after['services']['router']['image']=before['services']['router']['image'];assert before==after,'UNEXPECTED_COMPOSE_CHANGE'
 with (stage/'deployment.log').open('w') as log:subprocess.check_call(['docker','compose','-p','marketplace-mcp','-f',str(compose),'up','-d','--no-deps','--pull','never','router'],env=env,stdout=log,stderr=log)
 for attempt in range(20):
  prod=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]
  if prod['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(2)
 assert prod['Image']==image and prod['State']['Health']['Status']=='healthy'
 for name in ['smoke-live','finance-live','security-live']:
  control='marketplace-mcp-post-'+name+'-'+commit[:12]
  cmd=prod['Config']['Cmd'][0].replace('node dist/index.js --http','node --import /gate/readonly-preload.mjs /gate/'+name+'.mjs')
  run('docker','create','--name',control,'--network','marketplace-mcp-internal','--read-only','--security-opt','no-new-privileges:true','--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--memory','512m','--memory-swap','512m','--cpus','0.5','--pids-limit','128','--user','0:0','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=32m','-e','MCP_PROBE_URL=http://marketplace-mcp-router-1:3000/mcp','-v','/run/credentials/marketplace-mcp.service:/run/secrets:ro','-v',str(stage/'probe')+':/gate:ro','--entrypoint','/bin/sh',image,'-eu','-c',cmd)
  run('docker','network','connect','marketplace-mcp-egress',control)
  check=subprocess.run(['docker','start','-a',control],capture_output=True,text=True,timeout=900)
  try:report=json.loads(check.stdout)
  except Exception:report={'status':'FAIL','error':'NO_SANITIZED_CONTROLLER_RESULT','exit_code':check.returncode}
  (stage/('post-'+name+'.json')).write_text(json.dumps(report,indent=2))
  assert check.returncode==0 and report['status']=='PASS',name
  if name=='smoke-live':
   assert report['identity']['commit']==commit and report['identity']['version']=='1.1.0'
   assert all(label in [r['label'] for r in report['reads']] for label in ['prices v5 page 2','stocks v4 page 2','stocks rFBS','stocks FBO','stocks FBS','FBS v4','FBS unfulfilled','FBO v3'])
   assert not report['catalog']['write_tools']
  print('Post-deploy '+name+' PASS',flush=True)
 logs=subprocess.check_output(['docker','logs','--tail','200','marketplace-mcp-router-1'],stderr=subprocess.STDOUT)
 errors=[s for s in ['Fatal','FATAL','heap out of memory','ECONNREFUSED','uncaughtException'] if s.encode() in logs];assert not errors
 for name,cid in protected.items():assert json.loads(run('docker','inspect',name))[0]['Id']==cid
 prod=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0];im=json.loads(run('docker','image','inspect',image))[0]
 assert prod['State']['Health']['Status']=='healthy'
 result.update(status='PASS',deployment='DEPLOYED',post_deploy_smoke='PASS',container_id=prod['Id'],RepoTags=im['RepoTags'],RepoDigests=im.get('RepoDigests',[]),health='healthy',manifest_sha256=run('docker','exec','marketplace-mcp-router-1','sha256sum','/app/MARKETPLACE_MCP_MANIFEST.yaml').split()[0],compose_project=prod['Config']['Labels']['com.docker.compose.project'],compose_config_path=str(compose),compose_sha256=hashlib.sha256(compose.read_bytes()).hexdigest(),logs_sha256=hashlib.sha256(logs).hexdigest(),log_error_classes=errors,protected_container_ids=protected,WRITE_TOOLS_VISIBLE=0,WRITE_REQUESTS_SENT=0)
except Exception as error:
 result.update(status='FAIL',deployment='ROLLED_BACK',post_deploy_smoke='FAIL',error_kind=type(error).__name__)
 compose.write_bytes(baseline.read_bytes());compose.chmod(0o600)
 with (stage/'rollback-execution.log').open('w') as log:subprocess.check_call(['docker','compose','-p','marketplace-mcp','-f',str(compose),'up','-d','--no-deps','--pull','never','router'],env=env,stdout=log,stderr=log)
 result['rollback_restored_image']=json.loads(run('docker','inspect','marketplace-mcp-router-1'))[0]['Image'];assert result['rollback_restored_image']==old['Image']
finally:
 result['completed_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();(stage/'deployment-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if result['status']!='PASS':sys.exit(1)
