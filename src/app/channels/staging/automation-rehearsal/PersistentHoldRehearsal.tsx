'use client';
import { useState } from 'react';
import type { PersistentHoldState } from '@/lib/channex-staging/hold-rehearsal';
const endpoint = '/api/channels/staging/automation-rehearsal';
export function PersistentHoldRehearsal() {
 const [state,setState] = useState<PersistentHoldState | null>(null);
 const [pending,setPending] = useState(false);
 const [notice,setNotice] = useState('');
 async function read() {
  const response = await fetch(endpoint,{cache:'no-store'});
  if (!response.ok) throw new Error('Storage unavailable. No change confirmed.');
  const data = await response.json() as PersistentHoldState;
  if (!['held','scheduled'].includes(data.status) || !data.updatedAt || !Array.isArray(data.events)) throw new Error('Unexpected storage response.');
  setState(data);
 }
 async function refresh() {
  setPending(true); setState(null); setNotice('');
  try { await read(); setNotice('Loaded from the isolated staging database.'); }
  catch { setNotice('Could not read storage. Controls remain disabled.'); }
  finally { setPending(false); }
 }
 async function change() {
  if (!state || pending) return;
  setPending(true); setNotice('');
  try {
   const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({hold:state.status !== 'held',expectedUpdatedAt:state.updatedAt})});
   const result = await response.json();
   if (!response.ok) throw new Error(result.error || 'Change not confirmed. Refresh before trying again.');
   await read(); setNotice('Saved and read back from staging. Nothing was sent.');
  } catch (error) { setState(null); setNotice(error instanceof Error ? error.message : 'Refresh before trying again.'); }
  finally { setPending(false); }
 }
 return <section style={{border:'1px solid var(--rule)',padding:20,marginTop:24}}>
  <h2>Persistent storage rehearsal</h2>
  <p>One shared fictional message in the isolated staging database. Saves survive refresh. There is no delivery worker for this fixture.</p>
  <button type="button" disabled={pending} onClick={refresh}>Load saved state</button>
  {state && <>
   <p>Saved status: <strong>{state.status === 'held' ? 'Held' : 'Scheduled (no delivery)'}</strong></p>
   <p>Version: <code>{state.updatedAt}</code></p>
   <button type="button" disabled={pending} onClick={change}>{state.status === 'held' ? 'Release saved test message' : 'Hold saved test message'}</button>
   <h3>Saved change history</h3>
   {state.events.length ? <ul>{state.events.map(event => <li key={event.id}>{event.action} at {event.happened_at}</li>)}</ul> : <p>No changes recorded yet.</p>}
  </>}
  <p role="status">{notice}</p>
 </section>;
}
