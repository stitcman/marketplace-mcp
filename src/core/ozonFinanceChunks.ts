import { createHash, randomBytes } from 'node:crypto';
import { MpError } from './errors.js';
import type { ApprovedReadPage, ReadContinuation } from './readPolicy.js';
import { asToolResult, envelope } from './respond.js';

export const MAX_FINANCE_UPSTREAM_BYTES=16*1024*1024;
const MCP_BYTES=256*1024;
const TTL=10*60*1000;
const CACHE_BYTES=64*1024*1024;
type Entry={binding:string;expires:number;bytes:number;pages:ApprovedReadPage[]};
/** Process-local only: no database, file, or external storage writes. */
export class OzonFinanceChunks {
  private entries=new Map<string,Entry>();
  constructor(private now:()=>number=Date.now){}
  binding(connectionId:string,methodId:string,params:Record<string,unknown>){
    return createHash('sha256').update(JSON.stringify([connectionId,methodId,Object.entries(params).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');
  }
  private prune(){for(const [key,value] of this.entries)if(value.expires<=this.now())this.entries.delete(key);}
  resume(token:unknown,binding:string):ApprovedReadPage {
    if(typeof token!=='string'||!/^ofc_[a-f0-9]{48}_[1-9][0-9]{0,5}$/.test(token))throw new MpError('LOCAL_DENY','Malformed local finance cursor');
    this.prune();
    const split=token.lastIndexOf('_'),key=token.slice(0,split),index=Number(token.slice(split+1));
    const entry=this.entries.get(key);
    if(!entry)throw new MpError('STALE_DATA','Local finance cursor expired or runtime restarted; retry the original upstream page',{retryable:true});
    if(entry.binding!==binding||!entry.pages[index])throw new MpError('LOCAL_DENY','Local finance cursor binding or index mismatch');
    return structuredClone(entry.pages[index]);
  }
  split(payload:unknown,continuation:ReadContinuation,binding:string,connectionId:string,params:Record<string,unknown>):ApprovedReadPage {
    const fits=(page:ApprovedReadPage)=>Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:'x'.repeat(256),result:asToolResult(envelope(page.payload,{marketplace:'ozon',connectionId,continuation:page.continuation}))}))<=MCP_BYTES-8192;
    const normal={payload,continuation};
    if(fits(normal))return normal;
    const source=payload as any;
    if(!source||!Array.isArray(source.accruals))throw new MpError('BULK_LIMIT_EXCEEDED','Finance response is not a chunkable accrual list');
    const bytes=Buffer.byteLength(JSON.stringify(payload));
    if(bytes>MAX_FINANCE_UPSTREAM_BYTES)throw new MpError('BULK_LIMIT_EXCEEDED','Finance upstream response exceeds the finite 16 MiB limit');
    this.prune();
    if([...this.entries.values()].reduce((n,e)=>n+e.bytes,0)+bytes*3>CACHE_BYTES||this.entries.size>=32)throw new MpError('BULK_LIMIT_EXCEEDED','Local finance chunk cache is full; retry after cursor TTL',{retryable:true});
    const key='ofc_'+randomBytes(24).toString('hex');
    const pages:ApprovedReadPage[]=[];
    let start=0;
    while(start<source.accruals.length){
      const local:ReadContinuation={kind:'local_chunk',has_more:true,request_patch:{mcp_cursor:`${key}_${pages.length+1}`},phase:'LOCAL_CHUNK'};
      let low=start,high=source.accruals.length;
      while(low<high){const mid=Math.ceil((low+high)/2);if(fits({payload:{...source,accruals:source.accruals.slice(start,mid)},continuation:local}))low=mid;else high=mid-1;}
      if(low===start)throw new MpError('BULK_LIMIT_EXCEEDED','One accrual record exceeds the complete MCP response ceiling');
      pages.push({payload:{...source,accruals:source.accruals.slice(start,low)},continuation:local});start=low;
    }
    if(!pages.length)throw new MpError('BULK_LIMIT_EXCEEDED','Finance metadata exceeds the complete MCP response ceiling');
    pages.at(-1)!.continuation={...continuation,phase:'UPSTREAM_LAST_ID',request_patch:continuation.has_more?{date:params.date,...continuation.request_patch,mcp_cursor:null}:null};
    if(!pages.every(fits))throw new MpError('BULK_LIMIT_EXCEEDED','Finance continuation exceeds the MCP ceiling');
    const cost=Buffer.byteLength(JSON.stringify(pages))*3;
    if([...this.entries.values()].reduce((n,e)=>n+e.bytes,0)+cost>CACHE_BYTES)throw new MpError('BULK_LIMIT_EXCEEDED','Local finance cache byte ceiling exceeded',{retryable:true});
    this.entries.set(key,{binding,expires:this.now()+TTL,bytes:cost,pages});
    return structuredClone(pages[0]);
  }
}
export const ozonFinanceChunks=new OzonFinanceChunks();
