import 'server-only';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { cleanerManifestSchema, type CleanerStayRequest } from './cleaner-runtime-config.ts';
import { CleanerSmsTransport } from './cleaner-sms-transport.ts';
import { CleanerSmsWorker, renderRetainedCleanerSms, type CleanerSmsJob } from './cleaner-sms-worker.ts';
import { createCleanerSmsStore } from './cleaner-sms-store.ts';
import { readCleanerEnrollment, cleanerRecipientProof, sameCleanerEnrollment } from './cleaner-enrollment.ts';
import { createCalderwoodScheduleInputReader } from './schedule-inputs.ts';
import { createCalderwoodTemplateCaptureReader } from './template-retention.ts';
import { loadVerifiedRetainedStay } from './retained-stay.ts';
import { planCalderwoodSchedule } from './schedule-plan.ts';
import type { MessageRpc } from './store.ts';

export const cleanerKeys=['cleaner_reminder','cleaner_arrival'] as const;
type Key=typeof cleanerKeys[number];
type Deps={rpc:MessageRpc; credentials:()=>Promise<{guestyToken:string;channexKey:string}>;
  sms:()=>Promise<{apiKey:string;receiptKey:string;keyId:string}>; fetcher?:typeof fetch; clock?:()=>number};
type StayResult={action:'idle'|'schedule'|'dispatch';state:string;attention:boolean;
  providerReads:number;providerPosts:number;receiptState?:string};
