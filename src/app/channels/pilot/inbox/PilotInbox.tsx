'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { PilotConversation } from '@/lib/calderwood-inbox-core';
import type { ThreadMessage } from '@/lib/stay-concierge';
import s from './inbox.module.css';
export type InboxData = { conversations: PilotConversation[]; selected: PilotConversation | null; messages: ThreadMessage[]; errors: string[]; threadError: string | null; asOf: string };
function time(value: string) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'Time unavailable'; }
export function PilotInbox({ data, bookingId }: { data: InboxData; bookingId?: string }) {
  const [query, setQuery] = useState('');
  const c = data.selected;
  const rows = data.conversations.filter(r => (!bookingId || r.booking?.id === bookingId) && `${r.guest_full} ${r.channel} ${r.last_preview} ${r.booking?.external_confirmation_code ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className={s.shell}>
    <header className={s.header}><Link href="/channels/pilot">⌂ Helm / 65 Calderwood</Link><span>Read-only inbox</span><Link href="/messaging">Existing messaging ↗</Link></header>
    <nav className={s.nav}><Link href="/channels/pilot">Calendar & reservations</Link><Link href="/channels/pilot/inbox" aria-current="page">Inbox</Link></nav>
    <div className={s.heading}><div><p>65 CALDERWOOD</p><h1>Guest inbox</h1><span>Recent conversations from Guesty and Helm. Sending stays in existing messaging.</span></div><button onClick={() => window.location.reload()}>Refresh</button></div>
    {data.errors.map(e => <p key={e} role="alert" className={s.warning}>{e}</p>)}
    <div className={s.columns}>
      <aside className={s.list} aria-label="Conversations"><label>Search conversations<input type="search" placeholder="Guest, channel or confirmation" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <p className={s.note}>{rows.length} conversations · recent 60-day source window</p>
        {bookingId && <p className={s.note}>Filtered to the selected reservation. <Link href="/channels/pilot/inbox">Show all</Link></p>}
        {rows.map(r => <Link key={r.conversation_id} className={`${s.row} ${r.conversation_id === c?.conversation_id ? s.active : ''}`} aria-current={r.conversation_id === c?.conversation_id ? 'true' : undefined} href={`/channels/pilot/inbox?conversation=${encodeURIComponent(r.conversation_id)}${bookingId ? `&booking=${encodeURIComponent(bookingId)}` : ''}`}><strong>{r.guest_full || 'Guest'}</strong><span>{r.last_preview || 'No message preview recorded'}</span><small>{r.channel || 'Channel unknown'} · {r.source === 'helm' ? 'Helm' : 'Guesty'}</small><small>{r.check_in || '?'} → {r.check_out || '?'}</small><small>{time(r.last_activity_at)}</small></Link>)}
        {!rows.length && <p className={s.empty}>{query ? 'No conversations match this search.' : bookingId ? 'No conversation is linked by reservation ID in this source window.' : 'No conversations returned in this source window. This does not establish complete history.'}</p>}
      </aside>
      <main className={s.thread} aria-label="Conversation history">
        <div className={s.threadHead}><h2>{c?.guest_full || 'Select a conversation'}</h2>{c && <p>{c.channel || 'Channel unknown'} · {c.source === 'guesty' ? 'Guesty via Stay Concierge' : 'Helm message records'}</p>}</div>
        {data.threadError ? <p role="alert" className={s.warning}>{data.threadError}</p> : <div className={s.messages}>{data.messages.map((m, i) => <article key={`${m.id}:${i}`} className={`${s.message} ${m.who === 'host' ? s.host : s.guest}`}><div>{m.body || 'Message has no text content'}</div><footer>{m.sender_name || (m.who === 'guest' ? 'Guest' : 'Host')}{m.via ? ` · ${m.via.replaceAll('_', ' ')}` : ''} · {time(m.at)}</footer></article>)}{c && !data.messages.length && <p className={s.empty}>No messages returned by this source. This does not confirm that the conversation is empty.</p>}</div>}
        <div className={s.readOnly}>Read-only preview · up to 200 messages. Attachments and complete history are not yet verified. <Link href="/messaging">Open existing messaging to reply ↗</Link></div>
      </main>
      <aside className={s.details} aria-label="Reservation context"><p className={s.kicker}>RESERVATION</p><h2>65 Calderwood</h2>{c ? <><dl><dt>Guest</dt><dd>{c.guest_full}</dd><dt>Arrival</dt><dd>{c.booking?.check_in || c.check_in || 'Not recorded'}</dd><dt>Departure</dt><dd>{c.booking?.check_out || c.check_out || 'Not recorded'}</dd><dt>Channel</dt><dd>{c.channel || 'Not recorded'}</dd><dt>Status</dt><dd>{c.booking?.status || 'Not verified against a reservation'}</dd><dt>Guests</dt><dd>{c.booking?.num_guests ?? 'Not recorded'}</dd><dt>Confirmation</dt><dd>{c.booking?.external_confirmation_code || 'Not recorded'}</dd></dl>{c.booking ? <><p className={s.note}>Linked using the source reservation ID and existing duplicate references.</p><Link href={`/channels/pilot?booking=${encodeURIComponent(c.booking.id)}`}>View reservation in pilot →</Link>{(c.check_in && c.check_in !== c.booking.check_in || c.check_out && c.check_out !== c.booking.check_out) && <p className={s.warning}>Conversation dates differ from the reservation. Conversation: {c.check_in} → {c.check_out}.</p>}</> : <p className={s.warning}>No unique reservation match. Dates shown are conversation metadata; no guest-name or date guessing was used.</p>}</> : <p className={s.note}>Choose a conversation to see its stay details.</p>}<p className={s.note}>Loaded {time(data.asOf)}. Refresh reloads source data; it does not mark messages read.</p></aside>
    </div>
  </div>;
}
