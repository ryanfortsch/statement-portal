'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { INBOX_AUDIENCES, searchInbox, type InboxAudience, type InboxFilter, type InboxSearchData } from '@/lib/inbox-search';

export function InboxSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState<InboxAudience | 'all'>('all');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [data, setData] = useState<InboxSearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(20);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(''); setData(null);
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/messaging/search', { signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Search unavailable. Try again.');
      if (request.current === controller && !controller.signal.aborted) setData(result);
    } catch {
      if (request.current === controller) setError(controller.signal.aborted ? 'Search timed out. Try again.' : 'Search unavailable. Please retry or sign in again.');
    } finally { clearTimeout(timeout); if (request.current === controller) setLoading(false); }
  }
  const matches = searchInbox(data?.rows || [], query, audience, filter);
  return <div className="rt-inbox-search">
    <div className="rt-inbox-search-heading"><button type="button" className="rt-inbox-search-toggle" aria-expanded={open} aria-controls="inbox-search-panel" onClick={() => {
      if (!open) { setOpen(true); void load(); }
      else { setOpen(false); request.current?.abort(); request.current = null; }
    }}>{open ? 'Close search' : 'Search all inboxes'}</button>
    {open && <button type="button" className="rt-inbox-search-toggle" disabled={loading} onClick={() => void load()}>Refresh results</button>}</div>
    {open && <section id="inbox-search-panel" aria-label="Search all inboxes" className="rt-inbox-search-panel">
      <label className="sr-only" htmlFor="inbox-search-query">Search person, property, or message</label>
      <input id="inbox-search-query" type="search" autoFocus value={query} placeholder="Person, property, or message…" onChange={e => { setQuery(e.target.value); setLimit(20); }} />
      <div className="rt-inbox-search-filters">
        <select aria-label="Inbox" value={audience} onChange={e => { setAudience(e.target.value as InboxAudience | 'all'); setLimit(20); }}>
          <option value="all">All inboxes</option>{INBOX_AUDIENCES.map(a => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
        </select>
        <select aria-label="Message status" value={filter} onChange={e => { setFilter(e.target.value as InboxFilter); setLimit(20); }}>
          <option value="all">All statuses</option><option value="review">Needs review</option><option value="scheduled">Scheduled / sending</option><option value="handled">Handled</option>
        </select>
      </div>
      <p className="rt-inbox-search-scope">Current drafts and latest decisions from the past 7 days.</p>
      {loading && <p role="status">Loading messages…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
      {data && <>
        {!!data.unavailable.length && <p role="status" className="rt-inbox-search-warning">Results are incomplete: {data.unavailable.join(', ')} unavailable. <button type="button" onClick={() => void load()}>Retry</button></p>}
        {!!data.limited.length && <p className="rt-inbox-search-scope">Recent results are capped for {data.limited.join(', ')}. Older matches may be missing.</p>}
        <p role="status" className="rt-inbox-search-count">{matches.length} matching {matches.length === 1 ? 'message' : 'messages'}{matches.length > limit ? ` · showing ${limit}` : ''}</p>
        {!matches.length && <p>{data.unavailable.length ? 'No matches in the available results.' : 'No matches in this search range.'}</p>}
        <ul className="rt-inbox-search-results">{matches.slice(0, limit).map(row => <li key={row.key}>
          <details>
            <summary><span><strong>{row.name}</strong>{row.property && <span className="rt-inbox-search-property">{row.property}</span>}<span className="rt-inbox-search-preview">{row.text}</span></span><span className="rt-inbox-search-status">{row.status}<small>{row.audience}</small></span></summary>
            <div className="rt-inbox-search-message">
              <p className="eyebrow">Incoming message</p><p>{row.text || 'No incoming text recorded.'}</p>
              {row.reply && <><p className="eyebrow">{row.active ? 'Proposed reply' : 'Saved reply'}</p><p>{row.reply}</p></>}
              <Link href={row.href}>{row.active ? 'Open message' : 'Open ' + row.audience + ' inbox'} →</Link>
            </div>
          </details>
        </li>)}</ul>
        {matches.length > limit && <button type="button" onClick={() => setLimit(value => value + 20)}>Show more</button>}
      </>}
    </section>}
  </div>;
}