const lateWindow=1800000;
export function retainedCleanerSendId(bookingId:string,key:Key) {
  z.uuid().parse(bookingId);z.enum(cleanerKeys).parse(key);
  const h=createHash('sha256').update(`helm:channex:cleaner-schedule:v1:65_calderwood:${bookingId}:${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-${((parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}
const reference=(r:CleanerStayRequest)=>({captureId:r.templateCaptureId,templateDigest:r.templateDigest});
type Snapshot=Awaited<ReturnType<typeof loadVerifiedRetainedStay>>['snapshot'];
function validateEnrollment(request:CleanerStayRequest,s:Awaited<ReturnType<typeof readCleanerEnrollment>>,
  snapshot:Snapshot,transport:CleanerSmsTransport,at:number) {
  const x=s.release, proof=cleanerRecipientProof(s,transport);
  if(!x||x.releaseId!==request.releaseId||x.captureId!==request.templateCaptureId||x.templateDigest!==request.templateDigest
    ||s.authority!=='helm'||!s.automationsEnabled||!s.scopeEnabled||x.routeGeneration!==s.routeGeneration
    ||x.routeGeneration!==snapshot.timingEvidence.binding.routeGeneration||x.recipientRevision!==s.recipientRevision
    ||x.keyId!==proof.keyId||x.recipientHmac!==proof.recipientHmac||x.targetHmac!==proof.targetHmac
    ||Date.parse(x.reviewedAt)>at||snapshot.booking.id!==request.bookingId) throw Error();
  for(const key of cleanerKeys) {
    const original=snapshot.capturedRules.find(r=>r.key===key);
    if(!original||!isDeepStrictEqual(original,s.currentRules.find(r=>r.id===original.id))
      ||!isDeepStrictEqual(original,snapshot.currentRules.find(r=>r.id===original.id))) throw Error();
  }
}
const reviewFor=(snapshot:Snapshot,enrollment:Awaited<ReturnType<typeof readCleanerEnrollment>>,key:Key)=>({
  contextRevision:snapshot.timingEvidence.binding.contextRevision,
  propertyName:snapshot.merge.property_name??'',rule:snapshot.capturedRules.find(r=>r.key===key)!,
  clocks:snapshot.clocks,recipients:enrollment.recipients,
});

/** Four explicit existing stays at most. Separate receipt-only mode needs no
 * Guesty credential, live enrollment or current booking. No automatic enrollment,
 * replacement identities, past-message catch-up or retry of an uncertain send. */
export async function runRetainedCleanerPilot(raw:unknown,deps:Deps,options:{enabled?:boolean;receiptsOnly?:boolean}={}) {
  if(options.enabled!==true) return {state:'disabled',ok:true,stays:[] as StayResult[]};
  const parsed=cleanerManifestSchema.safeParse(raw);
  if(!parsed.success) return {state:'configuration_required',ok:false,stays:[] as StayResult[]};
  const clock=deps.clock??Date.now;
  const stays=await Promise.all(parsed.data.stays.map(async(request):Promise<StayResult>=>{
    let providerReads=0,providerPosts=0;
    const outcome=(action:StayResult['action'],state:string,attention=true):StayResult=>({action,state,attention,providerReads,providerPosts});
    try {
      const started=clock();let last=started;
      const now=()=>{const at=clock();if(!Number.isSafeInteger(at)||!Number.isSafeInteger(started)||at<last||at-started>=135000)throw Error();last=at;return at;};
      const rpc:MessageRpc=async(name,args)=>{now();const out=await deps.rpc(name,args);now();return out;};
      const store=createCleanerSmsStore(rpc,{enabled:true});
      const jobs=await Promise.all(cleanerKeys.map(async key=>({key,job:await store.read(retainedCleanerSendId(request.bookingId,key)) as CleanerSmsJob|null})));
      if(jobs.some(({key,job})=>job&&(job.bookingId!==request.bookingId||job.key!==key||job.releaseId!==request.releaseId)))throw Error();
      const fetcher:typeof fetch=async(url,init)=>{
        now();
        if(init?.method==='GET'&&init.body===undefined) {if(++providerReads>25)throw Error();}
        else if(init?.method==='POST'&&String(url)==='https://api.quo.com/v1/messages'&&!options.receiptsOnly) {if(++providerPosts>1)throw Error();}
        else throw Error();
        const signal=AbortSignal.any([AbortSignal.timeout(Math.min(8000,135000-(now()-started))),...(init.signal?[init.signal]:[])]);
        return (deps.fetcher??fetch)(url,{...init,signal});
      };
      let transport:CleanerSmsTransport|undefined;
      const sms=async()=>transport??=new CleanerSmsTransport({...await deps.sms(),sendEnabled:!options.receiptsOnly,clock,fetcher:(url,init)=>fetcher(url,init)});
      const local=async()=>{
        const [inputs,archive,enrollment]=await Promise.all([
          createCalderwoodScheduleInputReader(rpc,{enabled:true}).load(request.bookingId,request.bindingId,now),
          createCalderwoodTemplateCaptureReader(rpc,{enabled:true}).load(request.templateCaptureId,request.templateDigest,now()),
          readCleanerEnrollment(reference(request),rpc,now),
        ]);
        if(!inputs||!archive)throw Error();
        const snapshot={...inputs.snapshot,capturedRules:archive.capturedRules};
        validateEnrollment(request,enrollment,snapshot,await sms(),now());
        return {snapshot,enrollment};
      };
      const fresh=async()=>{
        const before=await readCleanerEnrollment(reference(request),rpc,now);
        const {snapshot}=await loadVerifiedRetainedStay(request,{rpc,now,fetcher,credentials:deps.credentials});
        const enrollment=await readCleanerEnrollment(reference(request),rpc,now);
        if(!sameCleanerEnrollment(before,enrollment))throw Error();
        validateEnrollment(request,enrollment,snapshot,await sms(),now());
        return {snapshot,enrollment};
      };
      const operate=async():Promise<StayResult>=>{
        if(options.receiptsOnly)return outcome('idle','receipts_only',jobs.some(({job})=>
          job&&['attempting','unknown','aborted','rejected','undelivered'].includes(job.state)));
        const {snapshot:s,enrollment}=await local(),at=now();
        const plans=planCalderwoodSchedule({stay:{canonicalId:request.bookingId,status:s.booking.status,duplicateOf:s.booking.duplicateOf,clocks:s.clocks},
          rules:s.capturedRules,ledger:s.ledger,now:at}).filter(p=>cleanerKeys.some(k=>k===p.key));
        let attention=jobs.some(({job})=>job&&['attempting','unknown','aborted','rejected','undelivered'].includes(job.state));
        const future:Key[]=[];
        let due:CleanerSmsJob|null=null;
        for(const p of plans) {
          const key=p.key as Key,job=jobs.find(j=>j.key===key)!.job;
          if(job&&['future_candidate','past_not_replayed'].includes(p.state)) {attention=true;continue;}
          if(p.state==='existing_schedule'&&(!job||!p.fireAt||Date.parse(job.fireAt)!==Date.parse(p.fireAt))) {attention=true;continue;}
          if(['held','history_conflict','schedule_changed','dst_review','timing_review','template_review','stay_inactive'].includes(p.state)) {attention=true;continue;}
          if(p.state==='future_candidate'&&!job) {
            try {const rendered=renderRetainedCleanerSms(reviewFor(s,enrollment,key),await sms(),now());
              if(Date.parse(rendered.fireAt)>at+500*86400000)throw Error();future.push(key);
            }catch{attention=true;}
          } else if(p.state==='existing_schedule'&&p.fireAt&&Date.parse(p.fireAt)<=at) {
            if(!job||job.state!=='prepared'||at>=Date.parse(job.expiresAt))attention=true;
            else if(!due||Date.parse(job.fireAt)<Date.parse(due.fireAt))due=job;
          } else if(p.state==='delivery_uncertain'&&job?.state!=='accepted')attention=true;
        }
        if(due) {
          const target=due;
          const worker=new CleanerSmsWorker({enabled:true,transport:await sms(),clock:now,store:{...store,
            finish:createCleanerSmsStore(deps.rpc,{enabled:true}).finish}});
          const out=await worker.dispatch(target.sendId,async job=>{
            if(!isDeepStrictEqual(job,target))throw Error();
            const loaded=await fresh();
            const p=planCalderwoodSchedule({stay:{canonicalId:request.bookingId,status:loaded.snapshot.booking.status,
              duplicateOf:loaded.snapshot.booking.duplicateOf,clocks:loaded.snapshot.clocks},rules:loaded.snapshot.capturedRules,
              ledger:loaded.snapshot.ledger,now:now()}).find(p=>p.key===target.key);
            if(p?.state!=='existing_schedule')throw Error();
            return reviewFor(loaded.snapshot,loaded.enrollment,target.key);
          });
          return outcome('dispatch',out.state,attention||out.state!=='accepted');
        }
        if(future.length) {
          for(const key of future) {
            const loaded=await fresh();
            const p=planCalderwoodSchedule({stay:{canonicalId:request.bookingId,status:loaded.snapshot.booking.status,
              duplicateOf:loaded.snapshot.booking.duplicateOf,clocks:loaded.snapshot.clocks},rules:loaded.snapshot.capturedRules,
              ledger:loaded.snapshot.ledger,now:now()}).find(p=>p.key===key);
            if(p?.state!=='future_candidate')return outcome('schedule','changed');
            const rendered=renderRetainedCleanerSms(reviewFor(loaded.snapshot,loaded.enrollment,key),await sms(),now());
            const plan={sendId:retainedCleanerSendId(request.bookingId,key),bookingId:request.bookingId,
              automationId:rendered.automationId,releaseId:request.releaseId,bindingId:request.bindingId,propertyId:'65_calderwood',key,
              keyId:rendered.keyId,contextRevision:rendered.contextRevision,recipientHmac:rendered.recipientHmac,
              targetHmac:rendered.targetHmac,bodySha256:rendered.bodySha256,fireAt:new Date(rendered.fireAt).toISOString(),
              expiresAt:new Date(Date.parse(rendered.fireAt)+lateWindow).toISOString()};
            try {const registered=await store.register(plan);if(!['created','existing'].includes(registered.state))return outcome('schedule','changed');}
            catch{return outcome('schedule','uncertain');}
          }
          return outcome('schedule','complete',attention);
        }
        return outcome('idle',attention?'review_required':'waiting',attention);
      };
      const accepted=jobs.flatMap(j=>j.job?.state==='accepted'?[j.job]:[]);
      const receipt=accepted.length?accepted[Math.floor(now()/60000)%accepted.length]:null;
      const reconcile=async()=>receipt?new CleanerSmsWorker({enabled:true,transport:await sms(),clock,
        store:createCleanerSmsStore(deps.rpc,{enabled:true})}).reconcile(receipt.sendId):null;
      // Receipt recovery is independent of current source, access, timing, holds
      // and cancellation. A broken dispatch path cannot starve accepted receipts.
      const [out,recovered]=await Promise.all([operate().catch(()=>outcome('idle','unavailable')),reconcile()]);
      return {...out,providerReads,providerPosts,...(recovered?{receiptState:recovered.state,
        attention:out.attention||!['accepted','delivered'].includes(recovered.state)}:{})};
    }catch{return outcome('idle','unavailable');}
  }));
  return {state:'complete',ok:stays.every(s=>!s.attention),stays};
}
