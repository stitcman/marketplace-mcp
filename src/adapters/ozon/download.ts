import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { MpError } from '../../core/errors.js';

// Public report/info example documents this file host. Unknown hosts remain denied.
const hosts = new Set(['ir.ozone.ru']);
export function isPublicOzonFileAddress(address:string): boolean {
  if(isIP(address)!==4) return false; // IPv6 requires a reviewed address policy.
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===0||b===168)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));
}
export async function resolveOzonFile(url:URL, resolver=lookup):Promise<string> {
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!hosts.has(url.hostname)) throw new MpError('LOCAL_DENY','Ozon file URL is outside the reviewed HTTPS host policy');
  const addresses=await resolver(url.hostname,{all:true,family:4});
  if(!addresses.length || addresses.some(({address})=>!isPublicOzonFileAddress(address))) throw new MpError('LOCAL_DENY','Ozon file DNS returned a non-public address');
  return addresses[0].address;
}
export async function downloadOzonFile(url:URL,maxBytes:number):Promise<{bytes:Buffer;mimeType:string}> {
  const address=await resolveOzonFile(url);
  return new Promise((resolve,reject)=>{
    const req=request(url,{method:'GET',headers:{Accept:'application/pdf,application/zip,text/csv,application/octet-stream'},
      // Pin the checked address so DNS cannot change between validation and connection.
      lookup:((_host:any,options:any,callback:any)=>options.all?callback(null,[{address,family:4}]):callback(null,address,4)) as any,
      signal:AbortSignal.timeout(30_000)},res=>{
      if(res.statusCode!==200){res.resume();reject(new MpError('LOCAL_DENY','Ozon file response rejected; redirects are never followed'));return;}
      const mimeType=String(res.headers['content-type']??'application/octet-stream').split(';')[0];
      if(!/^(application\/(pdf|zip|json|octet-stream|vnd\.[a-z0-9.+-]+|csv)|text\/(csv|plain))$/i.test(mimeType)){res.destroy();reject(new MpError('LOCAL_DENY','Unsupported Ozon file MIME type'));return;}
      if(Number(res.headers['content-length']??0)>maxBytes){res.destroy();reject(new MpError('BULK_LIMIT_EXCEEDED','Ozon file exceeds the download limit'));return;}
      const chunks:Buffer[]=[];let length=0;
      res.on('data',chunk=>{length+=chunk.length;if(length>maxBytes){res.destroy();reject(new MpError('BULK_LIMIT_EXCEEDED','Ozon file exceeds the download limit'));}else chunks.push(Buffer.from(chunk));});
      res.on('end',()=>resolve({bytes:Buffer.concat(chunks),mimeType}));
      res.on('error',()=>reject(new MpError('MARKETPLACE_UNAVAILABLE','Ozon file transfer failed')));
    });
    req.on('error',()=>reject(new MpError('MARKETPLACE_UNAVAILABLE','Ozon file request failed')));
    req.end();
  });
}
