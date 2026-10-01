import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const base=path.join(root,'docs/audits/2026-10-01-ozon-api-refresh');
const snapshot=JSON.parse(fs.readFileSync(path.join(base,'final-contract-finance/official-new-20-rendered.json'),'utf8'));
const writes=new Set(['ProductImportPicturesV2','ActionsProductsUpdate','ActionsAutoAddProductsUpdateV2','FbpOrderDirectTplDlvEdit']);
const destructive=new Set(['ActionsProductsDeactivate','ActionsAutoAddProductsDeleteV2']);
const jobs=new Set(['PostingFbsPackageLabelCreate']);
export function officialCurrentKeys(){const current=JSON.parse(fs.readFileSync(path.join(base,'final-contract-finance/official-current-normalized.json'),'utf8'));return new Set(current.operations.map(o=>`${o.family}|${o.method_id}|${o.http_method}|${o.path}`));}
export function schemaFromRenderedFields(fields){
  const properties={},required=[];
  for(const field of fields){
    if(!field||typeof field!=='object')throw Error('Lossy rendered schema');
    const material=field.material,head=material.split('\n')[0].replace(/^int\b/,'integer').replace(/^bool\b/,'boolean').replace(/^any <string>/,'string'),array=head.startsWith('Array of '),type=array?'array':head.match(/^(integer|string|object|boolean|number)\b/)?.[1];
    if(!type)throw Error('Unsupported rendered field '+field.name+': '+head);
    const spec={type};
    const description=field.description??material;
    spec.description=description;
    if(array){const itemType=head.match(/^Array of (strings|integers|objects|numbers)/)?.[1];if(!itemType)throw Error('Unsupported rendered array '+field.name);spec.items={type:{strings:'string',integers:'integer',objects:'object',numbers:'number'}[itemType]};if(field.children.length)spec.items=schemaFromRenderedFields(field.children);}
    else if(type==='object'&&field.children.length)Object.assign(spec,schemaFromRenderedFields(field.children));
    const range=head.match(/\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]/),max=head.match(/<=\s*(\d+)/),min=head.match(/>=\s*(\d+)/),minKey=array?'minItems':type==='string'?'minLength':'minimum',maxKey=array?'maxItems':type==='string'?'maxLength':'maximum';
    if(range){spec[minKey]=Number(range[1]);spec[maxKey]=Number(range[2]);}if(max)spec[maxKey]=Number(max[1]);if(min)spec[minKey]=Number(min[1]);
    const proseMin=description.match(/Миним(?:ум|альное значение)\s*[—–:-]?\s*(\d+)/i),proseMax=description.match(/Максим(?:ум|альное значение|альное количество)\s*[—–:-]?\s*(\d+)/i),proseRange=description.match(/(?:значени[яе]\s*[—–:]?\s*|значения\s*)от\s+(\d+)\s+до\s+(\d+)/i),arrayMax=array?description.match(/(?:передавать до|не более)\s+(\d+)\s+(?:значени|идентификатор|элемент)/i):null;
    if(proseMin)spec[minKey]=Number(proseMin[1]);if(proseMax)spec[maxKey]=Number(proseMax[1]);if(proseRange){spec[minKey]=Number(proseRange[1]);spec[maxKey]=Number(proseRange[2]);}if(arrayMax)spec.maxItems=Number(arrayMax[1]);
    const enumeration=material.match(/(?:Items )?Enum:([^\n]+)/);if(enumeration){let values=[...enumeration[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]);if(!values.length&&['integer','number'].includes(type))values=enumeration[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);if(values.length)(array?spec.items:spec).enum=values;}
    properties[field.name]=spec;if(field.required)required.push(field.name);
  }
  return {type:'object',properties,required,additionalProperties:false};
}
export function applyCurrentRenderedContracts(records){
  const current=JSON.parse(fs.readFileSync(path.join(base,'final-contract-finance/official-current-normalized.json'),'utf8'));
  const map=new Map(current.operations.map(o=>[`${o.family}|${o.method_id}|${o.http_method}|${o.path}`,o]));
  const admitted=new Set(JSON.parse(fs.readFileSync(path.join(root,'policies/ozon-read-allowlist.json'),'utf8')).map(o=>o.method_id));
  for(const record of records){
    const op=map.get(`${record.endpoint_group==='performance'?'performance':'seller'}|${record.method_id}|${record.http_method}|${record.path}`);
    if(!op)continue;
    record.source_version='OFFICIAL_RENDERED_DOCS;2026-10-01';record.source_hash=op.source_sha256;
    record.credential_family=op.family;
    record.rendered_contract={source_url:op.source_url,retrieved_at_utc:op.retrieved_at_utc,source_sha256:op.source_sha256,request_closed_schema_nodes:op.request_closed_schema_nodes};
    const description=op.source_material.split(/HEADER PARAMETERS|REQUEST BODY SCHEMA|PATH PARAMETERS|QUERY PARAMETERS/)[0];
    const retirement=description.split(/\n|(?<=\.)\s+/).find(line=>/метод/i.test(line)&&/отключ/i.test(line)&&!/параметр/i.test(line));
    const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const date=retirement?.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
    if(date&&months.includes(date[2])){
      const removed_at=`${date[3]}-${String(months.indexOf(date[2])+1).padStart(2,'0')}-${date[1].padStart(2,'0')}`;
      record.lifecycle={status:removed_at<='2026-10-01'?'removed':'deprecated',removed_at,replacement:[...new Set([...description.matchAll(/\/v\d+\/[a-z0-9_\/-]+/g)].map(m=>m[0]).filter(p=>p!==record.path))]};
      if(record.lifecycle.status==='removed')record.admission='denied';
    }
    if(admitted.has(record.method_id)&&record.admission!=='denied'){
      if(op.request_closed_schema_nodes!==0)throw Error('Incomplete current request schema '+record.method_id);
      record.input_schema=schemaFromRenderedFields(op.request_tables.flatMap(t=>t.fields));
    }
  }
  return records;
}
export function renderedAdditions(){return snapshot.operations.map(op=>{
  const text=op.text.replaceAll('\r','');const match=text.match(/\n(POST|GET|PUT|PATCH|DELETE)\n([^\n]+)/);
  if(!match)throw Error(`Missing official path ${op.method_id}`);
  const request=text.split('REQUEST BODY SCHEMA: application/json\n')[1]?.split('\nОтветы')[0]??'';
  const input_schema=schemaFromRenderedFields(op.request_tables.flatMap(t=>t.fields));
  const classification=writes.has(op.method_id)?'WRITE':destructive.has(op.method_id)?'DESTRUCTIVE':jobs.has(op.method_id)?'SEMANTIC_READ_JOB':'READ';
  const domain=match[2].includes('/actions/')?'advertising':match[2].includes('/analytics/')?'analytics':match[2].includes('/warehouse/')?'warehouses':match[2].includes('package-label')?'reports':'catalog';
  return {method_id:op.method_id,path:match[2],http_method:match[1],domain,endpoint_group:domain,classification,...(['READ','SEMANTIC_READ_JOB'].includes(classification)?{safety:'read'}:{}),reason:classification==='READ'?'Reviewed official data retrieval':classification==='SEMANTIC_READ_JOB'?'Official asynchronous label generation; no order status mutation':'Official seller-state mutation denied',permission:`${domain}.read`,...(['ActionsCandidates','ActionsProducts'].includes(op.method_id)?{pagination_contract:{kind:'last_id',response_field:'last_id'}}:op.method_id==='WarehouseRfbsReturnPointList'?{pagination_contract:{kind:'last_id',items_path:'points',last_item_field:'id'}}:op.method_id==='AnalyticsDecommissionedGoods'?{pagination_contract:{kind:'page'}}:{}),pagination:/cursor|last_id|offset|page_size/.test(request)?'bounded':'none',file_download:op.method_id==='PostingFbsPackageLabelGet',report_job:jobs.has(op.method_id),sensitive_data:false,summary:text.split('\n')[0],description:text.split('Описание и примерыКонсоль\n')[1]?.split(/HEADER PARAMETERS|REQUEST BODY SCHEMA/)[0]?.trim()??'',input_schema,source_version:'OFFICIAL_RENDERED_DOCS;2026-10-01',source_hash:crypto.createHash('sha256').update(text).digest('hex'),contract_review:{source:snapshot.source.split('#')[0]+'#operation/'+op.method_id,retrieved_at_utc:snapshot.retrieved_at_utc},response_schema_material:text.split('RESPONSE SCHEMA: application/json\n')[1]?.split('Примеры запроса')[0]??'',credential_family:'seller',admission:['READ','SEMANTIC_READ_JOB'].includes(classification)?'reviewed':'denied'};
});}
