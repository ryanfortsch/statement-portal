'use client';
import {useEffect,useState} from 'react';
import type {WorkerHealth as Health} from '@/lib/channex-staging/worker-health';
const labels:Record<string,string>={healthy:'Polling normally',failing:'Sync failed — retrying',stale:'No recent heartbeat',waiting:'Waiting for first report',unknown:'Status unknown'};
export function WorkerHealth(){
 const [value,setValue]=useState<{health:Health|null;status:string;checkedAt:string}|null>(null);
 const [unavailable,setUnavailable]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function refresh(){try{
   const response=await fetch('/api/channels/staging/health',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
   if(!response.ok)throw new Error('Unavailable');
   const data=await response.json();if(!controller.signal.aborted){setValue(data);setUnavailable(false);}
  }catch{if(!controller.signal.aborted)setUnavailable(true);}
  finally{if(!controller.signal.aborted)timer=setTimeout(refresh,30000);}}
  void refresh();return()=>{controller.abort();clearTimeout(timer);};
 },[]);
 const date=(s:string|null|undefined)=>s?new Date(s).toLocaleString():'Not recorded';
 return <section aria-label="Staging worker health" style={{margin:'20px 0',padding:'16px 20px',border:'1px solid #d9e2e0',borderRadius:8,background:'#fff'}}>
  <strong>Booking worker</strong><p role="status" style={{color:!unavailable&&value?.status==='healthy'?'#166554':'#805418'}}>{unavailable?'Health check unavailable':value?labels[value.status]??'Status unknown':'Checking worker…'}</p>
  <dl style={{display:'flex',gap:24,flexWrap:'wrap',fontSize:13}}>
   <div><dt>Last successful sync</dt><dd style={{margin:0}}>{date(value?.health?.last_success)}</dd></div>
   <div><dt>Last failure</dt><dd style={{margin:0}}>{date(value?.health?.last_failure)}</dd></div>
   <div><dt>Consecutive failures</dt><dd style={{margin:0}}>{value?.health?.consecutive_failures??'—'}</dd></div>
  </dl>
  <p style={{fontSize:12,color:'#596b67'}}>Checked: {date(value?.checkedAt)}. Refreshes every 30 seconds. Reports older than 5 minutes are stale; failed syncs may back off for up to 15 minutes. Booking polling only; messaging is not connected.</p>
 </section>;
}
