'use client';
import { useState } from 'react';
import Link from 'next/link';
export default function ClosureTest() {
 const [busy,setBusy]=useState(false),[result,setResult]=useState('');
 async function act(action: 'run'|'reconcile'|'history'|'drill') {
  setBusy(true);
  try {
   const response=await fetch('/api/channels/staging/closure',{method:action==='history'?'GET':'POST',headers:{'Content-Type':'application/json'},...(action==='history'?{}:{body:JSON.stringify({action})}),cache:'no-store'});
   const data=await response.json();setResult(JSON.stringify(data,null,2));
  } catch {setResult('Connection interrupted. Read history, then reconcile.');} finally {setBusy(false);}
 }
 return <main style={{maxWidth:900,margin:'40px auto',padding:24}}>
  <Link href="/channels/staging">← Staging workspace</Link>
  <h1>Staging closure test</h1>
  <p>February 1, 2027 · Front and back units · Inventory zero · Stop-sell stays enabled</p>
  <p>This single test operation can only close the two staging units. It cannot reopen dates. A matching read-back confirms inventory, not ownership of a provider block.</p>
  <p>Recovery drill: after the baseline completes, inject one completion-save failure. Then read history and reconcile. This is a simulated storage failure with real staging read-back, not a network outage. The drill cannot publish inventory and runs only once.</p>
  <div style={{display:'flex',gap:12}}>
   <button disabled={busy} onClick={()=>act('run')}>Run closure test</button>
   <button disabled={busy} onClick={()=>act('drill')}>Inject completion-save failure</button>
   <button disabled={busy} onClick={()=>act('history')}>Read saved history</button>
   <button disabled={busy} onClick={()=>act('reconcile')}>Reconcile interrupted test</button>
  </div>
  <pre aria-live="polite" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{busy?'Working…':result}</pre>
 </main>;
}
