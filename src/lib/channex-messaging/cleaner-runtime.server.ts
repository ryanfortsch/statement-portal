import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { cleanerRuntimeConfiguration, cleanerTransportConfiguration } from './cleaner-runtime-config';
import { runRetainedCleanerPilot } from './cleaner-runtime';
import { runCleanerEnrollment } from './cleaner-enrollment';
import { CleanerSmsTransport } from './cleaner-sms-transport';
import type { MessageRpc } from './store';

const rpc:MessageRpc=async(name,args)=>{
  const {data,error}=await supabaseAdmin.rpc(name,args).abortSignal(AbortSignal.timeout(8000));return {data,error};
};
export async function executeCleanerMessageTick() {
  const config=cleanerRuntimeConfiguration(process.env);
  if(!config)return {state:'disabled',ok:true,stays:[]};
  let credentials:Promise<{guestyToken:string;channexKey:string}>|undefined;
  return runRetainedCleanerPilot(config.manifest,{rpc,sms:async()=>config.transport,
    credentials:()=>credentials??=(async()=>{
      const {data,error}=await supabaseAdmin.from('guesty_auth').select('access_token,expires_at').eq('id',1)
        .abortSignal(AbortSignal.timeout(8000)).maybeSingle();
      if(error||!data||typeof data.access_token!=='string'||!data.access_token.trim()
        ||!Number.isFinite(Date.parse(data.expires_at))||Date.parse(data.expires_at)<=Date.now()+120000)throw Error('Credentials unavailable');
      return {guestyToken:data.access_token,channexKey:process.env.CHANNEX_PRODUCTION_API_KEY!};
    })(),
  },{enabled:true,receiptsOnly:config.mode==='receipts-only'});
}
export async function ownerCleanerEnrollment(raw:unknown) {
  const actor=await requireOwnerEmail();
  let config:ReturnType<typeof cleanerTransportConfiguration>;
  try {config=cleanerTransportConfiguration(process.env);}catch{return {state:'configuration_required',canSend:false};}
  return runCleanerEnrollment(raw,actor,{rpc,transport:new CleanerSmsTransport({...config,sendEnabled:false})},{enabled:true});
}
