'use client';
import {useState,useEffect} from 'react';
import Link from 'next/link';
import type {PilotThread,PilotMessage} from '@/lib/channex-staging/messages';
import type {WorkerHealth} from '@/lib/channex-staging/worker-health';
type Snapshot={threads:PilotThread[];messages:PilotMessage[];selectedThread:string|null;checkedAt:string;health:WorkerHealth|null;status:string};
const statuses:Record<string,string>={healthy:'Message sync healthy',failing:'Message sync failed — saved history retained',stale:'Message sync stale',waiting:'Waiting for first message sync',unknown:'Message sync status unknown'};
export default function StagingMessages(){
 const [unit,setUnit]=useState('front'),[selected,setSelected]=useState<string|null>(null),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   try{
    const params=new URLSearchParams({unit,...(selected?{thread:selected}:{})});
    const response=await fetch(`/api/channels/staging/messages?${params}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    const data=await response.json();if(!response.ok)throw new Error(data.error??'Saved history unavailable');
    if(!controller.signal.aborted){setSnapshot(data);setError('');}
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Saved history unavailable');}
   finally{if(!controller.signal.aborted)timer=setTimeout(refresh,30000);}
  }
  void refresh();return()=>{controller.abort();clearTimeout(timer);};
 },[unit,selected]);
 return <main style={{maxWidth:1100,margin:'32px auto',padding:24}}>
  <Link href="/channels/staging/ownership">Back to staging workspace</Link>
  <h1 style={{fontSize:24,fontWeight:600,marginTop:20}}>Pilot message history</h1>
  <p>Saved Channex staging history · 17 Beach · Sending disabled</p>
  <div style={{margin:'20px 0'}}><label>Unit <select value={unit} onChange={e=>{setUnit(e.target.value);setSelected(null);setSnapshot(null);setError('');}}><option value="front">Front unit</option><option value="back">Back unit</option></select></label></div>
  <section aria-label="Messaging sync status" style={{padding:16,background:'white',borderRadius:8,marginBottom:20}}>
   <strong role="status">{error?'Saved history check unavailable':snapshot?statuses[snapshot.status]??'Unknown status':'Loading saved history…'}</strong>
   {error&&<p>{error}</p>}
   <p style={{fontSize:13}}>Last successful sync: {snapshot?.health?.last_success?new Date(snapshot.health.last_success).toLocaleString():'Not recorded'} · Consecutive failures: {snapshot?.health?.consecutive_failures??'—'}</p>
   <small>Worker polls each unit; this view refreshes every 30 seconds. Reports older than five minutes are stale. {error&&'Previously displayed records may be out of date.'}</small>
  </section>
  {snapshot&&<><p style={{fontSize:12}}>Read from staging storage at {new Date(snapshot.checkedAt).toLocaleString()}.</p>
   {!snapshot.threads.length?<p style={{padding:24,background:'white',borderRadius:8}}>No saved conversations for this unit. {snapshot.health?.last_success?'The latest successful scan returned no new history.':'A successful initial sync has not been verified.'} Empty staging history does not verify Airbnb delivery.</p>:<div style={{display:'grid',gridTemplateColumns:'minmax(180px, 1fr) minmax(0, 2fr)',gap:20,marginTop:16}}>
    <nav aria-label="Conversations">{snapshot.threads.map(t=><button key={t.id} onClick={()=>{setSelected(t.id);setSnapshot(null);setError('');}} style={{display:'block',width:'100%',textAlign:'left',padding:12,background:t.id===snapshot.selectedThread?'#e2eeea':'white',borderBottom:'1px solid #eee'}}><strong>{t.title}</strong><br/><small>{t.provider} · {t.bookingId?'Reservation':'Inquiry / no reservation'} · {t.closed?'Closed':'Open'}</small></button>)}</nav>
    <section aria-label="Message history" style={{background:'white',padding:20,borderRadius:8}}>{!snapshot.selectedThread?'Select a conversation.':!snapshot.messages.length?'No saved messages.':snapshot.messages.map(m=><article key={m.id} style={{marginBottom:20}}><small>{m.sender} · {m.receivedAt} (source timestamp)</small><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:6}}>{m.text||'Attachment-only message'}</p>{m.attachmentCount>0&&<small>{m.attachmentCount} attachment(s) — preview unavailable</small>}</article>)}</section>
   </div>}
  </>}
  <p style={{fontSize:12,marginTop:24}}>Previously observed history is retained; disappearance from a provider scan is not treated as deletion. No replies, thread changes, read receipts or attachment downloads. Existing Helm messaging is unchanged.</p>
 </main>;
}
