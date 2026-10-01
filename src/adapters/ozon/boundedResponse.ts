import { MpError } from '../../core/errors.js';
export async function readOzonResponse(response:Response,maxBytes:number):Promise<Buffer> {
  if(Number(response.headers.get('content-length')??0)>maxBytes) {await response.body?.cancel();throw new MpError('BULK_LIMIT_EXCEEDED',`Ozon upstream response exceeds the finite ${maxBytes} byte limit`);}
  const reader=response.body?.getReader();
  if(!reader)return Buffer.alloc(0);
  const chunks:Buffer[]=[];let length=0;
  try {
    while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>maxBytes){await reader.cancel();throw new MpError('BULK_LIMIT_EXCEEDED',`Ozon upstream response exceeds the finite ${maxBytes} byte limit`);}chunks.push(Buffer.from(next.value));}
    return Buffer.concat(chunks);
  } finally {reader.releaseLock();}
}
