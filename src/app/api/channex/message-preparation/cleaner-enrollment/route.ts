import { NextResponse } from 'next/server';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { ownerCleanerEnrollment } from '@/lib/channex-messaging/cleaner-runtime.server';
import { cleanerEnrollmentRequestSchema } from '@/lib/channex-messaging/cleaner-runtime-contract';
export const dynamic='force-dynamic';
export const maxDuration=45;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function POST(request:Request) {
  try{await requireOwnerEmail();}catch{return json({error:'Owners only'},403);}
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')!=='application/json')return json({error:'Invalid request'},403);
  let body;
  try{
    const reader=request.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let bytes=0;
    try{for(;;){const r=await reader.read();if(r.done)break;if((bytes+=r.value.byteLength)>1500)throw Error();chunks.push(r.value);}}
    finally{await reader.cancel();reader.releaseLock();}
    body=cleanerEnrollmentRequestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
  }catch{return json({error:'Invalid request'},400);}
  try{return json(await ownerCleanerEnrollment(body));}catch{return json({state:'unavailable',canSend:false},503);}
}
