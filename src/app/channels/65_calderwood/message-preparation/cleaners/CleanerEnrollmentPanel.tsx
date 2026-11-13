'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { cleanerEnrollmentRequestSchema, cleanerEnrollmentOverviewSchema, type CleanerEnrollmentOverview } from '@/lib/channex-messaging/cleaner-runtime-contract';
type Reference={captureId:string;templateDigest:string};
const storageKey='helm-calderwood-cleaner-enrollment:v1';
function hasSavedRequest(reference:Reference|null,releaseId:string|null) {
  try {
    const saved=cleanerEnrollmentRequestSchema.safeParse(JSON.parse(localStorage.getItem(storageKey)??'null'));
    return Boolean(saved.success&&saved.data.action==='enroll'&&saved.data.captureId===reference?.captureId
      &&saved.data.templateDigest===reference?.templateDigest&&(!releaseId||saved.data.releaseId===releaseId));
  } catch {return false;}
}
async function call(body:unknown,signal?:AbortSignal) {
  const response=await fetch('/api/channex/message-preparation/cleaner-enrollment',{method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal??AbortSignal.timeout(45000)});
  if(!response.ok)throw Error();const out=await response.json();if(out.canSend!==false)throw Error();return out;
}
export function CleanerEnrollmentPanel({reference}:{reference:Reference|null}) {
  const [review,setReview]=useState<CleanerEnrollmentOverview|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState('');
  const [error,setError]=useState(''),[evidence,setEvidence]=useState(''),[stopped,setStopped]=useState(''),[drained,setDrained]=useState('');
  const [ack,setAck]=useState(false);const running=useRef(false);
  const [savedRequest,setSavedRequest]=useState(false);
  useEffect(()=>{
    if(!reference)return;const controller=new AbortController();
    call({action:'review',...reference},AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]))
      .then(out=>{if(controller.signal.aborted)return;
        if(out.state==='configuration_required'){setStatus('Secure cleaner delivery configuration is still pending. Sending remains off.');return;}
        if(out.state!=='review')throw Error();const next=cleanerEnrollmentOverviewSchema.parse(out.review);
        setReview(next);setSavedRequest(hasSavedRequest(reference,next.releaseId));})
      .catch(()=>{if(!controller.signal.aborted)setError('The current enrollment could not be verified. No action was taken.');});
    return()=>controller.abort();
  },[reference]);
  async function refresh() {
    if(!reference||running.current)return;running.current=true;setBusy(true);setError('');setAck(false);
    try{const out=await call({action:'review',...reference});if(out.state!=='review')throw Error();const next=cleanerEnrollmentOverviewSchema.parse(out.review);
      setReview(next);setSavedRequest(hasSavedRequest(reference,next.releaseId));setStatus('Review refreshed.');}
    catch{setReview(null);setError('The review is unavailable. Sending cannot be enabled from this page.');}
    finally{running.current=false;setBusy(false);}
  }
  async function enroll() {
    if(!reference||!review||!ack||running.current)return;running.current=true;setBusy(true);setError('');
    try{
      const request=await navigator.locks.request(storageKey,()=>{
        const saved=JSON.parse(localStorage.getItem(storageKey)??'null');
        if(saved!==null){const prior=cleanerEnrollmentRequestSchema.parse(saved);
          if(prior.action!=='enroll'||prior.captureId!==reference.captureId||prior.templateDigest!==reference.templateDigest)throw Error();return prior;}
        if(review.releaseId)throw Error();
        const next=cleanerEnrollmentRequestSchema.parse({action:'enroll',...reference,releaseId:crypto.randomUUID(),
          reviewedRecipient:review.recipientReview,reviewedRoute:review.routeGeneration,
          clearance:{sourceEvidenceId:evidence.trim(),sourceStoppedAt:stopped.trim(),sourceDrainedAt:drained.trim()}});
        localStorage.setItem(storageKey,JSON.stringify(next));setSavedRequest(true);return next;
      });
      const out=await call(request);
      if(!['created','existing'].includes(out.state)||request.action!=='enroll'||out.releaseId!==request.releaseId)throw Error();
      setStatus('Cleaner enrollment receipt confirmed. Scheduled execution remains a separate activation step.');
      const next=await call({action:'review',...reference});if(next.state!=='review')throw Error();setReview(cleanerEnrollmentOverviewSchema.parse(next.review));
    }catch{setError('Enrollment was not confirmed. The original request is saved here. Refresh, then confirm that same request; do not replace it.');}
    finally{running.current=false;setBusy(false);setAck(false);}
  }
  const ready=review?.canEnroll||Boolean(review?.releaseId&&savedRequest);
  return <>
    <section className="mt-6 rounded-2xl border p-6 sm:p-8" style={{borderColor:'var(--rule)',background:'var(--paper-2)'}}>
      <p className="eyebrow" style={{color:'var(--signal)'}}>Two reminders · One scoped cleaner</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{[['Advance reminder','10 days before arrival'],['Arrival-day reminder','7 hours before arrival']].map(([label,time])=>
        <article key={label} className="rounded-xl border p-5" style={{borderColor:'var(--rule)',background:'var(--paper)'}}><h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm">{time}</p></article>)}</div>
      <p className="mt-5 text-sm leading-6">Enrollment records the reviewed recipient, original wording and source-clearance evidence. It does not stop Guesty, enable sending or send the portal link.</p>
      {!reference?<p className="mt-4 text-sm">Open this review from the <Link className="underline" href="/channels/65_calderwood/message-preparation/templates">saved original-template archive</Link>.</p>:
        <Button className="mt-5" pending={busy} watchdog={false} onClick={refresh}>Refresh review</Button>}
    </section>
    {status&&<p role="status" className="mt-5 rounded-xl border p-4 text-sm" style={{borderColor:'var(--rule)'}}>{status}</p>}
    {error&&<p role="alert" className="mt-5 border-l-4 p-4 text-sm" style={{borderColor:'var(--negative)'}}>{error}</p>}
    {review&&<section className="mt-8">
      <h2 className="text-xl font-semibold">Handover review</h2>
      <dl className="mt-4 divide-y rounded-xl border px-5" style={{borderColor:'var(--rule)'}}>
        {[['Calendar control',review.authority==='helm'?'Helm':'Guesty'],['Scoped cleaner access',review.recipientReady?'Verified':'Needs review'],
          ['Original cleaner templates',review.templatesReady?'Unchanged':'Needs review'],['Channel handover',review.scopeEnabled?'Recorded':'Pending'],
          ['Cleaner enrollment',review.releaseId?'Receipt recorded':'Not recorded']].map(([label,value])=><div className="flex justify-between gap-5 py-4 text-sm" key={label}><dt>{label}</dt><dd className="font-medium">{value}</dd></div>)}
      </dl>
      {!ready&&<p className="mt-5 text-sm leading-6">{review.releaseId?'The enrollment receipt is already recorded. No replacement request is needed.':
        'Complete the pending handover checks before recording cleaner enrollment. Guesty queue clearance must be established separately.'}</p>}
      {ready&&<div className="mt-6 rounded-xl border p-5" style={{borderColor:'var(--rule)'}}>
        <h3 className="font-semibold">Retained source-clearance evidence</h3>
        <p className="mt-2 text-sm leading-6">Use the recorded evidence reference and actual UTC times. Do not substitute the current time or treat unavailable queue records as an empty queue.</p>
        {savedRequest&&<p role="status" className="mt-3 text-sm">A request is saved in this browser. Confirmation reuses its original recipient and clearance details.</p>}
        {[['Evidence reference',evidence,setEvidence,'UUID from the retained handover record'],['Guesty stopped at (UTC)',stopped,setStopped,'YYYY-MM-DDTHH:mm:ss.000Z'],['Provider queue cleared at (UTC)',drained,setDrained,'YYYY-MM-DDTHH:mm:ss.000Z']].map(([label,value,change,placeholder])=>
          <label className="mt-4 block text-sm" key={label as string}>{label as string}<input className="mt-2 w-full rounded-lg border p-3 font-mono text-xs" style={{borderColor:'var(--rule)',background:'var(--paper)'}}
            value={value as string} disabled={busy||savedRequest||!!review.releaseId} placeholder={placeholder as string} onChange={e=>(change as (v:string)=>void)(e.target.value)}/></label>)}
        <label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={ack} disabled={busy} onChange={e=>setAck(e.target.checked)}/>
          I reviewed the cleaner recipient and retained evidence confirming Guesty and its provider have no remaining messages for this handover.</label>
        <Button className="mt-4" variant="primary" pending={busy} watchdog={false} disabled={!ack} onClick={enroll}
          confirm={{title:'Record cleaner enrollment?',body:'Save the reviewed recipient and source-clearance receipt. No jobs or messages are created, and sending remains separately controlled.'}}>
          {review.releaseId?'Confirm saved request':'Record cleaner enrollment'}</Button>
      </div>}
    </section>}
  </>;
}
