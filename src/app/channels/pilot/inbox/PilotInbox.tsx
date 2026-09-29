'use client';
import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { PilotConversation } from '@/lib/calderwood-inbox-core';
import type { ThreadMessage } from '@/lib/stay-concierge';
import { PilotFrame, PilotIcon } from '../PilotFrame';
import s from './inbox.module.css';
export type InboxData = { conversations: PilotConversation[]; selected: PilotConversation | null; messages: ThreadMessage[]; errors: string[]; threadError: string | null; asOf: string };
const timeOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' } as const;
function time(value: string, withDate = false) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', withDate ? { ...timeOptions, month: 'short', day: 'numeric' } : timeOptions) : 'Time unavailable'; }
function date(value: string, withYear = false) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }) : 'Not recorded'; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0,2).map(n => n[0]).join('').toUpperCase() || '?'; }
function day(value: string) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }) : 'Date unavailable'; }
const stayLabels: Record<string,string> = { in_house: 'Staying now', upcoming: 'Upcoming', checked_out: 'Past stay' };
const viaLabels: Record<string,string> = { guesty_auto: 'Automated message', helm_ai: 'AI-assisted message', team: 'Team', operator: 'Sent from Helm' };
export function PilotInbox({ data, bookingId }: { data: InboxData; bookingId?: string }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [mobileThread, setMobileThread] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [pending, transition] = useTransition();
  const router = useRouter();
  const timeline = useRef<HTMLDivElement>(null);
  const detailsPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (showDetails) detailsPanel.current?.focus({ preventScroll: true }); }, [showDetails]);
  const c = data.selected;
  useEffect(() => { const el = timeline.current; if (el) el.scrollTop = el.scrollHeight; }, [c?.conversation_id, data.messages.length]);
  const rows = data.conversations.filter(r => (!bookingId || r.booking?.id === bookingId) && (filter === 'all' || r.stay_status === filter) && `${r.guest_full} ${r.channel} ${r.last_preview} ${r.booking?.external_confirmation_code ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  function navigate(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault(); setMobileThread(true); setShowDetails(false);
    transition(() => router.push(href, { scroll: false }));
  }
  return <PilotFrame section="inbox"><div className={s.workspace}>
    <div className={s.heading}><div><p>GUEST COMMUNICATIONS</p><h1>Inbox <span>{data.conversations.length}</span></h1><div>Every conversation, with the stay beside it.</div></div><div className={s.actions}><span>Updated {time(data.asOf)} ET</span><button disabled={pending} onClick={() => transition(() => router.refresh())}><PilotIcon name="refresh" size={15}/>{pending ? 'Updating…' : 'Refresh'}</button></div></div>
    {data.errors.map(e => <div key={e} role="alert" className={s.warning}><PilotIcon name="info" size={16}/><span>{e}</span></div>)}
    <div className={`${s.columns} ${mobileThread ? s.mobileThread : ''} ${showDetails ? s.showDetails : ''}`}>
      <aside className={s.list} aria-label="Conversations"><div className={s.listTools}><label className={s.search}><PilotIcon name="search" size={16}/><span className={s.srOnly}>Search conversations</span><input type="search" placeholder="Search guests or messages" value={query} onChange={e => setQuery(e.target.value)}/></label><div className={s.filters}><label><span className={s.srOnly}>Filter conversations by stay</span><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All conversations</option><option value="in_house">Staying now</option><option value="upcoming">Upcoming stays</option><option value="checked_out">Past stays</option></select></label><span>{rows.length}</span></div>{bookingId && <div className={s.filterNotice}>One reservation <Link href="/channels/pilot/inbox">Show all</Link></div>}</div>
        <div className={s.conversationRows}>{rows.map(r => { const href = `/channels/pilot/inbox?conversation=${encodeURIComponent(r.conversation_id)}${bookingId ? `&booking=${encodeURIComponent(bookingId)}` : ''}`; return <Link key={r.conversation_id} className={`${s.row} ${r.conversation_id === c?.conversation_id ? s.active : ''}`} aria-current={r.conversation_id === c?.conversation_id ? 'true' : undefined} href={href} onClick={e => navigate(e,href)}><span className={`${s.avatar} ${r.source === 'helm' ? s.nativeAvatar : ''}`}>{initials(r.guest_full)}</span><div className={s.rowBody}><div className={s.rowTitle}><strong>{r.guest_full || 'Guest'}</strong><time>{r.last_activity_at ? date(r.last_activity_at.slice(0,10)) : ''}</time></div><p>{r.last_preview || 'Open conversation'}</p><div className={s.rowMeta}><span>{date(r.check_in)} – {date(r.check_out)}</span>{stayLabels[r.stay_status] && <small className={r.stay_status === 'in_house' ? s.staying : ''}>{stayLabels[r.stay_status]}</small>}</div><div className={s.rowChannel}>{r.channel || 'Channel unknown'}<span>· {r.source === 'helm' ? 'Helm' : 'Guesty'}</span></div></div></Link>; })}
          {!rows.length && <div className={s.empty}><PilotIcon name="search" size={26}/><h3>{query || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'}</h3><p>{query || filter !== 'all' ? 'Try another guest name or select all conversations.' : bookingId ? 'No linked conversation was returned for this reservation.' : 'Nothing was returned in the recent conversation window.'}</p>{(query || filter !== 'all') && <button onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button>}</div>}
        </div><div className={s.listFoot}>Recent 60-day source window</div>
      </aside>
      <main className={s.thread} aria-label="Conversation history" aria-busy={pending}>
        <header className={s.threadHead}><button className={s.backButton} aria-label="Back to conversations" onClick={() => setMobileThread(false)}><PilotIcon name="back"/></button><span className={s.avatar}>{c ? initials(c.guest_full) : <PilotIcon name="inbox"/>}</span><div><h2>{c?.guest_full || 'Your guest conversations'}</h2><p>{c ? `${c.channel || 'Channel unknown'} · 65 Calderwood` : 'Choose a guest to open their messages'}</p></div><button className={s.detailsButton} aria-label="Toggle reservation details" aria-expanded={showDetails} onClick={() => setShowDetails(!showDetails)}><PilotIcon name="info"/></button></header>
        {pending && <div className={s.progress} role="status">Loading conversation…</div>}
        {data.threadError ? <div className={s.empty}><PilotIcon name="info" size={28}/><h3>Messages couldn’t load</h3><p>{data.threadError}</p><button disabled={pending} onClick={() => transition(() => router.refresh())}>Try again</button></div> : <div ref={timeline} className={s.messages}>{data.messages.map((m,i) => <div key={`${m.id}:${i}`} className={s.messageGroup}>{(i === 0 || day(data.messages[i-1].at) !== day(m.at)) && <div className={s.dayDivider}><span>{day(m.at)}</span></div>}<article className={`${s.message} ${m.who === 'host' ? s.host : s.guest}`}><div>{m.body || 'This message has no text content.'}</div><footer><span>{m.sender_name || (m.who === 'guest' ? 'Guest' : 'Host')}{m.via ? ` · ${viaLabels[m.via] || m.via}` : ''}</span><time>{time(m.at)}</time></footer></article></div>)}{!data.messages.length && <div className={s.empty}><PilotIcon name="inbox" size={30}/><h3>{c ? 'No messages returned' : 'Select a conversation'}</h3><p>{c ? 'The source hasn’t returned any messages. Complete history is not yet verified.' : 'Guest messages and stay details will appear here.'}</p></div>}</div>}
        <footer className={s.readOnly}><div><PilotIcon name="baseline" size={17}/><span><strong>You’re in review mode</strong><small>Replies are handled in existing messaging.</small></span></div><Link href="/messaging">Open messaging <PilotIcon name="arrow" size={15}/></Link></footer>
      </main>
      <aside ref={detailsPanel} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') setShowDetails(false); }} className={s.details} aria-label="Reservation context"><div className={s.detailsHeading}><span>STAY DETAILS</span><button className={s.closeDetails} aria-label="Close reservation details" onClick={() => setShowDetails(false)}><PilotIcon name="close" size={16}/></button></div><div className={s.propertyCard}><span><PilotIcon name="home" size={22}/></span><div><h2>65 Calderwood</h2><p>Calderwood Court</p></div></div>
        {c ? <><div className={s.stayDates}><div><span>CHECK-IN</span><strong>{date(c.booking?.check_in || c.check_in, true)}</strong></div><PilotIcon name="arrow" size={15}/><div><span>CHECK-OUT</span><strong>{date(c.booking?.check_out || c.check_out, true)}</strong></div></div><dl><div><dt>Guest</dt><dd>{c.guest_full}</dd></div><div><dt>Channel</dt><dd>{c.channel || 'Not recorded'}</dd></div><div><dt>Status</dt><dd>{c.booking ? <span className={s.statusPill}>{c.booking.status}</span> : 'Unverified'}</dd></div><div><dt>Guests</dt><dd>{c.booking?.num_guests ?? 'Not recorded'}</dd></div><div><dt>Confirmation</dt><dd className={s.confirmation}>{c.booking?.external_confirmation_code || 'Not recorded'}</dd></div></dl>
          {c.booking ? <><Link className={s.reservationLink} href={`/channels/pilot?booking=${encodeURIComponent(c.booking.id)}`}>View reservation <PilotIcon name="arrow" size={15}/></Link>{((c.check_in && c.check_in !== c.booking.check_in) || (c.check_out && c.check_out !== c.booking.check_out)) && <div className={s.warning}>Dates need review. The conversation shows {date(c.check_in)} → {date(c.check_out)}.</div>}</> : <div className={s.contextNote}><PilotIcon name="info" size={16}/><p>No unique reservation match. Dates are from conversation metadata.</p></div>}
        </> : <p className={s.note}>Select a guest to see their stay details.</p>}
        <details className={s.sourceDetails}><summary>About this conversation</summary><p>{c?.source === 'guesty' ? 'Messages are read through Guesty via Stay Concierge.' : 'Messages are read from Helm’s existing records.'} Up to 200 messages are shown. Attachments and complete history are not yet verified.</p><p>Updated {time(data.asOf,true)} ET. Opening or refreshing this view does not mark messages read.</p></details>
      </aside>
    </div>
  </div></PilotFrame>;
}
