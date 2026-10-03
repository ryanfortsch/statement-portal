'use client';
import {useState,useEffect} from 'react';
import Link from 'next/link';
import styles from './messages.module.css';
import type {PilotThread,PilotMessage} from '@/lib/channex-staging/messages';
import type {WorkerHealth} from '@/lib/channex-staging/worker-health';
type Snapshot={threads:PilotThread[];messages:PilotMessage[];selectedThread:string|null;checkedAt:string;health:WorkerHealth|null;status:string};
const statuses:Record<string,string>={healthy:'Message sync healthy',failing:'Message sync failed — saved history retained',stale:'Message sync stale',waiting:'Waiting for first message sync',unknown:'Message sync status unknown'};
export default function StagingMessages(){
 const [unit,setUnit]=useState('front'),[selected,setSelected]=useState<string|null>(null),[savedSnapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
 const [rehearsal,setRehearsal]=useState(false);
 const snapshot=rehearsal?sampleSnapshot(unit):savedSnapshot;
 const [query,setQuery]=useState(''),[inspector,setInspector]=useState(false);
 const active=snapshot?.threads.find(t=>t.id===(rehearsal?snapshot.selectedThread:selected));
 const threads=snapshot?.threads.filter(t=>`${t.title} ${t.provider}`.toLowerCase().includes(query.toLowerCase()))??[];
 useEffect(()=>{
  if(rehearsal)return;
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
 },[unit,selected,rehearsal]);
 return <main className={styles.workspace}>
  <header className={styles.topbar}><Link href="/channels/staging/ownership">← Staging workspace</Link><span>17 Beach <span className={styles.badge}>Read only</span></span></header>
  {rehearsal&&<div className={styles.sampleNotice}>Synthetic design rehearsal · Sample messages only · Not provider history or proof of delivery</div>}
  <div className={styles.layout}>
   <aside className={styles.sidebar}>
    <div className={styles.heading}><h1>Inbox</h1><span className={styles.count}>{snapshot?.threads.length??'—'}</span></div>
    <label className={styles.unit}>Property<select value={unit} onChange={e=>{setUnit(e.target.value);setSelected(null);setSnapshot(null);setError('');setQuery('');}}><option value="front">17 Beach · Front unit</option><option value="back">17 Beach · Back unit</option></select></label>
    <input className={styles.search} type="search" aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={e=>setQuery(e.target.value)}/>
    <button className={styles.sampleToggle} onClick={()=>{setRehearsal(!rehearsal);setSelected(null);setSnapshot(null);setError('');setQuery('');}}>{rehearsal?'Return to saved history':'Preview sample conversation'}</button>
    <div className={styles.listLabel}>{rehearsal?'Synthetic conversation':'Saved conversations'}</div>
    <nav className={styles.threadList} aria-label="Conversations">
     {threads.map(t=><button key={t.id} aria-current={t.id===selected?'true':undefined} className={`${styles.thread} ${t.id===selected?styles.selected:''}`} onClick={()=>{if(!rehearsal)setSelected(t.id);setError('');}}><span className={styles.avatar}>{t.title.slice(0,1).toUpperCase()}</span><span className={styles.threadCopy}><strong>{t.title}</strong><span>{t.provider} · {t.closed?'Closed':'Open'}</span><small>{t.messageCount} source messages · {t.bookingId?'Reservation':'Inquiry'}</small></span></button>)}
     {snapshot&&!threads.length&&<p className={styles.listEmpty}>{query?'No matching conversations.':'No conversations yet.'}</p>}
    </nav>
    <div className={styles.sync} aria-label="Messaging sync status"><strong role="status">{rehearsal?'Synthetic rehearsal — sync not measured':error?'History check unavailable':snapshot?statuses[snapshot.status]??'Unknown status':'Loading saved history…'}</strong><span>{snapshot?.health?.last_success?`Last sync ${new Date(snapshot.health.last_success).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:'No successful sync recorded'}</span></div>
   </aside>
   <section className={styles.conversation} aria-label="Message history" aria-busy={!!selected&&snapshot?.selectedThread!==selected}>
    <header className={styles.conversationHeader}><div><h2>{active?.title??'Guest conversations'}</h2><p>{active?`${active.provider} · ${active.bookingId?'Reservation':'Inquiry'}`:'Saved history from Channex staging'}</p></div><button className={styles.detailsButton} aria-expanded={inspector} aria-controls="message-details" onClick={()=>setInspector(!inspector)}>Details</button></header>
    {error&&<p className={styles.error} role="alert">{error}. Previously displayed history may be out of date.</p>}
    {inspector&&<aside id="message-details" className={styles.inspector}><strong>History details</strong><p>{active?.bookingId?`Reservation ID: ${active.bookingId}`:'No reservation selected'}</p><p>Successful sync: {snapshot?.health?.last_success?new Date(snapshot.health.last_success).toLocaleString():'Not recorded'} · Failures: {snapshot?.health?.consecutive_failures??'—'}</p><p>This view refreshes every 30 seconds. Reports older than five minutes are stale. Previously observed messages are retained if omitted from a later scan.</p></aside>}
    <div className={styles.messages}>
     {selected&&snapshot?.selectedThread!==selected?<div className={styles.empty}><h3>Loading conversation…</h3></div>:!snapshot?.selectedThread?<div className={styles.empty}><span className={styles.emptyIcon}>✉</span><h3>{snapshot?.threads.length?'Select a conversation':'Your guest history, in one place'}</h3><p>{snapshot?.threads.length?'Choose a guest to read their saved messages.':snapshot?'Conversations will appear here after they are received and saved by the staging worker.':'Checking saved history…'}</p>{snapshot&&!snapshot.threads.length&&<small>Empty staging history does not verify Airbnb delivery.</small>}</div>:!snapshot.messages.length?<div className={styles.empty}><h3>No saved messages</h3></div>:snapshot.messages.map(m=><article key={m.id} className={`${styles.message} ${m.sender==='property'?styles.outgoing:''}`}><div className={styles.messageMeta}><strong>{m.sender==='guest'?'Guest':m.sender==='property'?'Property team':'System'}</strong><time>{m.receivedAt.replace('T',' ').replace(/Z$/,' UTC')}</time></div><div className={styles.bubble}><p>{m.text||'Attachment-only message'}</p>{m.attachmentCount>0&&<small>{m.attachmentCount} attachment(s) · Preview unavailable</small>}</div>{m.updatedAt!==m.receivedAt&&<small className={styles.edited}>Edited · {m.updatedAt}</small>}</article>)}
    </div>
    <footer className={styles.readonly}><span className={styles.badge}>Read only</span><span>Replies stay in your existing inbox. This pilot does not send messages or read receipts.</span></footer>
   </section>
  </div>
 </main>;
}

function sampleSnapshot(unit:string):Snapshot{
 const thread: PilotThread={id:'synthetic-demo',unit:unit==='back'?'back':'front',title:'Sample guest',provider:'Synthetic',bookingId:null,closed:false,messageCount:3};
 return {threads:[thread],selectedThread:thread.id,checkedAt:'2026-10-02T13:05:00Z',health:null,status:'unknown',messages:[
 {id:'sample-1',text:'Hello! We are looking forward to our stay. Is there parking at the house?',sender:'guest',receivedAt:'2026-10-02T12:00:00Z',updatedAt:'2026-10-02T12:00:00Z',attachmentCount:0},
 {id:'sample-2',text:'Thanks for checking. Your arrival guide will include the parking instructions and entry details.',sender:'property',receivedAt:'2026-10-02T12:05:00Z',updatedAt:'2026-10-02T12:05:00Z',attachmentCount:0},
 {id:'sample-3',text:'Perfect, thank you. Our arrival has changed to 5 PM.',sender:'guest',receivedAt:'2026-10-02T13:00:00Z',updatedAt:'2026-10-02T13:05:00Z',attachmentCount:0}
 ]};
}
