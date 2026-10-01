import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const candidate='4e29543d05fbd9c0b322b756d87226c94edbb463';
export const commands=['npm run build','npm test','npm run policies:check','npm run baseline:check'];
export const sourcePaths=['src','policies','inventory','test','scripts','package.json','package-lock.json','MARKETPLACE_MCP_MANIFEST.yaml','MARKETPLACE_MCP_PASSPORT.md','Dockerfile','tsconfig.json'];
const evidenceScripts=['scripts/check-mos-mcp-boundary.mjs','scripts/probe-ozon-official-assets.mjs','scripts/record-ozon-release-gates.mjs','scripts/ozon-gate-attestation.mjs','scripts/test-ozon-gate-attestation.mjs','scripts/capture-ozon-gate-checks.mjs'];
export function candidateFiles(root){return execFileSync('git',['-C',root,'ls-tree','-r','--name-only',candidate,'--',...sourcePaths],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);}
export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function sourceFingerprint(root){
  const files=[...new Set([...candidateFiles(root),...evidenceScripts])].sort();
  const hash=crypto.createHash('sha256');
  for(const file of files)hash.update(file+'\0').update(fs.readFileSync(path.join(root,file))).update('\0');
  return hash.digest('hex');
}
export function assertCandidateSource(root){
  const files=candidateFiles(root);
  execFileSync('git',['-C',root,'diff','--quiet',candidate,'--',...files]);
  const current=execFileSync('git',['-C',root,'ls-files','--cached','--others','--exclude-standard','--',...sourcePaths],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  if(current.some(file=>!files.includes(file)&&!evidenceScripts.includes(file)))throw Error('Unexpected candidate source files');
}
export function verifyStage(evidence,{fingerprint,manifestHash}){
  const blocked={build:'BLOCKED',full_suite:'BLOCKED',policy:'BLOCKED',security:'BLOCKED',candidate_runtime_identity:'BLOCKED',candidate_publication:'BLOCKED'};
  if(!evidence||evidence.source_commit!==candidate||evidence.source_fingerprint!==fingerprint||!evidence.completed_at_utc)return blocked;
  const passed=command=>evidence.checks?.some(x=>x.command===command&&x.exit_code===0&&x.completed_at_utc&&/^[a-f0-9]{64}$/.test(x.stdout_sha256));
  const build=passed(commands[0]),suite=passed(commands[1]),policy=passed(commands[2])&&passed(commands[3]);
  const identity=evidence.loopback?.runtime_identity;
  const runtime=identity?.commit===candidate&&identity.version==='1.1.0-alpha.1'&&identity.manifest_sha256===manifestHash&&identity.mode==='READ_ONLY'&&identity.write_runtime_enabled===false;
  const publication=evidence.publication;
  const published=publication?.observed_sha===candidate&&publication.repository==='stitcman/marketplace-mcp'&&publication.branch==='codex/ozon-api-refresh-20261001'&&publication.reader==='GitHub MCP get_commit'&&publication.retrieved_at_utc;
  return {build:build?'PASS':'BLOCKED',full_suite:suite?'PASS':'BLOCKED',policy:policy?'PASS':'BLOCKED',security:suite&&policy?'PASS':'BLOCKED',candidate_runtime_identity:runtime?'PASS':'BLOCKED',candidate_publication:published?'PASS':'BLOCKED'};
}
export function readPinnedStage(file,expectedHash){
  if(!file||!/^[a-f0-9]{64}$/.test(expectedHash??''))return null;
  const bytes=fs.readFileSync(file);if(sha256(bytes)!==expectedHash)throw Error('Stage attestation hash mismatch');
  return JSON.parse(bytes);
}
