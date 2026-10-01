import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readPinnedStage,sourceFingerprint,verifyStage,sha256,assertCandidateSource} from './ozon-gate-attestation.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'docs/audits/2026-10-01-ozon-api-refresh/release-gate-followup');
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const write=(file,value)=>fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2)+'\n');
const inventory=read('inventory/ozon-operations.json');
const allowed=new Set(read('policies/ozon-read-allowlist.json').map(x=>x.method_id));
const old=JSON.parse(execFileSync('git',['-C',root,'show','ffc7ef2465e3df84d6be6fb5aba4015d170b2d61:policies/ozon-read-allowlist.json'],{encoding:'utf8'}));
const previousCoverage=read('docs/audits/2026-10-01-ozon-api-refresh/endpoint-coverage.json').records;
const live=read('docs/audits/2026-10-01-ozon-api-refresh/release-gate-followup/live-evidence.json');
const [attestationPath,attestationHash]=process.argv.slice(2);
let stage=null;
try{assertCandidateSource(root);stage=readPinnedStage(attestationPath,attestationHash);}catch(error){console.error(error.message);}
const verified=verifyStage(stage,{fingerprint:sourceFingerprint(root),manifestHash:sha256(fs.readFileSync(path.join(root,'MARKETPLACE_MCP_MANIFEST.yaml')))});
const coverage=inventory.map(method=>{
  const prior=previousCoverage.find(x=>x.method_id===method.method_id&&x.path_after===method.path);
  const observed=live.live_reads.find(x=>x.method===method.method_id);
  const currentDoc=method.contract_review||['GetFinanceAccrualByDay','GetFinanceAccrualPostings','GetFinanceAccrualTypes'].includes(method.method_id);
  return {endpoint:method.path,method_id:method.method_id,family:method.endpoint_group==='performance'?'performance':'seller',version:method.path.match(/^\/v(\d+)\//)?.[1]??null,safety_class:method.classification,local_allowlist_status:allowed.has(method.method_id)?'ALLOWED':'DENIED',documentation_status:currentDoc?'TARGETED_OFFICIAL_DOC_VERIFIED':'CURRENT_FULL_SCHEMA_UNVERIFIED',contract_test_status:prior?.contract_tested?'TARGETED_PASS':'NOT_TESTED',live_test_status:observed?.result??'NOT_REPEATED_THIS_STAGE',candidate_live_test_status:'BLOCKED_NO_ISOLATED_REAL_CONNECTION',replacement:method.lifecycle?.replacement??[],deprecation:method.lifecycle?.status??null,last_verified_date:observed?.fetched_at??(currentDoc?'2026-10-01':null)};
});
write('endpoint-matrix.json',{as_of_utc:new Date().toISOString(),scope:'HISTORICAL_INVENTORY_WITH_TARGETED_CURRENT_CHECKS_NOT_COMPLETE_OFFICIAL_SNAPSHOT',all_methods_current:false,records:coverage});
write('method-diff.json',{candidate:'4e29543d05fbd9c0b322b756d87226c94edbb463',baseline:'ffc7ef2465e3df84d6be6fb5aba4015d170b2d61',added:0,changed:18,retired:inventory.filter(x=>x.lifecycle?.status==='removed').map(x=>({id:x.method_id,path:x.path,replacement:x.lifecycle.replacement})),removed_from_allowlist:old.filter(x=>!allowed.has(x.method_id)).map(x=>({id:x.method_id,path:x.path})),implementation_changes_this_stage:0});
const gates=[
  ['build',verified.build],['full_suite',verified.full_suite],['policy',verified.policy],['security',verified.security],['write_tools_visible',verified.security==='PASS'&&verified.candidate_runtime_identity==='PASS'?'PASS':'BLOCKED',0],['write_requests_sent',verified.security,0],
  ...['prices','stocks','fbs_orders','fbo_orders'].map(x=>[x+'_candidate_live','BLOCKED','No isolated real connection available']),
  ['finance_reconciliation','BLOCKED','by-day/postings INVALID_ARGUMENT on current server; control total unavailable'],
  ['mos_compatibility','BLOCKED','Offline boundary PASS; actual production consumer/runtime binding unavailable'],
  ['candidate_runtime_identity',verified.candidate_runtime_identity,'Loopback process, not container'],['production_runtime_identity','BLOCKED','SSH pinned host key mismatch'],
  ['rollback_ready','BLOCKED','Current production container/image/Compose unavailable'],['candidate_publication',verified.candidate_publication,'Independent GitHub MCP readback in pinned stage attestation'],
];
write('production-gates.json',{as_of_utc:new Date().toISOString(),checks_completed_at_utc:stage?.completed_at_utc??null,stage_attestation:attestationPath??null,stage_attestation_sha256:attestationHash??null,status:'PARTIAL',deployment:'BLOCKED',rollback_ready:false,all_methods_current:false,post_deploy_smoke:'NOT_RUN',gates:gates.map(([gate,result,evidence])=>({gate,result,evidence:evidence??null}))});
console.log(JSON.stringify({records:coverage.length,allowlist_removed:old.filter(x=>!allowed.has(x.method_id)).length,blocked_gates:gates.filter(x=>x[1]==='BLOCKED').length,deployment:'BLOCKED'}));
if(gates.some(x=>x[1]!=='PASS'))process.exitCode=1;
