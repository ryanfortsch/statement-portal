import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { retainedRuntimeFixture } from './channex-retained-runtime.ts';
import { scheduleFixtureId as id } from './channex-schedule-snapshot.ts';
import { CleanerSmsTransport } from '../../channex-messaging/cleaner-sms-transport.ts';
import { cleanerRecipientProof } from '../../channex-messaging/cleaner-enrollment.ts';
import { runRetainedCleanerPilot } from '../../channex-messaging/cleaner-runtime.ts';
import type { CleanerSmsJob } from '../../channex-messaging/cleaner-sms-worker.ts';
import type { CleanerSmsPlan } from '../../channex-messaging/cleaner-sms-store.ts';
import { QUO_LINES } from '../../quo-lines.ts';

export function cleanerRuntimeFixture() {
  const f=retainedRuntimeFixture(), originalRpc=f.deps.rpc, originalFetch=f.deps.fetcher;
  const keys={apiKey:'SYNTHETIC_QUO',receiptKey:'c'.repeat(64),keyId:'synthetic-v1'};
  const transport=new CleanerSmsTransport(keys),jobs=new Map<string,CleanerSmsJob>();
  const enrollment={format:1 as const,observedAt:new Date(f.deps.clock()).toISOString(),authority:'helm' as 'helm'|'guesty',automationsEnabled:true,
    routeGeneration:f.context.routeGeneration,scopeEnabled:true,recipientRevision:'d'.repeat(32),
    recipients:[{enabled:true,property_ids:['65_calderwood'],region:'bridgeport_ct',phone:'+12025550123',portal_token:'a'.repeat(32),language:'en' as const}],
    currentRules:structuredClone(f.s.capturedRules.filter(r=>r.audience==='cleaner')),release:null as Record<string,unknown>|null};
  const proof=cleanerRecipientProof({...enrollment,release:null},transport);
  const release={releaseId:id(80),captureId:f.request.templateCaptureId,templateDigest:f.request.templateDigest,
    routeGeneration:f.context.routeGeneration,recipientRevision:enrollment.recipientRevision,...proof,
    sourceStoppedAt:new Date(f.deps.clock()-7200000).toISOString(),sourceDrainedAt:new Date(f.deps.clock()-3600000).toISOString(),
    sourceEvidenceId:id(81),actor:'synthetic-owner',reviewedAt:new Date(f.deps.clock()).toISOString()};
  enrollment.release=release;
  const request={...f.request,releaseId:release.releaseId},manifest={format:1,stays:[request]};
  let posts=0,claims=0,registrations=0,smsReads=0,status='queued';
  const messages=new Map<string,Record<string,unknown>>();
  f.deps.rpc=async(name,args)=>{
    if(name==='helm_channex_cleaner_enrollment_snapshot')return {data:structuredClone({...enrollment,observedAt:new Date(f.deps.clock()).toISOString()}),error:null};
    if(name==='helm_channex_cleaner_read')return {data:structuredClone(jobs.get(String(args.p_send_id))??null),error:null};
    if(name==='helm_channex_cleaner_register'){
      const p=args.p_plan as CleanerSmsPlan;const previous=jobs.get(p.sendId);
      if(previous)return {data:{state:'existing',sendId:p.sendId},error:null};
      registrations++;
      const {bindingId:_binding,...plan}=p;void _binding;
      jobs.set(p.sendId,{...plan,state:'prepared',attemptId:null,providerMessageId:null,providerStatus:null,providerUpdatedAt:null});
      f.s.ledger.push({id:p.sendId,booking_id:p.bookingId,property_id:'65_calderwood',automation_id:p.automationId,automation_key:p.key,
        fire_at:p.fireAt,status:'scheduled',planned_check_in:f.s.booking.start,planned_check_out:f.s.booking.end,sent_at:null,provider_message_id:null});
      return {data:{state:'created',sendId:p.sendId},error:null};
    }
    if(name==='helm_channex_cleaner_claim'){
      const expected=args.p_job as CleanerSmsJob,j=jobs.get(expected.sendId)!;claims++;
      if(j.state!=='prepared'||!isDeepStrictEqual(j,expected)||f.s.ledger.find(r=>r.id===j.sendId)?.status!=='scheduled')return {data:false,error:null};
      Object.assign(j,{state:'attempting',attemptId:args.p_attempt_id});f.s.ledger.find(r=>r.id===j.sendId)!.status='sending';
      return {data:true,error:null};
    }
    if(name==='helm_channex_cleaner_finish'){
      const j=jobs.get(String(args.p_send_id))!;assert.equal(j.attemptId,args.p_attempt_id);Object.assign(j,args.p_outcome);
      if(['accepted','delivered','undelivered'].includes(j.state))Object.assign(f.s.ledger.find(r=>r.id===j.sendId)!,{status:'sent',sent_at:new Date(f.deps.clock()).toISOString(),provider_message_id:j.providerMessageId});
      return {data:true,error:null};
    }
    assert.notEqual(name,'helm_channex_cleaner_enroll','A tick never enrolls');
    return originalRpc(name,args);
  };
  f.deps.fetcher=async(url,init)=>{
    if(new URL(String(url)).host!=='api.quo.com')return originalFetch(url,init);
    if(init?.method==='POST'){
      posts++;const body=JSON.parse(String(init.body)),messageId=`ACSYNTHETIC${posts}`;
      const row={id:messageId,from:QUO_LINES.ops.number,phoneNumberId:QUO_LINES.ops.id,to:body.to,text:body.content,
        direction:'outgoing',media:[],createdAt:new Date(f.deps.clock()).toISOString(),updatedAt:new Date(f.deps.clock()).toISOString(),status};
      messages.set(messageId,row);return Response.json({data:row},{status:202});
    }
    smsReads++;const messageId=new URL(String(url)).pathname.split('/').at(-1)!;
    const row=messages.get(messageId);return Response.json({data:row?{...row,status,updatedAt:new Date(f.deps.clock()).toISOString()}:null});
  };
  const deps=Object.assign(f.deps,{sms:async()=>keys});
  return {...f,deps,manifest,request,enrollment,keys,transport,jobs,messages,
    counts:()=>({posts,claims,registrations,smsReads}),status:(s:string)=>{status=s;},
    tick:(receiptsOnly=false)=>runRetainedCleanerPilot(manifest,deps,{enabled:true,receiptsOnly})};
}
