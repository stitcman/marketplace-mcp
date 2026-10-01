import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {candidate,commands,sha256,sourceFingerprint,assertCandidateSource} from './ozon-gate-attestation.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'docs/audits/2026-10-01-ozon-api-refresh/release-gate-followup');
const read=file=>JSON.parse(fs.readFileSync(path.join(out,file),'utf8'));
if(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==candidate)throw Error('Candidate SHA drift before attestation');
assertCandidateSource(root);
const source_fingerprint=sourceFingerprint(root);const checks=[];
for(const command of commands){
  const started_at_utc=new Date().toISOString();
  const r=spawnSync('cmd.exe',['/d','/c',command],{cwd:root,encoding:'utf8',timeout:300_000,maxBuffer:4*1024*1024});
  const result={command,started_at_utc,completed_at_utc:new Date().toISOString(),exit_code:r.status,stdout_sha256:sha256(r.stdout??''),stderr_sha256:sha256(r.stderr??''),runner_error:r.error?.code??null};
  checks.push(result);console.log(JSON.stringify(result));if(r.status!==0)break;
}
if(source_fingerprint!==sourceFingerprint(root))throw Error('Source changed during gate capture');
const evidence={source_commit:candidate,source_fingerprint,completed_at_utc:new Date().toISOString(),checks,loopback:read('isolated-runtime.json'),publication:read('github-publication.json')};
const file=`stage-checks-${evidence.completed_at_utc.replace(/[^0-9]/g,'')}.json`;
const bytes=JSON.stringify(evidence,null,2)+'\n';fs.writeFileSync(path.join(out,file),bytes,{flag:'wx'});
console.log(JSON.stringify({attestation:path.join(out,file),sha256:sha256(bytes)}));
if(checks.length!==commands.length||checks.some(x=>x.exit_code!==0))process.exitCode=1;
