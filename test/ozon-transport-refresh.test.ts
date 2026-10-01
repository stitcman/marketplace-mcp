import assert from 'node:assert/strict';
import { MarketplaceReadTransport } from '../src/core/genericReadTransport.js';
import { findReadMethod } from '../src/core/readPolicies.js';
import { withRetries } from '../src/core/rateLimiter.js';
import { MpError } from '../src/core/errors.js';
const transport=new MarketplaceReadTransport();
const fetchBefore=globalThis.fetch;
let requests:any[]=[];
globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return new Response('{"list":[]}',{headers:{'content-type':'application/json'}});};
let failures=0;
async function check(name:string,fn:()=>Promise<void>){try{requests=[];await fn();console.log(`PASS ${name}`);}catch(e){failures++;console.error(`FAIL ${name}: ${(e as Error).message}`);}}
try {
  const method=findReadMethod('ozon','CampaignList') ?? (await import('../src/core/readPolicies.js')).getReadPolicy('ozon').find(x=>x.endpoint_group==='performance'&&!x.report_job&&x.http_method==='GET')!;
  assert(method);
  await check('Performance uses a separate server-provisioned bearer and official host',async()=>{
    await transport.send({marketplace:'ozon',connectionId:'synthetic-performance',method,params:{},credentials:{performance_access_token:'synthetic-performance-token',performance_expires_at:'2099-01-01T00:00:00Z',client_id:'synthetic-seller',api_key:'synthetic-seller'}});
    assert.equal(new URL(requests[0].url).origin,'https://api-performance.ozon.ru');
    assert.equal(requests[0].init.headers.Authorization,'Bearer synthetic-performance-token');
    assert.equal(requests[0].init.headers['Api-Key'],undefined);
    assert.equal(requests[0].init.headers['Client-Id'],undefined);
    assert.equal(requests[0].init.redirect,'error');
  });
  await check('Seller credentials cannot authenticate Performance; expired bearer sends zero requests',async()=>{
    for(const credentials of [{client_id:'synthetic',api_key:'synthetic'},{performance_access_token:'synthetic',performance_expires_at:'2020-01-01T00:00:00Z'}]) {
      await assert.rejects(transport.send({marketplace:'ozon',connectionId:'synthetic',method,params:{},credentials}), (e:any)=>['AUTH_FAILED','FEATURE_NOT_AVAILABLE_FOR_ACCOUNT'].includes(e.code));
      assert.equal(requests.length,0);
    }
  });
  await check('report creation is never retried after uncertain network failure',async()=>{
    globalThis.fetch=async()=>{requests.push({});throw Error('synthetic network failure');};
    const report=findReadMethod('ozon','ReportAPI_CreateCompanyProductsReport')!;
    await assert.rejects(transport.send({marketplace:'ozon',connectionId:'synthetic-report',method:report,params:{},credentials:{client_id:'synthetic',api_key:'synthetic'}}));
    assert.equal(requests.length,1);
  });
  await check('Retry-After is respected; long waits return to caller without early retry',async()=>{
    let attempts=0;
    const started=Date.now();
    const result=await withRetries(async()=>{if(++attempts===1)throw new MpError('RATE_LIMITED','synthetic',{retryable:true,details:{retry_after_ms:40}});return true;},{baseMs:1,respectRetryAfter:true});
    assert.equal(result,true);assert(Date.now()-started>=35);assert.equal(attempts,2);
    attempts=0;
    await assert.rejects(withRetries(async()=>{attempts++;throw new MpError('RATE_LIMITED','synthetic',{retryable:true,details:{retry_after_ms:60_000}});},{baseMs:1,respectRetryAfter:true}));
    assert.equal(attempts,1);
  });
} finally {globalThis.fetch=fetchBefore;}
if(failures)process.exitCode=1;
