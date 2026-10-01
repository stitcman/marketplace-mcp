import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'docs/audits/2026-10-01-ozon-api-refresh');
const snapshot=JSON.parse(fs.readFileSync(path.join(base,'final-contract-finance/official-new-20-rendered.json'),'utf8'));
const writes=new Set(['ProductImportPicturesV2','ActionsProductsUpdate','ActionsAutoAddProductsUpdateV2','FbpOrderDirectTplDlvEdit']);
const destructive=new Set(['ActionsProductsDeactivate','ActionsAutoAddProductsDeleteV2']);
const jobs=new Set(['PostingFbsPackageLabelCreate']);
export function officialCurrentKeys(){return new Set(['seller','performance'].flatMap(family=>fs.readFileSync(path.join(base,`release-closure/${family}-dom.tsv`),'utf8').trim().split(/\r?\n/).map(line=>`${family}|${line}`)));}
export function renderedAdditions(){return snapshot.operations.map(op=>{
  const text=op.text.replaceAll('\r','');const match=text.match(/\n(POST|GET|PUT|PATCH|DELETE)\n([^\n]+)/);
  if(!match)throw Error(`Missing official path ${op.method_id}`);
  const request=text.split('REQUEST BODY SCHEMA: application/json\n')[1]?.split('\nОтветы')[0]??'';
  const properties={},required=[];
  const field=/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\n(?:(required)\s*\n)?\s*(Array of (?:strings|integers|objects)|integer|string|object|boolean|number)([^\n]*)/gm;
  for(const m of request.matchAll(field)){
    const spec={type:m[3].startsWith('Array')?'array':m[3]};
    if(spec.type==='array')spec.items={type:m[3].endsWith('strings')?'string':m[3].endsWith('integers')?'integer':'object'};
    const range=m[4].match(/\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]/),max=m[4].match(/<=\s*(\d+)/);
    if(range){spec[spec.type==='array'?'minItems':'minimum']=Number(range[1]);spec[spec.type==='array'?'maxItems':'maximum']=Number(range[2]);}
    if(max)spec[spec.type==='array'?'maxItems':'maximum']=Number(max[1]);
    const tail=request.slice(m.index+m[0].length).split('\n\n')[0];const enumeration=tail.match(/Enum:([^\n]+)/);
    if(enumeration)spec.enum=[...enumeration[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);
    properties[m[1]]=spec;if(m[2])required.push(m[1]);
  }
  const classification=writes.has(op.method_id)?'WRITE':destructive.has(op.method_id)?'DESTRUCTIVE':jobs.has(op.method_id)?'SEMANTIC_READ_JOB':'READ';
  const domain=match[2].includes('/actions/')?'advertising':match[2].includes('/analytics/')?'analytics':match[2].includes('/warehouse/')?'warehouses':match[2].includes('package-label')?'reports':'catalog';
  return {method_id:op.method_id,path:match[2],http_method:match[1],domain,endpoint_group:domain,classification,...(['READ','SEMANTIC_READ_JOB'].includes(classification)?{safety:'read'}:{}),reason:classification==='READ'?'Reviewed official data retrieval':classification==='SEMANTIC_READ_JOB'?'Official asynchronous label generation; no order status mutation':'Official seller-state mutation denied',permission:`${domain}.read`,...(['ActionsCandidates','ActionsProducts'].includes(op.method_id)?{pagination_contract:{kind:'last_id',response_field:'last_id'}}:op.method_id==='WarehouseRfbsReturnPointList'?{pagination_contract:{kind:'last_id',items_path:'points',last_item_field:'id'}}:op.method_id==='AnalyticsDecommissionedGoods'?{pagination_contract:{kind:'page'}}:{}),pagination:/cursor|last_id|offset|page_size/.test(request)?'bounded':'none',file_download:op.method_id==='PostingFbsPackageLabelGet',report_job:jobs.has(op.method_id),sensitive_data:false,summary:text.split('\n')[0],description:text.split('Описание и примерыКонсоль\n')[1]?.split(/HEADER PARAMETERS|REQUEST BODY SCHEMA/)[0]?.trim()??'',input_schema:{type:'object',properties,required,additionalProperties:false},source_version:'OFFICIAL_RENDERED_DOCS;2026-10-01',source_hash:crypto.createHash('sha256').update(text).digest('hex'),contract_review:{source:snapshot.source+'#operation/'+op.method_id,retrieved_at_utc:snapshot.retrieved_at_utc},response_schema_material:text.split('RESPONSE SCHEMA: application/json\n')[1]?.split('Примеры запроса')[0]??'',credential_family:'seller',admission:['READ','SEMANTIC_READ_JOB'].includes(classification)?'reviewed':'denied'};
});}
