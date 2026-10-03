'use client';
import {useRef,useState,useEffect} from 'react';
import Link from 'next/link';
import type {PilotThread,PilotMessage} from '@/lib/channex-staging/messages';
type Snapshot={threads:PilotThread[];messages:PilotMessage[];selectedThread:string|null;checkedAt:string};
export default function StagingMessages(){
 const [unit,setUnit]=useState('front'),[snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(thread?:string){
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setBusy(true);setError('');setSnapshot(null);
  try{
   const params=new URLSearchParams({unit,...(thread?{thread}:{})});
   const response=await fetch(`/api/channels/staging/messages?${params}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
   const data=await response.json();if(!response.ok)throw new Error(data.error??'Snapshot unavailable');
   if(!controller.signal.aborted)setSnapshot(data);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Snapshot unavailable');}
  finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <main style={{maxWidth:1100,margin:'32px auto',padding:24}}>
  <Link href="/channels/staging/ownership">Back to staging workspace</Link>
  <h1 style={{fontSize:24,fontWeight:600,marginTop:20}}>Pilot message history</h1>
  <p>Read-only Channex staging · 17 Beach · Sending disabled</p>
  <div style={{display:'flex',gap:12,margin:'20px 0'}}><label>Unit <select value={unit} disabled={busy} onChange={e=>{setUnit(e.target.value);setSnapshot(null);setError('');}}><option value="front">Front unit</option><option value="back">Back unit</option></select></label><button disabled={busy} onClick={()=>load()} style={{padding:'6px 12px',background:'#173f37',color:'white',borderRadius:6}}>{busy?'Reading…':'Read conversations'}</button></div>
  <p role="status">{error||(!snapshot&&!busy?'Choose a unit and read its available staging conversations.':'')}</p>
  {snapshot&&<><p style={{fontSize:12}}>Read at {new Date(snapshot.checkedAt).toLocaleString()}. Snapshot only; not background messaging sync.</p>
   {!snapshot.threads.length?<p style={{padding:24,background:'white',borderRadius:8}}>No conversations returned for this unit. Empty staging history does not verify Airbnb delivery or historical import.</p>:<div style={{display:'grid',gridTemplateColumns:'minmax(180px, 1fr) minmax(0, 2fr)',gap:20,marginTop:16}}>
    <nav aria-label="Conversations">{snapshot.threads.map(t=><button key={t.id} onClick={()=>load(t.id)} style={{display:'block',width:'100%',textAlign:'left',padding:12,background:t.id===snapshot.selectedThread?'#e2eeea':'white',borderBottom:'1px solid #eee'}}><strong>{t.title}</strong><br/><small>{t.provider} · {t.bookingId?'Reservation':'Inquiry / no reservation'} · {t.closed?'Closed':'Open'}</small></button>)}</nav>
    <section aria-label="Message history" style={{background:'white',padding:20,borderRadius:8}}>{!snapshot.selectedThread?'Select a conversation.':!snapshot.messages.length?'No messages returned.':snapshot.messages.map(m=><article key={m.id} style={{marginBottom:20}}><small>{m.sender} · {m.receivedAt} (source timestamp)</small><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:6}}>{m.text||'Attachment-only message'}</p>{m.attachmentCount>0&&<small>{m.attachmentCount} attachment(s) — preview unavailable</small>}</article>)}</section>
   </div>}
  </>}
  <p style={{fontSize:12,marginTop:24}}>This inspector reads provider history on demand. It does not send replies, close threads, mark messages read, or download attachments. Existing Helm messaging is unchanged.</p>
 </main>;
}
