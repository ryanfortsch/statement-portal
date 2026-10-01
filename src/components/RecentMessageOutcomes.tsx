'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CompactDisclosure } from './CompactDisclosure';
import { MessageOutcomes } from './MessageOutcomes';
import type { RecentFollowup } from '@/lib/recent-followups';

export function RecentMessageOutcomes({ initial, audience, initialError = false }: { initial: RecentFollowup[]; audience: string; initialError?: boolean }) {
  const [snapshot, setSnapshot] = useState<{items:RecentFollowup[]; error:boolean}>({items:initial,error:initialError});
  const [expanded, setExpanded] = useState(false);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
      const res = await fetch(`/api/messaging/followups?audience=${audience}`, {cache:'no-store', signal:controller.signal});
      if (!res.ok) throw new Error('unavailable');
      const data = await res.json();
      if (!Array.isArray(data.items)) throw new Error('invalid');
      if (active.current === controller) setSnapshot({items:data.items,error:false});
    } catch {
      if (active.current === controller) setSnapshot(s => ({...s,error:true}));
    } finally { clearTimeout(timeout); if (active.current === controller) active.current = null; }
  }, [audience]);
  useEffect(() => {
    const timer = setInterval(() => {if (!document.hidden && !active.current) void refresh();}, 30000);
    const onVisible = () => {if (!document.hidden) void refresh();};
    document.addEventListener('visibilitychange',onVisible);
    // Also reconciles freshly resolved cards when this section is re-rendered.
    const initialRefresh = setTimeout(() => void refresh(), 0);
    return () => {clearTimeout(initialRefresh);clearInterval(timer); document.removeEventListener('visibilitychange',onVisible); const current=active.current;active.current=null;current?.abort();};
  }, [refresh, initial]);
  const items = snapshot.items;
  if (!items.length && !snapshot.error) return null;
  return <CompactDisclosure title="Recent follow-ups" status={snapshot.error ? 'Refresh needed' : `${items.length} recent`} attention={snapshot.error}>
    <div className="rt-disclosure-toolbar">
      <span>Work and notes from resolved messages · past 7 days</span>
      <button type="button" className="rt-inline-action" onClick={() => void refresh()}>Refresh</button>
    </div>
    {snapshot.error && <p role="status" style={{color:'var(--signal)',fontSize:12}}>Couldn’t refresh follow-ups. The last loaded details are shown. <button type="button" onClick={() => void refresh()} style={{textDecoration:'underline'}}>Retry</button></p>}
    {(expanded ? items : items.slice(0,3)).map(row => <article key={row.id} id={`followup-${row.id}`} style={{padding:'14px 0',borderBottom:'1px solid var(--rule-soft)'}}>
      <div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:8}}><span className="font-serif" style={{fontSize:17}}>{row.who}{row.property ? ` · ${row.property}` : ''}</span><span style={{fontSize:11,color:'var(--ink-3)'}}>{row.replyStatus === 'approved' ? 'Reply sent' : row.replyStatus === 'manual_sent' ? 'Reply marked handled' : row.replyStatus === 'rejected' ? 'Reply rejected' : 'Reply resolved'}</span></div>
      <details style={{marginTop:6,fontSize:12,color:'var(--ink-3)'}}><summary style={{cursor:'pointer'}}>View source message</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.sourceText}</p></details>
      <MessageOutcomes value={row.outcomes} />
    </article>)}
    {items.length > 3 && <button type="button" className="eyebrow" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} style={{background:'none',border:'1px solid var(--rule)',padding:'8px 12px',marginTop:12,color:'var(--ink-3)',cursor:'pointer'}}>{expanded ? 'Show fewer' : `Show all ${items.length}`}</button>}
  </CompactDisclosure>;
}
